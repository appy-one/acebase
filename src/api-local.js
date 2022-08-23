const { Api } = require('acebase-core');
const { AceBaseStorage, AceBaseStorageSettings } = require('./storage-acebase');
const { SQLiteStorage, SQLiteStorageSettings } = require('./storage-sqlite');
const { MSSQLStorage, MSSQLStorageSettings } = require('./storage-mssql');
const { CustomStorage, CustomStorageSettings } = require('./storage-custom');
const { VALUE_TYPES } = require('./node-value-types');
const { query: executeQuery } = require('./query');

/**
 * @typedef {import('./data-index').DataIndex} DataIndex
 * @typedef {import('./storage').StorageSettings} StorageSettings
 * @typedef {import('acebase-core').AceBaseBase} AceBaseBase
 */

class LocalApi extends Api {
    // All api methods for local database instance

    /**
     *
     * @param {{db: AceBaseBase, storage: StorageSettings, logLevel?: string }} settings
     */
    constructor(dbname = 'default', settings, readyCallback) {
        super();
        this.db = settings.db;

        if (typeof settings.storage === 'object') {
            settings.storage.logLevel = settings.logLevel;
            if (SQLiteStorageSettings && (settings.storage instanceof SQLiteStorageSettings || settings.storage.type === 'sqlite')) {
                this.storage = new SQLiteStorage(dbname, settings.storage);
            }
            else if (MSSQLStorageSettings && (settings.storage instanceof MSSQLStorageSettings || settings.storage.type === 'mssql')) {
                this.storage = new MSSQLStorage(dbname, settings.storage);
            }
            else if (CustomStorageSettings && (settings.storage instanceof CustomStorageSettings || settings.storage.type === 'custom')) {
                this.storage = new CustomStorage(dbname, settings.storage);
            }
            else {
                const storageSettings = settings.storage instanceof AceBaseStorageSettings
                    ? settings.storage
                    : new AceBaseStorageSettings(settings.storage);
                this.storage = new AceBaseStorage(dbname, storageSettings);
            }
        }
        else {
            settings.storage = new AceBaseStorageSettings({ logLevel: settings.logLevel });
            this.storage = new AceBaseStorage(dbname, settings.storage);
        }
        this.storage.on('ready', readyCallback);
    }

    stats(options) {
        return Promise.resolve(this.storage.stats);
    }

    subscribe(path, event, callback) {
        this.storage.subscriptions.add(path, event, callback);
    }

    unsubscribe(path, event = undefined, callback = undefined) {
        this.storage.subscriptions.remove(path, event, callback);
    }

    /**
     * Creates a new node or overwrites an existing node
     * @param {Storage} storage
     * @param {string} path
     * @param {any} value Any value will do. If the value is small enough to be stored in a parent record, it will take care of it
     * @param {object} [options]
     * @param {boolean} [options.suppress_events=false] whether to suppress the execution of event subscriptions
     * @param {any} [options.context=null] Context to be passed along with data events
     * @returns {Promise<{ cursor?: string }>} returns a promise with the new cursor (if transaction logging is enabled)
     */
    async set(path, value, options = { suppress_events: false, context: null }) {
        const cursor = await this.storage.setNode(path, value, { suppress_events: options.suppress_events, context: options.context });
        return { cursor };
    }

    /**
     * Updates an existing node, or creates a new node.
     * @param {string} path
     * @param {any} updates
     * @param {object} [options]
     * @param {boolean} [options.suppress_events=false] whether to suppress the execution of event subscriptions
     * @param {any} [options.context=null] Context to be passed along with data events
     * @returns {Promise<{ cursor?: string }>} returns a promise with the new cursor (if transaction logging is enabled)
     */
    async update(path, updates, options = { suppress_events: false, context: null }) {
        const cursor = await this.storage.updateNode(path, updates, { suppress_events: options.suppress_events, context: options.context });
        return { cursor };
    }

    get transactionLoggingEnabled() {
        return this.storage.settings.transactions && this.storage.settings.transactions.log === true;
    }

    /**
     * Gets the value of a node
     * @param {string} path
     * @param {object} [options] when omitted retrieves all nested data. If include is set to an array of keys it will only return those children. If exclude is set to an array of keys, those values will not be included
     * @param {string[]} [options.include] keys to include
     * @param {string[]} [options.exclude] keys to exclude
     * @param {boolean} [options.child_objects=true] whether to include child objects
     * @returns {Promise<{ value: any, context: any, cursor?: string }>}
     */
    async get(path, options) {
        // const context = {};
        // if (this.transactionLoggingEnabled) {
        //     context.acebase_cursor = ID.generate();
        // }
        if (!options) { options = {}; }
        if (typeof options.include !== 'undefined' && !(options.include instanceof Array)) {
            throw new TypeError(`options.include must be an array of key names`);
        }
        if (typeof options.exclude !== 'undefined' && !(options.exclude instanceof Array)) {
            throw new TypeError(`options.exclude must be an array of key names`);
        }
        if (['undefined','boolean'].indexOf(typeof options.child_objects) < 0) {
            throw new TypeError(`options.child_objects must be a boolean`);
        }
        const node = await this.storage.getNode(path, options);
        return { value: node.value, context: { acebase_cursor: node.cursor }, cursor: node.cursor };
    }

