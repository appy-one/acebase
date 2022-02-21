const { Utils, DebugLogger, PathInfo, ID, PathReference, ascii85, SimpleEventEmitter, ColorStyle, SchemaDefinition } = require('acebase-core');
const { VALUE_TYPES } = require('./node-value-types');
const { NodeInfo } = require('./node-info');
const { compareValues, getChildValues, encodeString, defer } = Utils;
const { IPCPeer, RemoteIPCPeer } = require('./ipc');
const { pfs } = require('./promise-fs');
// const { IPCTransactionManager } = require('./node-transaction');

const DEBUG_MODE = false;

class NodeNotFoundError extends Error {}
class NodeRevisionError extends Error {}
class SchemaValidationError extends Error {
    /**
     * @param {string} reason 
     */
    constructor(reason) {
        super(`Schema validation failed: ${reason}`);
        this.reason = reason;
    }
}

/**
 * @property {Array<{ target: Array<string|number>, prev: any, val: any }>} mutations
 * @interface 
 */
class IWriteNodeResult {}

/**
 * @typedef IPCClientSettings
 * @property {string} [host='localhost'] IPC Server host to connect to. Default is `"localhost"`
 * @property {number} port IPC Server port number
 * @property {boolean} [ssl=false] Whether to use a secure connection to the server. Strongly recommended if `host` is not `"localhost"`. Default is `false`
 * @property {string} [token] Token used in the IPC Server configuration (optional). The server will refuse connections using the wrong token.
 * @property {'master'|'worker'} role Determines the role of this IPC client. Only 1 process can be assigned the 'master' role, all other processes must use the role 'worker'
 */

/**
 * @typedef IStorageSettings
 * @property {number} [maxInlineValueSize=50] in bytes, max amount of child data to store within a parent record before moving to a dedicated record. Default is 50
 * @property {boolean} [removeVoidProperties=false] Instead of throwing errors on undefined values, remove the properties automatically. Default is false
 * @property {string} [path="."] Target path to store database files in, default is '.'
 * @property {string} [info="realtime database"] optional info to be written to the console output underneith the logo
 * @property {string} [type] optional type of storage class - will be used by AceBaseStorage to create different db files in the future (data, transaction, auth etc)
 * @property {IPCClientSettings} [ipc] External IPC server configuration. You need this if you are running multiple AceBase processes using the same database files in a pm2 or cloud-based cluster so the individual processes can communicate with each other.
 * @property {number} [lockTimeout=120] timeout setting for read /and write locks in seconds. Operations taking longer than this will be aborted. Default is 120 seconds.
*/

/**
 * Storage Settings
 * @type {IStorageSettings}
 */
class StorageSettings {

    /**
     * 
     * @param {IStorageSettings} settings 
     */
    constructor(settings) {
        settings = settings || {};
        this.maxInlineValueSize = typeof settings.maxInlineValueSize === 'number' ? settings.maxInlineValueSize : 50;
        this.removeVoidProperties = settings.removeVoidProperties === true;
        /** @type {string} */
        this.path = settings.path || '.';
        if (this.path.endsWith('/')) { this.path = this.path.slice(0, -1); }
        /** @type {string} */
        this.logLevel = settings.logLevel || 'log';
        this.info = settings.info || 'realtime database';
        this.type = settings.type || 'data';
        this.ipc = settings.ipc;
        this.lockTimeout = typeof settings.lockTimeout === 'number' ? settings.lockTimeout : 120;
    }
}

class Storage extends SimpleEventEmitter {

    createTid() {
        return DEBUG_MODE ? ++this._lastTid : ID.generate();
    }

