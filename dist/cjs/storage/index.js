"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Storage = exports.StorageSettings = exports.SchemaValidationError = void 0;
const acebase_core_1 = require("acebase-core");
const node_value_types_1 = require("../node-value-types");
const node_errors_1 = require("../node-errors");
const node_info_1 = require("../node-info");
const ipc_1 = require("../ipc");
const promise_fs_1 = require("../promise-fs");
// const { IPCTransactionManager } = require('./node-transaction');
const data_index_1 = require("../data-index"); // Indexing might not be available: the browser dist bundle doesn't include it because fs is not available: browserify --i ./src/data-index.js
const indexes_1 = require("./indexes");
const assert_1 = require("../assert");
const { compareValues, getChildValues, encodeString, defer } = acebase_core_1.Utils;
const DEBUG_MODE = false;
const SUPPORTED_EVENTS = ['value', 'child_added', 'child_changed', 'child_removed', 'mutated', 'mutations'];
// Add 'notify_*' event types for each event to enable data-less notifications, so data retrieval becomes optional
SUPPORTED_EVENTS.push(...SUPPORTED_EVENTS.map(event => `notify_${event}`));
// eslint-disable-next-line @typescript-eslint/no-empty-function
const NOOP = () => { };
class SchemaValidationError extends Error {
    constructor(reason) {
        super(`Schema validation failed: ${reason}`);
        this.reason = reason;
    }
}
exports.SchemaValidationError = SchemaValidationError;
/**
 * Storage Settings
 */