    /**
     * Performs a transaction on a Node
     * @param {string} path
     * @param {(currentValue: any) => Promise<any>} callback callback is called with the current value. The returned value (or promise) will be used as the new value. When the callbacks returns undefined, the transaction will be canceled. When callback returns null, the node will be removed.
     * @param {object} [options]
     * @param {boolean} [options.suppress_events=false] whether to suppress the execution of event subscriptions
     * @param {any} [options.context=null]
     * @returns {Promise<{ cursor?: string }>} returns a promise with the new cursor (if transaction logging is enabled)
     */
    async transaction(path, callback, options = { suppress_events: false, context: null }) {
        const cursor = await this.storage.transactNode(path, callback, { suppress_events: options.suppress_events, context: options.context });
        return { cursor };
    }

    async exists(path) {
        const nodeInfo = await this.storage.getNodeInfo(path);
        return nodeInfo.exists;
    }

    // query2(path, query, options = { snapshots: false, include: undefined, exclude: undefined, child_objects: undefined }) {
    //     /*

    //     Now that we're using indexes to filter data and order upon, each query requires a different strategy
    //     to get the results the quickest.

    //     So, we'll analyze the query first, build a strategy and then execute the strategy

    //     Analyze stage:
    //     - what path is being queried (wildcard path or single parent)
    //     - which indexes are available for the path
    //     - which indexes can be used for filtering
    //     - which indexes can be used for sorting
    //     - is take/skip used to limit the result set

    //     Strategy stage:
    //     - chain index filtering
    //     - ....

    //     TODO!
    //     */
    // }

    /**
     *
     * @param {string} path
     * @param {object} query
     * @param {Array<{ key: string, op: string, compare: any}>} query.filters
     * @param {number} query.skip number of results to skip, useful for paging
     * @param {number} query.take max number of results to return
     * @param {Array<{ key: string, ascending: boolean }>} query.order
     * @param {object} [options]
     * @param {boolean} [options.snapshots=false] whether to return matching data, or paths to matching nodes only
     * @param {string[]} [options.include] when using snapshots, keys or relative paths to include in result data
     * @param {string[]} [options.exclude] when using snapshots, keys or relative paths to exclude from result data
     * @param {boolean} [options.child_objects] when using snapshots, whether to include child objects in result data
     * @param {(event: { name: string, [key: string]: any }) => void} [options.eventHandler]
     * @param {object} [options.monitor] NEW (BETA) monitor changes
     * @param {boolean} [options.monitor.add=false] monitor new matches (either because they were added, or changed and now match the query)
     * @param {boolean} [options.monitor.change=false] monitor changed children that still match this query
     * @param {boolean} [options.monitor.remove=false] monitor children that don't match this query anymore
     * @returns {Promise<{ results: object[]|string[], context: any, stop(): Promise<void> }>} returns a promise that resolves with matching data or paths in `results`
     */
    query(path, query, options = { snapshots: false, include: undefined, exclude: undefined, child_objects: undefined, eventHandler: event => {} }) {
        return executeQuery(this, path, query, options);
    }

    /**
     * Creates an index on key for all child nodes at path
     * @param {string} path
     * @param {string} key
     * @param {object} [options]
     * @returns {Promise<DataIndex>}
     */
    createIndex(path, key, options) {
        return this.storage.indexes.create(path, key, options);
    }

    /**
     * Gets all indexes
     * @returns {Promise<DataIndex[]>}
     */
    getIndexes() {
        return Promise.resolve(this.storage.indexes.list());
    }

    /**
     * Deletes an existing index from the database
     * @param {string} filePath
     * @returns
     */
    async deleteIndex(filePath) {
        return this.storage.indexes.delete(filePath);
    }