    /**
     * Base class for database storage, must be extended by back-end specific methods.
     * Currently implemented back-ends are AceBaseStorage, SQLiteStorage, MSSQLStorage, CustomStorage
     * @param {string} name name of the database
     * @param {StorageSettings} settings instance of AceBaseStorageSettings or SQLiteStorageSettings
     */
    constructor(name, settings) {
        super();
        this.name = name;
        this.settings = settings;
        this.debug = new DebugLogger(settings.logLevel, `[${name}${typeof settings.type === 'string' && settings.type !== 'data' ? `:${settings.type}` : ''}]`); // `├ ${name} ┤` // `[🧱${name}]`

        // Setup IPC to allow vertical scaling (multiple threads sharing locks and data)
        const ipcName = name + (typeof settings.type === 'string' ? `_${settings.type}` : '');
        if (settings.ipc) {
            if (typeof settings.ipc.port !== 'number') {
                throw new Error(`IPC port number must be a number`);
            }
            if (!['master','worker'].includes(settings.ipc.role)) {
                throw new Error(`IPC client role must be either "master" or "worker", not "${settings.ipc.role}"`);
            }
            const ipcSettings = Object.assign({ dbname: ipcName }, settings.ipc);
            this.ipc = new RemoteIPCPeer(this, ipcSettings);
        }
        else {
            this.ipc = new IPCPeer(this, ipcName);
        }
        this.ipc.once('exit', code => {
            // We can perform any custom cleanup here:
            // - storage-acebase should close the db file
            // - storage-mssql / sqlite should close connection
            // - indexes should close their files
            if (this.indexes.supported) {
                this.indexes.close();
            }
        });
        this.nodeLocker = {
            lock: (path, tid, write, comment) => {
                return this.ipc.lock({ path, tid, write, comment });
            }
        };
        // this.transactionManager = new IPCTransactionManager(this.ipc);
        this._lastTid = 0;

        // Setup indexing functionality
        const { DataIndex, ArrayIndex, FullTextIndex, GeoIndex } = require('./data-index'); // Indexing might not be available: the browser dist bundle doesn't include it because fs is not available: browserify --i ./src/data-index.js

        /** @type {Map<string, { validate?: (previous: any, value: any) => boolean, schema?: SchemaDefinition }>} */
        // this._validation = new Map();
        /** @type {Array<{ path: string, schema: SchemaDefinition }>} */
        this._schemas = [];

        /** @type {DataIndex[]} */ 
        const _indexes = [];
        const storage = this;
        this.indexes = {
            /**
             * Tests if (the default storage implementation of) indexes are supported in the environment. 
             * They are currently only supported when running in Node.js because they use the fs filesystem. 
             * TODO: Implement storage specific indexes (eg in SQLite, MySQL, MSSQL, in-memory)
             */
            get supported() {
                return pfs && pfs.hasFileSystem;
            },

            /**
             * Creates an index on specified path and key(s)
             * @param {string} path location of objects to be indexed. Eg: "users" to index all children of the "users" node; or "chats/*\/members" to index all members of all chats
             * @param {string} key for now - one key to index. Once our B+tree implementation supports nested trees, we can allow multiple fields
             * @param {object} [options]
             * @param {boolean} [options.rebuild=false]
             * @param {string} [options.type] special index to create: 'array', 'fulltext' or 'geo'
             * @param {string[]} [options.include] keys to include in index
             * @param {object} [options.config] additional index-specific configuration settings 
             * @returns {Promise<DataIndex>}
             */
            async create(path, key, options = { rebuild: false, type: undefined, include: undefined }) { //, refresh = false) {
                if (!this.supported) {
                    throw new Error(`Indexes are not supported in current environment because it requires Node.js fs`)
                }
                path = path.replace(/\/\*$/, ""); // Remove optional trailing "/*"
                const rebuild = options && options.rebuild === true;
                const indexType = (options && options.type) || 'normal';
                let includeKeys = (options && options.include) || [];
                if (typeof includeKeys === 'string') { includeKeys = [includeKeys]; }
                const existingIndex = _indexes.find(index => 
                    index.path === path && index.key === key && index.type === indexType
                    && index.includeKeys.length === includeKeys.length
                    && index.includeKeys.every((key, index) => includeKeys[index] === key)
                );
                if (existingIndex && rebuild !== true) {
                    storage.debug.log(`Index on "/${path}/*/${key}" already exists`.colorize(ColorStyle.inverse));
                    return existingIndex;
                }

                if (!storage.ipc.isMaster) {
                    // Pass create request to master
                    const result = await storage.ipc.sendRequest({ type: 'index.create', path, key, options });
                    if (result.ok) {
                        return this.add(result.fileName);
                    }
                    throw new Error(result.reason);
                }

                await pfs.mkdir(`${storage.settings.path}/${storage.name}.acebase`).catch(err => {
                    if (err.code !== 'EEXIST') {
                        throw err;
                    }
                });

                const index = existingIndex || (() => {
                    switch (indexType) {
                        case 'array': return new ArrayIndex(storage, path, key, { include: options.include, config: options.config });
                        case 'fulltext': return new FullTextIndex(storage, path, key, { include: options.include, config: options.config });
                        case 'geo': return new GeoIndex(storage, path, key, { include: options.include, config: options.config });
                        default: return new DataIndex(storage, path, key, { include: options.include, config: options.config });
                    }
                })();
                if (!existingIndex) {
                    _indexes.push(index);
                }
                await index.build()
                .catch(err => {
                    storage.debug.error(`Index build on "/${path}/*/${key}" failed: ${err.message} (code: ${err.code})`.colorize(ColorStyle.red));
                    if (!existingIndex) {
                        // Only remove index if we added it. Build may have failed because someone tried creating the index more than once, or rebuilding it while it was building...
                        _indexes.splice(_indexes.indexOf(index), 1);
                    }
                    throw err;
                });
                storage.ipc.sendNotification({ type: 'index.created', fileName: index.fileName, path, key, options });
                return index;
            },

            /**
             * Returns indexes at a path, or a specific index on a key in that path
             * @param {string} path 
             * @param {string} [key=null] 
             * @returns {DataIndex[]}
             */
            get(path, key = null) {
                const matchesNamedWildcardPath = index => {
                    if (!index.path.includes('$')) { return false; }
                    const pattern = '^' + index.path.replace(/\$[a-z0-9_]+/gi, '[a-z0-9_]+|\\*') + '$';
                    const re = new RegExp(pattern, 'i');
                    return re.test(path);
                };
                return _indexes.filter(index => (index.path === path || matchesNamedWildcardPath(index)) && (key === null || key === index.key));
            },

            /**
             * Returns all indexes on a target path, optionally includes indexes on child and parent paths
             * @param {string} targetPath
             * @param {object} [options] 
             * @param {boolean} [options.parentPaths=true] 
             * @param {boolean} [options.childPaths=true] 
             * @returns {DataIndex[]}
             */
            getAll(targetPath, options = { parentPaths: true, childPaths: true }) {
                const pathKeys = PathInfo.getPathKeys(targetPath);
                return _indexes.filter(index => {
                    const indexKeys = PathInfo.getPathKeys(index.path + '/*');
                    // check if index is on a parent node of given path:
                    if (options.parentPaths && indexKeys.every((key, i) => { return key === '*' || pathKeys[i] === key; }) && [index.key].concat(...index.includeKeys).includes(pathKeys[indexKeys.length])) {
                        // eg: path = 'restaurants/1/location/lat', index is on 'restaurants(/*)', key 'location'
                        return true;
                    }
                    else if (indexKeys.length < pathKeys.length) {
                        // the index is on a higher path, and did not match above parent paths check
                        return false;
                    }
                    else if (!options.childPaths && indexKeys.length !== pathKeys.length) { 
                        // no checking for indexes on child paths and index path has more or less keys than path
                        // eg: path = 'restaurants/1', index is on child path 'restaurants/*/reviews(/*)', key 'rating'
                        return false;
                    }
                    // check if all path's keys match the index path
                    // eg: path = 'restaurants/1', index is on 'restaurants(/*)', key 'name'
                    // or: path = 'restaurants/1', index is on 'restaurants/*/reviews(/*)', key 'rating' (and options.childPaths === true)
                    return pathKeys.every((key, i) => {
                        return [key, '*'].includes(indexKeys[i]); //key === indexKeys[i] || indexKeys[i] === '*';
                    });
                });
            },

            /**
             * Returns all indexes
             * @returns {DataIndex[]}
             */
            list() {
                return _indexes.slice();
            },

            /**
             * Discovers and populates all created indexes
             */
            async load() {
                _indexes.splice(0);
                if (!pfs.hasFileSystem) { 
                    // If pfs (fs) is not available, don't try using it
                    return;
                }
                let files = [];
                try {
                    files = await pfs.readdir(`${storage.settings.path}/${storage.name}.acebase`);
                }
                catch(err) {
                    if (err.code !== 'ENOENT') {
                        // If the directory is not found, there are no file indexes. (probably not supported by used storage class)
                        // Only complain if error is something else
                        storage.debug.error(err);
                    }
                }
                const promises = [];
                files.forEach(fileName => {
                    if (!fileName.endsWith('.idx')) { return; }
                    const needsStoragePrefix = settings.type !== 'data'; // auth indexes need to start with "[auth]-" and have to be ignored by other storage types
                    const hasStoragePrefix = /^\[[a-z]+\]-/.test(fileName);
                    if ((!needsStoragePrefix && !hasStoragePrefix) || needsStoragePrefix && fileName.startsWith(`[${settings.type}]-`)) {
                        const p = this.add(fileName);
                        promises.push(p);
                    }
                });
                await Promise.all(promises);
            },

            async add(fileName) {
                try {
                    const index = await DataIndex.readFromFile(storage, fileName);
                    _indexes.push(index);
                }
                catch(err) {
                    storage.debug.error(err);
                }
            },

            async delete(index) {
                await index.delete();
                storage.ipc.sendNotification({ type: 'index.deleted', fileName: index.fileName, path: index.path, keys: index.key });
            },

            async remove(fileName) {
                const index = _indexes.find(index => index.fileName === fileName);
                if (!index) { throw new Error(`Index ${fileName} not found`); }
                _indexes.splice(_indexes.indexOf(index), 1);
            },

            async close() {
                // Close all indexes
                const promises = this.list().map(index => index.close().catch(err => storage.debug.error(err)));
                await Promise.all(promises);
            }
        };

        // Subscriptions
        const _subs = {};
        const _supportedEvents = ['value','child_added','child_changed','child_removed','mutated','mutations'];
        // Add 'notify_*' event types for each event to enable data-less notifications, so data retrieval becomes optional
        _supportedEvents.push(..._supportedEvents.map(event => `notify_${event}`)); 
        this.subscriptions = {
            /**
             * Adds a subscription to a node
             * @param {string} path - Path to the node to add subscription to
             * @param {string} type - Type of the subscription
             * @param {(err: Error, path: string, newValue: any, oldValue: any) => void} callback - Subscription callback function
             */
            add: (path, type, callback) => {
                if (_supportedEvents.indexOf(type) < 0) {
                    throw new TypeError(`Invalid event type "${type}"`);
                }
                let pathSubs = _subs[path];
                if (!pathSubs) { pathSubs = _subs[path] = []; }
                // if (pathSubs.findIndex(ps => ps.type === type && ps.callback === callback)) {
                //     storage.debug.warn(`Identical subscription of type ${type} on path "${path}" being added`);
                // }
                pathSubs.push({ created: Date.now(), type, callback });
                this.emit('subscribe', { path, event: type, callback }); // Enables IPC peers to be notified
            },

            /**
             * Removes 1 or more subscriptions from a node
             * @param {string} path - Path to the node to remove the subscription from
             * @param {string} type - Type of subscription(s) to remove (optional: if omitted all types will be removed)
             * @param {Function} callback - Callback to remove (optional: if omitted all of the same type will be removed)
             */
            remove: (path, type = undefined, callback = undefined) => {
                let pathSubs = _subs[path];
                if (!pathSubs) { return; }
                let i, next = () => pathSubs.findIndex(ps => 
                    (type ? ps.type === type : true) && (callback ? ps.callback === callback : true)
                );
                while ((i = next()) >= 0) {
                    pathSubs.splice(i, 1);
                }
                this.emit('unsubscribe', { path, event: type, callback }); // Enables IPC peers to be notified 
            },

            /**
             * Checks if there are any subscribers at given path that need the node's previous value when a change is triggered
             * @param {string} path 
             */
            hasValueSubscribersForPath(path) {
                const valueNeeded = this.getValueSubscribersForPath(path);
                return !!valueNeeded;
            },

            /**
             * Gets all subscribers at given path that need the node's previous value when a change is triggered
             * @param {string} path 
             * @returns {Array<{ type: string, path: string }>}
             */
            getValueSubscribersForPath(path) {
                // Subscribers that MUST have the entire previous value of a node before updating:
                //  - "value" events on the path itself, and any ancestor path
                //  - "child_added", "child_removed" events on the parent path
                //  - "child_changed" events on the parent path and its ancestors
                //  - ALL events on child/descendant paths
                const pathInfo = new PathInfo(path);
                const valueSubscribers = [];
                Object.keys(_subs).forEach(subscriptionPath => {
                    if (pathInfo.equals(subscriptionPath) || pathInfo.isDescendantOf(subscriptionPath)) {
                        // path being updated === subscriptionPath, or a child/descendant path of it
                        // eg path === "posts/123/title"
                        // and subscriptionPath is "posts/123/title", "posts/$postId/title", "posts/123", "posts/*", "posts" etc
                        let pathSubs = _subs[subscriptionPath];
                        const eventPath = PathInfo.fillVariables(subscriptionPath, path);
                        pathSubs
                        .filter(sub => !sub.type.startsWith("notify_")) // notify events don't need additional value loading
                        .forEach(sub => {
                            let dataPath = null;
                            if (sub.type === "value") { // ["value", "notify_value"].includes(sub.type)
                                dataPath = eventPath;
                            }
                            else if (["mutated", "mutations"].includes(sub.type) && pathInfo.isDescendantOf(eventPath)) { //["mutated", "notify_mutated"].includes(sub.type)
                                dataPath = path; // Only needed data is the properties being updated in the targeted path
                            }
                            else if (sub.type === "child_changed" && path !== eventPath) { // ["child_changed", "notify_child_changed"].includes(sub.type)
                                let childKey = PathInfo.getPathKeys(path.slice(eventPath.length).replace(/^\//, ''))[0];
                                dataPath = PathInfo.getChildPath(eventPath, childKey);
                            }
                            else if (["child_added", "child_removed"].includes(sub.type) && pathInfo.isChildOf(eventPath)) { //["child_added", "child_removed", "notify_child_added", "notify_child_removed"]
                                let childKey = PathInfo.getPathKeys(path.slice(eventPath.length).replace(/^\//, ''))[0];
                                dataPath = PathInfo.getChildPath(eventPath, childKey);
                            }
                            
                            if (dataPath !== null && !valueSubscribers.includes(s => s.type === sub.type && s.eventPath === eventPath)) {
                                valueSubscribers.push({ type: sub.type, eventPath, dataPath, subscriptionPath });
                            }
                        });
                    }
                });
                return valueSubscribers;
            },

            /**
             * Gets all subscribers at given path that could possibly be invoked after a node is updated
             * @param {string} path 
             */
            getAllSubscribersForPath(path) {
                const pathInfo = PathInfo.get(path);
                const subscribers = [];
                Object.keys(_subs).forEach(subscriptionPath => {
                    // if (pathInfo.equals(subscriptionPath) //path === subscriptionPath 
                    //     || pathInfo.isDescendantOf(subscriptionPath) 
                    //     || pathInfo.isAncestorOf(subscriptionPath)
                    // ) {
                    if (pathInfo.isOnTrailOf(subscriptionPath)) {
                        let pathSubs = _subs[subscriptionPath];
                        const eventPath = PathInfo.fillVariables(subscriptionPath, path);

                        pathSubs.forEach(sub => {
                            let dataPath = null;
                            if (sub.type === "value" || sub.type === "notify_value") { 
                                dataPath = eventPath; 
                            }
                            else if (["child_changed", "notify_child_changed"].includes(sub.type)) { 
                                let childKey = path === eventPath || pathInfo.isAncestorOf(eventPath) 
                                    ? "*" 
                                    : PathInfo.getPathKeys(path.slice(eventPath.length).replace(/^\//, ''))[0];
                                dataPath = PathInfo.getChildPath(eventPath, childKey);
                            }
                            else if (["mutated", "mutations", "notify_mutated", "notify_mutations"].includes(sub.type)) { 
                                dataPath = path;
                            }
                            else if (
                                ["child_added", "child_removed", "notify_child_added", "notify_child_removed"].includes(sub.type) 
                                && (
                                    pathInfo.isChildOf(eventPath) 
                                    || path === eventPath 
                                    || pathInfo.isAncestorOf(eventPath)
                                )
                            ) { 
                                let childKey = path === eventPath || pathInfo.isAncestorOf(eventPath) 
                                    ? "*" 
                                    : PathInfo.getPathKeys(path.slice(eventPath.length).replace(/^\//, ''))[0];
                                dataPath = PathInfo.getChildPath(eventPath, childKey); //NodePath(subscriptionPath).childPath(childKey); 
                            }
                            if (dataPath !== null && !subscribers.some(s => s.type === sub.type && s.eventPath === eventPath && s.subscriptionPath === subscriptionPath)) { // && subscribers.findIndex(s => s.type === sub.type && s.dataPath === dataPath) < 0
                                subscribers.push({ type: sub.type, eventPath, dataPath, subscriptionPath });
                            }
                        });
                    }
                });
                return subscribers;
            },

            /**
             * Triggers subscription events to run on relevant nodes
             * @param {string} event - Event type: "value", "child_added", "child_changed", "child_removed"
             * @param {string} path - Path to the node the subscription is on
             * @param {string} dataPath - path to the node the value is stored
             * @param {any} oldValue - old value
             * @param {any} newValue - new value
             * @param {any} context - context used by the client that updated this data
             */
            trigger(event, path, dataPath, oldValue, newValue, context) {
                //console.warn(`Event "${event}" triggered on node "/${path}" with data of "/${dataPath}": `, newValue);
                const pathSubscriptions = _subs[path] || [];
                pathSubscriptions.filter(sub => sub.type === event)
                .forEach(sub => {
                    sub.callback(null, dataPath, newValue, oldValue, context);
                    // if (event.startsWith('notify_')) {
                    //     // Notify only event, run callback without data
                    //     sub.callback(null, dataPath);
                    // }
                    // else {
                    //     // Run callback with data
                    //     sub.callback(null, dataPath, newValue, oldValue);
                    // }
                });
            }
        };
       
    } // end of constructor

    async close() {
        // Close the database by calling exit on the ipc channel, which will emit an 'exit' event when the database can be safely closed.
        await this.ipc.exit();
    }

    get path() {
        return `${this.settings.path}/${this.name}.acebase`;
    }

    /**
     * Checks if a value can be stored in a parent object, or if it should 
     * move to a dedicated record. Uses settings.maxInlineValueSize
     * @param {any} value 
     */
    valueFitsInline(value) {
        if (typeof value === "number" || typeof value === "boolean" || value instanceof Date) {
            return true;
        }
        else if (typeof value === "string") {
            if (value.length > this.settings.maxInlineValueSize) { return false; }
            // if the string has unicode chars, its byte size will be bigger than value.length
            const encoded = encodeString(value);
            return encoded.length < this.settings.maxInlineValueSize;
        }
        else if (value instanceof PathReference) {
            if (value.path.length > this.settings.maxInlineValueSize) { return false; }
            // if the path has unicode chars, its byte size will be bigger than value.path.length
            const encoded = encodeString(value.path);
            return encoded.length < this.settings.maxInlineValueSize;
        }
        else if (value instanceof ArrayBuffer) {
            return value.length < this.settings.maxInlineValueSize;
        }
        else if (value instanceof Array) {
            return value.length === 0;
        }
        else if (typeof value === "object") {
            return Object.keys(value).length === 0;
        }
        else {
            throw new TypeError(`What else is there?`);
        }
    }

    /**
     * Creates or updates a node in its own record. DOES NOT CHECK if path exists in parent node, or if parent paths exist! Calling code needs to do this
     * @param {string} path 
     * @param {any} value 
     * @param {object} [options] 
     * @param {boolean} [options.merge=false]
     * @returns {Promise<any>}
     */
    // eslint-disable-next-line no-unused-vars
    _writeNode(path, value, options) {
        throw new Error(`This method must be implemented by subclass`);
    }

    /**
     * 
     * @param {string} path 
     * @param {boolean} suppressEvents 
     * @returns 
     */
    getUpdateImpact(path, suppressEvents) {
        let topEventPath = path;
        let hasValueSubscribers = false;
        
        // Get all subscriptions that should execute on the data (includes events on child nodes as well)
        let eventSubscriptions = suppressEvents ? [] : this.subscriptions.getAllSubscribersForPath(path);

        // Get all subscriptions for data on this or ancestor nodes, determines what data to load before processing
        const valueSubscribers = suppressEvents ? [] : this.subscriptions.getValueSubscribersForPath(path);
        if (valueSubscribers.length > 0) {
            hasValueSubscribers = true;
            let eventPaths = valueSubscribers
                .map(sub => { return { path: sub.dataPath, keys: PathInfo.getPathKeys(sub.dataPath) }; })
                .sort((a,b) => {
                    if (a.keys.length < b.keys.length) return -1;
                    else if (a.keys.length > b.keys.length) return 1;
                    return 0;
                });
            let first = eventPaths[0];
            topEventPath = first.path;
            if (valueSubscribers.filter(sub => sub.dataPath === topEventPath).every(sub => sub.type === 'mutated' || sub.type.startsWith('notify_'))) {
                // Prevent loading of all data on path, so it'll only load changing properties
                hasValueSubscribers = false;
            }
            topEventPath = PathInfo.fillVariables(topEventPath, path); // fill in any wildcards in the subscription path 
        }

        const indexes = this.indexes.getAll(path, { childPaths: true, parentPaths: true })
            .map(index => ({ index, keys: PathInfo.getPathKeys(index.path) }))
            .sort((a, b) => {
                if (a.keys.length < b.keys.length) { return -1; }
                else if (a.keys.length > b.keys.length) { return 1; }
                return 0;
            })
            .map(obj => obj.index);

        let keysFilter = [];
        if (indexes.length > 0) {
            indexes.sort((a,b) => {
                if (typeof a._pathKeys === 'undefined') { a._pathKeys = PathInfo.getPathKeys(a.path); }
                if (typeof b._pathKeys === 'undefined') { b._pathKeys = PathInfo.getPathKeys(b.path); }
                if (a._pathKeys.length < b._pathKeys.length) return -1;
                else if (a._pathKeys.length > b._pathKeys.length) return 1;
                return 0;
            });
            const topIndex = indexes[0];
            let topIndexPath = topIndex.path === path ? path : PathInfo.fillVariables(`${topIndex.path}/*`, path);
            if (topIndexPath.length < topEventPath.length) {
                // index is on a higher path than any value subscriber.
                // eg: 
                //      path = 'restaurants/1/rating'
                //      topEventPath = 'restaurants/1/rating' (because of 'value' event on 'restaurants/*/rating')
                //      topIndexPath = 'restaurants/1' (because of index on 'restaurants(/*)', key 'name', included key 'rating')
                // set topEventPath to topIndexPath, but include only:
                // - indexed keys on that path,
                // - any additional child keys for all value event subscriptions in that path (they can never be different though?)
                topEventPath = topIndexPath;
                indexes.filter(index => index.path === topIndex.path).forEach(index => {
                    let keys = [index.key].concat(index.includeKeys);
                    keys.forEach(key => !keysFilter.includes(key) && keysFilter.push(key));
                });
            }
        }
        return { topEventPath, eventSubscriptions, valueSubscribers, hasValueSubscribers, indexes, keysFilter };
    }

    /**
     * Wrapper for _writeNode, handles triggering change events, index updating.
     * @param {string} path 
     * @param {any} value 
     * @param {object} [options] 
     * @returns {Promise<IWriteNodeResult>} Returns a promise that resolves with an object that contains storage specific details, plus the applied mutations if transaction logging is enabled
     */
    async _writeNodeWithTracking(path, value, options = { merge: false, transaction: undefined, tid: undefined, _customWriteFunction: undefined, waitForIndexUpdates: true, suppress_events: false, context: null, impact: null }) {
        options = options || {};
        if (!options.tid && !options.transaction) { throw new Error(`_writeNodeWithTracking MUST be executed with a tid OR transaction!`); }
        options.merge = options.merge === true;

        // Does the value meet schema requirements?
        const validation = this.validateSchema(path, value, { updates: options.merge });
        if (!validation.ok) {
            throw new SchemaValidationError(validation.reason);
        }

        const tid = options.tid;
        const transaction = options.transaction;

        // Is anyone interested in the values changing on this path?
        let topEventData = null;
        let { topEventPath, eventSubscriptions, hasValueSubscribers, indexes, keysFilter } = options.impact ? options.impact : this.getUpdateImpact(path, options.suppress_events);

        const writeNode = () => {
            if (typeof options._customWriteFunction === 'function') {
                return options._customWriteFunction();
            }
            if (topEventData) {
                // Pass loaded data to _writeNode, speeds up recursive calls
                // This prevents reloading and/or overwriting of unchanged child nodes                
                const pathKeys = PathInfo.getPathKeys(path);
                const eventPathKeys = PathInfo.getPathKeys(topEventPath);
                const trailKeys = pathKeys.slice(eventPathKeys.length);
                let currentValue = topEventData;
                while (trailKeys.length > 0 && currentValue !== null) {
                    const childKey = trailKeys.shift();
                    currentValue = typeof currentValue === 'object' && childKey in currentValue ? currentValue[childKey] : null;
                }
                options.currentValue = currentValue;
            }
            return this._writeNode(path, value, options);            
        }

        const transactionLoggingEnabled = this.settings.transactions && this.settings.transactions.log === true;
        if (eventSubscriptions.length === 0 && indexes.length === 0 && !transactionLoggingEnabled) {
            // Nobody's interested in value changes. Write node without tracking
            return writeNode();
        }

        if (!hasValueSubscribers && options.merge === true && keysFilter.length === 0) {
            // only load properties being updated
            keysFilter = Object.keys(value);
            if (topEventPath !== path) {
                let trailPath = path.slice(topEventPath.length);
                keysFilter = keysFilter.map(key => `${trailPath}/${key}`);
            }
        }

        const eventNodeInfo = await this.getNodeInfo(topEventPath, { transaction, tid });
        let currentValue = null;
        if (eventNodeInfo.exists) {
            let valueOptions = { transaction, tid };
            if (keysFilter.length > 0) {
                valueOptions.include = keysFilter;
            }
            if (topEventPath === '' && typeof valueOptions.include === 'undefined') {
                this.debug.warn(`WARNING: One or more value event listeners on the root node are causing the entire database value to be read to facilitate change tracking. Using "value", "notify_value", "child_changed" and "notify_child_changed" events on the root node are a bad practice because of the significant performance impact. Use "mutated" or "mutations" events instead`);
            }
            currentValue = await this.getNodeValue(topEventPath, valueOptions);
        }

        topEventData = currentValue;

        // Now proceed with node updating
        const result = (await writeNode()) || {};

        // Build data for old/new comparison
        let newTopEventData, modifiedData;
        if (path === topEventPath) {
            if (options.merge) {
                if (topEventData === null) {
                    newTopEventData = value instanceof Array ? [] : {};
                }
                else {
                    // Create shallow copy of previous object value
                    newTopEventData = topEventData instanceof Array ? [] : {};
                    Object.keys(topEventData).forEach(key => {
                        newTopEventData[key] = topEventData[key];
                    });
                }
            }
            else {
                newTopEventData = value;
            }
            modifiedData = newTopEventData;
        }
        else {
            // topEventPath is on a higher path, so we have to adjust the value deeper down
            const trailPath = path.slice(topEventPath.length).replace(/^\//, '');
            const trailKeys = PathInfo.getPathKeys(trailPath);
            // Create shallow copy of the original object (let unchanged properties reference existing objects)
            if (topEventData === null) {
                // the node didn't exist prior to the update (or was not loaded)
                newTopEventData = typeof trailKeys[0] === 'number' ? [] : {};
            }
            else {
                newTopEventData = topEventData instanceof Array ? [] : {};
                Object.keys(topEventData).forEach(key => {
                    newTopEventData[key] = topEventData[key];
                });
            }
            modifiedData = newTopEventData;
            while (trailKeys.length > 0) {
                let childKey = trailKeys.shift();
                // Create shallow copy of object at target
                if (!options.merge && trailKeys.length === 0) {
                    modifiedData[childKey] = value;
                }
                else {
                    const original = modifiedData[childKey];
                    const shallowCopy = typeof childKey === 'number' ? [] : {};
                    Object.keys(original).forEach(key => {
                        shallowCopy[key] = original[key];
                    })
                    modifiedData[childKey] = shallowCopy;
                }
                modifiedData = modifiedData[childKey];
            }
        }

        if (options.merge) {
            // Update target value with updates
            Object.keys(value).forEach(key => {
                modifiedData[key] = value[key];
            });
        }

        // console.assert(topEventData !== newTopEventData, 'shallow copy must have been made!');

        const dataChanges = compareValues(topEventData, newTopEventData);
        if (dataChanges === 'identical') {
            result.mutations = [];
            return result;
        }

        // Fix: remove null property values (https://github.com/appy-one/acebase/issues/2)
        function removeNulls(obj) {
            if (obj === null || typeof obj !== 'object') { return obj; } // Nothing to do
            Object.keys(obj).forEach(prop => {
                const val = obj[prop];
                if (val === null) { 
                    delete obj[prop]; 
                    if (obj instanceof Array) { obj.length--; } // Array items can only be removed from the end, 
                }
                if (typeof val === 'object') { removeNulls(val); }
            });
        }
        removeNulls(newTopEventData);
        
        // Trigger all index updates
        const indexUpdates = [];
        indexes.map(index => ({ index, keys: PathInfo.getPathKeys(index.path) }))
        .sort((a, b) => {
            // Deepest paths should fire first, then bubble up the tree
            if (a.keys.length < b.keys.length) { return 1; }
            else if (a.keys.length > b.keys.length) { return -1; }
            return 0;
        })
        .forEach(({ index }) => {
            // Index is either on the top event path, or on a child path

            // Example situation:
            // path = "users/ewout/posts/1" (a post was added)
            // topEventPath = "users/ewout" (a "child_changed" event was on "users")
            // index.path is "users/*/posts"
            // index must be called with data of "users/ewout/posts/1" 

            let pathKeys = PathInfo.getPathKeys(topEventPath); 
            let indexPathKeys = PathInfo.getPathKeys(index.path + '/*');
            let trailKeys = indexPathKeys.slice(pathKeys.length);
            // let { oldValue, newValue } = updatedData;
            let oldValue = topEventData;
            let newValue = newTopEventData;
            if (trailKeys.length === 0) {
                console.assert(pathKeys.length === indexPathKeys.length, 'check logic');
                // Index is on updated path
                const p = this.ipc.isMaster
                    ? index.handleRecordUpdate(topEventPath, oldValue, newValue)
                    : this.ipc.sendRequest({ type: 'index.update', path: topEventPath, oldValue, newValue });
                indexUpdates.push(p);
                return; // next index
            }
            const getAllIndexUpdates = (path, oldValue, newValue) => {
                if (oldValue === null && newValue === null) {
                    return [];
                }
                let pathKeys = PathInfo.getPathKeys(path);
                let indexPathKeys = PathInfo.getPathKeys(index.path + '/*');
                let trailKeys = indexPathKeys.slice(pathKeys.length);
                if (trailKeys.length === 0) {
                    console.assert(pathKeys.length === indexPathKeys.length, 'check logic');
                    return [{ path, oldValue, newValue }];
                }

                let results = [];
                let trailPath = '';
                while (trailKeys.length > 0) {
                    let subKey = trailKeys.shift();
                    if (subKey === '*') {
                        // Recursion needed
                        let allKeys = oldValue === null ? [] : Object.keys(oldValue);
                        newValue !== null && Object.keys(newValue).forEach(key => {
                            if (allKeys.indexOf(key) < 0) {
                                allKeys.push(key);
                            }
                        });
                        allKeys.forEach(key => {
                            let childPath = PathInfo.getChildPath(trailPath, key);
                            let childValues = getChildValues(key, oldValue, newValue);
                            let subTrailPath = PathInfo.getChildPath(path, childPath);
                            let childResults = getAllIndexUpdates(subTrailPath, childValues.oldValue, childValues.newValue);
                            results = results.concat(childResults);
                        });
                        break;
                    }
                    else {
                        let values = getChildValues(subKey, oldValue, newValue);
                        oldValue = values.oldValue;
                        newValue = values.newValue;
                        if (oldValue === null && newValue === null) {
                            break;
                        }
                        trailPath = PathInfo.getChildPath(trailPath, subKey);
                    }
                }
                return results;
            };
            let results = getAllIndexUpdates(topEventPath, oldValue, newValue);
            results.forEach(result => {
                const p = this.ipc.isMaster
                    ? index.handleRecordUpdate(result.path, result.oldValue, result.newValue)
                    : this.ipc.sendRequest({ type: 'index.update', path: result.path, oldValue: result.oldValue, newValue: result.newValue });
                indexUpdates.push(p);
            });
        });

        const callSubscriberWithValues = (sub, oldValue, newValue, variables = []) => {
            let trigger = true;
            let type = sub.type;
            if (type.startsWith('notify_')) {
                type = type.slice('notify_'.length);
            }
            if (type === "mutated") {
                return; // Ignore here, requires different logic
            }
            else if (type === "child_changed" && (oldValue === null || newValue === null)) {
                trigger = false;
            }
            else if (type === "value" || type === "child_changed") {
                let changes = compareValues(oldValue, newValue);
                trigger = changes !== 'identical';
            }
            else if (type === "child_added") {
                trigger = oldValue === null && newValue !== null;
            }
            else if (type === "child_removed") {
                trigger = oldValue !== null && newValue === null;
            }

            const pathKeys = PathInfo.getPathKeys(sub.dataPath);
            variables.forEach(variable => {
                // only replaces first occurrence (so multiple *'s will be processed 1 by 1)
                const index = pathKeys.indexOf(variable.name);
                console.assert(index >= 0, `Variable "${variable.name}" not found in subscription dataPath "${sub.dataPath}"`);
                pathKeys[index] = variable.value;
            });
            const dataPath = pathKeys.reduce((path, key) => PathInfo.getChildPath(path, key), '');
            trigger && this.subscriptions.trigger(sub.type, sub.subscriptionPath, dataPath, oldValue, newValue, options.context);
        };

        const prepareMutationEvents = (sub, currentPath, oldValue, newValue, compareResult) => {
            const batch = [];
            const result = compareResult || compareValues(oldValue, newValue);
            if (result === 'identical') {
                return batch; // no changes on subscribed path
            }
            else if (typeof result === 'string') {
                // We are on a path that has an actual change
                batch.push({ path: currentPath, oldValue, newValue });
            }
            // else if (oldValue instanceof Array || newValue instanceof Array) {
            //     // Trigger mutated event on the array itself instead of on individual indexes.
            //     // DO convert both arrays to objects because they are sparse
            //     const oldObj = {}, newObj = {};
            //     result.added.forEach(index => {
            //         oldObj[index] = null;
            //         newObj[index] = newValue[index];
            //     });
            //     result.removed.forEach(index => {
            //         oldObj[index] = oldValue[index];
            //         newObj[index] = null;
            //     });
            //     result.changed.forEach(index => {
            //         oldObj[index] = oldValue[index];
            //         newObj[index] = newValue[index];
            //     });
            //     batch.push({ path: currentPath, oldValue: oldObj, newValue: newObj });
            // }
            else {
                // DISABLED array handling here, because if a client is using a cache db this will cause problems
                // because individual array entries should never be modified.
                // if (oldValue instanceof Array && newValue instanceof Array) {
                //     // Make sure any removed events on arrays will be triggered from last to first
                //     result.removed.sort((a,b) => a < b ? 1 : -1);
                // }
                result.changed.forEach(info => {
                    const childPath = PathInfo.getChildPath(currentPath, info.key);
                    let childValues = getChildValues(info.key, oldValue, newValue);
                    const childBatch = prepareMutationEvents(sub, childPath, childValues.oldValue, childValues.newValue, info.change);
                    batch.push(...childBatch);
                });
                result.added.forEach(key => {
                    const childPath = PathInfo.getChildPath(currentPath, key);
                    batch.push({ path: childPath, oldValue: null, newValue: newValue[key] });
                });
                if (oldValue instanceof Array && newValue instanceof Array) {
                    result.removed.sort((a,b) => a - b);
                }
                result.removed.forEach(key => {
                    const childPath = PathInfo.getChildPath(currentPath, key);
                    batch.push({ path: childPath, oldValue: oldValue[key], newValue: null });
                });
            }
            return batch;
        };

        // Add mutations to result (only if transaction logging is enabled)
        if (this.transactionLoggingEnabled && this.settings.type !== 'transaction') {
            result.mutations = (() => {
                const trailPath = path.slice(topEventPath.length).replace(/^\//, '');
                const trailKeys = PathInfo.getPathKeys(trailPath);
                let oldValue = topEventData, newValue = newTopEventData;
                while (trailKeys.length > 0) {
                    const key = trailKeys.shift();
                    ({ oldValue, newValue } = getChildValues(key, oldValue, newValue));
                }
                const compareResults = compareValues(oldValue, newValue);
                const fakeSub = { event: 'mutations', path };
                const batch = prepareMutationEvents(fakeSub, path, oldValue, newValue, compareResults);
                const mutations = batch.map(m => ({ target: PathInfo.getPathKeys(m.path.slice(path.length)), prev: m.oldValue, val: m.newValue })); // key: PathInfo.get(m.path).key
                return mutations;
            })();
        }

        const triggerAllEvents = () => {
            // Notify all event subscriptions, should be executed with a delay
            // this.debug.verbose(`Triggering events caused by ${options && options.merge ? '(merge) ' : ''}write on "${path}":`, value);
            eventSubscriptions
            .filter(sub => !['mutated','mutations','notify_mutated','notify_mutations'].includes(sub.type))
            .map(sub => {
                const keys = PathInfo.getPathKeys(sub.dataPath);
                return {
                    sub,
                    keys
                };
            })
            .sort((a, b) => {
                // Deepest paths should fire first, then bubble up the tree
                if (a.keys.length < b.keys.length) { return 1; }
                else if (a.keys.length > b.keys.length) { return -1; }
                return 0;
            })
            .forEach(({ sub }) => {
                const process = (currentPath, oldValue, newValue, variables = []) => {
                    let trailPath = sub.dataPath.slice(currentPath.length).replace(/^\//, '');
                    let trailKeys = PathInfo.getPathKeys(trailPath);
                    while (trailKeys.length > 0) {
                        let subKey = trailKeys.shift();
                        if (typeof subKey === 'string' && (subKey === '*' || subKey[0] === '$')) {
                            // Fire on all relevant child keys
                            let allKeys = oldValue === null ? [] : Object.keys(oldValue).map(key =>
                                oldValue instanceof Array ? parseInt(key) : key
                            );
                            newValue !== null && Object.keys(newValue).forEach(key => {
                                if (newValue instanceof Array) {
                                    key = parseInt(key);
                                }
                                if (allKeys.indexOf(key) < 0) {
                                    allKeys.push(key);
                                }
                            });
                            allKeys.forEach(key => {
                                const childValues = getChildValues(key, oldValue, newValue);
                                const vars = variables.concat({ name: subKey, value: key });
                                if (trailKeys.length === 0) {
                                    callSubscriberWithValues(sub, childValues.oldValue, childValues.newValue, vars);
                                }
                                else {
                                    process(PathInfo.getChildPath(currentPath, subKey), childValues.oldValue, childValues.newValue, vars);
                                }
                            });
                            return; // We can stop processing
                        }
                        else {
                            currentPath = PathInfo.getChildPath(currentPath, subKey);
                            let childValues = getChildValues(subKey, oldValue, newValue);
                            oldValue = childValues.oldValue;
                            newValue = childValues.newValue;
                        }
                    }
                    callSubscriberWithValues(sub, oldValue, newValue, variables);
                };

                if (sub.type.startsWith('notify_') && PathInfo.get(sub.eventPath).isAncestorOf(topEventPath)) {
                    // Notify event on a higher path than we have loaded data on
                    // We can trigger the notify event on the subscribed path
                    // Eg: 
                    // path === 'users/ewout', updates === { name: 'Ewout Stortenbeker' }
                    // sub.path === 'users' or '', sub.type === 'notify_child_changed'
                    // => OK to trigger if dataChanges !== 'removed' and 'added'
                    const isOnParentPath = PathInfo.get(sub.eventPath).isParentOf(topEventPath);
                    const trigger = 
                        (sub.type === 'notify_value')
                        || (sub.type === 'notify_child_changed' && (!isOnParentPath || !['added','removed'].includes(dataChanges)))
                        || (sub.type === 'notify_child_removed' && dataChanges === 'removed' && isOnParentPath)
                        || (sub.type === 'notify_child_added' && dataChanges === 'added' && isOnParentPath)
                    trigger && this.subscriptions.trigger(sub.type, sub.subscriptionPath, sub.dataPath, null, null, options.context);
                }
                else {
                    // Subscription is on current or deeper path
                    process(topEventPath, topEventData, newTopEventData);
                }
            });

            // The only events we haven't processed now are 'mutated' events.
            // They require different logic: we'll call them for all nested properties of the updated path, that 
            // actually did change. They do not bubble up like 'child_changed' does.
            eventSubscriptions.filter(sub => ['mutated', 'mutations', 'notify_mutated', 'notify_mutations'].includes(sub.type))
            .forEach(sub => {
                // Get the target data this subscription is interested in
                let currentPath = path;
                let trailPath = sub.eventPath.slice(currentPath.length).replace(/^\//, '');
                let trailKeys = PathInfo.getPathKeys(trailPath);
                let oldValue = topEventData, newValue = newTopEventData;
                while (trailKeys.length > 0) {
                    let subKey = trailKeys.shift();
                    currentPath = PathInfo.getChildPath(currentPath, subKey);
                    let childValues = getChildValues(subKey, oldValue, newValue);
                    oldValue = childValues.oldValue;
                    newValue = childValues.newValue;
                }

                const batch = prepareMutationEvents(sub, currentPath, oldValue, newValue);
                if (batch.length === 0) {
                    return;
                }
                const isNotifyEvent = sub.type.startsWith('notify_');
                if (['mutated','notify_mutated'].includes(sub.type)) {
                    // Send all mutations 1 by 1
                    batch.forEach((mutation, index) => {
                        const context = options.context; // const context = cloneObject(options.context);
                        // context.acebase_mutated_event = { nr: index + 1, total: batch.length }; // Add context info about number of mutations
                        const prevVal = isNotifyEvent ? null : mutation.oldValue;
                        const newVal = isNotifyEvent ? null : mutation.newValue;
                        this.subscriptions.trigger(sub.type, sub.subscriptionPath, mutation.path, prevVal, newVal, context);
                    });
                }
                else if (['mutations','notify_mutations'].includes(sub.type)) {
                    // Send 1 batch with all mutations
                    // const oldValues = isNotifyEvent ? null : batch.map(m => ({ target: PathInfo.getPathKeys(mutation.path.slice(sub.subscriptionPath.length)), val: m.oldValue })); // batch.reduce((obj, mutation) => (obj[mutation.path.slice(sub.subscriptionPath.length).replace(/^\//, '') || '.'] = mutation.oldValue, obj), {});
                    // const newValues = isNotifyEvent ? null : batch.map(m => ({ target: PathInfo.getPathKeys(mutation.path.slice(sub.subscriptionPath.length)), val: m.newValue })) //batch.reduce((obj, mutation) => (obj[mutation.path.slice(sub.subscriptionPath.length).replace(/^\//, '') || '.'] = mutation.newValue, obj), {});
                    const values = isNotifyEvent ? null : batch.map(m => ({ target: PathInfo.getPathKeys(m.path.slice(sub.subscriptionPath.length)), prev: m.oldValue, val: m.newValue }));
                    this.subscriptions.trigger(sub.type, sub.subscriptionPath, sub.subscriptionPath, null, values, options.context);
                }
            });
        };

        // Wait for all index updates to complete
        if (options.waitForIndexUpdates === false) {
            indexUpdates.splice(0); // Remove all index update promises, so we don't wait for them to resolve
        }
        await Promise.all(indexUpdates);
        defer(triggerAllEvents); // Delayed execution
        return result;
    }


    /**
     * Enumerates all children of a given Node for reflection purposes
     * @param {string} path 
     * @param {object} [options] optional options used by implementation for recursive calls
     * @param {string[]|number[]} [options.keyFilter] specify the child keys to get callbacks for, skips .next callbacks for other keys
     * @param {string} [options.tid] optional transaction id for node locking purposes
     * @returns {{ next(child: NodeInfo) => Promise<void>}} returns a generator object that calls .next for each child until the .next callback returns false
     */
    // eslint-disable-next-line no-unused-vars
    getChildren(path, options) {
        throw new Error(`This method must be implemented by subclass`);
    }

    /**
     * Gets a node's value by delegating to getNode, returning only the value
     * @param {string} path 
     * @param {object} [options] optional options that can limit the amount of (sub)data being loaded, and any other implementation specific options for recusrsive calls
     * @param {string[]} [options.include] child paths to include
     * @param {string[]} [options.exclude] child paths to exclude
     * @param {boolean} [options.child_objects] whether to inlcude child objects and arrays
     * @param {string} [options.tid] optional transaction id for node locking purposes
     * @returns {Promise<any>}
     */
    async getNodeValue(path, options) {
        const node = await this.getNode(path, options);
        return node.value;
    }

    /**
     * Gets a node's value and (if supported) revision
     * @param {string} path 
     * @param {object} [options] optional options that can limit the amount of (sub)data being loaded, and any other implementation specific options for recusrsive calls
     * @param {string[]} [options.include] child paths to include
     * @param {string[]} [options.exclude] child paths to exclude
     * @param {boolean} [options.child_objects] whether to inlcude child objects and arrays
     * @param {string} [options.tid] optional transaction id for node locking purposes
     * @returns {Promise<{ revision?: string, value: any}>}
     */
    // eslint-disable-next-line no-unused-vars
    getNode(path, options) {
        throw new Error(`This method must be implemented by subclass`);
    }

    /**
     * Retrieves info about a node (existence, wherabouts etc)
     * @param {string} path 
     * @param {object} [options] optional options used by implementation for recursive calls
     * @param {string} [options.tid] optional transaction id for node locking purposes
     * @param {boolean} [options.include_child_count=false] whether to include child count if node is an object or array
     * @returns {Promise<NodeInfo>}
     */
    // eslint-disable-next-line no-unused-vars
    getNodeInfo(path, options) {
        throw new Error(`This method must be implemented by subclass`);
    }

    // /**
    //  * Removes a node by delegating to updateNode on the parent with null value.
    //  * Throws an Error if path is root ('')
    //  * @param {string} path
    //  * @param {object} [options] optional options used by implementation for recursive calls
    //  * @param {string} [options.tid] optional transaction id for node locking purposes
    //  * @param {string} [options.context] context info used by the client
    //  * @returns {Promise<void>}
    //  */
    // removeNode(path, options = { tid: undefined, context: null }) {
    //     throw new Error(`This method must be implemented by subclass`);
    // }

    /**
     * Creates or overwrites a node. Delegates to updateNode on a parent if
     * path is not the root.
     * @param {string} path
     * @param {any} value
     * @param {object} [options] optional options used by implementation for recursive calls
     * @param {string} [options.tid] optional transaction id for node locking purposes
     * @param {any} [options.context] context info used by the client
     * @returns {Promise<void>}
     */
    // eslint-disable-next-line no-unused-vars
    setNode(path, value, options) {
        throw new Error(`This method must be implemented by subclass`);
    }

    /**
     * Updates a node by merging an existing node with passed updates object, 
     * or creates it by delegating to updateNode on the parent path.
     * @param {string} path
     * @param {object} updates object with key/value pairs
     * @param {object} [options] optional options used by implementation for recursive calls
     * @param {string} [options.tid] optional transaction id for node locking purposes
     * @param {any} [options.context] context info used by the client
     * @returns {Promise<void>}
     */
    // eslint-disable-next-line no-unused-vars
    updateNode(path, updates, options) {
        throw new Error(`This method must be implemented by subclass`);
    }

    /**
     * Updates a node by getting its value, running a callback function that transforms 
     * the current value and returns the new value to be stored. Assures the read value 
     * does not change while the callback runs, or runs the callback again if it did.
     * @param {string} path
     * @param {(value: any) => any} callback function that transforms current value and returns the new value to be stored. Can return a Promise
     * @param {object} [options] optional options used by implementation for recursive calls
     * @param {string} [options.tid] optional transaction id for node locking purposes
     * @param {boolean} [options.suppress_events=false] whether to suppress the execution of event subscriptions
     * @param {any} [options.context] context info used by the client
     * @returns {Promise<void>}
     */
    async transactNode(path, callback, options = { no_lock: false, suppress_events: false, context: null }) {
        const useFakeLock = options && options.no_lock === true;
        const tid = this.createTid();
        const lock = useFakeLock
            ? { tid, release() {} } // Fake lock, we'll use revision checking & retrying instead
            : await this.nodeLocker.lock(path, tid, true, 'transactNode');

        try {
            let changed = false, changeCallback = () => { changed = true; };
            if (useFakeLock) {
                // Monitor value changes
                this.subscriptions.add(path, 'notify_value', changeCallback);
            }
            const node = await this.getNode(path, { tid });
            const checkRevision = node.revision;
            let newValue;
            try {
                newValue = callback(node.value);
                if (newValue instanceof Promise) {
                    newValue = await newValue.catch(err => {
                        this.debug.error(`Error in transaction callback: ${err.message}`);
                    });
                }
            }
            catch (err) {
                this.debug.error(`Error in transaction callback: ${err.message}`);
            }
            if (typeof newValue === 'undefined') {
                // Callback did not return value. Cancel transaction
                return;
            }
            // asserting revision is only needed when no_lock option was specified
            if (useFakeLock) {
                this.subscriptions.remove(path, 'notify_value', changeCallback)
            }
            if (changed) {
                throw new NodeRevisionError(`Node changed`);
            }
            const result = await this.setNode(path, newValue, { assert_revision: checkRevision, tid: lock.tid, suppress_events: options.suppress_events, context: options.context });
            return result;
        }
        catch (err) {
            if (err instanceof NodeRevisionError) {
                // try again
                console.warn(`node value changed, running again. Error: ${err.message}`);
                return this.transactNode(path, callback, options);
            }
            else {
                throw err;
            }
        }
        finally {
            lock.release();
        }
    }

    /**
     * Checks if a node's value matches the passed criteria
     * @param {string} path
     * @param {Array<{ key: string, op: string, compare: string }>} criteria criteria to test
     * @param {object} [options] optional options used by implementation for recursive calls
     * @param {string} [options.tid] optional transaction id for node locking purposes
     * @returns {Promise<boolean>} returns a promise that resolves with a boolean indicating if it matched the criteria
     */
    matchNode(path, criteria, options = { tid: undefined }) {

        // TODO: Try implementing nested property matching, eg: filter('address/city', '==', 'Amsterdam')
        
        const tid = (options && options.tid) || ID.generate();

        /**
         * 
         * @param {string} path 
         * @param {Array<{ key: string, op: string, compare: string }>} criteria criteria to test
         */
        const checkNode = (path, criteria) => {
            if (criteria.length === 0) {
                return Promise.resolve(true); // No criteria, so yes... It matches!
            }
            const criteriaKeys = criteria.reduce((keys, cr) => {
                let key = cr.key;
                if (key.includes('/')) {
                    // Descendant key criterium, use child key only (eg 'address' of 'address/city')
                    key = key.slice(0, key.indexOf('/'));
                }
                if (keys.indexOf(key) < 0) {
                    keys.push(key);
                }
                return keys;
            }, []);
            const unseenKeys = criteriaKeys.slice();

            let isMatch = true;
            let delayedMatchPromises = [];
            return this.getChildren(path, { tid, keyFilter: criteriaKeys })
            .next(childInfo => {
                unseenKeys.includes(childInfo.key) && unseenKeys.splice(unseenKeys.indexOf(childInfo.key), 1);

                const keyCriteria = criteria
                    .filter(cr => cr.key === childInfo.key)
                    .map(cr => ({ op: cr.op, compare: cr.compare }));

                const keyResult = keyCriteria.length > 0 ? checkChild(childInfo, keyCriteria) : { isMatch: true, promises: [] };
                isMatch = keyResult.isMatch;
                if (isMatch) {
                    delayedMatchPromises.push(...keyResult.promises);

                    const childCriteria = criteria
                        .filter(cr => cr.key.startsWith(`${childInfo.key}/`))
                        .map(cr => {
                            const key = cr.key.slice(cr.key.indexOf('/') + 1);
                            return { key, op: cr.op, compare: cr.compare }
                        });

                    if (childCriteria.length > 0) {
                        const childPath = PathInfo.getChildPath(path, childInfo.key);
                        const childPromise = 
                            checkNode(childPath, childCriteria)
                            .then(isMatch => ({ isMatch }));
                        delayedMatchPromises.push(childPromise);
                    }
                }
                if (!isMatch || unseenKeys.length === 0) {
                    return false; // Stop iterating
                }
            })
            .then(() => {
                if (isMatch) {
                    return Promise.all(delayedMatchPromises)
                    .then(results => {
                        isMatch = results.every(res => res.isMatch)
                    });
                }
            })
            .then(() => {
                if (!isMatch) { return false; }
                
                // Now, also check keys that weren't found in the node. (a criterium may be "!exists")
                isMatch = unseenKeys.every(key => {

                    const childInfo = new NodeInfo({ key, exists: false });

                    const childCriteria = criteria
                        .filter(cr => cr.key.startsWith(`${key}/`))
                        .map(cr => ({ op: cr.op, compare: cr.compare }));

                    if (childCriteria.length > 0 && !checkChild(childInfo, childCriteria).isMatch) {
                        return false;
                    }

                    const keyCriteria = criteria
                        .filter(cr => cr.key === key)
                        .map(cr => ({ op: cr.op, compare: cr.compare }));

                    if (keyCriteria.length === 0) {
                        return true; // There were only child criteria, and they matched (otherwise we wouldn't be here)
                    }

                    const result = checkChild(childInfo, keyCriteria);
                    return result.isMatch;
                });
                return isMatch;
            })
            .catch(err => {
                this.debug.error(`Error matching on "${path}": `, err);
                throw err;
            });
        }; // checkNode

        /**
         * 
         * @param {NodeInfo} child 
         * @param {Array<{ op: string, compare: string }>} criteria criteria to test
         */
        const checkChild = (child, criteria) => {
            const promises = [];
            const isMatch = criteria.every(f => {
                let proceed = true;
                if (f.op === "!exists" || (f.op === "==" && (typeof f.compare === 'undefined' || f.compare === null))) { 
                    proceed = !child.exists;
                }
                else if (f.op === "exists" || (f.op === "!=" && (typeof f.compare === 'undefined' || f.compare === null))) {
                    proceed = child.exists;
                }
                else if (!child.exists) {
                    proceed = false;
                }
                else {
                    if (child.address) {
                        if (child.valueType === VALUE_TYPES.OBJECT && ["has","!has"].indexOf(f.op) >= 0) {
                            const op = f.op === "has" ? "exists" : "!exists";
                            const p = checkNode(child.path, [{ key: f.compare, op }])
                            .then(isMatch => {
                                return { key: child.key, isMatch };
                            });
                            promises.push(p);
                            proceed = true;
                        }
                        else if (child.valueType === VALUE_TYPES.ARRAY && ["contains","!contains"].indexOf(f.op) >= 0) {
                            // TODO: refactor to use child stream
                            const p = this.getNodeValue(child.path, { tid })
                            .then(arr => {
                                // const i = arr.indexOf(f.compare);
                                // return { key: child.key, isMatch: (i >= 0 && f.op === "contains") || (i < 0 && f.op === "!contains") };
        
                                const isMatch = 
                                    f.op === "contains"
                                        // "contains"
                                        ? f.compare instanceof Array
                                            ? f.compare.every(val => arr.includes(val)) // Match if ALL of the passed values are in the array
                                            : arr.includes(f.compare)
                                    
                                        // "!contains"
                                        : f.compare instanceof Array
                                            ? !f.compare.some(val => arr.includes(val)) // DON'T match if ANY of the passed values is in the array
                                            : !arr.includes(f.compare);
        
                                return { key: child.key, isMatch };
                            });
                            promises.push(p);
                            proceed = true;
                        }
                        else if (child.valueType === VALUE_TYPES.STRING) {
                            const p = this.getNodeValue(child.path, { tid })
                            .then(val => {
                                return { key: child.key, isMatch: this.test(val, f.op, f.compare) };
                            });
                            promises.push(p);
                            proceed = true;
                        }
                        else {
                            proceed = false;
                        }
                    }
                    else if (child.type === VALUE_TYPES.OBJECT && ["has","!has"].indexOf(f.op) >= 0) {
                        const has = f.compare in child.value;
                        proceed = (has && f.op === "has") || (!has && f.op === "!has");
                    }
                    else if (child.type === VALUE_TYPES.ARRAY && ["contains","!contains"].indexOf(f.op) >= 0) {
                        const contains = child.value.indexOf(f.compare) >= 0;
                        proceed = (contains && f.op === "contains") || (!contains && f.op === "!contains");
                    }
                    else {
                        let ret = this.test(child.value, f.op, f.compare);
                        if (ret instanceof Promise) {
                            promises.push(ret);
                            ret = true;
                        }
                        proceed = ret;
                    }
                }
                return proceed;
            }); // fs.every
        
            return { isMatch, promises };        
        }; // checkChild

        return checkNode(path, criteria);
    }

    test(val, op, compare) {
        if (op === "<") { return val < compare; }
        if (op === "<=") { return val <= compare; }
        if (op === "==") { return val === compare; }
        if (op === "!=") { return val !== compare; }
        if (op === ">") { return val > compare; }
        if (op === ">=") { return val >= compare; }
        if (op === "in") { return compare.indexOf(val) >= 0; }
        if (op === "!in") { return compare.indexOf(val) < 0; }
        if (op === "like" || op === "!like") {
            const pattern = '^' + compare.replace(/[-[\]{}()+.,\\^$|#\s]/g, '\\$&').replace(/\?/g, '.').replace(/\*/g, '.*?') + '$';
            const re = new RegExp(pattern, 'i');
            const isMatch = re.test(val.toString());
            return op === "like" ? isMatch : !isMatch;
        }
        if (op === "matches") {
            return compare.test(val.toString());
        }
        if (op === "!matches") {
            return !compare.test(val.toString());
        }
        if (op === "between") {
            return val >= compare[0] && val <= compare[1];
        }
        if (op === "!between") {
            return val < compare[0] || val > compare[1];
        }
        if (op === "has" || op === "!has") {
            const has = typeof val === 'object' && compare in val;
            return op === "has" ? has : !has;
        }
        if (op === "contains" || op === "!contains") {
            // TODO: rename to "includes"?
            const includes = typeof val === 'object' && val instanceof Array && val.includes(compare);
            return op === "contains" ? includes : !includes;
        }
        return false;
    }

    /**
     * Export a specific path's data to a stream
     * @param {string} path
     * @param {(str: string) => void|Promise<void> | { write(str: string) => void|Promise<void>}} write function that writes to a stream, or stream object that has a write method that (optionally) returns a promise the export needs to wait for before continuing
     * @returns {Promise<void>} returns a promise that resolves once all data is exported
     */
    async exportNode(path, write, options = { format: 'json', type_safe: true }) {
        if (options && options.format !== 'json') {
            throw new Error(`Only json output is currently supported`);
        }
        if (typeof write !== 'function') {
            // Using the "old" stream argument. Use its write method for backward compatibility
            write = write.write.bind(write);
        }

        const stringifyValue = (type, val) => {
            const escape = str => str.replace(/"/g, '\\"').replace(/\n/g, '\\n');
            if (type === VALUE_TYPES.DATETIME) {
                val = `"${val.toISOString()}"`;
                if (options.type_safe) {
                    val = `{".type":"Date",".val":${val}}`;
                }
            }
            else if (type === VALUE_TYPES.STRING) {
                val = `"${escape(val)}"`;
            }
            else if (type === VALUE_TYPES.ARRAY) {
                val = `[]`;
            }
            else if (type === VALUE_TYPES.OBJECT) {
                val = `{}`;
            }
            else if (type === VALUE_TYPES.BINARY) {
                val = `"${escape(ascii85.encode(val))}"`; // TODO: use base64 instead, no escaping needed
                if (options.type_safe) {
                    val = `{".type":"Buffer",".val":${val}}`;
                }
            }
            else if (type === VALUE_TYPES.REFERENCE) {
                val = `"${val.path}"`;
                if (options.type_safe) {
                    val = `{".type":"PathReference",".val":${val}}`;
                }
            }
            return val;
        };

        let objStart = '', objEnd = '';
        const nodeInfo = await this.getNodeInfo(path);
        if (!nodeInfo.exists) {
            return write('null');
        }
        else if (nodeInfo.type === VALUE_TYPES.OBJECT) { objStart = '{'; objEnd = '}'; }
        else if (nodeInfo.type === VALUE_TYPES.ARRAY) { objStart = '['; objEnd = ']'; }
        else {
            // Node has no children, get and export its value
            const value = await this.getNodeValue(path);
            const val = stringifyValue(nodeInfo.type, value);
            return write(val);
        }

        if (objStart) {
            const p = write(objStart);
            if (p instanceof Promise) { await p; }
        }

        let output = '', outputCount = 0;
        const pending = [];
        await this.getChildren(path)
        .next(childInfo => {
            if (childInfo.address) {
                // Export child recursively
                pending.push(childInfo);
            }
            else {
                if (outputCount++ > 0) { output += ','; }
                if (typeof childInfo.key === 'string') { output += `"${childInfo.key}":`; }
                output += stringifyValue(childInfo.type, childInfo.value);
            }
        });
        if (output) {
            const p = write(output);
            if (p instanceof Promise) { await p; }
        }

        while (pending.length > 0) {
            const childInfo = pending.shift();
            let output = outputCount++ > 0 ? ',' : '';
            const key = typeof childInfo.index === 'number' ? childInfo.index : childInfo.key;
            if (typeof key === 'string') { output += `"${key}":`; }
            if (output) {
                const p = write(output);
                if (p instanceof Promise) { await p; }
            }
            await this.exportNode(PathInfo.getChildPath(path, key), write, options);
        }

        if (objEnd) {
            const p = write(objEnd);
            if (p instanceof Promise) { await p; }
        }
    }

    /**
     * Import a specific path's data from a stream
     * @param {string} path
     * @param {(bytes: number) => string|ArrayBufferView|Promise<string|ArrayBufferView>} read read function that streams a new chunk of data
     * @param {object} [options]
     * @param {'json'} [options.format]
     * @param {'set'|'update'|'merge'} [options.method] How to store the imported data: 'set' and 'update' will use the same logic as when calling 'set' or 'update' on the target, 
     * 'merge' will do something special: it will use 'update' logic on all nested child objects: 
     * consider existing data `{ users: { ewout: { name: 'Ewout Stortenbeker', age: 42 } } }`: 
     * importing `{ users: { ewout: { country: 'The Netherlands', age: 43 } } }` with `method: 'merge'` on the root node
     * will effectively add `country` and update `age` properties of "users/ewout", and keep all else the same.4
     * This method is extremely useful to replicate effective data changes to remote databases.
     * @returns {Promise<void>} returns a promise that resolves once all data is imported
     */
     async importNode(path, read, options = { format: 'json', method: 'set' }) {
        const chunkSize = 256 * 1024; // 256KB
        const maxQueueBytes = 1024 * 1024; // 1MB
        let state = {
            data: '',
            index: 0,
            offset: 0,
            queue: [],
            queueStartByte: 0,
            timesFlushed: 0,
            get processedBytes() {
                return this.offset + this.index;
            }
        };
        const readNextChunk = async (append = false) => {
            let data = await read(chunkSize);
            if (data === null) {
                if (state.data) {
                    throw new Error(`Unexpected EOF at index ${state.offset + state.data.length}`);
                }
                else {
                    throw new Error(`Unable to read data from stream`);
                }
            }
            else if (typeof data === 'object') {
                data = new TextDecoder().decode(data);
            }
            if (append) {
                state.data += data;
            }
            else {
                state.offset += state.data.length;
                state.data = data;
                state.index = 0;
            }
        };
        const readBytes = async (length) => {
            let str = '';
            if (state.index + length >= state.data.length) {
                str = state.data.slice(state.index);
                length -= str.length;
                await readNextChunk();
            }
            str += state.data.slice(state.index, state.index + length);
            state.index += length;
            return str;
        };
        const assertBytes = async (length) => {
            if (state.index + length > state.data.length) {
                await readNextChunk(true);
            }
            if (state.index + length > state.data.length) {
                throw new Error(`Not enough data available from stream`);
            }
        };
        const consumeToken = async token => {
            // const str = state.data.slice(state.index, state.index + token.length);
            const str = await readBytes(token.length);
            if (str !== token) { throw new Error(`Unexpected character "${str[0]}" at index ${state.offset + state.index}, expected "${token}"`); }
        };
        const consumeSpaces = async () => {
            const spaces = [' ', '\t', '\r', '\n'];
            while (true) {
                if (state.index >= state.data.length) {
                    await readNextChunk();
                }
                if (spaces.includes(state.data[state.index])) {
                    state.index++;
                }
                else {
                    break;
                }
            }
        };
        /**
         * Reads number of bytes from the stream but does not consume them
         */
        const peekBytes = async (length) => {
            await assertBytes(length);
            const index = state.index;
            return state.data.slice(index, index + length);
        };
        /**
         * Tries to detect what type of value to expect, but does not read it
         * @returns 
         */
        const peekValueType = async () => {
            await consumeSpaces();
            const ch = await peekBytes(1);
            switch (ch) {
                case '"': return 'string';
                case '{': return 'object';
                case '[': return 'array';
                case 'n': return 'null';
                case 'u': return 'undefined';
                case 't':
                case 'f':
                    return 'boolean';
                default: {
                    if (ch === '-' || (ch >= '0' && ch <= '9')) {
                        return 'number';
                    }
                    throw new Error(`Unknown value at index ${state.offset + state.index}`);
                }
            }
        };

        /**
         * Reads a string from the stream at current index. Expects current character to be "
         */
        const readString = async () => {
            await consumeToken('"');
            let str = '';
            let i = state.index;
            // Read until next (unescaped) quote
            while (state.data[i] !== '"' || state.data[i-1] === '\\') {
                i++;
                if (i >= state.data.length) {
                    str += state.data.slice(state.index);
                    await readNextChunk();
                    i = 0;
                }
            }
            str += state.data.slice(state.index, i);
            state.index = i + 1;
            return unescape(str);
        };
        const readBoolean = async () => {
            if (state.data[state.index] === 't') {
                await consumeToken('true');
            }
            else if (state.data[state.index] === 'f') {
                await consumeToken('false');
            }
            throw new Error(`Expected true or false at index ${state.offset + state.index}`);
        };
        const readNumber = async () => {
            let str = '';
            let i = state.index;
            // Read until non-number character is encountered
            const nrChars = ['-','0','1','2','3','4','5','6','7','8','9','.','e','b','f','x'];
            while (nrChars.includes(state.data[i])) {
                i++;
                if (i >= state.data.length) {
                    str += state.data.slice(state.index);
                    await readNextChunk();
                    i = 0;
                }
            }
            str += state.data.slice(state.index, i);
            state.index = i;
            const nr = str.includes('.') ? parseFloat(str) : parseInt(str);
            return nr;
        };
        const readValue = async () => {
            await consumeSpaces();
            const type = await peekValueType();
            const value = await (() => {
                switch (type) {
                    case 'string': return readString();
                    case 'object': return {};
                    case 'array': return [];
                    case 'number': return readNumber();
                    case 'null': return null;
                    case 'undefined': return undefined;
                    case 'boolean': return readBoolean();
                }
            })();
            return { type, value };
        };

        const unescape = str => str.replace(/\\n/g, '\n').replace(/\\"/g, '"');
        const getTypeSafeValue = (path, obj) => {
            const type = obj['.type'];
            let val = obj['.val'];
            switch (type) {
                case 'Date': val = new Date(val); break;
                case 'Buffer': 
                    val = unescape(val);
                    if (val.startsWith('<~')) {
                        // Ascii85 encoded
                        val = ascii85.decode(val);
                    }
                    else {
                        // base64 not implemented yet
                        throw new Error(`Import error: Unexpected encoding for value for value at path "/${path}"`);
                    }
                    break;
                case 'PathReference': 
                    val = new PathReference(val);
                    break;
                default:
                    throw new Error(`Import error: Unsupported type "${type}" for value at path "/${path}"`);
            }
            return val;
        };

        const context = { acebase_import_id: ID.generate() };
        const childOptions = { suppress_events: options.suppress_events, context };

        /**
         * Work in progress (not used yet): queue nodes to store to improve performance
         * @param {PathInfo} target
         * @param {any} value
         */
        const enqueue = async (target, value) => {
            state.queue.push({ target, value });
            if (state.processedBytes >= state.queueStartByte + maxQueueBytes) {
                // Flush queue, group queued (set) items as update operations on their parents
                const operations = state.queue.reduce((updates, item) => {
                    // Optimization idea: find all data we know is complete, add that as 1 set if method !== 'merge'
                    // Example: queue is something like [
                    //   "users/user1": {},
                    //   "users/user1/email": "user@example.com"
                    //   "users/user1/addresses": {},
                    //   "users/user1/addresses/address1": {},
                    //   "users/user1/addresses/address1/city": "Amsterdam",
                    //   "users/user1/addresses/address2": {}, // We KNOW "users/user1/addresses/address1" is not coming back
                    //   "users/user1/addresses/address2/city": "Berlin",
                    //   "users/user2": {} // <-- We KNOW "users/user1" is not coming back!
                    //]
                    if (item.target.path === path) {
                        // This is the import target. If method is 'set' and this is the first flush, add it as 'set' operation.
                        // Use 'update' in all other cases
                        updates.push({ op: options.method === 'set' && state.timesFlushed === 0 ? 'set' : 'update', ...item });
                    }
                    else {
                        // Find parent to merge with
                        const parent = updates.find(other => other.target.isParentOf(item.target));
                        if (parent) {
                            parent.value[item.target.key] = item.value;
                        }
                        else {
                            // Parent not found. If method is 'merge', use 'update', otherwise use or 'set'
                            updates.push({ op: options.method === 'merge' ? 'update' : 'set', ...item });
                        }
                    }
                }, []);

                // Fresh state
                state.queueStartBytestate.queueStartByte = state.processedBytes;
                state.queue = [];
                state.timesFlushed++;

                // Execute db updates


            }
            if (target.path === path) {
                // This is the import target. If method === 'set'

            }
        };

        /**
         * 
         * @param {PathInfo} target 
         */
        const importObject = async (target) => {
            await consumeToken('{');
            await consumeSpaces();
            let nextChar = await peekBytes(1);
            if (nextChar === '}') {
                state.index++;
                return this.setNode(target.path, {}, childOptions);
            }
            let childCount = 0;
            let obj = {};
            let flushedBefore = false;
            const flushObject = async () => {
                let p;
                if (!flushedBefore) {
                    flushedBefore = true;
                    p = this.setNode(target.path, obj, childOptions);
                }
                else if (Object.keys(obj).length > 0) {
                    p = this.updateNode(target.path, obj, childOptions);
                }
                obj = {};
                if (p) { await p; }
            };
            const promises = [];
            while (true) {
                await consumeSpaces();
                const property = await readString(); // readPropertyName();
                await consumeSpaces();
                await consumeToken(':');
                await consumeSpaces();
                const { value, type } = await readValue();
                obj[property] = value;
                childCount++;
                if (['object','array'].includes(type)) {
                    // Flush current imported value before proceeding with object/array child
                    promises.push(flushObject());

                    if (type === 'object') {
                        // Import child object/array
                        await importObject(target.child(property));
                    }
                    else {
                        await importArray(target.child(property));
                    }
                }

                // What comes next? End of object ('}') or new property (',')?
                await consumeSpaces();
                let nextChar = await peekBytes(1);
                if (nextChar === '}') {
                    // Done importing this object
                    state.index++;
                    break;
                }
                // Assume comma now
                await consumeToken(',');
            }
            const isTypedValue = childCount === 2 && '.type' in obj && '.val' in obj;
            if (isTypedValue) {
                // This is a value that was exported with type safety. 
                // Do not store as object, but convert to original value
                // Note that this is done regardless of options.type_safe
                const val = getTypeSafeValue(target.path, obj);
                return this.setNode(target.path, val, childOptions);
            }
            promises.push(flushObject());
            await Promise.all(promises);
        };

        /**
         * 
         * @param {PathInfo} target 
         * @returns 
         */
        const importArray = async (target) => {
            await consumeToken('[');
            await consumeSpaces();
            let nextChar = await peekBytes(1);
            if (nextChar === ']') {
                state.index++;
                return this.setNode(target.path, [], childOptions);
            }
            let flushedBefore = false;
            let arr = [];
            let updates = {};
            const flushArray = async () => {
                let p;
                if (!flushedBefore) {
                    // Store array
                    flushedBefore = true;
                    p = this.setNode(target.path, arr, childOptions);
                    arr = null; // GC
                }
                else if (Object.keys(updates).length > 0) {
                    // Flush updates
                    p = this.updateNode(target.path, updates, childOptions);
                    updates = {};
                }
                if (p) { await p; }
            };
            const pushChild = (value, index) => {
                if (flushedBefore) {
                    updates[index] = value;
                }
                else {
                    arr.push(value);
                }
            };

            const promises = [];
            let index = 0;
            while (true) {
                await consumeSpaces();
                const { value, type } = await readValue();
                pushChild(value, index);
                if (['object','array'].includes(type)) {
                    // Flush current imported value before proceeding with object/array child
                    promises.push(flushArray()); // No need to await now

                    if (type === 'object') {
                        // Import child object/array
                        await importObject(target.child(index));
                    }
                    else {
                        await importArray(target.child(index));
                    }
                }

                // What comes next? End of array (']') or new property (',')?
                await consumeSpaces();
                let nextChar = await peekBytes(1);
                if (nextChar === ']') {
                    // Done importing this array
                    state.index++;
                    break;
                }
                // Assume comma now
                await consumeToken(',');
                index++;
            }

            promises.push(flushArray());
            await Promise.all(promises);
        };

        const start = async () => {
            const { value, type } = await readValue();
            if (['object','array'].includes(type)) {
                // Object or array value, has not been read yet
                const target = PathInfo.get(path);
                if (type === 'object') {
                    await importObject(target);
                }
                else {
                    await importArray(target);
                }
            }
            else {
                // Simple value
                await this.setNode(path, value, childOptions);
            }
        }
        return start();
     }


    /**
     * Adds, updates or removes a schema definition to validate node values before they are stored at the specified path
     * @param {string} path target path to enforce the schema on, can include wildcards. Eg: 'users/*\/posts/*' or 'users/$uid/posts/$postid'
     * @param {string|Object} schema schema type definitions. When null value is passed, a previously set schema is removed.
     */
    setSchema(path, schema) {
        if (typeof schema === 'undefined') {
            throw new TypeError(`schema argument must be given`);
        }
        if (schema === null) {
            // Remove previously set schema on path
            const i = this._schemas.findIndex(s => s.path === path);
            i >= 0 && this._schemas.splice(i, 1);
            return;
        }
        // Parse schema, add or update it
        const definition = new SchemaDefinition(schema);        
        let item = this._schemas.find(s => s.path === path);
        if (item) {
            item.schema = definition;
        }
        else {
            this._schemas.push({ path, schema: definition });
            this._schemas.sort((a, b) => {
                const ka = PathInfo.getPathKeys(a.path), kb = PathInfo.getPathKeys(b.path);
                if (ka.length === kb.length) { return 0; }
                return ka.length < kb.length ? -1 : 1;
            });
        }
    }

    /**
     * Gets currently active schema definition for the specified path
     * @param {string} path
     * @returns { path: string, schema: string|Object, text: string }
     */
    getSchema(path) {
        const item = this._schemas.find(item => item.path === path);
        return item ? { path, schema: item.schema.source, text: item.schema.text } : null;
    }

    /**
     * Gets all currently active schema definitions
     * @returns {Array<{ path: string, schema: string|Object, text: string }>}
     */
    getSchemas() {
        return this._schemas.map(item => ({ path: item.path, schema: item.schema.source, text: item.schema.text }) );
    }

    /**
     * Validates the schemas of the node being updated and its children
     * @param {string} path path being written to
     * @param {any} value the new value, or updates to current value
     * @param {any} [options] 
     * @param {boolean} [options.updates] If an existing node is being updated (merged), this will only enforce schema rules set on properties being updated.
     * @returns {{ ok: boolean, reason?: string }}
     * @example
     * // define schema for each tag of each user post:
     * db.schema.set(
     *  'users/$uid/posts/$postId/tags/$tagId', 
     *  { name: 'string', 'link_id?': 'number' }
     * );
     * 
     * // Insert that will fail:
     * db.ref('users/352352/posts/572245').set({ 
     *  text: 'this is my post', 
     *  tags: { sometag: 'deny this' } // <-- sometag must be typeof object
     * });
     * 
     * // Insert that will fail:
     * db.ref('users/352352/posts/572245').set({ 
     *  text: 'this is my post', 
     *  tags: { 
     *      tag1: { name: 'firstpost', link_id: 234 },
     *      tag2: { name: 'newbie' },
     *      tag3: { title: 'Not allowed' } // <-- title property not allowed
     *  }
     * });
     * 
     * // Update that fails if post does not exist:
     * db.ref('users/352352/posts/572245/tags/tag1').update({ 
     *  name: 'firstpost'
     * }); // <-- post is missing property text
     */
     validateSchema(path, value, options = { updates: false }) {
        let result = { ok: true };
        const pathInfo = PathInfo.get(path);
        
        this._schemas.filter(s => 
            pathInfo.isOnTrailOf(s.path) //pathInfo.equals(s.path) || pathInfo.isAncestorOf(s.path)
        )
        .every(s => {
            if (pathInfo.isDescendantOf(s.path)) {
                // Given check path is a descendant of this schema definition's path
                const ancestorPath = PathInfo.fillVariables(s.path, path);
                const trailKeys = pathInfo.keys.slice(PathInfo.getPathKeys(s.path).length);
                result = s.schema.check(ancestorPath, value, options.updates, trailKeys);
                return result.ok;
            }
            
            // Given check path is on schema definition's path or on a higher path
            const trailKeys = PathInfo.getPathKeys(s.path).slice(pathInfo.keys.length);
            const partial = options.updates === true && trailKeys.length === 0;
            /**
             * @param {string} path
             * @param {any} value 
             * @param {Array<string|numer>} trailKeys 
             * @returns {{ ok: boolean, reason?: string }}
             */
            const check = (path, value, trailKeys) => {
                if (trailKeys.length === 0) {
                    // Check this node
                    return s.schema.check(path, value, partial);
                }
                else if (value === null) {
                    return { ok: true }; // Not at the end of trail, but nothing more to check
                }
                const key = trailKeys[0];
                if (typeof key === 'string' && (key === '*' || key[0] === '$')) {
                    // Wildcard. Check each key in value recursively                        
                    if (value === null || typeof value !== 'object') {
                        // Can't check children, because there are none. This is
                        // possible if another rule permits the value at current path
                        // to be something else than an object.
                        return { ok: true };
                    }
                    let result;
                    Object.keys(value).every(childKey => {
                        const childPath = PathInfo.getChildPath(path, childKey);
                        const childValue = value[childKey];
                        result = check(childPath, childValue, trailKeys.slice(1));
                        return result.ok;
                    });
                    return result;
                }
                else {
                    const childPath = PathInfo.getChildPath(path, key);
                    const childValue = value[key];
                    return check(childPath, childValue, trailKeys.slice(1));
                }
            }
            result = check(path, value, trailKeys);
            return result.ok;
        });
        
        return result;
    }    
}

module.exports = {
    Storage,
    StorageSettings,
    NodeNotFoundError,
    NodeRevisionError,
    SchemaValidationError,
    IWriteNodeResult
};