class StorageSettings {
    constructor(settings = {}) {
        /**
         * in bytes, max amount of child data to store within a parent record before moving to a dedicated record. Default is 50
         * @default 50
         */
        this.maxInlineValueSize = 50;
        /**
         * Instead of throwing errors on undefined values, remove the properties automatically. Default is false
         * @default false
         */
        this.removeVoidProperties = false;
        /**
         * Target path to store database files in, default is `'.'`
         * @default '.'
         */
        this.path = '.';
        /**
         * timeout setting for read and write locks in seconds. Operations taking longer than this will be aborted. Default is 120 seconds.
         * @default 120
         */
        this.lockTimeout = 120;
        /**
         * optional type of storage class - used by `AceBaseStorage` to create different specific db files (data, transaction, auth etc)
         * @see AceBaseStorageSettings see `AceBaseStorageSettings.type` for more info
         */
        this.type = 'data';
        /**
         * Whether the database should be opened in readonly mode
         * @default false
         */
        this.readOnly = false;
        if (typeof settings.maxInlineValueSize === 'number') {
            this.maxInlineValueSize = settings.maxInlineValueSize;
        }
        if (typeof settings.removeVoidProperties === 'boolean') {
            this.removeVoidProperties = settings.removeVoidProperties;
        }
        if (typeof settings.path === 'string') {
            this.path = settings.path;
        }
        if (this.path.endsWith('/')) {
            this.path = this.path.slice(0, -1);
        }
        if (typeof settings.lockTimeout === 'number') {
            this.lockTimeout = settings.lockTimeout;
        }
        if (typeof settings.type === 'string') {
            this.type = settings.type;
        }
        if (typeof settings.readOnly === 'boolean') {
            this.readOnly = settings.readOnly;
        }
        if (['object', 'string'].includes(typeof settings.ipc)) {
            this.ipc = settings.ipc;
        }
    }
}
exports.StorageSettings = StorageSettings;
class Storage extends acebase_core_1.SimpleEventEmitter {
    createTid() {
        return DEBUG_MODE ? ++this._lastTid : acebase_core_1.ID.generate();
    }
    /**
     * Base class for database storage, must be extended by back-end specific methods.
     * Currently implemented back-ends are AceBaseStorage, SQLiteStorage, MSSQLStorage, CustomStorage
     * @param name name of the database
     * @param settings instance of AceBaseStorageSettings or SQLiteStorageSettings
     */
    constructor(name, settings, env) {
        super();
        this.name = name;
        this.settings = settings;
        // private _validation = new Map<string, { validate?: (previous: any, value: any) => boolean, schema?: SchemaDefinition }>;
        this._schemas = [];
        this._indexes = [];
        this._annoucedIndexes = new Map();
        this.indexes = {
            /**
             * Tests if (the default storage implementation of) indexes are supported in the environment.
             * They are currently only supported when running in Node.js because they use the fs filesystem.
             * TODO: Implement storage specific indexes (eg in SQLite, MySQL, MSSQL, in-memory)
             */
            get supported() {
                return promise_fs_1.pfs === null || promise_fs_1.pfs === void 0 ? void 0 : promise_fs_1.pfs.hasFileSystem;
            },
            create: (path, key, options = {
                rebuild: false,
            }) => {
                const context = { storage: this, debug: this.debug, indexes: this._indexes, ipc: this.ipc };
                return (0, indexes_1.createIndex)(context, path, key, options);
            },
            /**
             * Returns indexes at a path, or a specific index on a key in that path
             */
            get: (path, key = null) => {
                if (path.includes('$')) {
                    // Replace $variables in path with * wildcards
                    const pathKeys = acebase_core_1.PathInfo.getPathKeys(path).map(key => typeof key === 'string' && key.startsWith('$') ? '*' : key);
                    path = (new acebase_core_1.PathInfo(pathKeys)).path;
                }
                return this._indexes.filter(index => index.path === path &&
                    (key === null || key === index.key));
            },
            /**
             * Returns all indexes on a target path, optionally includes indexes on child and parent paths
             */
            getAll: (targetPath, options = { parentPaths: true, childPaths: true }) => {
                const pathKeys = acebase_core_1.PathInfo.getPathKeys(targetPath);
                return this._indexes.filter(index => {
                    const indexKeys = acebase_core_1.PathInfo.getPathKeys(index.path + '/*');
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
             */
            list: () => {
                return this._indexes.slice();
            },
            /**
             * Discovers and populates all created indexes
             */
            load: async () => {
                this._indexes.splice(0);
                if (!promise_fs_1.pfs.hasFileSystem) {
                    // If pfs (fs) is not available, don't try using it
                    return;
                }
                let files = [];
                try {
                    files = (await promise_fs_1.pfs.readdir(`${this.settings.path}/${this.name}.acebase`));
                }
                catch (err) {
                    if (err.code !== 'ENOENT') {
                        // If the directory is not found, there are no file indexes. (probably not supported by used storage class)
                        // Only complain if error is something else
                        this.debug.error(err);
                    }
                }
                const promises = [];
                files.forEach(fileName => {
                    if (!fileName.endsWith('.idx')) {
                        return;
                    }
                    const needsStoragePrefix = this.settings.type !== 'data'; // auth indexes need to start with "[auth]-" and have to be ignored by other storage types
                    const hasStoragePrefix = /^\[[a-z]+\]-/.test(fileName);
                    if ((!needsStoragePrefix && !hasStoragePrefix) || needsStoragePrefix && fileName.startsWith(`[${this.settings.type}]-`)) {
                        const p = this.indexes.add(fileName);
                        promises.push(p);
                    }
                });
                await Promise.all(promises);
            },
            add: async (fileName) => {
                const existingIndex = this._indexes.find(index => index.fileName === fileName);
                if (existingIndex) {
                    return existingIndex;
                }
                else if (this._annoucedIndexes.has(fileName)) {
                    // Index is already in the process of being added, wait until it becomes availabe
                    const index = await this._annoucedIndexes.get(fileName);
                    return index;
                }
                try {
                    // Announce the index to prevent race condition in between reading and receiving the IPC index.created notification
                    const indexPromise = data_index_1.DataIndex.readFromFile(this, fileName);
                    this._annoucedIndexes.set(fileName, indexPromise);
                    const index = await indexPromise;
                    this._indexes.push(index);
                    this._annoucedIndexes.delete(fileName);
                    return index;
                }
                catch (err) {
                    this.debug.error(err);
                    return null;
                }
            },
            /**
             * Deletes an index from the database
             */
            delete: async (fileName) => {
                const index = await this.indexes.remove(fileName);
                await index.delete();
                this.ipc.sendNotification({ type: 'index.deleted', fileName: index.fileName, path: index.path, keys: index.key });
            },
            /**
             * Removes an index from the list. Does not delete the actual file, `delete` does that!
             * @returns returns the removed index
             */
            remove: async (fileName) => {
                const index = this._indexes.find(index => index.fileName === fileName);
                if (!index) {
                    throw new Error(`Index ${fileName} not found`);
                }
                this._indexes.splice(this._indexes.indexOf(index), 1);
                return index;
            },
            close: async () => {
                // Close all indexes
                const promises = this.indexes.list().map(index => index.close().catch(err => this.debug.error(err)));
                await Promise.all(promises);
            },
        };
        this._eventSubscriptions = {};
        this.subscriptions = {
            /**
             * Adds a subscription to a node
             * @param path Path to the node to add subscription to
             * @param type Type of the subscription
             * @param callback Subscription callback function
             */
            add: (path, type, callback) => {
                if (SUPPORTED_EVENTS.indexOf(type) < 0) {
                    throw new TypeError(`Invalid event type "${type}"`);
                }
                let pathSubs = this._eventSubscriptions[path];
                if (!pathSubs) {
                    pathSubs = this._eventSubscriptions[path] = [];
                }
                // if (pathSubs.findIndex(ps => ps.type === type && ps.callback === callback)) {
                //     storage.debug.warn(`Identical subscription of type ${type} on path "${path}" being added`);
                // }
                pathSubs.push({ created: Date.now(), type, callback });
                this.emit('subscribe', { path, event: type, callback }); // Enables IPC peers to be notified
            },
            /**
             * Removes 1 or more subscriptions from a node
             * @param path Path to the node to remove the subscription from
             * @param type Type of subscription(s) to remove (optional: if omitted all types will be removed)
             * @param callback Callback to remove (optional: if omitted all of the same type will be removed)
             */
            remove: (path, type, callback) => {
                const pathSubs = this._eventSubscriptions[path];
                if (!pathSubs) {
                    return;
                }
                const next = () => pathSubs.findIndex(ps => (type ? ps.type === type : true) && (callback ? ps.callback === callback : true));
                let i;
                while ((i = next()) >= 0) {
                    pathSubs.splice(i, 1);
                }
                this.emit('unsubscribe', { path, event: type, callback }); // Enables IPC peers to be notified
            },
            /**
             * Checks if there are any subscribers at given path that need the node's previous value when a change is triggered
             * @param path
             */
            hasValueSubscribersForPath(path) {
                const valueNeeded = this.getValueSubscribersForPath(path);
                return !!valueNeeded;
            },
            /**
             * Gets all subscribers at given path that need the node's previous value when a change is triggered
             * @param path
             */
            getValueSubscribersForPath: (path) => {
                // Subscribers that MUST have the entire previous value of a node before updating:
                //  - "value" events on the path itself, and any ancestor path
                //  - "child_added", "child_removed" events on the parent path
                //  - "child_changed" events on the parent path and its ancestors
                //  - ALL events on child/descendant paths
                const pathInfo = new acebase_core_1.PathInfo(path);
                const valueSubscribers = [];
                Object.keys(this._eventSubscriptions).forEach(subscriptionPath => {
                    if (pathInfo.equals(subscriptionPath) || pathInfo.isDescendantOf(subscriptionPath)) {
                        // path being updated === subscriptionPath, or a child/descendant path of it
                        // eg path === "posts/123/title"
                        // and subscriptionPath is "posts/123/title", "posts/$postId/title", "posts/123", "posts/*", "posts" etc
                        const pathSubs = this._eventSubscriptions[subscriptionPath];
                        const eventPath = acebase_core_1.PathInfo.fillVariables(subscriptionPath, path);
                        pathSubs
                            .filter(sub => !sub.type.startsWith('notify_')) // notify events don't need additional value loading
                            .forEach(sub => {
                            let dataPath = null;
                            if (sub.type === 'value') { // ["value", "notify_value"].includes(sub.type)
                                dataPath = eventPath;
                            }
                            else if (['mutated', 'mutations'].includes(sub.type) && pathInfo.isDescendantOf(eventPath)) { //["mutated", "notify_mutated"].includes(sub.type)
                                dataPath = path; // Only needed data is the properties being updated in the targeted path
                            }
                            else if (sub.type === 'child_changed' && path !== eventPath) { // ["child_changed", "notify_child_changed"].includes(sub.type)
                                const childKey = acebase_core_1.PathInfo.getPathKeys(path.slice(eventPath.length).replace(/^\//, ''))[0];
                                dataPath = acebase_core_1.PathInfo.getChildPath(eventPath, childKey);
                            }
                            else if (['child_added', 'child_removed'].includes(sub.type) && pathInfo.isChildOf(eventPath)) { //["child_added", "child_removed", "notify_child_added", "notify_child_removed"]
                                const childKey = acebase_core_1.PathInfo.getPathKeys(path.slice(eventPath.length).replace(/^\//, ''))[0];
                                dataPath = acebase_core_1.PathInfo.getChildPath(eventPath, childKey);
                            }
                            if (dataPath !== null && !valueSubscribers.some(s => s.type === sub.type && s.eventPath === eventPath)) {
                                valueSubscribers.push({ type: sub.type, eventPath, dataPath, subscriptionPath });
                            }
                        });
                    }
                });
                return valueSubscribers;
            },
            /**
             * Gets all subscribers at given path that could possibly be invoked after a node is updated
             */
            getAllSubscribersForPath: (path) => {
                const pathInfo = acebase_core_1.PathInfo.get(path);
                const subscribers = [];
                Object.keys(this._eventSubscriptions).forEach(subscriptionPath => {
                    // if (pathInfo.equals(subscriptionPath) //path === subscriptionPath
                    //     || pathInfo.isDescendantOf(subscriptionPath)
                    //     || pathInfo.isAncestorOf(subscriptionPath)
                    // ) {
                    if (pathInfo.isOnTrailOf(subscriptionPath)) {
                        const pathSubs = this._eventSubscriptions[subscriptionPath];
                        const eventPath = acebase_core_1.PathInfo.fillVariables(subscriptionPath, path);
                        pathSubs.forEach(sub => {
                            let dataPath = null;
                            if (sub.type === 'value' || sub.type === 'notify_value') {
                                dataPath = eventPath;
                            }
                            else if (['child_changed', 'notify_child_changed'].includes(sub.type)) {
                                const childKey = path === eventPath || pathInfo.isAncestorOf(eventPath)
                                    ? '*'
                                    : acebase_core_1.PathInfo.getPathKeys(path.slice(eventPath.length).replace(/^\//, ''))[0];
                                dataPath = acebase_core_1.PathInfo.getChildPath(eventPath, childKey);
                            }
                            else if (['mutated', 'mutations', 'notify_mutated', 'notify_mutations'].includes(sub.type)) {
                                dataPath = path;
                            }
                            else if (['child_added', 'child_removed', 'notify_child_added', 'notify_child_removed'].includes(sub.type)
                                && (pathInfo.isChildOf(eventPath)
                                    || path === eventPath
                                    || pathInfo.isAncestorOf(eventPath))) {
                                const childKey = path === eventPath || pathInfo.isAncestorOf(eventPath)
                                    ? '*'
                                    : acebase_core_1.PathInfo.getPathKeys(path.slice(eventPath.length).replace(/^\//, ''))[0];
                                dataPath = acebase_core_1.PathInfo.getChildPath(eventPath, childKey); //NodePath(subscriptionPath).childPath(childKey);
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
             * @param event Event type: "value", "child_added", "child_changed", "child_removed"
             * @param path Path to the node the subscription is on
             * @param dataPath path to the node the value is stored
             * @param oldValue old value
             * @param newValue new value
             * @param context context used by the client that updated this data
             */
            trigger: (event, path, dataPath, oldValue, newValue, context) => {
                //console.warn(`Event "${event}" triggered on node "/${path}" with data of "/${dataPath}": `, newValue);
                const pathSubscriptions = this._eventSubscriptions[path] || [];
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
            },
        };
        this.debug = new acebase_core_1.DebugLogger(env.logLevel, `[${name}${typeof settings.type === 'string' && settings.type !== 'data' ? `:${settings.type}` : ''}]`); // `├ ${name} ┤` // `[🧱${name}]`
        // Setup IPC to allow vertical scaling (multiple threads sharing locks and data)
        const ipcName = name + (typeof settings.type === 'string' ? `_${settings.type}` : '');
        if (settings.ipc === 'socket' || settings.ipc instanceof ipc_1.NetIPCServer) {
            const ipcSettings = { ipcName, server: settings.ipc instanceof ipc_1.NetIPCServer ? settings.ipc : null };
            this.ipc = new ipc_1.IPCSocketPeer(this, ipcSettings);
        }
        else if (settings.ipc) {
            if (typeof settings.ipc.port !== 'number') {
                throw new Error('IPC port number must be a number');
            }
            if (!['master', 'worker'].includes(settings.ipc.role)) {
                throw new Error(`IPC client role must be either "master" or "worker", not "${settings.ipc.role}"`);
            }
            const ipcSettings = Object.assign({ dbname: ipcName }, settings.ipc);
            this.ipc = new ipc_1.RemoteIPCPeer(this, ipcSettings);
        }
        else {
            this.ipc = new ipc_1.IPCPeer(this, ipcName);
        }
        this.ipc.once('exit', (code) => {
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
            },
        };
        // this.transactionManager = new IPCTransactionManager(this.ipc);
        this._lastTid = 0;
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
     * @param value
     */
    valueFitsInline(value) {
        if (typeof value === 'number' || typeof value === 'boolean' || value instanceof Date) {
            return true;
        }
        else if (typeof value === 'string') {
            if (value.length > this.settings.maxInlineValueSize) {
                return false;
            }
            // if the string has unicode chars, its byte size will be bigger than value.length
            const encoded = encodeString(value);
            return encoded.length < this.settings.maxInlineValueSize;
        }
        else if (value instanceof acebase_core_1.PathReference) {
            if (value.path.length > this.settings.maxInlineValueSize) {
                return false;
            }
            // if the path has unicode chars, its byte size will be bigger than value.path.length
            const encoded = encodeString(value.path);
            return encoded.length < this.settings.maxInlineValueSize;
        }
        else if (value instanceof ArrayBuffer) {
            return value.byteLength < this.settings.maxInlineValueSize;
        }
        else if (value instanceof Array) {
            return value.length === 0;
        }
        else if (typeof value === 'object') {
            return Object.keys(value).length === 0;
        }
        else {
            throw new TypeError('What else is there?');
        }
    }
    /**
     * Creates or updates a node in its own record. DOES NOT CHECK if path exists in parent node, or if parent paths exist! Calling code needs to do this
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _writeNode(path, value, options) {
        throw new Error('This method must be implemented by subclass');
    }
    getUpdateImpact(path, suppressEvents) {
        let topEventPath = path;
        let hasValueSubscribers = false;
        // Get all subscriptions that should execute on the data (includes events on child nodes as well)
        const eventSubscriptions = suppressEvents ? [] : this.subscriptions.getAllSubscribersForPath(path);
        // Get all subscriptions for data on this or ancestor nodes, determines what data to load before processing
        const valueSubscribers = suppressEvents ? [] : this.subscriptions.getValueSubscribersForPath(path);
        if (valueSubscribers.length > 0) {
            hasValueSubscribers = true;
            const eventPaths = valueSubscribers
                .map(sub => { return { path: sub.dataPath, keys: acebase_core_1.PathInfo.getPathKeys(sub.dataPath) }; })
                .sort((a, b) => {
                if (a.keys.length < b.keys.length) {
                    return -1;
                }
                else if (a.keys.length > b.keys.length) {
                    return 1;
                }
                return 0;
            });
            const first = eventPaths[0];
            topEventPath = first.path;
            if (valueSubscribers.filter(sub => sub.dataPath === topEventPath).every(sub => sub.type === 'mutated' || sub.type.startsWith('notify_'))) {
                // Prevent loading of all data on path, so it'll only load changing properties
                hasValueSubscribers = false;
            }
            topEventPath = acebase_core_1.PathInfo.fillVariables(topEventPath, path); // fill in any wildcards in the subscription path
        }
        const indexes = this.indexes.getAll(path, { childPaths: true, parentPaths: true })
            .map(index => ({ index, keys: acebase_core_1.PathInfo.getPathKeys(index.path) }))
            .sort((a, b) => {
            if (a.keys.length < b.keys.length) {
                return -1;
            }
            else if (a.keys.length > b.keys.length) {
                return 1;
            }
            return 0;
        })
            .map(obj => obj.index);
        const keysFilter = [];
        if (indexes.length > 0) {
            indexes.sort((a, b) => {
                if (typeof a._pathKeys === 'undefined') {
                    a._pathKeys = acebase_core_1.PathInfo.getPathKeys(a.path);
                }
                if (typeof b._pathKeys === 'undefined') {
                    b._pathKeys = acebase_core_1.PathInfo.getPathKeys(b.path);
                }
                if (a._pathKeys.length < b._pathKeys.length) {
                    return -1;
                }
                else if (a._pathKeys.length > b._pathKeys.length) {
                    return 1;
                }
                return 0;
            });
            const topIndex = indexes[0];
            const topIndexPath = topIndex.path === path ? path : acebase_core_1.PathInfo.fillVariables(`${topIndex.path}/*`, path);
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
                    const keys = [index.key].concat(index.includeKeys);
                    keys.forEach(key => !keysFilter.includes(key) && keysFilter.push(key));
                });
            }
        }
        return { topEventPath, eventSubscriptions, valueSubscribers, hasValueSubscribers, indexes, keysFilter };
    }
    /**
     * Wrapper for _writeNode, handles triggering change events, index updating.
     * @returns Returns a promise that resolves with an object that contains storage specific details,
     * plus the applied mutations if transaction logging is enabled
     */
    async _writeNodeWithTracking(path, value, options = {
        merge: false,
        waitForIndexUpdates: true,
        suppress_events: false,
        context: null,
        impact: null,
    }) {
        options = options || {};
        if (!options.tid && !options.transaction) {
            throw new Error('_writeNodeWithTracking MUST be executed with a tid OR transaction!');
        }
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
        const updateImpact = options.impact ? options.impact : this.getUpdateImpact(path, options.suppress_events);
        const { topEventPath, eventSubscriptions, hasValueSubscribers, indexes } = updateImpact;
        let { keysFilter } = updateImpact;
        const writeNode = () => {
            if (typeof options._customWriteFunction === 'function') {
                return options._customWriteFunction();
            }
            if (topEventData) {
                // Pass loaded data to _writeNode, speeds up recursive calls
                // This prevents reloading and/or overwriting of unchanged child nodes
                const pathKeys = acebase_core_1.PathInfo.getPathKeys(path);
                const eventPathKeys = acebase_core_1.PathInfo.getPathKeys(topEventPath);
                const trailKeys = pathKeys.slice(eventPathKeys.length);
                let currentValue = topEventData;
                while (trailKeys.length > 0 && currentValue !== null) {
                    const childKey = trailKeys.shift();
                    currentValue = typeof currentValue === 'object' && childKey in currentValue ? currentValue[childKey] : null;
                }
                options.currentValue = currentValue;
            }
            return this._writeNode(path, value, options);
        };
        const transactionLoggingEnabled = this.settings.transactions && this.settings.transactions.log === true;
        if (eventSubscriptions.length === 0 && indexes.length === 0 && !transactionLoggingEnabled) {
            // Nobody's interested in value changes. Write node without tracking
            return writeNode();
        }
        if (!hasValueSubscribers && options.merge === true && keysFilter.length === 0) {
            // only load properties being updated
            keysFilter = Object.keys(value);
            if (topEventPath !== path) {
                const trailPath = path.slice(topEventPath.length);
                keysFilter = keysFilter.map(key => `${trailPath}/${key}`);
            }
        }
        const eventNodeInfo = await this.getNodeInfo(topEventPath, { transaction, tid });
        let currentValue = null;
        if (eventNodeInfo.exists) {
            const valueOptions = { transaction, tid };
            if (keysFilter.length > 0) {
                valueOptions.include = keysFilter;
            }
            if (topEventPath === '' && typeof valueOptions.include === 'undefined') {
                this.debug.warn('WARNING: One or more value event listeners on the root node are causing the entire database value to be read to facilitate change tracking. Using "value", "notify_value", "child_changed" and "notify_child_changed" events on the root node are a bad practice because of the significant performance impact. Use "mutated" or "mutations" events instead');
            }
            const node = await this.getNode(topEventPath, valueOptions);
            currentValue = node.value;
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
            const trailKeys = acebase_core_1.PathInfo.getPathKeys(trailPath);
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
                const childKey = trailKeys.shift();
                // Create shallow copy of object at target
                if (!options.merge && trailKeys.length === 0) {
                    modifiedData[childKey] = value;
                }
                else {
                    const original = modifiedData[childKey];
                    const shallowCopy = typeof childKey === 'number' ? [...original] : Object.assign({}, original);
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
        // assert(topEventData !== newTopEventData, 'shallow copy must have been made!');
        const dataChanges = compareValues(topEventData, newTopEventData);
        if (dataChanges === 'identical') {
            result.mutations = [];
            return result;
        }
        // Fix: remove null property values (https://github.com/appy-one/acebase/issues/2)
        function removeNulls(obj) {
            if (obj === null || typeof obj !== 'object') {
                return obj;
            } // Nothing to do
            Object.keys(obj).forEach(prop => {
                const val = obj[prop];
                if (val === null) {
                    delete obj[prop];
                    if (obj instanceof Array) {
                        obj.length--;
                    } // Array items can only be removed from the end,
                }
                if (typeof val === 'object') {
                    removeNulls(val);
                }
            });
        }
        removeNulls(newTopEventData);
        // Trigger all index updates
        // TODO: Let indexes subscribe to "mutations" event, saves a lot of work because we are preparing
        // before/after copies of the relevant data here, and then the indexes go check what data changed...
        const indexUpdates = [];
        indexes.map(index => ({ index, keys: acebase_core_1.PathInfo.getPathKeys(index.path) }))
            .sort((a, b) => {
            // Deepest paths should fire first, then bubble up the tree
            if (a.keys.length < b.keys.length) {
                return 1;
            }
            else if (a.keys.length > b.keys.length) {
                return -1;
            }
            return 0;
        })
            .forEach(({ index }) => {
            // Index is either on the top event path, or on a child path
            // Example situation:
            // path = "users/ewout/posts/1" (a post was added)
            // topEventPath = "users/ewout" (a "child_changed" event was on "users")
            // index.path is "users/*/posts"
            // index must be called with data of "users/ewout/posts/1"
            const pathKeys = acebase_core_1.PathInfo.getPathKeys(topEventPath);
            const indexPathKeys = acebase_core_1.PathInfo.getPathKeys(index.path + '/*');
            const trailKeys = indexPathKeys.slice(pathKeys.length);
            // let { oldValue, newValue } = updatedData;
            const oldValue = topEventData;
            const newValue = newTopEventData;
            if (trailKeys.length === 0) {
                (0, assert_1.assert)(pathKeys.length === indexPathKeys.length, 'check logic');
                // Index is on updated path
                const p = this.ipc.isMaster
                    ? index.handleRecordUpdate(topEventPath, oldValue, newValue)
                    : this.ipc.sendRequest({ type: 'index.update', fileName: index.fileName, path: topEventPath, oldValue, newValue });
                indexUpdates.push(p);
                return; // next index
            }
            const getAllIndexUpdates = (path, oldValue, newValue) => {
                if (oldValue === null && newValue === null) {
                    return [];
                }
                const pathKeys = acebase_core_1.PathInfo.getPathKeys(path);
                const indexPathKeys = acebase_core_1.PathInfo.getPathKeys(index.path + '/*');
                const trailKeys = indexPathKeys.slice(pathKeys.length);
                if (trailKeys.length === 0) {
                    (0, assert_1.assert)(pathKeys.length === indexPathKeys.length, 'check logic');
                    return [{ path, oldValue, newValue }];
                }
                let results = [];
                let trailPath = '';
                while (trailKeys.length > 0) {
                    const subKey = trailKeys.shift();
                    if (typeof subKey === 'string' && (subKey === '*' || subKey.startsWith('$'))) {
                        // Recursion needed
                        const allKeys = oldValue === null ? [] : Object.keys(oldValue);
                        newValue !== null && Object.keys(newValue).forEach(key => {
                            if (allKeys.indexOf(key) < 0) {
                                allKeys.push(key);
                            }
                        });
                        allKeys.forEach(key => {
                            const childPath = acebase_core_1.PathInfo.getChildPath(trailPath, key);
                            const childValues = getChildValues(key, oldValue, newValue);
                            const subTrailPath = acebase_core_1.PathInfo.getChildPath(path, childPath);
                            const childResults = getAllIndexUpdates(subTrailPath, childValues.oldValue, childValues.newValue);
                            results = results.concat(childResults);
                        });
                        break;
                    }
                    else {
                        const values = getChildValues(subKey, oldValue, newValue);
                        oldValue = values.oldValue;
                        newValue = values.newValue;
                        if (oldValue === null && newValue === null) {
                            break;
                        }
                        trailPath = acebase_core_1.PathInfo.getChildPath(trailPath, subKey);
                    }
                }
                return results;
            };
            const results = getAllIndexUpdates(topEventPath, oldValue, newValue);
            results.forEach(result => {
                const p = this.ipc.isMaster
                    ? index.handleRecordUpdate(result.path, result.oldValue, result.newValue)
                    : this.ipc.sendRequest({ type: 'index.update', fileName: index.fileName, path: result.path, oldValue: result.oldValue, newValue: result.newValue });
                indexUpdates.push(p);
            });
        });
        const callSubscriberWithValues = (sub, oldValue, newValue, variables = []) => {
            let trigger = true;
            let type = sub.type;
            if (type.startsWith('notify_')) {
                type = type.slice('notify_'.length);
            }
            if (type === 'mutated') {
                return; // Ignore here, requires different logic
            }
            else if (type === 'child_changed' && (oldValue === null || newValue === null)) {
                trigger = false;
            }
            else if (type === 'value' || type === 'child_changed') {
                const changes = compareValues(oldValue, newValue);
                trigger = changes !== 'identical';
            }
            else if (type === 'child_added') {
                trigger = oldValue === null && newValue !== null;
            }
            else if (type === 'child_removed') {
                trigger = oldValue !== null && newValue === null;
            }
            if (!trigger) {
                return;
            }
            const pathKeys = acebase_core_1.PathInfo.getPathKeys(sub.dataPath);
            variables.forEach(variable => {
                // only replaces first occurrence (so multiple *'s will be processed 1 by 1)
                const index = pathKeys.indexOf(variable.name);
                (0, assert_1.assert)(index >= 0, `Variable "${variable.name}" not found in subscription dataPath "${sub.dataPath}"`);
                pathKeys[index] = variable.value;
            });
            const dataPath = pathKeys.reduce((path, key) => acebase_core_1.PathInfo.getChildPath(path, key), '');
            this.subscriptions.trigger(sub.type, sub.subscriptionPath, dataPath, oldValue, newValue, options.context);
        };
        const prepareMutationEvents = (currentPath, oldValue, newValue, compareResult) => {
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
                    const childPath = acebase_core_1.PathInfo.getChildPath(currentPath, info.key);
                    const childValues = getChildValues(info.key, oldValue, newValue);
                    const childBatch = prepareMutationEvents(childPath, childValues.oldValue, childValues.newValue, info.change);
                    batch.push(...childBatch);
                });
                result.added.forEach(key => {
                    const childPath = acebase_core_1.PathInfo.getChildPath(currentPath, key);
                    batch.push({ path: childPath, oldValue: null, newValue: newValue[key] });
                });
                if (oldValue instanceof Array && newValue instanceof Array) {
                    result.removed.sort((a, b) => a < b ? 1 : -1);
                }
                result.removed.forEach(key => {
                    const childPath = acebase_core_1.PathInfo.getChildPath(currentPath, key);
                    batch.push({ path: childPath, oldValue: oldValue[key], newValue: null });
                });
            }
            return batch;
        };
        // Add mutations to result (only if transaction logging is enabled)
        if (transactionLoggingEnabled && this.settings.type !== 'transaction') {
            result.mutations = (() => {
                const trailPath = path.slice(topEventPath.length).replace(/^\//, '');
                const trailKeys = acebase_core_1.PathInfo.getPathKeys(trailPath);
                let oldValue = topEventData, newValue = newTopEventData;
                while (trailKeys.length > 0) {
                    const key = trailKeys.shift();
                    ({ oldValue, newValue } = getChildValues(key, oldValue, newValue));
                }
                const compareResults = compareValues(oldValue, newValue);
                const batch = prepareMutationEvents(path, oldValue, newValue, compareResults);
                const mutations = batch.map(m => ({ target: acebase_core_1.PathInfo.getPathKeys(m.path.slice(path.length)), prev: m.oldValue, val: m.newValue })); // key: PathInfo.get(m.path).key
                return mutations;
            })();
        }
        const triggerAllEvents = () => {
            // Notify all event subscriptions, should be executed with a delay
            // this.debug.verbose(`Triggering events caused by ${options && options.merge ? '(merge) ' : ''}write on "${path}":`, value);
            eventSubscriptions
                .filter(sub => !['mutated', 'mutations', 'notify_mutated', 'notify_mutations'].includes(sub.type))
                .map(sub => {
                const keys = acebase_core_1.PathInfo.getPathKeys(sub.dataPath);
                return {
                    sub,
                    keys,
                };
            })
                .sort((a, b) => {
                // Deepest paths should fire first, then bubble up the tree
                if (a.keys.length < b.keys.length) {
                    return 1;
                }
                else if (a.keys.length > b.keys.length) {
                    return -1;
                }
                return 0;
            })
                .forEach(({ sub }) => {
                const process = (currentPath, oldValue, newValue, variables = []) => {
                    const trailPath = sub.dataPath.slice(currentPath.length).replace(/^\//, '');
                    const trailKeys = acebase_core_1.PathInfo.getPathKeys(trailPath);
                    while (trailKeys.length > 0) {
                        const subKey = trailKeys.shift();
                        if (typeof subKey === 'string' && (subKey === '*' || subKey[0] === '$')) {
                            // Fire on all relevant child keys
                            const allKeys = oldValue === null ? [] : Object.keys(oldValue).map(key => oldValue instanceof Array ? parseInt(key) : key);
                            newValue !== null && Object.keys(newValue).forEach(key => {
                                const keyOrIndex = newValue instanceof Array ? parseInt(key) : key;
                                !allKeys.includes(keyOrIndex) && allKeys.push(key);
                            });
                            allKeys.forEach(key => {
                                const childValues = getChildValues(key, oldValue, newValue);
                                const vars = variables.concat({ name: subKey, value: key });
                                if (trailKeys.length === 0) {
                                    callSubscriberWithValues(sub, childValues.oldValue, childValues.newValue, vars);
                                }
                                else {
                                    process(acebase_core_1.PathInfo.getChildPath(currentPath, subKey), childValues.oldValue, childValues.newValue, vars);
                                }
                            });
                            return; // We can stop processing
                        }
                        else {
                            currentPath = acebase_core_1.PathInfo.getChildPath(currentPath, subKey);
                            const childValues = getChildValues(subKey, oldValue, newValue);
                            oldValue = childValues.oldValue;
                            newValue = childValues.newValue;
                        }
                    }
                    callSubscriberWithValues(sub, oldValue, newValue, variables);
                };
                if (sub.type.startsWith('notify_') && acebase_core_1.PathInfo.get(sub.eventPath).isAncestorOf(topEventPath)) {
                    // Notify event on a higher path than we have loaded data on
                    // We can trigger the notify event on the subscribed path
                    // Eg:
                    // path === 'users/ewout', updates === { name: 'Ewout Stortenbeker' }
                    // sub.path === 'users' or '', sub.type === 'notify_child_changed'
                    // => OK to trigger if dataChanges !== 'removed' and 'added'
                    const isOnParentPath = acebase_core_1.PathInfo.get(sub.eventPath).isParentOf(topEventPath);
                    const trigger = (sub.type === 'notify_value')
                        || (sub.type === 'notify_child_changed' && (!isOnParentPath || !['added', 'removed'].includes(dataChanges)))
                        || (sub.type === 'notify_child_removed' && dataChanges === 'removed' && isOnParentPath)
                        || (sub.type === 'notify_child_added' && dataChanges === 'added' && isOnParentPath);
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
            const mutationEvents = eventSubscriptions.filter(sub => ['mutated', 'mutations', 'notify_mutated', 'notify_mutations'].includes(sub.type));
            mutationEvents.forEach(sub => {
                // Get the target data this subscription is interested in
                let currentPath = topEventPath;
                // const trailPath = sub.eventPath.slice(currentPath.length).replace(/^\//, ''); // eventPath can contain vars and * ?
                const trailKeys = acebase_core_1.PathInfo.getPathKeys(sub.eventPath).slice(acebase_core_1.PathInfo.getPathKeys(currentPath).length); //PathInfo.getPathKeys(trailPath);
                const events = [];
                let oldValue = topEventData, newValue = newTopEventData;
                const processNextTrailKey = (target, currentTarget, oldValue, newValue, vars) => {
                    if (target.length === 0) {
                        // Add it
                        return events.push({ target: currentTarget, oldValue, newValue, vars });
                    }
                    const subKey = target[0];
                    const keys = new Set();
                    const isWildcardKey = typeof subKey === 'string' && (subKey === '*' || subKey.startsWith('$'));
                    if (isWildcardKey) {
                        // Recursive for each key in oldValue and newValue
                        if (oldValue !== null && typeof oldValue === 'object') {
                            Object.keys(oldValue).forEach(key => keys.add(key));
                        }
                        if (newValue !== null && typeof newValue === 'object') {
                            Object.keys(newValue).forEach(key => keys.add(key));
                        }
                    }
                    else {
                        keys.add(subKey); // just one specific key
                    }
                    for (const key of keys) {
                        const childValues = getChildValues(key, oldValue, newValue);
                        oldValue = childValues.oldValue;
                        newValue = childValues.newValue;
                        processNextTrailKey(target.slice(1), currentTarget.concat(key), oldValue, newValue, isWildcardKey ? vars.concat({ name: subKey, value: key }) : vars);
                    }
                };
                processNextTrailKey(trailKeys, [], oldValue, newValue, []);
                for (const event of events) {
                    const targetPath = acebase_core_1.PathInfo.get(currentPath).child(event.target).path;
                    const batch = prepareMutationEvents(targetPath, event.oldValue, event.newValue);
                    if (batch.length === 0) {
                        continue;
                    }
                    const isNotifyEvent = sub.type.startsWith('notify_');
                    if (['mutated', 'notify_mutated'].includes(sub.type)) {
                        // Send all mutations 1 by 1
                        batch.forEach((mutation, index) => {
                            const context = options.context; // const context = cloneObject(options.context);
                            // context.acebase_mutated_event = { nr: index + 1, total: batch.length }; // Add context info about number of mutations
                            const prevVal = isNotifyEvent ? null : mutation.oldValue;
                            const newVal = isNotifyEvent ? null : mutation.newValue;
                            this.subscriptions.trigger(sub.type, sub.subscriptionPath, mutation.path, prevVal, newVal, context);
                        });
                    }
                    else if (['mutations', 'notify_mutations'].includes(sub.type)) {
                        // Send 1 batch with all mutations
                        // const oldValues = isNotifyEvent ? null : batch.map(m => ({ target: PathInfo.getPathKeys(mutation.path.slice(sub.subscriptionPath.length)), val: m.oldValue })); // batch.reduce((obj, mutation) => (obj[mutation.path.slice(sub.subscriptionPath.length).replace(/^\//, '') || '.'] = mutation.oldValue, obj), {});
                        // const newValues = isNotifyEvent ? null : batch.map(m => ({ target: PathInfo.getPathKeys(mutation.path.slice(sub.subscriptionPath.length)), val: m.newValue })) //batch.reduce((obj, mutation) => (obj[mutation.path.slice(sub.subscriptionPath.length).replace(/^\//, '') || '.'] = mutation.newValue, obj), {});
                        const subscriptionPathKeys = acebase_core_1.PathInfo.getPathKeys(sub.subscriptionPath);
                        const values = isNotifyEvent ? null : batch.map(m => ({ target: acebase_core_1.PathInfo.getPathKeys(m.path).slice(subscriptionPathKeys.length), prev: m.oldValue, val: m.newValue }));
                        const dataPath = acebase_core_1.PathInfo.get(acebase_core_1.PathInfo.getPathKeys(targetPath).slice(0, subscriptionPathKeys.length)).path;
                        this.subscriptions.trigger(sub.type, sub.subscriptionPath, dataPath, null, values, options.context);
                    }
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
     * @param path
     * @param options optional options used by implementation for recursive calls
     * @returns returns a generator object that calls .next for each child until the .next callback returns false
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    getChildren(path, options) {
        throw new Error('This method must be implemented by subclass');
    }
    /**
     * @deprecated Use `getNode` instead
     * Gets a node's value by delegating to getNode, returning only the value
     * @param path
     * @param options optional options that can limit the amount of (sub)data being loaded, and any other implementation specific options for recusrsive calls
     */
    async getNodeValue(path, options = {}) {
        const node = await this.getNode(path, options);
        return node.value;
    }
    /**
     * Gets a node's value and (if supported) revision
     * @param path
     * @param options optional options that can limit the amount of (sub)data being loaded, and any other implementation specific options for recusrsive calls
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    getNode(path, options) {
        throw new Error('This method must be implemented by subclass');
    }
    /**
     * Retrieves info about a node (existence, wherabouts etc)
     * @param {string} path
     * @param {object} [options] optional options used by implementation for recursive calls
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    getNodeInfo(path, options) {
        throw new Error('This method must be implemented by subclass');
    }
    /**
     * Creates or overwrites a node. Delegates to updateNode on a parent if
     * path is not the root.
     * @param path
     * @param value
     * @param options optional options used by implementation for recursive calls
     * @returns Returns a new cursor if transaction logging is enabled
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    setNode(path, value, options) {
        throw new Error('This method must be implemented by subclass');
    }
    /**
     * Updates a node by merging an existing node with passed updates object,
     * or creates it by delegating to updateNode on the parent path.
     * @param path
     * @param updates object with key/value pairs
     * @returns Returns a new cursor if transaction logging is enabled
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    updateNode(path, updates, options) {
        throw new Error('This method must be implemented by subclass');
    }
    /**
     * Updates a node by getting its value, running a callback function that transforms
     * the current value and returns the new value to be stored. Assures the read value
     * does not change while the callback runs, or runs the callback again if it did.
     * @param path
     * @param callback function that transforms current value and returns the new value to be stored. Can return a Promise
     * @param options optional options used by implementation for recursive calls
     * @returns Returns a new cursor if transaction logging is enabled
     */
    async transactNode(path, callback, options = { no_lock: false, suppress_events: false, context: null }) {
        const useFakeLock = options && options.no_lock === true;
        const tid = this.createTid();
        const lock = useFakeLock
            ? { tid, release: NOOP } // Fake lock, we'll use revision checking & retrying instead
            : await this.nodeLocker.lock(path, tid, true, 'transactNode');
        try {
            let changed = false;
            const changeCallback = () => { changed = true; };
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
                this.subscriptions.remove(path, 'notify_value', changeCallback);
            }
            if (changed) {
                throw new node_errors_1.NodeRevisionError('Node changed');
            }
            const cursor = await this.setNode(path, newValue, { assert_revision: checkRevision, tid: lock.tid, suppress_events: options.suppress_events, context: options.context });
            return cursor;
        }
        catch (err) {
            if (err instanceof node_errors_1.NodeRevisionError) {
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
     * @param path
     * @param criteria criteria to test
     * @param options optional options used by implementation for recursive calls
     * @returns returns a promise that resolves with a boolean indicating if it matched the criteria
     */
    async matchNode(path, criteria, options) {
        var _a;
        const tid = (_a = options === null || options === void 0 ? void 0 : options.tid) !== null && _a !== void 0 ? _a : acebase_core_1.ID.generate();
        const checkNode = async (path, criteria) => {
            if (criteria.length === 0) {
                return Promise.resolve(true); // No criteria, so yes... It matches!
            }
            const criteriaKeys = criteria.reduce((keys, cr) => {
                let key = cr.key;
                if (typeof key === 'string' && key.includes('/')) {
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
            const delayedMatchPromises = [];
            try {
                await this.getChildren(path, { tid, keyFilter: criteriaKeys }).next(childInfo => {
                    var _a;
                    const keyOrIndex = (_a = childInfo.key) !== null && _a !== void 0 ? _a : childInfo.index;
                    unseenKeys.includes(keyOrIndex) && unseenKeys.splice(unseenKeys.indexOf(childInfo.key), 1);
                    const keyCriteria = criteria
                        .filter(cr => cr.key === keyOrIndex)
                        .map(cr => ({ op: cr.op, compare: cr.compare }));
                    const keyResult = keyCriteria.length > 0 ? checkChild(childInfo, keyCriteria) : { isMatch: true, promises: [] };
                    isMatch = keyResult.isMatch;
                    if (isMatch) {
                        delayedMatchPromises.push(...keyResult.promises);
                        const childCriteria = criteria
                            .filter(cr => typeof cr.key === 'string' && cr.key.startsWith(`${typeof keyOrIndex === 'number' ? `[${keyOrIndex}]` : keyOrIndex}/`))
                            .map(cr => {
                            const key = cr.key.slice(cr.key.indexOf('/') + 1);
                            return { key, op: cr.op, compare: cr.compare };
                        });
                        if (childCriteria.length > 0) {
                            const childPath = acebase_core_1.PathInfo.getChildPath(path, childInfo.key);
                            const childPromise = checkNode(childPath, childCriteria)
                                .then(isMatch => ({ isMatch }));
                            delayedMatchPromises.push(childPromise);
                        }
                    }
                    if (!isMatch || unseenKeys.length === 0) {
                        return false; // Stop iterating
                    }
                });
                if (isMatch) {
                    const results = await Promise.all(delayedMatchPromises);
                    isMatch = results.every(res => res.isMatch);
                }
                if (!isMatch) {
                    return false;
                }
                // Now, also check keys that weren't found in the node. (a criterium may be "!exists")
                isMatch = unseenKeys.every(keyOrIndex => {
                    const childInfo = new node_info_1.NodeInfo(Object.assign(Object.assign(Object.assign({}, (typeof keyOrIndex === 'number' && { index: keyOrIndex })), (typeof keyOrIndex === 'string' && { key: keyOrIndex })), { exists: false }));
                    const childCriteria = criteria
                        .filter(cr => typeof cr.key === 'string' && cr.key.startsWith(`${typeof keyOrIndex === 'number' ? `[${keyOrIndex}]` : keyOrIndex}/`))
                        .map(cr => ({ op: cr.op, compare: cr.compare }));
                    if (childCriteria.length > 0 && !checkChild(childInfo, childCriteria).isMatch) {
                        return false;
                    }
                    const keyCriteria = criteria
                        .filter(cr => cr.key === keyOrIndex)
                        .map(cr => ({ op: cr.op, compare: cr.compare }));
                    if (keyCriteria.length === 0) {
                        return true; // There were only child criteria, and they matched (otherwise we wouldn't be here)
                    }
                    const result = checkChild(childInfo, keyCriteria);
                    return result.isMatch;
                });
                return isMatch;
            }
            catch (err) {
                this.debug.error(`Error matching on "${path}": `, err);
                throw err;
            }
        }; // checkNode
        /**
         *
         * @param child
         * @param criteria criteria to test
         */
        const checkChild = (child, criteria) => {
            const promises = [];
            const isMatch = criteria.every(f => {
                let proceed = true;
                if (f.op === '!exists' || (f.op === '==' && (typeof f.compare === 'undefined' || f.compare === null))) {
                    proceed = !child.exists;
                }
                else if (f.op === 'exists' || (f.op === '!=' && (typeof f.compare === 'undefined' || f.compare === null))) {
                    proceed = child.exists;
                }
                else if ((f.op === 'contains' || f.op === '!contains') && f.compare instanceof Array && f.compare.length === 0) {
                    // Added for #135: empty compare array for contains/!contains must match all values
                    proceed = true;
                }
                else if (!child.exists) {
                    proceed = false;
                }
                else {
                    if (child.address) {
                        if (child.valueType === node_value_types_1.VALUE_TYPES.OBJECT && ['has', '!has'].indexOf(f.op) >= 0) {
                            const op = f.op === 'has' ? 'exists' : '!exists';
                            const p = checkNode(child.path, [{ key: f.compare, op }])
                                .then(isMatch => {
                                return { key: child.key, isMatch };
                            });
                            promises.push(p);
                            proceed = true;
                        }
                        else if (child.valueType === node_value_types_1.VALUE_TYPES.ARRAY && ['contains', '!contains'].indexOf(f.op) >= 0) {
                            // TODO: refactor to use child stream
                            const p = this.getNode(child.path, { tid })
                                .then(({ value: arr }) => {
                                // const i = arr.indexOf(f.compare);
                                // return { key: child.key, isMatch: (i >= 0 && f.op === "contains") || (i < 0 && f.op === "!contains") };
                                const isMatch = f.op === 'contains'
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
                        else if (child.valueType === node_value_types_1.VALUE_TYPES.STRING) {
                            const p = this.getNode(child.path, { tid })
                                .then(node => {
                                return { key: child.key, isMatch: this.test(node.value, f.op, f.compare) };
                            });
                            promises.push(p);
                            proceed = true;
                        }
                        else {
                            proceed = false;
                        }
                    }
                    else if (child.type === node_value_types_1.VALUE_TYPES.OBJECT && ['has', '!has'].indexOf(f.op) >= 0) {
                        const has = f.compare in child.value;
                        proceed = (has && f.op === 'has') || (!has && f.op === '!has');
                    }
                    else if (child.type === node_value_types_1.VALUE_TYPES.ARRAY && ['contains', '!contains'].indexOf(f.op) >= 0) {
                        const contains = child.value.indexOf(f.compare) >= 0;
                        proceed = (contains && f.op === 'contains') || (!contains && f.op === '!contains');
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
        if (op === '<') {
            return val < compare;
        }
        if (op === '<=') {
            return val <= compare;
        }
        if (op === '==') {
            return val === compare;
        }
        if (op === '!=') {
            return val !== compare;
        }
        if (op === '>') {
            return val > compare;
        }
        if (op === '>=') {
            return val >= compare;
        }
        if (op === 'in') {
            return compare.indexOf(val) >= 0;
        }
        if (op === '!in') {
            return compare.indexOf(val) < 0;
        }
        if (op === 'like' || op === '!like') {
            const pattern = '^' + compare.replace(/[-[\]{}()+.,\\^$|#\s]/g, '\\$&').replace(/\?/g, '.').replace(/\*/g, '.*?') + '$';
            const re = new RegExp(pattern, 'i');
            const isMatch = re.test(val.toString());
            return op === 'like' ? isMatch : !isMatch;
        }
        if (op === 'matches') {
            return compare.test(val.toString());
        }
        if (op === '!matches') {
            return !compare.test(val.toString());
        }
        if (op === 'between') {
            return val >= compare[0] && val <= compare[1];
        }
        if (op === '!between') {
            return val < compare[0] || val > compare[1];
        }
        if (op === 'has' || op === '!has') {
            const has = typeof val === 'object' && compare in val;
            return op === 'has' ? has : !has;
        }
        if (op === 'contains' || op === '!contains') {
            // TODO: rename to "includes"?
            const includes = typeof val === 'object' && val instanceof Array && val.includes(compare);
            return op === 'contains' ? includes : !includes;
        }
        return false;
    }
    /**
     * Export a specific path's data to a stream
     * @param path
     * @param write function that writes to a stream, or stream object that has a write method that (optionally) returns a promise the export needs to wait for before continuing
     * @returns returns a promise that resolves once all data is exported
     */
    async exportNode(path, writeFn, options = { format: 'json', type_safe: true }) {
        if ((options === null || options === void 0 ? void 0 : options.format) !== 'json') {
            throw new Error('Only json output is currently supported');
        }
        const write = typeof writeFn !== 'function'
            ? writeFn.write.bind(writeFn) // Using the "old" stream argument. Use its write method for backward compatibility
            : writeFn;
        const stringifyValue = (type, val) => {
            const escape = (str) => str
                .replace(/\\/g, '\\\\') // forward slashes
                .replace(/"/g, '\\"') // quotes
                .replace(/\r/g, '\\r') // carriage return
                .replace(/\n/g, '\\n') // line feed
                .replace(/\t/g, '\\t') // tabs
                .replace(/[\u0000-\u001f]/g, // other control characters
            // other control characters
            ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
            if (type === node_value_types_1.VALUE_TYPES.DATETIME) {
                val = `"${val.toISOString()}"`;
                if (options.type_safe) {
                    val = `{".type":"date",".val":${val}}`; // Previously: "Date"
                }
            }
            else if (type === node_value_types_1.VALUE_TYPES.STRING) {
                val = `"${escape(val)}"`;
            }
            else if (type === node_value_types_1.VALUE_TYPES.ARRAY) {
                val = '[]';
            }
            else if (type === node_value_types_1.VALUE_TYPES.OBJECT) {
                val = '{}';
            }
            else if (type === node_value_types_1.VALUE_TYPES.BINARY) {
                val = `"${escape(acebase_core_1.ascii85.encode(val))}"`; // TODO: use base64 instead, no escaping needed
                if (options.type_safe) {
                    val = `{".type":"binary",".val":${val}}`; // Previously: "Buffer"
                }
            }
            else if (type === node_value_types_1.VALUE_TYPES.REFERENCE) {
                val = `"${val.path}"`;
                if (options.type_safe) {
                    val = `{".type":"reference",".val":${val}}`; // Previously: "PathReference"
                }
            }
            else if (type === node_value_types_1.VALUE_TYPES.BIGINT) {
                // Unfortnately, JSON.parse does not support 0n bigint json notation
                val = `"${val}"`;
                if (options.type_safe) {
                    val = `{".type":"bigint",".val":${val}}`;
                }
            }
            return val;
        };
        let objStart = '', objEnd = '';
        const nodeInfo = await this.getNodeInfo(path);
        if (!nodeInfo.exists) {
            return write('null');
        }
        else if (nodeInfo.type === node_value_types_1.VALUE_TYPES.OBJECT) {
            objStart = '{';
            objEnd = '}';
        }
        else if (nodeInfo.type === node_value_types_1.VALUE_TYPES.ARRAY) {
            objStart = '[';
            objEnd = ']';
        }
        else {
            // Node has no children, get and export its value
            const node = await this.getNode(path);
            const val = stringifyValue(nodeInfo.type, node.value);
            return write(val);
        }
        if (objStart) {
            const p = write(objStart);
            if (p instanceof Promise) {
                await p;
            }
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
                if (outputCount++ > 0) {
                    output += ',';
                }
                if (typeof childInfo.key === 'string') {
                    output += `"${childInfo.key}":`;
                }
                output += stringifyValue(childInfo.type, childInfo.value);
            }
        });
        if (output) {
            const p = write(output);
            if (p instanceof Promise) {
                await p;
            }
        }
        while (pending.length > 0) {
            const childInfo = pending.shift();
            let output = outputCount++ > 0 ? ',' : '';
            const key = typeof childInfo.index === 'number' ? childInfo.index : childInfo.key;
            if (typeof key === 'string') {
                output += `"${key}":`;
            }
            if (output) {
                const p = write(output);
                if (p instanceof Promise) {
                    await p;
                }
            }
            await this.exportNode(acebase_core_1.PathInfo.getChildPath(path, key), write, options);
        }
        if (objEnd) {
            const p = write(objEnd);
            if (p instanceof Promise) {
                await p;
            }
        }
    }
    /**
     * Import a specific path's data from a stream
     * @param path
     * @param read read function that streams a new chunk of data
     * @returns returns a promise that resolves once all data is imported
     */
    async importNode(path, read, options = { format: 'json', method: 'set' }) {
        const chunkSize = 256 * 1024; // 256KB
        const maxQueueBytes = 1024 * 1024; // 1MB
        const state = {
            data: '',
            index: 0,
            offset: 0,
            queue: [],
            queueStartByte: 0,
            timesFlushed: 0,
            get processedBytes() {
                return this.offset + this.index;
            },
        };
        const readNextChunk = async (append = false) => {
            let data = await read(chunkSize);
            if (data === null) {
                if (state.data) {
                    throw new Error(`Unexpected EOF at index ${state.offset + state.data.length}`);
                }
                else {
                    throw new Error('Unable to read data from stream');
                }
            }
            else if (typeof data === 'object') {
                data = acebase_core_1.Utils.decodeString(data);
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
                throw new Error('Not enough data available from stream');
            }
        };
        const consumeToken = async (token) => {
            // const str = state.data.slice(state.index, state.index + token.length);
            const str = await readBytes(token.length);
            if (str !== token) {
                throw new Error(`Unexpected character "${str[0]}" at index ${state.offset + state.index}, expected "${token}"`);
            }
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
            while (state.data[i] !== '"' || state.data[i - 1] === '\\') {
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
            const nrChars = ['-', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '.', 'e', 'b', 'f', 'x', 'o', 'n']; // b: 0b110101, x: 0x3a, o: 0o01, n: 29723n, e: 10e+23, f: ?
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
            const nr = str.endsWith('n') ? BigInt(str.slice(0, -1)) : str.includes('.') ? parseFloat(str) : parseInt(str);
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
        const unescape = (str) => str.replace(/\\n/g, '\n').replace(/\\"/g, '"');
        const getTypeSafeValue = (path, obj) => {
            const type = obj['.type'];
            let val = obj['.val'];
            switch (type) {
                case 'Date':
                case 'date': {
                    val = new Date(val);
                    break;
                }
                case 'Buffer':
                case 'binary': {
                    val = unescape(val);
                    if (val.startsWith('<~')) {
                        // Ascii85 encoded
                        val = acebase_core_1.ascii85.decode(val);
                    }
                    else {
                        // base64 not implemented yet
                        throw new Error(`Import error: Unexpected encoding for value for value at path "/${path}"`);
                    }
                    break;
                }
                case 'PathReference':
                case 'reference': {
                    val = new acebase_core_1.PathReference(val);
                    break;
                }
                case 'bigint': {
                    val = BigInt(val);
                    break;
                }
                default:
                    throw new Error(`Import error: Unsupported type "${type}" for value at path "/${path}"`);
            }
            return val;
        };
        const context = { acebase_import_id: acebase_core_1.ID.generate() };
        const childOptions = { suppress_events: options.suppress_events, context };
        /**
         * Work in progress (not used yet): queue nodes to store to improve performance
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
                        updates.push(Object.assign({ op: options.method === 'set' && state.timesFlushed === 0 ? 'set' : 'update' }, item));
                    }
                    else {
                        // Find parent to merge with
                        const parent = updates.find(other => other.target.isParentOf(item.target));
                        if (parent) {
                            parent.value[item.target.key] = item.value;
                        }
                        else {
                            // Parent not found. If method is 'merge', use 'update', otherwise use or 'set'
                            updates.push(Object.assign({ op: options.method === 'merge' ? 'update' : 'set' }, item));
                        }
                    }
                    return updates;
                }, []);
                // Fresh state
                state.queueStartByte = state.processedBytes;
                state.queue = [];
                state.timesFlushed++;
                // Execute db updates
            }
            if (target.path === path) {
                // This is the import target. If method === 'set'
            }
        };
        const importObject = async (target) => {
            await consumeToken('{');
            await consumeSpaces();
            const nextChar = await peekBytes(1);
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
                if (p) {
                    await p;
                }
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
                if (['object', 'array'].includes(type)) {
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
                const nextChar = await peekBytes(1);
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
        const importArray = async (target) => {
            await consumeToken('[');
            await consumeSpaces();
            const nextChar = await peekBytes(1);
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
                if (p) {
                    await p;
                }
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
                if (['object', 'array'].includes(type)) {
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
                const nextChar = await peekBytes(1);
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
            if (['object', 'array'].includes(type)) {
                // Object or array value, has not been read yet
                const target = acebase_core_1.PathInfo.get(path);
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
        };
        return start();
    }
    /**
     * Adds, updates or removes a schema definition to validate node values before they are stored at the specified path
     * @param path target path to enforce the schema on, can include wildcards. Eg: 'users/*\/posts/*' or 'users/$uid/posts/$postid'
     * @param schema schema type definitions. When null value is passed, a previously set schema is removed.
     */
    setSchema(path, schema, warnOnly = false) {
        if (typeof schema === 'undefined') {
            throw new TypeError('schema argument must be given');
        }
        if (schema === null) {
            // Remove previously set schema on path
            const i = this._schemas.findIndex(s => s.path === path);
            i >= 0 && this._schemas.splice(i, 1);
            return;
        }
        // Parse schema, add or update it
        const definition = new acebase_core_1.SchemaDefinition(schema, {
            warnOnly,
            warnCallback: (message) => this.debug.warn(message),
        });
        const item = this._schemas.find(s => s.path === path);
        if (item) {
            item.schema = definition;
        }
        else {
            this._schemas.push({ path, schema: definition });
            this._schemas.sort((a, b) => {
                const ka = acebase_core_1.PathInfo.getPathKeys(a.path), kb = acebase_core_1.PathInfo.getPathKeys(b.path);
                if (ka.length === kb.length) {
                    return 0;
                }
                return ka.length < kb.length ? -1 : 1;
            });
        }
    }
    /**
     * Gets currently active schema definition for the specified path
     */
    getSchema(path) {
        const item = this._schemas.find(item => item.path === path);
        return item ? { path, schema: item.schema.source, text: item.schema.text } : null;
    }
    /**
     * Gets all currently active schema definitions
     */
    getSchemas() {
        return this._schemas.map(item => ({ path: item.path, schema: item.schema.source, text: item.schema.text }));
    }
    /**
     * Validates the schemas of the node being updated and its children
     * @param path path being written to
     * @param value the new value, or updates to current value
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
        const pathInfo = acebase_core_1.PathInfo.get(path);
        this._schemas.filter(s => pathInfo.isOnTrailOf(s.path)).every(s => {
            if (pathInfo.isDescendantOf(s.path)) {
                // Given check path is a descendant of this schema definition's path
                const ancestorPath = acebase_core_1.PathInfo.fillVariables(s.path, path);
                const trailKeys = pathInfo.keys.slice(acebase_core_1.PathInfo.getPathKeys(s.path).length);
                result = s.schema.check(ancestorPath, value, options.updates, trailKeys);
                return result.ok;
            }
            // Given check path is on schema definition's path or on a higher path
            const trailKeys = acebase_core_1.PathInfo.getPathKeys(s.path).slice(pathInfo.keys.length);
            if (options.updates === true && trailKeys.length > 0 && !(trailKeys[0] in value)) {
                // Fixes #217: this update on a higher path does not affect any data at schema's target path
                return result.ok;
            }
            const partial = options.updates === true && trailKeys.length === 0;
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
                        const childPath = acebase_core_1.PathInfo.getChildPath(path, childKey);
                        const childValue = value[childKey];
                        result = check(childPath, childValue, trailKeys.slice(1));
                        return result.ok;
                    });
                    return result;
                }
                else {
                    const childPath = acebase_core_1.PathInfo.getChildPath(path, key);
                    const childValue = value[key];
                    return check(childPath, childValue, trailKeys.slice(1));
                }
            };
            result = check(path, value, trailKeys);
            return result.ok;
        });
        return result;
    }
}
exports.Storage = Storage;
//# sourceMappingURL=index.js.map