    async reflect(path, type, args) {
        args = args || {};
        const getChildren = async (path, limit = 50, skip = 0, from = null) => {
            if (typeof limit === 'string') { limit = parseInt(limit); }
            if (typeof skip === 'string') { skip = parseInt(skip); }
            if (['null','undefined'].includes(from)) { from = null; }
            const children = [];
            let n = 0, stop = false, more = false; //stop = skip + limit,
            await this.storage.getChildren(path)
                .next(childInfo => {
                    if (stop) {
                        // Stop 1 child too late on purpose to make sure there's more
                        more = true;
                        return false; // Stop iterating
                    }
                    n++;
                    const include = from !== null ? childInfo.key > from : skip === 0 || n > skip;
                    if (include) {
                        children.push({
                            key: typeof childInfo.key === 'string' ? childInfo.key : childInfo.index,
                            type: childInfo.valueTypeName,
                            value: childInfo.value,
                            // address is now only added when storage is acebase. Not when eg sqlite, mssql
                            address: typeof childInfo.address === 'object' && 'pageNr' in childInfo.address ? { pageNr: childInfo.address.pageNr, recordNr: childInfo.address.recordNr } : undefined,
                        });
                    }
                    stop = limit > 0 && children.length === limit; // flag, but don't stop now. Otherwise we won't know if there's more
                })
                .catch(err => {
                    // Node doesn't exist? No children..
                });
            return {
                more,
                list: children,
            };
        };
        switch(type) {
            case 'children': {
                return getChildren(path, args.limit, args.skip, args.from);
            }
            case 'info': {
                const info = {
                    key: '',
                    exists: false,
                    type: 'unknown',
                    value: undefined,
                    children: {
                        count: 0,
                        more: false,
                        list: [],
                    },
                };
                const nodeInfo = await this.storage.getNodeInfo(path, { include_child_count: args.child_count === true });
                info.key = typeof nodeInfo.key !== 'undefined' ? nodeInfo.key : nodeInfo.index;
                info.exists = nodeInfo.exists;
                info.type = nodeInfo.exists ? nodeInfo.valueTypeName : undefined;
                info.value = nodeInfo.value;
                info.address = typeof nodeInfo.address === 'object' && 'pageNr' in nodeInfo.address ? { pageNr: nodeInfo.address.pageNr, recordNr: nodeInfo.address.recordNr } : undefined;
                let isObjectOrArray = nodeInfo.exists && nodeInfo.address && [VALUE_TYPES.OBJECT, VALUE_TYPES.ARRAY].includes(nodeInfo.type);
                if (args.child_count === true) {
                    // set child count instead of enumerating
                    info.children = { count: isObjectOrArray ? nodeInfo.childCount : 0 };
                }
                else if (typeof args.child_limit === 'number' && args.child_limit > 0) {
                    if (isObjectOrArray) {
                        info.children = await getChildren(path, args.child_limit, args.child_skip, args.child_from);
                    }
                }
                return info;
            }
        }
    }

    export(path, stream, options = { format: 'json' }) {
        return this.storage.exportNode(path, stream, options);
    }

    import(path, read, options = { format: 'json', suppress_events: false, method: 'set' }) {
        return this.storage.importNode(path, read, options);
    }

    async setSchema(path, schema) {
        return this.storage.setSchema(path, schema);
    }

    async getSchema(path) {
        return this.storage.getSchema(path);
    }

    async getSchemas() {
        return this.storage.getSchemas();
    }

    async validateSchema(path, value, isUpdate) {
        return this.storage.validateSchema(path, value, { updates: isUpdate });
    }

    /**
     * Gets all relevant mutations for specific events on a path and since specified cursor
     * @param {object} filter
     * @param {string} [filter.path] path to get all mutations for, only used if `for` property isn't used
     * @param {Array<{ path: string, events: string[] }>} [filter.for] paths and events to get relevant mutations for
     * @param {string} filter.cursor cursor to use
     * @param {number} filter.timestamp timestamp to use
     * @returns {Promise<{ used_cursor: string, new_cursor: string, mutations: object[] }>}
     */
    async getMutations(filter) {
        if (typeof this.storage.getMutations !== 'function') { throw new Error('Used storage type does not support getMutations'); }
        if (typeof filter !== 'object') { throw new Error('No filter specified'); }
        if (typeof filter.cursor !== 'string' && typeof filter.timestamp !== 'number') { throw new Error('No cursor or timestamp given'); }
        return this.storage.getMutations(filter);
    }

    /**
     * Gets all relevant effective changes for specific events on a path and since specified cursor
     * @param {object} filter
     * @param {string} [filter.path] path to get all mutations for, only used if `for` property isn't used
     * @param {Array<{ path: string, events: string[] }>} [filter.for] paths and events to get relevant mutations for
     * @param {string} filter.cursor cursor to use
     * @param {number} filter.timestamp timestamp to use
     * @returns {Promise<{ used_cursor: string, new_cursor: string, changes: object[] }>}
     */
    async getChanges(filter) {
        if (typeof this.storage.getChanges !== 'function') { throw new Error('Used storage type does not support getChanges'); }
        if (typeof filter !== 'object') { throw new Error('No filter specified'); }
        if (typeof filter.cursor !== 'string' && typeof filter.timestamp !== 'number') { throw new Error('No cursor or timestamp given'); }
        return this.storage.getChanges(filter);
    }
}

module.exports = { LocalApi };
