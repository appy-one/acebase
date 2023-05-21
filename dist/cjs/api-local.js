"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalApi = void 0;
const acebase_core_1 = require("acebase-core");
const binary_1 = require("./storage/binary");
const sqlite_1 = require("./storage/sqlite");
const mssql_1 = require("./storage/mssql");
const custom_1 = require("./storage/custom");
const node_value_types_1 = require("./node-value-types");
const query_1 = require("./query");
const node_errors_1 = require("./node-errors");
class LocalApi extends acebase_core_1.Api {
    constructor(dbname = 'default', init, readyCallback) {
        super();
        this.db = init.db;
        const storageEnv = { logLevel: init.settings.logLevel };
        if (typeof init.settings.storage === 'object') {
            // settings.storage.logLevel = settings.logLevel;
            if (sqlite_1.SQLiteStorageSettings && (init.settings.storage instanceof sqlite_1.SQLiteStorageSettings)) { //  || env.settings.storage.type === 'sqlite'
                this.storage = new sqlite_1.SQLiteStorage(dbname, init.settings.storage, storageEnv);
            }
            else if (mssql_1.MSSQLStorageSettings && (init.settings.storage instanceof mssql_1.MSSQLStorageSettings)) { //  || env.settings.storage.type === 'mssql'
                this.storage = new mssql_1.MSSQLStorage(dbname, init.settings.storage, storageEnv);
            }
            else if (custom_1.CustomStorageSettings && (init.settings.storage instanceof custom_1.CustomStorageSettings)) { //  || settings.storage.type === 'custom'
                this.storage = new custom_1.CustomStorage(dbname, init.settings.storage, storageEnv);
            }
            else {
                const storageSettings = init.settings.storage instanceof binary_1.AceBaseStorageSettings
                    ? init.settings.storage
                    : new binary_1.AceBaseStorageSettings(init.settings.storage);
                this.storage = new binary_1.AceBaseStorage(dbname, storageSettings, storageEnv);
            }
        }
        else {
            this.storage = new binary_1.AceBaseStorage(dbname, new binary_1.AceBaseStorageSettings(), storageEnv);
        }
        this.storage.on('ready', readyCallback);
    }
    async stats(options) {
        return this.storage.stats;
    }
    subscribe(path, event, callback) {
        this.storage.subscriptions.add(path, event, callback);
    }
    unsubscribe(path, event, callback) {
        this.storage.subscriptions.remove(path, event, callback);
    }
    /**
     * Creates a new node or overwrites an existing node
     * @param path
     * @param value Any value will do. If the value is small enough to be stored in a parent record, it will take care of it
     * @returns returns a promise with the new cursor (if transaction logging is enabled)
     */
    async set(path, value, options = {
        suppress_events: false,
        context: null,
    }) {
        const cursor = await this.storage.setNode(path, value, { suppress_events: options.suppress_events, context: options.context });
        return Object.assign({}, (cursor && { cursor }));
    }
    /**
     * Updates an existing node, or creates a new node.
     * @returns returns a promise with the new cursor (if transaction logging is enabled)
     */
    async update(path, updates, options = {
        suppress_events: false,
        context: null,
    }) {
        const cursor = await this.storage.updateNode(path, updates, { suppress_events: options.suppress_events, context: options.context });
        return Object.assign({}, (cursor && { cursor }));
    }
    get transactionLoggingEnabled() {
        return this.storage.settings.transactions && this.storage.settings.transactions.log === true;
    }
    /**
     * Gets the value of a node
     * @param options when omitted retrieves all nested data. If `include` is set to an array of keys it will only return those children.
     * If `exclude` is set to an array of keys, those values will not be included
     */
    async get(path, options) {
        if (!options) {
            options = {};
        }
        if (typeof options.include !== 'undefined' && !(options.include instanceof Array)) {
            throw new TypeError(`options.include must be an array of key names`);
        }
        if (typeof options.exclude !== 'undefined' && !(options.exclude instanceof Array)) {
            throw new TypeError(`options.exclude must be an array of key names`);
        }
        if (['undefined', 'boolean'].indexOf(typeof options.child_objects) < 0) {
            throw new TypeError(`options.child_objects must be a boolean`);
        }
        const node = await this.storage.getNode(path, options);
        return { value: node.value, context: { acebase_cursor: node.cursor }, cursor: node.cursor };
    }
    /**
     * Performs a transaction on a Node
     * @param path
     * @param callback callback is called with the current value. The returned value (or promise) will be used as the new value. When the callbacks returns undefined, the transaction will be canceled. When callback returns null, the node will be removed.
     * @returns returns a promise with the new cursor (if transaction logging is enabled)
     */
    async transaction(path, callback, options = {
        suppress_events: false,
        context: null,
    }) {
        const cursor = await this.storage.transactNode(path, callback, { suppress_events: options.suppress_events, context: options.context });
        return Object.assign({}, (cursor && { cursor }));
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
     * @returns Returns a promise that resolves with matching data or paths in `results`
     */
    async query(path, query, options = { snapshots: false }) {
        const results = await (0, query_1.executeQuery)(this, path, query, options);
        return results;
    }
    /**
     * Creates an index on key for all child nodes at path
     */
    createIndex(path, key, options) {
        return this.storage.indexes.create(path, key, options);
    }
    /**
     * Gets all indexes
     */
    async getIndexes() {
        return this.storage.indexes.list();
    }
    /**
     * Deletes an existing index from the database
     */
    async deleteIndex(filePath) {
        return this.storage.indexes.delete(filePath);
    }
    async reflect(path, type, args) {
        args = args || {};
        const getChildren = async (path, limit = 50, skip = 0, from = null) => {
            if (typeof limit === 'string') {
                limit = parseInt(limit);
            }
            if (typeof skip === 'string') {
                skip = parseInt(skip);
            }
            if (['null', 'undefined'].includes(from)) {
                from = null;
            }
            const children = []; // Array<{ key: string | number; type: string; value: any; address?: any }>;
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
                    children.push(Object.assign({ key: typeof childInfo.key === 'string' ? childInfo.key : childInfo.index, type: childInfo.valueTypeName, value: childInfo.value }, (typeof childInfo.address === 'object' && 'pageNr' in childInfo.address && {
                        address: {
                            pageNr: childInfo.address.pageNr,
                            recordNr: childInfo.address.recordNr,
                        },
                    })));
                }
                stop = limit > 0 && children.length === limit; // flag, but don't stop now. Otherwise we won't know if there's more
            })
                .catch(err => {
                // Node doesn't exist? No children..
                if (!(err instanceof node_errors_1.NodeNotFoundError)) {
                    throw err;
                }
            });
            return {
                more,
                list: children,
            };
        };
        switch (type) {
            case 'children': {
                const result = await getChildren(path, args.limit, args.skip, args.from);
                return result;
            }
            case 'info': {
                const info = {
                    key: '',
                    exists: false,
                    type: 'unknown',
                    value: undefined,
                    address: undefined,
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
                info.address = typeof nodeInfo.address === 'object' && 'pageNr' in nodeInfo.address
                    ? {
                        pageNr: nodeInfo.address.pageNr,
                        recordNr: nodeInfo.address.recordNr,
                    }
                    : undefined;
                const isObjectOrArray = nodeInfo.exists && nodeInfo.address && [node_value_types_1.VALUE_TYPES.OBJECT, node_value_types_1.VALUE_TYPES.ARRAY].includes(nodeInfo.type);
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
    export(path, stream, options = {
        format: 'json',
        type_safe: true,
    }) {
        return this.storage.exportNode(path, stream, options);
    }
    import(path, read, options = {
        format: 'json',
        suppress_events: false,
        method: 'set',
    }) {
        return this.storage.importNode(path, read, options);
    }
    async setSchema(path, schema, warnOnly = false) {
        return this.storage.setSchema(path, schema, warnOnly);
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
     */
    async getMutations(filter) {
        if (typeof this.storage.getMutations !== 'function') {
            throw new Error('Used storage type does not support getMutations');
        }
        if (typeof filter !== 'object') {
            throw new Error('No filter specified');
        }
        if (typeof filter.cursor !== 'string' && typeof filter.timestamp !== 'number') {
            throw new Error('No cursor or timestamp given');
        }
        return this.storage.getMutations(filter);
    }
    /**
     * Gets all relevant effective changes for specific events on a path and since specified cursor
     */
    async getChanges(filter) {
        if (typeof this.storage.getChanges !== 'function') {
            throw new Error('Used storage type does not support getChanges');
        }
        if (typeof filter !== 'object') {
            throw new Error('No filter specified');
        }
        if (typeof filter.cursor !== 'string' && typeof filter.timestamp !== 'number') {
            throw new Error('No cursor or timestamp given');
        }
        return this.storage.getChanges(filter);
    }
}
exports.LocalApi = LocalApi;
//# sourceMappingURL=api-local.js.map