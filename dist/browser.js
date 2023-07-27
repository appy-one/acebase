(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.acebase = f()}})(function(){var define,module,exports;return (function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrowserAceBase = void 0;
const acebase_local_1 = require("./acebase-local");
const indexed_db_1 = require("./storage/custom/indexed-db");
const deprecatedConstructorError = `Using AceBase constructor in the browser to use localStorage is deprecated!
Switch to:
IndexedDB implementation (FASTER, MORE RELIABLE):
    let db = AceBase.WithIndexedDB(name, settings)
Or, new LocalStorage implementation:
    let db = AceBase.WithLocalStorage(name, settings)
Or, write your own CustomStorage adapter:
    let myCustomStorage = new CustomStorageSettings({ ... });
    let db = new AceBase(name, { storage: myCustomStorage })`;
class BrowserAceBase extends acebase_local_1.AceBase {
    /**
     * Constructor that is used in browser context
     * @param name database name
     * @param settings settings
     */
    constructor(name, settings) {
        if (typeof settings !== 'object' || typeof settings.storage !== 'object') {
            // Client is using old AceBaseBrowser signature, eg:
            // let db = new AceBase('name', { temp: false })
            //
            // Don't allow this anymore. If client wants to use localStorage,
            // they need to switch to AceBase.WithLocalStorage('name', settings).
            // If they want to use custom storage in the browser, they must
            // use the same constructor signature AceBase has:
            // let db = new AceBase('name', { storage: new CustomStorageSettings({ ... }) });
            throw new Error(deprecatedConstructorError);
        }
        super(name, settings);
        this.settings.ipcEvents = settings.multipleTabs === true;
    }
    /**
     * Creates an AceBase database instance using IndexedDB as storage engine
     * @param dbname Name of the database
     * @param settings optional settings
     */
    static WithIndexedDB(dbname, init = {}) {
        return (0, indexed_db_1.createIndexedDBInstance)(dbname, init);
    }
}
exports.BrowserAceBase = BrowserAceBase;

},{"./acebase-local":2,"./storage/custom/indexed-db":22}],2:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AceBase = exports.AceBaseLocalSettings = exports.IndexedDBStorageSettings = exports.LocalStorageSettings = void 0;
const acebase_core_1 = require("acebase-core");
const binary_1 = require("./storage/binary");
const api_local_1 = require("./api-local");
const local_storage_1 = require("./storage/custom/local-storage");
Object.defineProperty(exports, "LocalStorageSettings", { enumerable: true, get: function () { return local_storage_1.LocalStorageSettings; } });
const settings_1 = require("./storage/custom/indexed-db/settings");
Object.defineProperty(exports, "IndexedDBStorageSettings", { enumerable: true, get: function () { return settings_1.IndexedDBStorageSettings; } });
class AceBaseLocalSettings extends acebase_core_1.AceBaseBaseSettings {
    constructor(options = {}) {
        super(options);
        if (options.storage) {
            this.storage = options.storage;
            // If they were set on global settings, copy IPC and transaction settings to storage settings
            if (options.ipc) {
                this.storage.ipc = options.ipc;
            }
            if (options.transactions) {
                this.storage.transactions = options.transactions;
            }
        }
    }
}
exports.AceBaseLocalSettings = AceBaseLocalSettings;
class AceBase extends acebase_core_1.AceBaseBase {
    /**
     * @param dbname Name of the database to open or create
     */
    constructor(dbname, init = {}) {
        const settings = new AceBaseLocalSettings(init);
        super(dbname, settings);
        this.recovery = {
            /**
             * Repairs a node that cannot be loaded by removing the reference from its parent, or marking it as removed
             */
            repairNode: async (path, options) => {
                await this.ready();
                if (this.api.storage instanceof binary_1.AceBaseStorage) {
                    await this.api.storage.repairNode(path, options);
                }
                else if (!this.api.storage.repairNode) {
                    throw new Error(`repairNode is not supported with chosen storage engine`);
                }
            },
            /**
             * Repairs a node that uses a B+Tree for its keys (100+ children).
             * See https://github.com/appy-one/acebase/issues/183
             * @param path Target path to fix
             */
            repairNodeTree: async (path) => {
                await this.ready();
                const storage = this.api.storage;
                await storage.repairNodeTree(path);
            },
        };
        const apiSettings = {
            db: this,
            settings,
        };
        this.api = new api_local_1.LocalApi(dbname, apiSettings, () => {
            this.emit('ready');
        });
    }
    async close() {
        // Close the database by calling exit on the ipc channel, which will emit an 'exit' event when the database can be safely closed.
        await this.api.storage.close();
    }
    get settings() {
        const ipc = this.api.storage.ipc, debug = this.debug;
        return {
            get logLevel() { return debug.level; },
            set logLevel(level) { debug.setLevel(level); },
            get ipcEvents() { return ipc.eventsEnabled; },
            set ipcEvents(enabled) { ipc.eventsEnabled = enabled; },
        };
    }
    /**
     * Creates an AceBase database instance using LocalStorage or SessionStorage as storage engine. When running in non-browser environments, set
     * settings.provider to a custom LocalStorage provider, eg 'node-localstorage'
     * @param dbname Name of the database
     * @param settings optional settings
     */
    static WithLocalStorage(dbname, settings = {}) {
        const db = (0, local_storage_1.createLocalStorageInstance)(dbname, settings);
        return db;
    }
    /**
     * Creates an AceBase database instance using IndexedDB as storage engine. Only available in browser contexts!
     * @param dbname Name of the database
     * @param settings optional settings
     */
    static WithIndexedDB(dbname, init = {}) {
        throw new Error(`IndexedDB storage can only be used in browser contexts`);
    }
}
exports.AceBase = AceBase;

},{"./api-local":3,"./storage/binary":18,"./storage/custom/indexed-db/settings":23,"./storage/custom/local-storage":25,"acebase-core":43}],3:[function(require,module,exports){
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

},{"./node-errors":11,"./node-value-types":14,"./query":17,"./storage/binary":18,"./storage/custom":21,"./storage/mssql":30,"./storage/sqlite":31,"acebase-core":43}],4:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assert = void 0;
/**
* Replacement for console.assert, throws an error if condition is not met.
* @param condition 'truthy' condition
* @param error
*/
function assert(condition, error) {
    if (!condition) {
        throw new Error(`Assertion failed: ${error !== null && error !== void 0 ? error : 'check your code'}`);
    }
}
exports.assert = assert;

},{}],5:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AsyncTaskBatch = void 0;
class AsyncTaskBatch {
    /**
     * Creates a new batch: runs a maximum amount of async tasks simultaniously and waits until they are all resolved.
     * If all tasks succeed, returns the results in the same order tasks were added (like `Promise.all` would do), but
     * cancels any waiting tasks upon failure of one task. Note that the execution order of tasks added after the set
     * limit is unknown.
     * @param limit Max amount of async functions to execute simultaniously. Default is `1000`
     * @param options Additional options
     */
    constructor(limit = 1000, options) {
        this.limit = limit;
        this.options = options;
        this.added = 0;
        this.scheduled = [];
        this.running = 0;
        this.results = [];
        this.done = false;
    }
    async execute(task, index) {
        var _a, _b;
        try {
            this.running++;
            const result = await task();
            this.results[index] = result;
            this.running--;
            if (this.running === 0 && this.scheduled.length === 0) {
                // Finished
                this.done = true;
                (_a = this.doneCallback) === null || _a === void 0 ? void 0 : _a.call(this, this.results);
            }
            else if (this.scheduled.length > 0) {
                // Run next scheduled task
                const next = this.scheduled.shift();
                this.execute(next.task, next.index);
            }
        }
        catch (err) {
            this.done = true;
            (_b = this.errorCallback) === null || _b === void 0 ? void 0 : _b.call(this, err);
        }
    }
    add(task) {
        var _a;
        if (this.done) {
            throw new Error(`Cannot add to a batch that has already finished. Use wait option and start batch processing manually if you are adding tasks in an async loop`);
        }
        const index = this.added++;
        if (((_a = this.options) === null || _a === void 0 ? void 0 : _a.wait) !== true && this.running < this.limit) {
            this.execute(task, index);
        }
        else {
            this.scheduled.push({ task, index });
        }
    }
    /**
     * Manually starts batch processing, mus be done if the `wait` option was used
     */
    start() {
        while (this.running < this.limit) {
            const next = this.scheduled.shift();
            this.execute(next.task, next.index);
        }
    }
    async finish() {
        if (this.running === 0 && this.scheduled.length === 0) {
            return this.results;
        }
        await new Promise((resolve, reject) => {
            this.doneCallback = resolve;
            this.errorCallback = reject;
        });
        return this.results;
    }
}
exports.AsyncTaskBatch = AsyncTaskBatch;

},{}],6:[function(require,module,exports){
"use strict";
/**
   ________________________________________________________________________________

      ___          ______
     / _ \         | ___ \
    / /_\ \ ___ ___| |_/ / __ _ ___  ___
    |  _  |/ __/ _ \ ___ \/ _` / __|/ _ \
    | | | | (_|  __/ |_/ / (_| \__ \  __/
    \_| |_/\___\___\____/ \__,_|___/\___|
                        realtime database

   Copyright 2018-2022 by Ewout Stortenbeker (me@appy.one)
   Published under MIT license

   See docs at https://github.com/appy-one/acebase
   ________________________________________________________________________________

*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.SchemaValidationError = exports.StorageSettings = exports.ICustomStorageNodeMetaData = exports.ICustomStorageNode = exports.CustomStorageHelpers = exports.CustomStorageSettings = exports.CustomStorageTransaction = exports.MSSQLStorageSettings = exports.SQLiteStorageSettings = exports.AceBaseStorageSettings = exports.IndexedDBStorageSettings = exports.LocalStorageSettings = exports.AceBaseLocalSettings = exports.AceBase = exports.PartialArray = exports.proxyAccess = exports.ID = exports.ObjectCollection = exports.TypeMappings = exports.PathReference = exports.EventSubscription = exports.EventStream = exports.DataReferencesArray = exports.DataSnapshotsArray = exports.DataReference = exports.DataSnapshot = void 0;
const acebase_core_1 = require("acebase-core");
Object.defineProperty(exports, "DataReference", { enumerable: true, get: function () { return acebase_core_1.DataReference; } });
Object.defineProperty(exports, "DataSnapshot", { enumerable: true, get: function () { return acebase_core_1.DataSnapshot; } });
Object.defineProperty(exports, "EventSubscription", { enumerable: true, get: function () { return acebase_core_1.EventSubscription; } });
Object.defineProperty(exports, "PathReference", { enumerable: true, get: function () { return acebase_core_1.PathReference; } });
Object.defineProperty(exports, "TypeMappings", { enumerable: true, get: function () { return acebase_core_1.TypeMappings; } });
Object.defineProperty(exports, "ID", { enumerable: true, get: function () { return acebase_core_1.ID; } });
Object.defineProperty(exports, "proxyAccess", { enumerable: true, get: function () { return acebase_core_1.proxyAccess; } });
Object.defineProperty(exports, "DataSnapshotsArray", { enumerable: true, get: function () { return acebase_core_1.DataSnapshotsArray; } });
Object.defineProperty(exports, "ObjectCollection", { enumerable: true, get: function () { return acebase_core_1.ObjectCollection; } });
Object.defineProperty(exports, "DataReferencesArray", { enumerable: true, get: function () { return acebase_core_1.DataReferencesArray; } });
Object.defineProperty(exports, "EventStream", { enumerable: true, get: function () { return acebase_core_1.EventStream; } });
Object.defineProperty(exports, "PartialArray", { enumerable: true, get: function () { return acebase_core_1.PartialArray; } });
const acebase_local_1 = require("./acebase-local");
const acebase_browser_1 = require("./acebase-browser");
Object.defineProperty(exports, "AceBase", { enumerable: true, get: function () { return acebase_browser_1.BrowserAceBase; } });
const custom_1 = require("./storage/custom");
const acebase = {
    AceBase: acebase_browser_1.BrowserAceBase,
    AceBaseLocalSettings: acebase_local_1.AceBaseLocalSettings,
    DataReference: acebase_core_1.DataReference,
    DataSnapshot: acebase_core_1.DataSnapshot,
    EventSubscription: acebase_core_1.EventSubscription,
    PathReference: acebase_core_1.PathReference,
    TypeMappings: acebase_core_1.TypeMappings,
    CustomStorageSettings: custom_1.CustomStorageSettings,
    CustomStorageTransaction: custom_1.CustomStorageTransaction,
    CustomStorageHelpers: custom_1.CustomStorageHelpers,
    ID: acebase_core_1.ID,
    proxyAccess: acebase_core_1.proxyAccess,
    DataSnapshotsArray: acebase_core_1.DataSnapshotsArray,
};
if (typeof window !== 'undefined') {
    // Expose classes to window.acebase:
    window.acebase = acebase;
    // Expose BrowserAceBase class as window.AceBase:
    window.AceBase = acebase_browser_1.BrowserAceBase;
}
// Expose classes for module imports:
exports.default = acebase;
var acebase_local_2 = require("./acebase-local");
Object.defineProperty(exports, "AceBaseLocalSettings", { enumerable: true, get: function () { return acebase_local_2.AceBaseLocalSettings; } });
Object.defineProperty(exports, "LocalStorageSettings", { enumerable: true, get: function () { return acebase_local_2.LocalStorageSettings; } });
Object.defineProperty(exports, "IndexedDBStorageSettings", { enumerable: true, get: function () { return acebase_local_2.IndexedDBStorageSettings; } });
var binary_1 = require("./storage/binary");
Object.defineProperty(exports, "AceBaseStorageSettings", { enumerable: true, get: function () { return binary_1.AceBaseStorageSettings; } });
var sqlite_1 = require("./storage/sqlite");
Object.defineProperty(exports, "SQLiteStorageSettings", { enumerable: true, get: function () { return sqlite_1.SQLiteStorageSettings; } });
var mssql_1 = require("./storage/mssql");
Object.defineProperty(exports, "MSSQLStorageSettings", { enumerable: true, get: function () { return mssql_1.MSSQLStorageSettings; } });
var custom_2 = require("./storage/custom");
Object.defineProperty(exports, "CustomStorageTransaction", { enumerable: true, get: function () { return custom_2.CustomStorageTransaction; } });
Object.defineProperty(exports, "CustomStorageSettings", { enumerable: true, get: function () { return custom_2.CustomStorageSettings; } });
Object.defineProperty(exports, "CustomStorageHelpers", { enumerable: true, get: function () { return custom_2.CustomStorageHelpers; } });
Object.defineProperty(exports, "ICustomStorageNode", { enumerable: true, get: function () { return custom_2.ICustomStorageNode; } });
Object.defineProperty(exports, "ICustomStorageNodeMetaData", { enumerable: true, get: function () { return custom_2.ICustomStorageNodeMetaData; } });
var storage_1 = require("./storage");
Object.defineProperty(exports, "StorageSettings", { enumerable: true, get: function () { return storage_1.StorageSettings; } });
Object.defineProperty(exports, "SchemaValidationError", { enumerable: true, get: function () { return storage_1.SchemaValidationError; } });

},{"./acebase-browser":1,"./acebase-local":2,"./storage":28,"./storage/binary":18,"./storage/custom":21,"./storage/mssql":30,"./storage/sqlite":31,"acebase-core":43}],7:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArrayIndex = exports.GeoIndex = exports.FullTextIndex = exports.DataIndex = void 0;
const not_supported_1 = require("../not-supported");
/**
 * Not supported in browser context
 */
class DataIndex extends not_supported_1.NotSupported {
}
exports.DataIndex = DataIndex;
/**
 * Not supported in browser context
 */
class FullTextIndex extends not_supported_1.NotSupported {
}
exports.FullTextIndex = FullTextIndex;
/**
 * Not supported in browser context
 */
class GeoIndex extends not_supported_1.NotSupported {
}
exports.GeoIndex = GeoIndex;
/**
 * Not supported in browser context
 */
class ArrayIndex extends not_supported_1.NotSupported {
}
exports.ArrayIndex = ArrayIndex;

},{"../not-supported":15}],8:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NetIPCServer = exports.IPCSocketPeer = exports.RemoteIPCPeer = exports.IPCPeer = void 0;
const acebase_core_1 = require("acebase-core");
const ipc_1 = require("./ipc");
const not_supported_1 = require("../not-supported");
Object.defineProperty(exports, "RemoteIPCPeer", { enumerable: true, get: function () { return not_supported_1.NotSupported; } });
Object.defineProperty(exports, "IPCSocketPeer", { enumerable: true, get: function () { return not_supported_1.NotSupported; } });
Object.defineProperty(exports, "NetIPCServer", { enumerable: true, get: function () { return not_supported_1.NotSupported; } });
/**
 * Browser tabs IPC. Database changes and events will be synchronized automatically.
 * Locking of resources will be done by the election of a single locking master:
 * the one with the lowest id.
 */
class IPCPeer extends ipc_1.AceBaseIPCPeer {
    constructor(storage) {
        super(storage, acebase_core_1.ID.generate());
        this.masterPeerId = this.id; // We don't know who the master is yet...
        this.ipcType = 'browser.bcc';
        // Setup process exit handler
        // Monitor onbeforeunload event to say goodbye when the window is closed
        addEventListener('beforeunload', () => {
            this.exit();
        });
        // Create BroadcastChannel to allow multi-tab communication
        // This allows other tabs to make changes to the database, notifying us of those changes.
        if (typeof BroadcastChannel !== 'undefined') {
            this.channel = new BroadcastChannel(`acebase:${storage.name}`);
        }
        else if (typeof localStorage !== 'undefined') {
            // Use localStorage as polyfill for Safari & iOS WebKit
            const listeners = [null]; // first callback reserved for onmessage handler
            const notImplemented = () => { throw new Error('Not implemented'); };
            this.channel = {
                name: `acebase:${storage.name}`,
                postMessage: (message) => {
                    const messageId = acebase_core_1.ID.generate(), key = `acebase:${storage.name}:${this.id}:${messageId}`, payload = JSON.stringify(acebase_core_1.Transport.serialize(message));
                    // Store message, triggers 'storage' event in other tabs
                    localStorage.setItem(key, payload);
                    // Remove after 10ms
                    setTimeout(() => localStorage.removeItem(key), 10);
                },
                set onmessage(handler) { listeners[0] = handler; },
                set onmessageerror(handler) { notImplemented(); },
                close() { notImplemented(); },
                addEventListener(event, callback) {
                    if (event !== 'message') {
                        notImplemented();
                    }
                    listeners.push(callback);
                },
                removeEventListener(event, callback) {
                    const i = listeners.indexOf(callback);
                    i >= 1 && listeners.splice(i, 1);
                },
                dispatchEvent(event) {
                    listeners.forEach(callback => {
                        try {
                            callback && callback(event);
                        }
                        catch (err) {
                            console.error(err);
                        }
                    });
                    return true;
                },
            };
            // Listen for storage events to intercept possible messages
            addEventListener('storage', event => {
                const [acebase, dbname, peerId, messageId] = event.key.split(':');
                if (acebase !== 'acebase' || dbname !== storage.name || peerId === this.id || event.newValue === null) {
                    return;
                }
                const message = acebase_core_1.Transport.deserialize(JSON.parse(event.newValue));
                this.channel.dispatchEvent({ data: message });
            });
        }
        else {
            // No localStorage either, this is probably an old browser running in a webworker
            this.storage.debug.warn(`[BroadcastChannel] not supported`);
            this.sendMessage = () => { };
            return;
        }
        // Monitor incoming messages
        this.channel.addEventListener('message', async (event) => {
            const message = event.data;
            if (message.to && message.to !== this.id) {
                // Message is for somebody else. Ignore
                return;
            }
            storage.debug.verbose(`[BroadcastChannel] received: `, message);
            if (message.type === 'hello' && message.from < this.masterPeerId) {
                // This peer was created before other peer we thought was the master
                this.masterPeerId = message.from;
                storage.debug.log(`[BroadcastChannel] Tab ${this.masterPeerId} is the master.`);
            }
            else if (message.type === 'bye' && message.from === this.masterPeerId) {
                // The master tab is leaving
                storage.debug.log(`[BroadcastChannel] Master tab ${this.masterPeerId} is leaving`);
                // Elect new master
                const allPeerIds = this.peers.map(peer => peer.id).concat(this.id).filter(id => id !== this.masterPeerId); // All peers, including us, excluding the leaving master peer
                this.masterPeerId = allPeerIds.sort()[0];
                storage.debug.log(`[BroadcastChannel] ${this.masterPeerId === this.id ? 'We are' : `tab ${this.masterPeerId} is`} the new master. Requesting ${this._locks.length} locks (${this._locks.filter(r => !r.granted).length} pending)`);
                // Let the new master take over any locks and lock requests.
                const requests = this._locks.splice(0); // Copy and clear current lock requests before granted locks are requested again.
                // Request previously granted locks again
                await Promise.all(requests.filter(req => req.granted).map(async (req) => {
                    // Prevent race conditions: if the existing lock is released or moved to parent before it was
                    // moved to the new master peer, we'll resolve their promises after releasing/moving the new lock
                    let released, movedToParent;
                    req.lock.release = () => { return new Promise(resolve => released = resolve); };
                    req.lock.moveToParent = () => { return new Promise(resolve => movedToParent = resolve); };
                    // Request lock again:
                    const lock = await this.lock({ path: req.lock.path, write: req.lock.forWriting, tid: req.lock.tid, comment: req.lock.comment });
                    if (movedToParent) {
                        const newLock = await lock.moveToParent();
                        movedToParent(newLock);
                    }
                    if (released) {
                        await lock.release();
                        released();
                    }
                }));
                // Now request pending locks again
                await Promise.all(requests.filter(req => !req.granted).map(async (req) => {
                    await this.lock(req.request);
                }));
            }
            return this.handleMessage(message);
        });
        // // Schedule periodic "pulse" to let others know we're still around
        // setInterval(() => {
        //     sendMessage(<IPulseMessage>{ from: tabId, type: 'pulse' });
        // }, 30000);
        // Send hello to other peers
        const helloMsg = { type: 'hello', from: this.id, data: undefined };
        this.sendMessage(helloMsg);
    }
    sendMessage(message) {
        this.storage.debug.verbose(`[BroadcastChannel] sending: `, message);
        this.channel.postMessage(message);
    }
}
exports.IPCPeer = IPCPeer;

},{"../not-supported":15,"./ipc":9,"acebase-core":43}],9:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AceBaseIPCPeer = exports.AceBaseIPCPeerExitingError = void 0;
const acebase_core_1 = require("acebase-core");
const node_lock_1 = require("../node-lock");
class AceBaseIPCPeerExitingError extends Error {
    constructor(message) { super(`Exiting: ${message}`); }
}
exports.AceBaseIPCPeerExitingError = AceBaseIPCPeerExitingError;
/**
 * Base class for Inter Process Communication, enables vertical scaling: using more CPU's on the same machine to share workload.
 * These processes will have to communicate with eachother because they are reading and writing to the same database file
 */
class AceBaseIPCPeer extends acebase_core_1.SimpleEventEmitter {
    get isMaster() { return this.masterPeerId === this.id; }
    constructor(storage, id, dbname = storage.name) {
        super();
        this.storage = storage;
        this.id = id;
        this.dbname = dbname;
        this.ipcType = 'ipc';
        this.ourSubscriptions = [];
        this.remoteSubscriptions = [];
        this.peers = [];
        this._exiting = false;
        this._locks = [];
        this._requests = new Map();
        this._eventsEnabled = true;
        this._nodeLocker = new node_lock_1.NodeLocker(storage.debug, storage.settings.lockTimeout);
        // Setup db event listeners
        storage.on('subscribe', (subscription) => {
            // Subscription was added to db
            storage.debug.verbose(`database subscription being added on peer ${this.id}`);
            const remoteSubscription = this.remoteSubscriptions.find(sub => sub.callback === subscription.callback);
            if (remoteSubscription) {
                // Send ack
                // return sendMessage({ type: 'subscribe_ack', from: tabId, to: remoteSubscription.for, data: { path: subscription.path, event: subscription.event } });
                return;
            }
            const othersAlreadyNotifying = this.ourSubscriptions.some(sub => sub.event === subscription.event && sub.path === subscription.path);
            // Add subscription
            this.ourSubscriptions.push(subscription);
            if (othersAlreadyNotifying) {
                // Same subscription as other previously added. Others already know we want to be notified
                return;
            }
            // Request other tabs to keep us updated of this event
            const message = { type: 'subscribe', from: this.id, data: { path: subscription.path, event: subscription.event } };
            this.sendMessage(message);
        });
        storage.on('unsubscribe', (subscription) => {
            // Subscription was removed from db
            const remoteSubscription = this.remoteSubscriptions.find(sub => sub.callback === subscription.callback);
            if (remoteSubscription) {
                // Remove
                this.remoteSubscriptions.splice(this.remoteSubscriptions.indexOf(remoteSubscription), 1);
                // Send ack
                // return sendMessage({ type: 'unsubscribe_ack', from: tabId, to: remoteSubscription.for, data: { path: subscription.path, event: subscription.event } });
                return;
            }
            this.ourSubscriptions
                .filter(sub => sub.path === subscription.path && (!subscription.event || sub.event === subscription.event) && (!subscription.callback || sub.callback === subscription.callback))
                .forEach(sub => {
                // Remove from our subscriptions
                this.ourSubscriptions.splice(this.ourSubscriptions.indexOf(sub), 1);
                // Request other tabs to stop notifying
                const message = { type: 'unsubscribe', from: this.id, data: { path: sub.path, event: sub.event } };
                this.sendMessage(message);
            });
        });
    }
    /**
     * Requests the peer to shut down. Resolves once its locks are cleared and 'exit' event has been emitted.
     * Has to be overridden by the IPC implementation to perform custom shutdown tasks
     * @param code optional exit code (eg one provided by SIGINT event)
     */
    async exit(code = 0) {
        if (this._exiting) {
            // Already exiting...
            return this.once('exit');
        }
        this._exiting = true;
        this.storage.debug.warn(`Received ${this.isMaster ? 'master' : 'worker ' + this.id} process exit request`);
        if (this._locks.length > 0) {
            this.storage.debug.warn(`Waiting for ${this.isMaster ? 'master' : 'worker'} ${this.id} locks to clear`);
            await this.once('locks-cleared');
        }
        // Send "bye"
        this.sayGoodbye(this.id);
        this.storage.debug.warn(`${this.isMaster ? 'Master' : 'Worker ' + this.id} will now exit`);
        this.emitOnce('exit', code);
    }
    sayGoodbye(forPeerId) {
        // Send "bye" message on their behalf
        const bye = { type: 'bye', from: forPeerId, data: undefined };
        this.sendMessage(bye);
    }
    addPeer(id, sendReply = true) {
        if (this._exiting) {
            return;
        }
        const peer = this.peers.find(w => w.id === id);
        if (!peer) {
            this.peers.push({ id, lastSeen: Date.now() });
        }
        if (sendReply) {
            // Send hello back to sender
            const helloMessage = { type: 'hello', from: this.id, to: id, data: undefined };
            this.sendMessage(helloMessage);
            // Send our active subscriptions through
            this.ourSubscriptions.forEach(sub => {
                // Request to keep us updated
                const message = { type: 'subscribe', from: this.id, to: id, data: { path: sub.path, event: sub.event } };
                this.sendMessage(message);
            });
        }
    }
    removePeer(id, ignoreUnknown = false) {
        if (this._exiting) {
            return;
        }
        const peer = this.peers.find(peer => peer.id === id);
        if (!peer) {
            if (!ignoreUnknown) {
                throw new Error(`We are supposed to know this peer!`);
            }
            return;
        }
        this.peers.splice(this.peers.indexOf(peer), 1);
        // Remove their subscriptions
        const subscriptions = this.remoteSubscriptions.filter(sub => sub.for === id);
        subscriptions.forEach(sub => {
            // Remove & stop their subscription
            this.remoteSubscriptions.splice(this.remoteSubscriptions.indexOf(sub), 1);
            this.storage.subscriptions.remove(sub.path, sub.event, sub.callback);
        });
    }
    addRemoteSubscription(peerId, details) {
        if (this._exiting) {
            return;
        }
        // this.storage.debug.log(`remote subscription being added`);
        if (this.remoteSubscriptions.some(sub => sub.for === peerId && sub.event === details.event && sub.path === details.path)) {
            // We're already serving this event for the other peer. Ignore
            return;
        }
        // Add remote subscription
        const subscribeCallback = (err, path, val, previous, context) => {
            // db triggered an event, send notification to remote subscriber
            const eventMessage = {
                type: 'event',
                from: this.id,
                to: peerId,
                path: details.path,
                event: details.event,
                data: {
                    path,
                    val,
                    previous,
                    context,
                },
            };
            this.sendMessage(eventMessage);
        };
        this.remoteSubscriptions.push({ for: peerId, event: details.event, path: details.path, callback: subscribeCallback });
        this.storage.subscriptions.add(details.path, details.event, subscribeCallback);
    }
    cancelRemoteSubscription(peerId, details) {
        // Other tab requests to remove previously subscribed event
        const sub = this.remoteSubscriptions.find(sub => sub.for === peerId && sub.event === details.event && sub.path === details.event);
        if (!sub) {
            // We don't know this subscription so we weren't notifying in the first place. Ignore
            return;
        }
        // Stop subscription
        this.storage.subscriptions.remove(details.path, details.event, sub.callback);
    }
    async handleMessage(message) {
        switch (message.type) {
            case 'hello': return this.addPeer(message.from, message.to !== this.id);
            case 'bye': return this.removePeer(message.from, true);
            case 'subscribe': return this.addRemoteSubscription(message.from, message.data);
            case 'unsubscribe': return this.cancelRemoteSubscription(message.from, message.data);
            case 'event': {
                if (!this._eventsEnabled) {
                    // IPC event handling is disabled for this client. Ignore message.
                    break;
                }
                const eventMessage = message;
                const context = eventMessage.data.context || {};
                context.acebase_ipc = { type: this.ipcType, origin: eventMessage.from }; // Add IPC details
                // Other peer raised an event we are monitoring
                const subscriptions = this.ourSubscriptions.filter(sub => sub.event === eventMessage.event && sub.path === eventMessage.path);
                subscriptions.forEach(sub => {
                    sub.callback(null, eventMessage.data.path, eventMessage.data.val, eventMessage.data.previous, context);
                });
                break;
            }
            case 'lock-request': {
                // Lock request sent by worker to master
                if (!this.isMaster) {
                    throw new Error(`Workers are not supposed to receive lock requests!`);
                }
                const request = message;
                const result = { type: 'lock-result', id: request.id, from: this.id, to: request.from, ok: true, data: undefined };
                try {
                    const lock = await this.lock(request.data);
                    result.data = {
                        id: lock.id,
                        path: lock.path,
                        tid: lock.tid,
                        write: lock.forWriting,
                        expires: lock.expires,
                        comment: lock.comment,
                    };
                }
                catch (err) {
                    result.ok = false;
                    result.reason = err.stack || err.message || err;
                }
                return this.sendMessage(result);
            }
            case 'lock-result': {
                // Lock result sent from master to worker
                if (this.isMaster) {
                    throw new Error(`Masters are not supposed to receive results for lock requests!`);
                }
                const result = message;
                const request = this._requests.get(result.id);
                if (typeof request !== 'object') {
                    throw new Error(`The request must be known to us!`);
                }
                if (result.ok) {
                    request.resolve(result.data);
                }
                else {
                    request.reject(new Error(result.reason));
                }
                return;
            }
            case 'unlock-request': {
                // lock release request sent from worker to master
                if (!this.isMaster) {
                    throw new Error(`Workers are not supposed to receive unlock requests!`);
                }
                const request = message;
                const result = { type: 'unlock-result', id: request.id, from: this.id, to: request.from, ok: true, data: { id: request.data.id } };
                try {
                    const lockInfo = this._locks.find(l => { var _a; return ((_a = l.lock) === null || _a === void 0 ? void 0 : _a.id) === request.data.id; }); // this._locks.get(request.data.id);
                    await lockInfo.lock.release(); //this.unlock(request.data.id);
                }
                catch (err) {
                    result.ok = false;
                    result.reason = err.stack || err.message || err;
                }
                return this.sendMessage(result);
            }
            case 'unlock-result': {
                // lock release result sent from master to worker
                if (this.isMaster) {
                    throw new Error(`Masters are not supposed to receive results for unlock requests!`);
                }
                const result = message;
                const request = this._requests.get(result.id);
                if (typeof request !== 'object') {
                    throw new Error(`The request must be known to us!`);
                }
                if (result.ok) {
                    request.resolve(result.data);
                }
                else {
                    request.reject(new Error(result.reason));
                }
                return;
            }
            case 'move-lock-request': {
                // move lock request sent from worker to master
                if (!this.isMaster) {
                    throw new Error(`Workers are not supposed to receive move lock requests!`);
                }
                const request = message;
                const result = { type: 'lock-result', id: request.id, from: this.id, to: request.from, ok: true, data: undefined };
                try {
                    let movedLock;
                    // const lock = this._locks.get(request.data.id);
                    const lockRequest = this._locks.find(r => { var _a; return ((_a = r.lock) === null || _a === void 0 ? void 0 : _a.id) === request.data.id; });
                    if (request.data.move_to === 'parent') {
                        movedLock = await lockRequest.lock.moveToParent();
                    }
                    else {
                        throw new Error(`Unknown lock move_to "${request.data.move_to}"`);
                    }
                    // this._locks.delete(request.data.id);
                    // this._locks.set(movedLock.id, movedLock);
                    lockRequest.lock = movedLock;
                    result.data = {
                        id: movedLock.id,
                        path: movedLock.path,
                        tid: movedLock.tid,
                        write: movedLock.forWriting,
                        expires: movedLock.expires,
                        comment: movedLock.comment,
                    };
                }
                catch (err) {
                    result.ok = false;
                    result.reason = err.stack || err.message || err;
                }
                return this.sendMessage(result);
            }
            case 'notification': {
                // Custom notification received - raise event
                return this.emit('notification', message);
            }
            case 'request': {
                // Custom message received - raise event
                return this.emit('request', message);
            }
            case 'result': {
                // Result of custom request received - raise event
                const result = message;
                const request = this._requests.get(result.id);
                if (typeof request !== 'object') {
                    throw new Error(`Result of unknown request received`);
                }
                if (result.ok) {
                    request.resolve(result.data);
                }
                else {
                    request.reject(new Error(result.reason));
                }
            }
        }
    }
    /**
     * Acquires a lock. If this peer is a worker, it will request the lock from the master
     * @param details
     */
    async lock(details) {
        if (this._exiting) {
            // Peer is exiting. Do we have an existing lock with requested tid? If not, deny request.
            const tidApproved = this._locks.find(l => l.tid === details.tid && l.granted);
            if (!tidApproved) {
                // We have no previously granted locks for this transaction. Deny.
                throw new AceBaseIPCPeerExitingError('new transaction lock denied because the IPC peer is exiting');
            }
        }
        const removeLock = (lockDetails) => {
            this._locks.splice(this._locks.indexOf(lockDetails), 1);
            if (this._locks.length === 0) {
                // this.storage.debug.log(`No more locks in worker ${this.id}`);
                this.emit('locks-cleared');
            }
        };
        if (this.isMaster) {
            // Master
            const lockInfo = { tid: details.tid, granted: false, request: details, lock: null };
            this._locks.push(lockInfo);
            const lock = await this._nodeLocker.lock(details.path, details.tid, details.write, details.comment);
            lockInfo.tid = lock.tid;
            lockInfo.granted = true;
            const createIPCLock = (lock) => {
                return {
                    get id() { return lock.id; },
                    get tid() { return lock.tid; },
                    get path() { return lock.path; },
                    get forWriting() { return lock.forWriting; },
                    get expires() { return lock.expires; },
                    get comment() { return lock.comment; },
                    get state() { return lock.state; },
                    release: async () => {
                        await lock.release();
                        removeLock(lockInfo);
                    },
                    moveToParent: async () => {
                        const parentLock = await lock.moveToParent();
                        lockInfo.lock = createIPCLock(parentLock);
                        return lockInfo.lock;
                    },
                };
            };
            lockInfo.lock = createIPCLock(lock);
            return lockInfo.lock;
        }
        else {
            // Worker
            const lockInfo = { tid: details.tid, granted: false, request: details, lock: null };
            this._locks.push(lockInfo);
            const createIPCLock = (result) => {
                lockInfo.granted = true;
                lockInfo.tid = result.tid;
                lockInfo.lock = {
                    id: result.id,
                    tid: result.tid,
                    path: result.path,
                    forWriting: result.write,
                    state: node_lock_1.LOCK_STATE.LOCKED,
                    expires: result.expires,
                    comment: result.comment,
                    release: async () => {
                        const req = { type: 'unlock-request', id: acebase_core_1.ID.generate(), from: this.id, to: this.masterPeerId, data: { id: lockInfo.lock.id } };
                        await this.request(req);
                        lockInfo.lock.state = node_lock_1.LOCK_STATE.DONE;
                        this.storage.debug.verbose(`Worker ${this.id} released lock ${lockInfo.lock.id} (tid ${lockInfo.lock.tid}, ${lockInfo.lock.comment}, "/${lockInfo.lock.path}", ${lockInfo.lock.forWriting ? 'write' : 'read'})`);
                        removeLock(lockInfo);
                    },
                    moveToParent: async () => {
                        const req = { type: 'move-lock-request', id: acebase_core_1.ID.generate(), from: this.id, to: this.masterPeerId, data: { id: lockInfo.lock.id, move_to: 'parent' } };
                        let result;
                        try {
                            result = await this.request(req);
                        }
                        catch (err) {
                            // We didn't get new lock?!
                            lockInfo.lock.state = node_lock_1.LOCK_STATE.DONE;
                            removeLock(lockInfo);
                            throw err;
                        }
                        lockInfo.lock = createIPCLock(result);
                        return lockInfo.lock;
                    },
                };
                // this.storage.debug.log(`Worker ${this.id} received lock ${lock.id} (tid ${lock.tid}, ${lock.comment}, "/${lock.path}", ${lock.forWriting ? 'write' : 'read'})`);
                return lockInfo.lock;
            };
            const req = { type: 'lock-request', id: acebase_core_1.ID.generate(), from: this.id, to: this.masterPeerId, data: details };
            let result, err;
            try {
                result = await this.request(req);
            }
            catch (e) {
                err = e;
                result = null;
            }
            if (err) {
                removeLock(lockInfo);
                throw err;
            }
            return createIPCLock(result);
        }
    }
    async request(req) {
        // Send request, return result promise
        let resolve, reject;
        const promise = new Promise((rs, rj) => {
            resolve = (result) => {
                this._requests.delete(req.id);
                rs(result);
            };
            reject = (err) => {
                this._requests.delete(req.id);
                rj(err);
            };
        });
        this._requests.set(req.id, { resolve, reject, request: req });
        this.sendMessage(req);
        return promise;
    }
    /**
     * Sends a custom request to the IPC master
     * @param request
     * @returns
     */
    sendRequest(request) {
        const req = { type: 'request', from: this.id, to: this.masterPeerId, id: acebase_core_1.ID.generate(), data: request };
        return this.request(req)
            .catch(err => {
            this.storage.debug.error(err);
            throw err;
        });
    }
    replyRequest(requestMessage, result) {
        const reply = { type: 'result', id: requestMessage.id, ok: true, from: this.id, to: requestMessage.from, data: result };
        this.sendMessage(reply);
    }
    /**
     * Sends a custom notification to all IPC peers
     * @param notification
     * @returns
     */
    sendNotification(notification) {
        const msg = { type: 'notification', from: this.id, data: notification };
        this.sendMessage(msg);
    }
    /**
     * If ipc event handling is currently enabled
     */
    get eventsEnabled() { return this._eventsEnabled; }
    /**
     * Enables or disables ipc event handling. When disabled, incoming event messages will be ignored.
     */
    set eventsEnabled(enabled) {
        this.storage.debug.log(`ipc events ${enabled ? 'enabled' : 'disabled'}`);
        this._eventsEnabled = enabled;
    }
}
exports.AceBaseIPCPeer = AceBaseIPCPeer;

},{"../node-lock":13,"acebase-core":43}],10:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RemovedNodeAddress = exports.NodeAddress = void 0;
class NodeAddress {
    constructor(path) {
        this.path = path;
    }
    toString() {
        return `"/${this.path}"`;
    }
    /**
     * Compares this address to another address
     */
    equals(address) {
        return this.path === address.path;
    }
}
exports.NodeAddress = NodeAddress;
class RemovedNodeAddress extends NodeAddress {
    constructor(path) {
        super(path);
    }
    toString() {
        return `"/${this.path}" (removed)`;
    }
    /**
     * Compares this address to another address
     */
    equals(address) {
        return address instanceof RemovedNodeAddress && this.path === address.path;
    }
}
exports.RemovedNodeAddress = RemovedNodeAddress;

},{}],11:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NodeRevisionError = exports.NodeNotFoundError = void 0;
class NodeNotFoundError extends Error {
}
exports.NodeNotFoundError = NodeNotFoundError;
class NodeRevisionError extends Error {
}
exports.NodeRevisionError = NodeRevisionError;

},{}],12:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NodeInfo = void 0;
const node_value_types_1 = require("./node-value-types");
const acebase_core_1 = require("acebase-core");
class NodeInfo {
    constructor(info) {
        this.path = info.path;
        this.type = info.type;
        this.index = info.index;
        this.key = info.key;
        this.exists = info.exists;
        this.address = info.address;
        this.value = info.value;
        this.childCount = info.childCount;
        if (typeof this.path === 'string' && (typeof this.key === 'undefined' && typeof this.index === 'undefined')) {
            const pathInfo = acebase_core_1.PathInfo.get(this.path);
            if (typeof pathInfo.key === 'number') {
                this.index = pathInfo.key;
            }
            else {
                this.key = pathInfo.key;
            }
        }
        if (typeof this.exists === 'undefined') {
            this.exists = true;
        }
    }
    get valueType() {
        return this.type;
    }
    get valueTypeName() {
        return (0, node_value_types_1.getValueTypeName)(this.valueType);
    }
    toString() {
        if (!this.exists) {
            return `"${this.path}" doesn't exist`;
        }
        if (this.address) {
            return `"${this.path}" is ${this.valueTypeName} stored at ${this.address.toString()}`;
        }
        else {
            return `"${this.path}" is ${this.valueTypeName} with value ${this.value}`;
        }
    }
}
exports.NodeInfo = NodeInfo;

},{"./node-value-types":14,"acebase-core":43}],13:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NodeLock = exports.NodeLocker = exports.LOCK_STATE = void 0;
const acebase_core_1 = require("acebase-core");
const assert_1 = require("./assert");
const DEBUG_MODE = false;
const DEFAULT_LOCK_TIMEOUT = 120; // in seconds
exports.LOCK_STATE = {
    PENDING: 'pending',
    LOCKED: 'locked',
    EXPIRED: 'expired',
    DONE: 'done',
};
class NodeLocker {
    /**
     * Provides locking mechanism for nodes, ensures no simultanious read and writes happen to overlapping paths
     */
    constructor(debug, lockTimeout = DEFAULT_LOCK_TIMEOUT) {
        this._locks = [];
        this._lastTid = 0;
        this.debug = debug;
        this.timeout = lockTimeout * 1000;
    }
    setTimeout(timeout) {
        this.timeout = timeout * 1000;
    }
    createTid() {
        return DEBUG_MODE ? ++this._lastTid : acebase_core_1.ID.generate();
    }
    _allowLock(path, tid, forWriting) {
        /**
         * Disabled path locking because of the following issue:
         *
         * Process 1 requests WRITE lock on "/users/ewout", is GRANTED
         * Process 2 requests READ lock on "", is DENIED (process 1 writing to a descendant)
         * Process 3 requests WRITE lock on "/posts/post1", is GRANTED
         * Process 1 requests READ lock on "/" because of bound events, is DENIED (3 is writing to a descendant)
         * Process 3 requests READ lock on "/" because of bound events, is DENIED (1 is writing to a descendant)
         *
         * --> DEADLOCK!
         *
         * Now simply makes sure one transaction has write access at the same time,
         * might change again in the future...
         */
        const conflict = this._locks
            .find(otherLock => {
            return (otherLock.tid !== tid
                && otherLock.state === exports.LOCK_STATE.LOCKED
                && (forWriting || otherLock.forWriting));
        });
        return { allow: !conflict, conflict };
    }
    quit() {
        return new Promise(resolve => {
            if (this._locks.length === 0) {
                return resolve();
            }
            this._quit = resolve;
        });
    }
    /**
     * Safely reject a pending lock, catching any unhandled promise rejections (that should not happen in the first place, obviously)
     * @param lock
     */
    _rejectLock(lock, err) {
        this._locks.splice(this._locks.indexOf(lock), 1); // Remove from queue
        clearTimeout(lock.timeout);
        try {
            lock.reject(err);
        }
        catch (err) {
            console.error(`Unhandled promise rejection:`, err);
        }
    }
    _processLockQueue() {
        if (this._quit) {
            // Reject all pending locks
            const quitError = new Error('Quitting');
            this._locks
                .filter(lock => lock.state === exports.LOCK_STATE.PENDING)
                .forEach(lock => this._rejectLock(lock, quitError));
            // Resolve quit promise if queue is empty:
            if (this._locks.length === 0) {
                this._quit();
            }
        }
        const pending = this._locks
            .filter(lock => lock.state === exports.LOCK_STATE.PENDING)
            .sort((a, b) => {
            // // Writes get higher priority so all reads get the most recent data
            // if (a.forWriting === b.forWriting) {
            //     if (a.requested < b.requested) { return -1; }
            //     else { return 1; }
            // }
            // else if (a.forWriting) { return -1; }
            if (a.priority && !b.priority) {
                return -1;
            }
            else if (!a.priority && b.priority) {
                return 1;
            }
            return a.requested - b.requested;
        });
        pending.forEach(lock => {
            const check = this._allowLock(lock.path, lock.tid, lock.forWriting);
            lock.waitingFor = check.conflict || null;
            if (check.allow) {
                this.lock(lock)
                    .then(lock.resolve)
                    .catch(err => this._rejectLock(lock, err));
            }
        });
    }
    async lock(path, tid, forWriting = true, comment = '', options = { withPriority: false, noTimeout: false }) {
        let lock, proceed;
        if (path instanceof NodeLock) {
            lock = path;
            //lock.comment = `(retry: ${lock.comment})`;
            proceed = true;
        }
        else if (this._locks.findIndex((l => l.tid === tid && l.state === exports.LOCK_STATE.EXPIRED)) >= 0) {
            throw new Error(`lock on tid ${tid} has expired, not allowed to continue`);
        }
        else if (this._quit && !options.withPriority) {
            throw new Error(`Quitting`);
        }
        else {
            DEBUG_MODE && console.error(`${forWriting ? 'write' : 'read'} lock requested on "${path}" by tid ${tid} (${comment})`);
            // // Test the requested lock path
            // let duplicateKeys = getPathKeys(path)
            //     .reduce((r, key) => {
            //         let i = r.findIndex(c => c.key === key);
            //         if (i >= 0) { r[i].count++; }
            //         else { r.push({ key, count: 1 }) }
            //         return r;
            //     }, [])
            //     .filter(c => c.count > 1)
            //     .map(c => c.key);
            // if (duplicateKeys.length > 0) {
            //     console.log(`ALERT: Duplicate keys found in path "/${path}"`.colorize([ColorStyle.dim, ColorStyle.bgRed]);
            // }
            lock = new NodeLock(this, path, tid, forWriting, options.withPriority === true);
            lock.comment = comment;
            this._locks.push(lock);
            const check = this._allowLock(path, tid, forWriting);
            lock.waitingFor = check.conflict || null;
            proceed = check.allow;
        }
        if (proceed) {
            DEBUG_MODE && console.error(`${lock.forWriting ? 'write' : 'read'} lock ALLOWED on "${lock.path}" by tid ${lock.tid} (${lock.comment})`);
            lock.state = exports.LOCK_STATE.LOCKED;
            if (typeof lock.granted === 'number') {
                //debug.warn(`lock :: ALLOWING ${lock.forWriting ? "write" : "read" } lock on path "/${lock.path}" by tid ${lock.tid}; ${lock.comment}`);
            }
            else {
                lock.granted = Date.now();
                if (options.noTimeout !== true) {
                    lock.expires = Date.now() + this.timeout;
                    //debug.warn(`lock :: GRANTED ${lock.forWriting ? "write" : "read" } lock on path "/${lock.path}" by tid ${lock.tid}; ${lock.comment}`);
                    let timeoutCount = 0;
                    const timeoutHandler = () => {
                        // Autorelease timeouts must only fire when there is something wrong in the
                        // executing (AceBase) code, eg an unhandled promise rejection causing a lock not
                        // to be released. To guard against programming errors, we will issue 3 warning
                        // messages before releasing the lock.
                        if (lock.state !== exports.LOCK_STATE.LOCKED) {
                            return;
                        }
                        timeoutCount++;
                        if (timeoutCount <= 3) {
                            // Warn first.
                            this.debug.warn(`${lock.forWriting ? 'write' : 'read'} lock on path "/${lock.path}" by tid ${lock.tid} (${lock.comment}) is taking a long time to complete [${timeoutCount}]`);
                            lock.timeout = setTimeout(timeoutHandler, this.timeout / 4);
                            return;
                        }
                        this.debug.error(`lock :: ${lock.forWriting ? 'write' : 'read'} lock on path "/${lock.path}" by tid ${lock.tid} (${lock.comment}) took too long`);
                        lock.state = exports.LOCK_STATE.EXPIRED;
                        // let allTransactionLocks = _locks.filter(l => l.tid === lock.tid).sort((a,b) => a.requested < b.requested ? -1 : 1);
                        // let transactionsDebug = allTransactionLocks.map(l => `${l.state} ${l.forWriting ? "WRITE" : "read"} ${l.comment}`).join("\n");
                        // debug.error(transactionsDebug);
                        this._processLockQueue();
                    };
                    lock.timeout = setTimeout(timeoutHandler, this.timeout / 4);
                }
            }
            return lock;
        }
        else {
            // Keep pending until clashing lock(s) is/are removed
            //debug.warn(`lock :: QUEUED ${lock.forWriting ? "write" : "read" } lock on path "/${lock.path}" by tid ${lock.tid}; ${lock.comment}`);
            (0, assert_1.assert)(lock.state === exports.LOCK_STATE.PENDING);
            return new Promise((resolve, reject) => {
                lock.resolve = resolve;
                lock.reject = reject;
            });
        }
    }
    unlock(lockOrId, comment, processQueue = true) {
        let lock, i;
        if (lockOrId instanceof NodeLock) {
            lock = lockOrId;
            i = this._locks.indexOf(lock);
        }
        else {
            const id = lockOrId;
            i = this._locks.findIndex(l => l.id === id);
            lock = this._locks[i];
        }
        if (i < 0) {
            const msg = `lock on "/${lock.path}" for tid ${lock.tid} wasn't found; ${comment}`;
            // debug.error(`unlock :: ${msg}`);
            throw new Error(msg);
        }
        lock.state = exports.LOCK_STATE.DONE;
        clearTimeout(lock.timeout);
        this._locks.splice(i, 1);
        DEBUG_MODE && console.error(`${lock.forWriting ? 'write' : 'read'} lock RELEASED on "${lock.path}" by tid ${lock.tid}`);
        //debug.warn(`unlock :: RELEASED ${lock.forWriting ? "write" : "read" } lock on "/${lock.path}" for tid ${lock.tid}; ${lock.comment}; ${comment}`);
        processQueue && this._processLockQueue();
        return lock;
    }
    list() {
        return this._locks || [];
    }
    isAllowed(path, tid, forWriting) {
        return this._allowLock(path, tid, forWriting).allow;
    }
}
exports.NodeLocker = NodeLocker;
let lastid = 0;
class NodeLock {
    static get LOCK_STATE() { return exports.LOCK_STATE; }
    /**
     * Constructor for a record lock
     * @param {NodeLocker} locker
     * @param {string} path
     * @param {string} tid
     * @param {boolean} forWriting
     * @param {boolean} priority
     */
    constructor(locker, path, tid, forWriting, priority = false) {
        this.locker = locker;
        this.path = path;
        this.tid = tid;
        this.forWriting = forWriting;
        this.priority = priority;
        this.state = exports.LOCK_STATE.PENDING;
        this.requested = Date.now();
        this.comment = '';
        this.waitingFor = null;
        this.id = ++lastid;
        this.history = [];
    }
    async release(comment) {
        //return this.storage.unlock(this.path, this.tid, comment);
        this.history.push({ action: 'release', path: this.path, forWriting: this.forWriting, comment });
        return this.locker.unlock(this, comment || this.comment);
    }
    async moveToParent() {
        const parentPath = acebase_core_1.PathInfo.get(this.path).parentPath; //getPathInfo(this.path).parent;
        const allowed = this.locker.isAllowed(parentPath, this.tid, this.forWriting); //_allowLock(parentPath, this.tid, this.forWriting);
        if (allowed) {
            DEBUG_MODE && console.error(`moveToParent ALLOWED for ${this.forWriting ? 'write' : 'read'} lock on "${this.path}" by tid ${this.tid} (${this.comment})`);
            this.history.push({ path: this.path, forWriting: this.forWriting, action: 'moving to parent' });
            this.waitingFor = null;
            this.path = parentPath;
            // this.comment = `moved to parent: ${this.comment}`;
            return this;
        }
        else {
            // Unlock without processing the queue
            DEBUG_MODE && console.error(`moveToParent QUEUED for ${this.forWriting ? 'write' : 'read'} lock on "${this.path}" by tid ${this.tid} (${this.comment})`);
            this.locker.unlock(this, `moveLockToParent: ${this.comment}`, false);
            // Lock parent node with priority to jump the queue
            const newLock = await this.locker.lock(parentPath, this.tid, this.forWriting, this.comment, { withPriority: true });
            DEBUG_MODE && console.error(`QUEUED moveToParent ALLOWED for ${this.forWriting ? 'write' : 'read'} lock on "${this.path}" by tid ${this.tid} (${this.comment})`);
            newLock.history = this.history;
            newLock.history.push({ path: this.path, forWriting: this.forWriting, action: 'moving to parent through queue (priority)' });
            return newLock;
        }
    }
}
exports.NodeLock = NodeLock;

},{"./assert":4,"acebase-core":43}],14:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getValueType = exports.getNodeValueType = exports.getValueTypeName = exports.VALUE_TYPES = void 0;
const acebase_core_1 = require("acebase-core");
const nodeValueTypes = {
    // Native types:
    OBJECT: 1,
    ARRAY: 2,
    NUMBER: 3,
    BOOLEAN: 4,
    STRING: 5,
    BIGINT: 7,
    // Custom types:
    DATETIME: 6,
    BINARY: 8,
    REFERENCE: 9, // Absolute or relative path to other node
    // Future:
    // DOCUMENT: 10,     // JSON/XML documents that are contained entirely within the stored node
};
exports.VALUE_TYPES = nodeValueTypes;
function getValueTypeName(valueType) {
    switch (valueType) {
        case exports.VALUE_TYPES.ARRAY: return 'array';
        case exports.VALUE_TYPES.BINARY: return 'binary';
        case exports.VALUE_TYPES.BOOLEAN: return 'boolean';
        case exports.VALUE_TYPES.DATETIME: return 'date';
        case exports.VALUE_TYPES.NUMBER: return 'number';
        case exports.VALUE_TYPES.OBJECT: return 'object';
        case exports.VALUE_TYPES.REFERENCE: return 'reference';
        case exports.VALUE_TYPES.STRING: return 'string';
        case exports.VALUE_TYPES.BIGINT: return 'bigint';
        // case VALUE_TYPES.DOCUMENT: return 'document';
        default: 'unknown';
    }
}
exports.getValueTypeName = getValueTypeName;
function getNodeValueType(value) {
    if (value instanceof Array) {
        return exports.VALUE_TYPES.ARRAY;
    }
    else if (value instanceof acebase_core_1.PathReference) {
        return exports.VALUE_TYPES.REFERENCE;
    }
    else if (value instanceof ArrayBuffer) {
        return exports.VALUE_TYPES.BINARY;
    }
    // TODO else if (value instanceof DataDocument) { return VALUE_TYPES.DOCUMENT; }
    else if (typeof value === 'string') {
        return exports.VALUE_TYPES.STRING;
    }
    else if (typeof value === 'object') {
        return exports.VALUE_TYPES.OBJECT;
    }
    else if (typeof value === 'bigint') {
        return exports.VALUE_TYPES.BIGINT;
    }
    throw new Error(`Invalid value for standalone node: ${value}`);
}
exports.getNodeValueType = getNodeValueType;
function getValueType(value) {
    if (value instanceof Array) {
        return exports.VALUE_TYPES.ARRAY;
    }
    else if (value instanceof acebase_core_1.PathReference) {
        return exports.VALUE_TYPES.REFERENCE;
    }
    else if (value instanceof ArrayBuffer) {
        return exports.VALUE_TYPES.BINARY;
    }
    else if (value instanceof Date) {
        return exports.VALUE_TYPES.DATETIME;
    }
    // TODO else if (value instanceof DataDocument) { return VALUE_TYPES.DOCUMENT; }
    else if (typeof value === 'string') {
        return exports.VALUE_TYPES.STRING;
    }
    else if (typeof value === 'object') {
        return exports.VALUE_TYPES.OBJECT;
    }
    else if (typeof value === 'number') {
        return exports.VALUE_TYPES.NUMBER;
    }
    else if (typeof value === 'boolean') {
        return exports.VALUE_TYPES.BOOLEAN;
    }
    else if (typeof value === 'bigint') {
        return exports.VALUE_TYPES.BIGINT;
    }
    throw new Error(`Unknown value type: ${value}`);
}
exports.getValueType = getValueType;

},{"acebase-core":43}],15:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotSupported = void 0;
class NotSupported {
    constructor(context = 'browser') { throw new Error(`This feature is not supported in ${context} context`); }
}
exports.NotSupported = NotSupported;

},{}],16:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pfs = void 0;
class pfs {
    static get hasFileSystem() { return false; }
    static get fs() { return null; }
}
exports.pfs = pfs;

},{}],17:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeQuery = void 0;
const acebase_core_1 = require("acebase-core");
const node_value_types_1 = require("./node-value-types");
const node_errors_1 = require("./node-errors");
const data_index_1 = require("./data-index");
const async_task_batch_1 = require("./async-task-batch");
// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = () => { };
/**
 *
 * @param storage Target storage instance
 * @param path Path of the object collection to perform query on
 * @param query Query to execute
 * @param options Additional options
 * @returns Returns a promise that resolves with matching data or paths in `results`
 */
async function executeQuery(api, path, query, options = { snapshots: false, include: undefined, exclude: undefined, child_objects: undefined, eventHandler: noop }) {
    var _a, _b, _c, _d, _e, _f;
    // TODO: Refactor to async
    if (typeof options !== 'object') {
        options = {};
    }
    if (typeof options.snapshots === 'undefined') {
        options.snapshots = false;
    }
    const context = {};
    if ((_a = api.storage.settings.transactions) === null || _a === void 0 ? void 0 : _a.log) {
        context.acebase_cursor = acebase_core_1.ID.generate();
    }
    const queryFilters = query.filters.map(f => (Object.assign({}, f)));
    const querySort = query.order.map(s => (Object.assign({}, s)));
    const sortMatches = (matches) => {
        matches.sort((a, b) => {
            const compare = (i) => {
                const o = querySort[i];
                const trailKeys = acebase_core_1.PathInfo.getPathKeys(typeof o.key === 'number' ? `[${o.key}]` : o.key);
                const left = trailKeys.reduce((val, key) => val !== null && typeof val === 'object' && key in val ? val[key] : null, a.val);
                const right = trailKeys.reduce((val, key) => val !== null && typeof val === 'object' && key in val ? val[key] : null, b.val);
                if (left === null) {
                    return right === null ? 0 : o.ascending ? -1 : 1;
                }
                if (right === null) {
                    return o.ascending ? 1 : -1;
                }
                // TODO: add collation options using Intl.Collator. Note this also has to be implemented in the matching engines (inclusing indexes)
                // See discussion https://github.com/appy-one/acebase/discussions/27
                if (left == right) {
                    if (i < querySort.length - 1) {
                        return compare(i + 1);
                    }
                    else {
                        return a.path < b.path ? -1 : 1;
                    } // Sort by path if property values are equal
                }
                else if (left < right) {
                    return o.ascending ? -1 : 1;
                }
                // else if (left > right) {
                return o.ascending ? 1 : -1;
                // }
            };
            return compare(0);
        });
    };
    const loadResultsData = async (preResults, options) => {
        // Limit the amount of concurrent getValue calls by batching them
        if (preResults.length === 0) {
            return [];
        }
        const maxBatchSize = 50;
        const batch = new async_task_batch_1.AsyncTaskBatch(maxBatchSize);
        const results = [];
        preResults.forEach(({ path }, index) => batch.add(async () => {
            const node = await api.storage.getNode(path, options);
            const val = node.value;
            if (val === null) {
                // Record was deleted, but index isn't updated yet?
                api.storage.debug.warn(`Indexed result "/${path}" does not have a record!`);
                // TODO: let index rebuild
                return;
            }
            const result = { path, val };
            if (stepsExecuted.sorted) {
                // Put the result in the same index as the preResult was
                results[index] = result;
            }
            else {
                results.push(result);
                if (!stepsExecuted.skipped && results.length > query.skip + Math.abs(query.take)) {
                    // we can toss a value! sort, toss last one
                    sortMatches(results);
                    results.pop(); // Always toss last value, results have been sorted already
                }
            }
        }));
        await batch.finish();
        return results;
    };
    const pathInfo = acebase_core_1.PathInfo.get(path);
    const isWildcardPath = pathInfo.keys.some(key => key === '*' || key.toString().startsWith('$')); // path.includes('*');
    const availableIndexes = api.storage.indexes.get(path);
    const usingIndexes = [];
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    let stop = async () => { };
    if (isWildcardPath) {
        // Check if path contains $vars with explicit filter values. If so, execute multiple queries and merge results
        const vars = pathInfo.keys.filter(key => typeof key === 'string' && key.startsWith('$'));
        const hasExplicitFilterValues = vars.length > 0 && vars.every(v => query.filters.some(f => f.key === v && ['==', 'in'].includes(f.op)));
        const isRealtime = typeof options.monitor === 'object' && [(_b = options.monitor) === null || _b === void 0 ? void 0 : _b.add, (_c = options.monitor) === null || _c === void 0 ? void 0 : _c.change, (_d = options.monitor) === null || _d === void 0 ? void 0 : _d.remove].some(val => val === true);
        if (hasExplicitFilterValues && !isRealtime) {
            // create path combinations
            const combinations = [];
            for (const v of vars) {
                const filters = query.filters.filter(f => f.key === v);
                const filterValues = filters.reduce((values, f) => {
                    if (f.op === '==') {
                        values.push(f.compare);
                    }
                    if (f.op === 'in') {
                        if (!(f.compare instanceof Array)) {
                            throw new Error(`compare argument for 'in' operator must be an Array`);
                        }
                        values.push(...f.compare);
                    }
                    return values;
                }, []);
                // Expand all current combinations with these filter values
                const prevCombinations = combinations.splice(0);
                filterValues.forEach(fv => {
                    if (prevCombinations.length === 0) {
                        combinations.push({ [v]: fv });
                    }
                    else {
                        combinations.push(...prevCombinations.map(c => (Object.assign(Object.assign({}, c), { [v]: fv }))));
                    }
                });
            }
            // create queries
            const filters = query.filters.filter(f => !vars.includes(f.key));
            const paths = combinations.map(vars => acebase_core_1.PathInfo.get(acebase_core_1.PathInfo.getPathKeys(path).map(key => { var _a; return (_a = vars[key]) !== null && _a !== void 0 ? _a : key; })).path);
            const loadData = query.order.length > 0;
            const promises = paths.map(path => {
                var _a;
                return executeQuery(api, path, { filters, take: 0, skip: 0, order: [] }, {
                    snapshots: loadData,
                    cache_mode: options.cache_mode,
                    include: [...((_a = options.include) !== null && _a !== void 0 ? _a : []), ...query.order.map(o => o.key)],
                    exclude: options.exclude,
                });
            });
            const resultSets = await Promise.all(promises);
            let results = resultSets.reduce((results, set) => (results.push(...set.results), results), []);
            if (loadData) {
                sortMatches(results);
            }
            if (query.skip > 0) {
                results.splice(0, query.skip);
            }
            if (query.take > 0) {
                results.splice(query.take);
            }
            if (options.snapshots && (!loadData || ((_e = options.include) === null || _e === void 0 ? void 0 : _e.length) > 0 || ((_f = options.exclude) === null || _f === void 0 ? void 0 : _f.length) > 0 || !options.child_objects)) {
                const { include, exclude, child_objects } = options;
                results = await loadResultsData(results, { include, exclude, child_objects });
            }
            return { results, context: null, stop };
            // const results = options.snapshots ? results
        }
        else if (availableIndexes.length === 0) {
            // Wildcard paths require data to be indexed
            const err = new Error(`Query on wildcard path "/${path}" requires an index`);
            return Promise.reject(err);
        }
        if (queryFilters.length === 0) {
            // Filterless query on wildcard path. Use first available index with filter on non-null key value (all results)
            const index = availableIndexes.filter((index) => index.type === 'normal')[0];
            queryFilters.push({ key: index.key, op: '!=', compare: null });
        }
    }
    // Check if there are path specific indexes
    // eg: index on "users/$uid/posts", key "$uid", including "title" (or key "title", including "$uid")
    // Which are very useful for queries on "users/98sdfkb37/posts" with filter or sort on "title"
    // const indexesOnPath = availableIndexes
    //     .map(index => {
    //         if (!index.path.includes('$')) { return null; }
    //         const pattern = '^' + index.path.replace(/(\$[a-z0-9_]+)/gi, (match, name) => `(?<${name}>[a-z0-9_]+|\\*)`) + '$';
    //         const re = new RegExp(pattern, 'i');
    //         const match = path.match(re);
    //         const canBeUsed = index.key[0] === '$'
    //             ? match.groups[index.key] !== '*' // Index key value MUST be present in the path
    //             : null !== ourFilters.find(filter => filter.key === index.key); // Index key MUST be in a filter
    //         if (!canBeUsed) { return null; }
    //         return {
    //             index,
    //             wildcards: match.groups, // eg: { "$uid": "98sdfkb37" }
    //             filters: Object.keys(match.groups).filter(name => match.groups[name] !== '*').length
    //         }
    //     })
    //     .filter(info => info !== null)
    //     .sort((a, b) => {
    //         a.filters > b.filters ? -1 : 1
    //     });
    // TODO:
    // if (ourFilters.length === 0 && indexesOnPath.length > 0) {
    //     ourFilters = ourFilters.concat({ key: })
    //     usingIndexes.push({ index: filter.index, description: filter.index.description});
    // }
    queryFilters.forEach(filter => {
        if (filter.index) {
            // Index has been assigned already
            return;
        }
        // // Check if there are path indexes we can use
        // const pathIndexesWithKey = DataIndex.validOperators.includes(filter.op)
        //     ? indexesOnPath.filter(info => info.index.key === filter.key || info.index.includeKeys.includes(filter.key))
        //     : [];
        // Check if there are indexes on this filter key
        const indexesOnKey = availableIndexes
            .filter(index => index.key === filter.key)
            .filter(index => {
            return index.validOperators.includes(filter.op);
        });
        if (indexesOnKey.length >= 1) {
            // If there are multiple indexes on 1 key (happens when index includes other keys),
            // we should check other .filters and .order to determine the best one to use
            // TODO: Create a good strategy here...
            const otherFilterKeys = queryFilters.filter(f => f !== filter).map(f => f.key);
            const sortKeys = querySort.map(o => o.key).filter(key => key !== filter.key);
            const beneficialIndexes = indexesOnKey.map(index => {
                const availableKeys = index.includeKeys.concat(index.key);
                const forOtherFilters = availableKeys.filter(key => otherFilterKeys.includes(key));
                const forSorting = availableKeys.filter(key => sortKeys.includes(key));
                const forBoth = forOtherFilters.concat(forSorting.filter(index => !forOtherFilters.includes(index)));
                const points = {
                    filters: forOtherFilters.length,
                    sorting: forSorting.length * (query.take !== 0 ? forSorting.length : 1),
                    both: forBoth.length * forBoth.length,
                    get total() {
                        return this.filters + this.sorting + this.both;
                    },
                };
                return { index, points: points.total, filterKeys: forOtherFilters, sortKeys: forSorting };
            });
            // Use index with the most points
            beneficialIndexes.sort((a, b) => a.points > b.points ? -1 : 1);
            const bestBenificialIndex = beneficialIndexes[0];
            // Assign to this filter
            filter.index = bestBenificialIndex.index;
            // Assign to other filters and sorts
            bestBenificialIndex.filterKeys.forEach(key => {
                queryFilters.filter(f => f !== filter && f.key === key).forEach(f => {
                    if (!data_index_1.DataIndex.validOperators.includes(f.op)) {
                        // The used operator for this filter is invalid for use on metadata
                        // Probably because it is an Array/Fulltext/Geo query operator
                        return;
                    }
                    f.indexUsage = 'filter';
                    f.index = bestBenificialIndex.index;
                });
            });
            bestBenificialIndex.sortKeys.forEach(key => {
                querySort.filter(s => s.key === key).forEach(s => {
                    s.index = bestBenificialIndex.index;
                });
            });
        }
        if (filter.index) {
            usingIndexes.push({ index: filter.index, description: filter.index.description });
        }
    });
    if (querySort.length > 0 && query.take !== 0 && queryFilters.length === 0) {
        // Check if we can use assign an index to sorts in a filterless take & sort query
        querySort.forEach(sort => {
            if (sort.index) {
                // Index has been assigned already
                return;
            }
            sort.index = availableIndexes
                .filter(index => index.key === sort.key)
                .find(index => index.type === 'normal');
            // if (sort.index) {
            //     usingIndexes.push({ index: sort.index, description: `${sort.index.description} (for sorting)`});
            // }
        });
    }
    // const usingIndexes = ourFilters.map(filter => filter.index).filter(index => index);
    const indexDescriptions = usingIndexes.map(index => index.description).join(', ');
    usingIndexes.length > 0 && api.storage.debug.log(`Using indexes for query: ${indexDescriptions}`);
    // Filters that should run on all nodes after indexed results:
    const tableScanFilters = queryFilters.filter(filter => !filter.index);
    // Check if there are filters that require an index to run (such as "fulltext:contains", and "geo:nearby" etc)
    const specialOpsRegex = /^[a-z]+:/i;
    if (tableScanFilters.some(filter => specialOpsRegex.test(filter.op))) {
        const f = tableScanFilters.find(filter => specialOpsRegex.test(filter.op));
        const err = new Error(`query contains operator "${f.op}" which requires a special index that was not found on path "${path}", key "${f.key}"`);
        return Promise.reject(err);
    }
    // Check if the filters are using valid operators
    const allowedTableScanOperators = ['<', '<=', '==', '!=', '>=', '>', 'like', '!like', 'in', '!in', 'matches', '!matches', 'between', '!between', 'has', '!has', 'contains', '!contains', 'exists', '!exists']; // DISABLED "custom" because it is not fully implemented and only works locally
    for (let i = 0; i < tableScanFilters.length; i++) {
        const f = tableScanFilters[i];
        if (!allowedTableScanOperators.includes(f.op)) {
            return Promise.reject(new Error(`query contains unknown filter operator "${f.op}" on path "${path}", key "${f.key}"`));
        }
    }
    // Check if the available indexes are sufficient for this wildcard query
    if (isWildcardPath && tableScanFilters.length > 0) {
        // There are unprocessed filters, which means the fields aren't indexed.
        // We're not going to get all data of a wildcard path to query manually.
        // Indexes must be created
        const keys = tableScanFilters.reduce((keys, f) => {
            if (keys.indexOf(f.key) < 0) {
                keys.push(f.key);
            }
            return keys;
        }, []).map(key => `"${key}"`);
        const err = new Error(`This wildcard path query on "/${path}" requires index(es) on key(s): ${keys.join(', ')}. Create the index(es) and retry`);
        return Promise.reject(err);
    }
    // Run queries on available indexes
    const indexScanPromises = [];
    queryFilters.forEach(filter => {
        if (filter.index && filter.indexUsage !== 'filter') {
            let promise = filter.index.query(filter.op, filter.compare)
                .then(results => {
                var _a, _b;
                (_a = options.eventHandler) === null || _a === void 0 ? void 0 : _a.call(options, { name: 'stats', type: 'index_query', source: filter.index.description, stats: results.stats });
                if (results.hints.length > 0) {
                    (_b = options.eventHandler) === null || _b === void 0 ? void 0 : _b.call(options, { name: 'hints', type: 'index_query', source: filter.index.description, hints: results.hints });
                }
                return results;
            });
            // Get other filters that can be executed on these indexed results (eg filters on included keys of the index)
            const resultFilters = queryFilters.filter(f => f.index === filter.index && f.indexUsage === 'filter');
            if (resultFilters.length > 0) {
                // Hook into the promise
                promise = promise.then(results => {
                    resultFilters.forEach(filter => {
                        const { key, op, index } = filter;
                        let { compare } = filter;
                        if (typeof compare === 'string' && !index.caseSensitive) {
                            compare = compare.toLocaleLowerCase(index.textLocale);
                        }
                        results = results.filterMetadata(key, op, compare);
                    });
                    return results;
                });
            }
            indexScanPromises.push(promise);
        }
    });
    const stepsExecuted = {
        filtered: queryFilters.length === 0,
        skipped: query.skip === 0,
        taken: query.take === 0,
        sorted: querySort.length === 0,
        preDataLoaded: false,
        dataLoaded: false,
    };
    if (queryFilters.length === 0 && query.take === 0) {
        api.storage.debug.warn(`Filterless queries must use .take to limit the results. Defaulting to 100 for query on path "${path}"`);
        query.take = 100;
    }
    if (querySort.length > 0 && querySort[0].index) {
        const sortIndex = querySort[0].index;
        const ascending = query.take < 0 ? !querySort[0].ascending : querySort[0].ascending;
        if (queryFilters.length === 0 && querySort.slice(1).every(s => sortIndex.allMetadataKeys.includes(s.key))) {
            api.storage.debug.log(`Using index for sorting: ${sortIndex.description}`);
            const metadataSort = querySort.slice(1).map(s => {
                s.index = sortIndex; // Assign index to skip later processing of this sort operation
                return { key: s.key, ascending: s.ascending };
            });
            const promise = sortIndex.take(query.skip, Math.abs(query.take), { ascending, metadataSort })
                .then(results => {
                var _a, _b;
                (_a = options.eventHandler) === null || _a === void 0 ? void 0 : _a.call(options, { name: 'stats', type: 'sort_index_take', source: sortIndex.description, stats: results.stats });
                if (results.hints.length > 0) {
                    (_b = options.eventHandler) === null || _b === void 0 ? void 0 : _b.call(options, { name: 'hints', type: 'sort_index_take', source: sortIndex.description, hints: results.hints });
                }
                return results;
            });
            indexScanPromises.push(promise);
            stepsExecuted.skipped = true;
            stepsExecuted.taken = true;
            stepsExecuted.sorted = true;
        }
        // else if (queryFilters.every(f => [sortIndex.key, ...sortIndex.includeKeys].includes(f.key))) {
        //  TODO: If an index can be used for sorting, and all filter keys are included in its metadata: query the index!
        //  Implement:
        //  sortIndex.query(ourFilters);
        //  etc
        // }
    }
    return Promise.all(indexScanPromises)
        .then(async (indexResultSets) => {
        // Merge all results in indexResultSets, get distinct nodes
        let indexedResults = [];
        if (indexResultSets.length === 1) {
            const resultSet = indexResultSets[0];
            indexedResults = resultSet.map(match => {
                const result = { key: match.key, path: match.path, val: { [resultSet.filterKey]: match.value } };
                match.metadata && Object.assign(result.val, match.metadata);
                return result;
            });
            stepsExecuted.filtered = true;
        }
        else if (indexResultSets.length > 1) {
            indexResultSets.sort((a, b) => a.length < b.length ? -1 : 1); // Sort results, shortest result set first
            const shortestSet = indexResultSets[0];
            const otherSets = indexResultSets.slice(1);
            indexedResults = shortestSet.reduce((results, match) => {
                // Check if the key is present in the other result sets
                const result = { key: match.key, path: match.path, val: { [shortestSet.filterKey]: match.value } };
                const matchedInAllSets = otherSets.every(set => set.findIndex(m => m.path === match.path) >= 0);
                if (matchedInAllSets) {
                    match.metadata && Object.assign(result.val, match.metadata);
                    otherSets.forEach(set => {
                        const otherResult = set.find(r => r.path === result.path);
                        result.val[set.filterKey] = otherResult.value;
                        otherResult.metadata && Object.assign(result.val, otherResult.metadata);
                    });
                    results.push(result);
                }
                return results;
            }, []);
            stepsExecuted.filtered = true;
        }
        if (isWildcardPath || (indexScanPromises.length > 0 && tableScanFilters.length === 0)) {
            if (querySort.length === 0 || querySort.every(o => o.index)) {
                // No sorting, or all sorts are on indexed keys. We can use current index results
                stepsExecuted.preDataLoaded = true;
                if (!stepsExecuted.sorted && querySort.length > 0) {
                    sortMatches(indexedResults);
                }
                stepsExecuted.sorted = true;
                if (!stepsExecuted.skipped && query.skip > 0) {
                    indexedResults = query.take < 0
                        ? indexedResults.slice(0, -query.skip)
                        : indexedResults.slice(query.skip);
                }
                if (!stepsExecuted.taken && query.take !== 0) {
                    indexedResults = query.take < 0
                        ? indexedResults.slice(query.take)
                        : indexedResults.slice(0, query.take);
                }
                stepsExecuted.skipped = true;
                stepsExecuted.taken = true;
                if (!options.snapshots) {
                    return indexedResults;
                }
                // TODO: exclude already known key values, merge loaded with known
                const childOptions = { include: options.include, exclude: options.exclude, child_objects: options.child_objects };
                return loadResultsData(indexedResults, childOptions)
                    .then(results => {
                    stepsExecuted.dataLoaded = true;
                    return results;
                });
            }
            if (options.snapshots || !stepsExecuted.sorted) {
                const loadPartialResults = querySort.length > 0;
                const childOptions = loadPartialResults
                    ? { include: querySort.map(order => order.key) }
                    : { include: options.include, exclude: options.exclude, child_objects: options.child_objects };
                return loadResultsData(indexedResults, childOptions)
                    .then(results => {
                    if (querySort.length > 0) {
                        sortMatches(results);
                    }
                    stepsExecuted.sorted = true;
                    if (query.skip > 0) {
                        results = query.take < 0
                            ? results.slice(0, -query.skip)
                            : results.slice(query.skip);
                    }
                    if (query.take !== 0) {
                        results = query.take < 0
                            ? results.slice(query.take)
                            : results.slice(0, query.take);
                    }
                    stepsExecuted.skipped = true;
                    stepsExecuted.taken = true;
                    if (options.snapshots && loadPartialResults) {
                        // Get the rest
                        return loadResultsData(results, { include: options.include, exclude: options.exclude, child_objects: options.child_objects });
                    }
                    return results;
                });
            }
            else {
                // No need to take further actions, return what we have now
                return indexedResults;
            }
        }
        // If we get here, this is a query on a regular path (no wildcards) with additional non-indexed filters left,
        // we can get child records from a single parent. Merge index results by key
        let indexKeyFilter;
        if (indexedResults.length > 0) {
            indexKeyFilter = indexedResults.map(result => result.key);
        }
        let matches = [];
        let preliminaryStop = false;
        const loadPartialData = querySort.length > 0;
        const childOptions = loadPartialData
            ? { include: querySort.map(order => order.key) }
            : { include: options.include, exclude: options.exclude, child_objects: options.child_objects };
        const batch = {
            promises: [],
            add(promise) {
                this.promises.push(promise);
                if (this.promises.length >= 1000) {
                    return Promise.all(this.promises.splice(0)).then(_ => undefined);
                }
            },
        };
        try {
            await api.storage.getChildren(path, { keyFilter: indexKeyFilter, async: true }).next(child => {
                if (child.type !== node_value_types_1.VALUE_TYPES.OBJECT) {
                    return;
                }
                if (!child.address) {
                    // Currently only happens if object has no properties
                    // ({}, stored as a tiny_value in parent record). In that case,
                    // should it be matched in any query? -- That answer could be YES, when testing a property for !exists. Ignoring for now
                    return;
                }
                if (preliminaryStop) {
                    return false;
                }
                const matchNode = async () => {
                    const isMatch = await api.storage.matchNode(child.address.path, tableScanFilters);
                    if (!isMatch) {
                        return;
                    }
                    const childPath = child.address.path;
                    let result;
                    if (options.snapshots || querySort.length > 0) {
                        const node = await api.storage.getNode(childPath, childOptions);
                        result = { path: childPath, val: node.value };
                    }
                    else {
                        result = { path: childPath };
                    }
                    // If a maximumum number of results is requested, we can check if we can preliminary toss this result
                    // This keeps the memory space used limited to skip + take
                    // TODO: see if we can limit it to the max number of results returned (.take)
                    matches.push(result);
                    if (query.take !== 0 && matches.length > Math.abs(query.take) + query.skip) {
                        if (querySort.length > 0) {
                            // A query order has been set. If this value falls in between it can replace some other value
                            // matched before.
                            sortMatches(matches);
                        }
                        else if (query.take > 0) {
                            // No query order set, we can stop after 'take' + 'skip' results
                            preliminaryStop = true; // Flags the loop that no more nodes have to be checked
                        }
                        // const ascending = querySort.length === 0 || (query.take >= 0 ? querySort[0].ascending : !querySort[0].ascending);
                        // if (ascending) {
                        //     matches.pop(); // ascending sort order, toss last value
                        // }
                        // else {
                        //     matches.shift(); // descending, toss first value
                        // }
                        matches.pop(); // Always toss last value, results have been sorted already
                    }
                };
                const p = batch.add(matchNode());
                if (p instanceof Promise) {
                    // If this returns a promise, child iteration should pause automatically
                    return p;
                }
            });
        }
        catch (reason) {
            // No record?
            if (!(reason instanceof node_errors_1.NodeNotFoundError)) {
                api.storage.debug.warn(`Error getting child stream: ${reason}`);
            }
            return [];
        }
        // Done iterating all children, wait for all match promises to resolve
        await Promise.all(batch.promises);
        stepsExecuted.preDataLoaded = loadPartialData;
        stepsExecuted.dataLoaded = !loadPartialData;
        if (querySort.length > 0) {
            sortMatches(matches);
        }
        stepsExecuted.sorted = true;
        if (query.skip > 0) {
            matches = query.take < 0
                ? matches.slice(0, -query.skip)
                : matches.slice(query.skip);
        }
        stepsExecuted.skipped = true;
        if (query.take !== 0) {
            // (should not be necessary, basically it has already been done in the loop?)
            matches = query.take < 0
                ? matches.slice(query.take)
                : matches.slice(0, query.take);
        }
        stepsExecuted.taken = true;
        if (!stepsExecuted.dataLoaded) {
            matches = await loadResultsData(matches, { include: options.include, exclude: options.exclude, child_objects: options.child_objects });
            stepsExecuted.dataLoaded = true;
        }
        return matches;
    })
        .then(matches => {
        // Order the results
        if (!stepsExecuted.sorted && querySort.length > 0) {
            sortMatches(matches);
        }
        if (!options.snapshots) {
            // Remove the loaded values from the results, because they were not requested (and aren't complete, we only have data of the sorted keys)
            matches = matches.map(match => match.path);
        }
        // Limit result set
        if (!stepsExecuted.skipped && query.skip > 0) {
            matches = query.take < 0
                ? matches.slice(0, -query.skip)
                : matches.slice(query.skip);
        }
        if (!stepsExecuted.taken && query.take !== 0) {
            matches = query.take < 0
                ? matches.slice(query.take)
                : matches.slice(0, query.take);
        }
        // NEW: Check if this is a realtime query - future updates must send query result updates
        if (options.monitor === true) {
            options.monitor = { add: true, change: true, remove: true };
        }
        if (typeof options.monitor === 'object' && (options.monitor.add || options.monitor.change || options.monitor.remove)) {
            // TODO: Refactor this to use 'mutations' event instead of 'notify_child_*'
            const monitor = options.monitor;
            const matchedPaths = options.snapshots ? matches.map(match => match.path) : matches.slice();
            const ref = api.db.ref(path);
            const removeMatch = (path) => {
                const index = matchedPaths.indexOf(path);
                if (index < 0) {
                    return;
                }
                matchedPaths.splice(index, 1);
            };
            const addMatch = (path) => {
                if (matchedPaths.includes(path)) {
                    return;
                }
                matchedPaths.push(path);
            };
            const stopMonitoring = () => {
                api.unsubscribe(ref.path, 'child_changed', childChangedCallback);
                api.unsubscribe(ref.path, 'child_added', childAddedCallback);
                api.unsubscribe(ref.path, 'notify_child_removed', childRemovedCallback);
            };
            stop = async () => { stopMonitoring(); };
            const childChangedCallback = async (err, path, newValue, oldValue) => {
                const wasMatch = matchedPaths.includes(path);
                let keepMonitoring = true;
                // check if the properties we already have match filters,
                // and if we have to check additional properties
                const checkKeys = [];
                queryFilters.forEach(f => !checkKeys.includes(f.key) && checkKeys.push(f.key));
                const seenKeys = [];
                typeof oldValue === 'object' && Object.keys(oldValue).forEach(key => !seenKeys.includes(key) && seenKeys.push(key));
                typeof newValue === 'object' && Object.keys(newValue).forEach(key => !seenKeys.includes(key) && seenKeys.push(key));
                const missingKeys = [];
                let isMatch = seenKeys.every(key => {
                    if (!checkKeys.includes(key)) {
                        return true;
                    }
                    const filters = queryFilters.filter(filter => filter.key === key);
                    return filters.every(filter => {
                        var _a;
                        if (((_a = filter.index) === null || _a === void 0 ? void 0 : _a.textLocaleKey) && !seenKeys.includes(filter.index.textLocaleKey)) {
                            // Can't check because localeKey is missing
                            missingKeys.push(filter.index.textLocaleKey);
                            return true; // so we'll know if all others did match
                        }
                        else if (allowedTableScanOperators.includes(filter.op)) {
                            return api.storage.test(newValue[key], filter.op, filter.compare);
                        }
                        else {
                            // specific index filter
                            return filter.index.test(newValue, filter.op, filter.compare);
                        }
                    });
                });
                if (isMatch) {
                    // Matches all checked (updated) keys. BUT. Did we have all data needed?
                    // If it was a match before, other properties don't matter because they didn't change and won't
                    // change the current outcome
                    missingKeys.push(...checkKeys.filter(key => !seenKeys.includes(key)));
                    // let promise = Promise.resolve(true);
                    if (!wasMatch && missingKeys.length > 0) {
                        // We have to check if this node becomes a match
                        const filterQueue = queryFilters.filter(f => missingKeys.includes(f.key));
                        const simpleFilters = filterQueue.filter(f => allowedTableScanOperators.includes(f.op));
                        const indexFilters = filterQueue.filter(f => !allowedTableScanOperators.includes(f.op));
                        if (simpleFilters.length > 0) {
                            isMatch = await api.storage.matchNode(path, simpleFilters);
                        }
                        if (isMatch && indexFilters.length > 0) {
                            // TODO: ask index what keys to load (eg: FullTextIndex might need key specified by localeKey)
                            const keysToLoad = indexFilters.reduce((keys, filter) => {
                                if (!keys.includes(filter.key)) {
                                    keys.push(filter.key);
                                }
                                if (filter.index instanceof data_index_1.FullTextIndex && filter.index.config.localeKey && !keys.includes(filter.index.config.localeKey)) {
                                    keys.push(filter.index.config.localeKey);
                                }
                                return keys;
                            }, []);
                            const node = await api.storage.getNode(path, { include: keysToLoad });
                            if (node.value === null) {
                                return false;
                            }
                            isMatch = indexFilters.every(filter => filter.index.test(node.value, filter.op, filter.compare));
                        }
                    }
                }
                if (isMatch) {
                    if (!wasMatch) {
                        addMatch(path);
                    }
                    // load missing data if snapshots are requested
                    if (options.snapshots) {
                        const loadOptions = { include: options.include, exclude: options.exclude, child_objects: options.child_objects };
                        const node = await api.storage.getNode(path, loadOptions);
                        newValue = node.value;
                    }
                    if (wasMatch && monitor.change) {
                        keepMonitoring = options.eventHandler({ name: 'change', path, value: newValue }) !== false;
                    }
                    else if (!wasMatch && monitor.add) {
                        keepMonitoring = options.eventHandler({ name: 'add', path, value: newValue }) !== false;
                    }
                }
                else if (wasMatch) {
                    removeMatch(path);
                    if (monitor.remove) {
                        keepMonitoring = options.eventHandler({ name: 'remove', path: path, value: oldValue }) !== false;
                    }
                }
                if (keepMonitoring === false) {
                    stopMonitoring();
                }
            };
            const childAddedCallback = (err, path, newValue) => {
                const isMatch = queryFilters.every(filter => {
                    if (allowedTableScanOperators.includes(filter.op)) {
                        return api.storage.test(newValue[filter.key], filter.op, filter.compare);
                    }
                    else {
                        return filter.index.test(newValue, filter.op, filter.compare);
                    }
                });
                let keepMonitoring = true;
                if (isMatch) {
                    addMatch(path);
                    if (monitor.add) {
                        keepMonitoring = options.eventHandler({ name: 'add', path: path, value: options.snapshots ? newValue : null }) !== false;
                    }
                }
                if (keepMonitoring === false) {
                    stopMonitoring();
                }
            };
            const childRemovedCallback = (err, path, newValue, oldValue) => {
                let keepMonitoring = true;
                removeMatch(path);
                if (monitor.remove) {
                    keepMonitoring = options.eventHandler({ name: 'remove', path: path, value: options.snapshots ? oldValue : null }) !== false;
                }
                if (keepMonitoring === false) {
                    stopMonitoring();
                }
            };
            if (options.monitor.add || options.monitor.change || options.monitor.remove) {
                // Listen for child_changed events
                api.subscribe(ref.path, 'child_changed', childChangedCallback);
            }
            if (options.monitor.remove) {
                api.subscribe(ref.path, 'notify_child_removed', childRemovedCallback);
            }
            if (options.monitor.add) {
                api.subscribe(ref.path, 'child_added', childAddedCallback);
            }
        }
        return { results: matches, context, stop };
    });
}
exports.executeQuery = executeQuery;

},{"./async-task-batch":5,"./data-index":7,"./node-errors":11,"./node-value-types":14,"acebase-core":43}],18:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AceBaseStorage = exports.AceBaseStorageSettings = void 0;
const not_supported_1 = require("../../not-supported");
/**
 * Not supported in browser context
 */
class AceBaseStorageSettings extends not_supported_1.NotSupported {
}
exports.AceBaseStorageSettings = AceBaseStorageSettings;
/**
 * Not supported in browser context
 */
class AceBaseStorage extends not_supported_1.NotSupported {
}
exports.AceBaseStorage = AceBaseStorage;

},{"../../not-supported":15}],19:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createIndex = void 0;
const acebase_core_1 = require("acebase-core");
const data_index_1 = require("../data-index");
const promise_fs_1 = require("../promise-fs");
/**
* Creates an index on specified path and key(s)
* @param path location of objects to be indexed. Eg: "users" to index all children of the "users" node; or "chats/*\/members" to index all members of all chats
* @param key for now - one key to index. Once our B+tree implementation supports nested trees, we can allow multiple fields
*/
async function createIndex(context, path, key, options) {
    if (!context.storage.indexes.supported) {
        throw new Error('Indexes are not supported in current environment because it requires Node.js fs');
    }
    // path = path.replace(/\/\*$/, ""); // Remove optional trailing "/*"
    const { ipc, debug, indexes, storage } = context;
    const rebuild = options && options.rebuild === true;
    const indexType = (options && options.type) || 'normal';
    let includeKeys = (options && options.include) || [];
    if (typeof includeKeys === 'string') {
        includeKeys = [includeKeys];
    }
    const existingIndex = indexes.find(index => index.path === path && index.key === key && index.type === indexType
        && index.includeKeys.length === includeKeys.length
        && index.includeKeys.every((key, index) => includeKeys[index] === key));
    if (existingIndex && options.config) {
        // Additional index config params are not saved to index files, apply them to the in-memory index now
        existingIndex.config = options.config;
    }
    if (existingIndex && rebuild !== true) {
        debug.log(`Index on "/${path}/*/${key}" already exists`.colorize(acebase_core_1.ColorStyle.inverse));
        return existingIndex;
    }
    if (!ipc.isMaster) {
        // Pass create request to master
        const result = await ipc.sendRequest({ type: 'index.create', path, key, options });
        if (result.ok) {
            return storage.indexes.add(result.fileName);
        }
        throw new Error(result.reason);
    }
    await promise_fs_1.pfs.mkdir(`${storage.settings.path}/${storage.name}.acebase`).catch(err => {
        if (err.code !== 'EEXIST') {
            throw err;
        }
    });
    const index = existingIndex || (() => {
        const { include, caseSensitive, textLocale, textLocaleKey } = options;
        const indexOptions = { include, caseSensitive, textLocale, textLocaleKey };
        switch (indexType) {
            case 'array': return new data_index_1.ArrayIndex(storage, path, key, Object.assign({}, indexOptions));
            case 'fulltext': return new data_index_1.FullTextIndex(storage, path, key, Object.assign(Object.assign({}, indexOptions), { config: options.config }));
            case 'geo': return new data_index_1.GeoIndex(storage, path, key, Object.assign({}, indexOptions));
            default: return new data_index_1.DataIndex(storage, path, key, Object.assign({}, indexOptions));
        }
    })();
    if (!existingIndex) {
        indexes.push(index);
    }
    try {
        await index.build();
    }
    catch (err) {
        context.debug.error(`Index build on "/${path}/*/${key}" failed: ${err.message} (code: ${err.code})`.colorize(acebase_core_1.ColorStyle.red));
        if (!existingIndex) {
            // Only remove index if we added it. Build may have failed because someone tried creating the index more than once, or rebuilding it while it was building...
            indexes.splice(indexes.indexOf(index), 1);
        }
        throw err;
    }
    ipc.sendNotification({ type: 'index.created', fileName: index.fileName, path, key, options });
    return index;
}
exports.createIndex = createIndex;

},{"../data-index":7,"../promise-fs":16,"acebase-core":43}],20:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CustomStorageHelpers = void 0;
const acebase_core_1 = require("acebase-core");
/**
 * Helper functions to build custom storage classes with
 */
class CustomStorageHelpers {
    /**
     * Helper function that returns a SQL where clause for all children of given path
     * @param path Path to get children of
     * @param columnName Name of the Path column in your SQL db, default is 'path'
     * @returns Returns the SQL where clause
     */
    static ChildPathsSql(path, columnName = 'path') {
        const where = path === ''
            ? `${columnName} <> '' AND ${columnName} NOT LIKE '%/%'`
            : `(${columnName} LIKE '${path}/%' OR ${columnName} LIKE '${path}[%') AND ${columnName} NOT LIKE '${path}/%/%' AND ${columnName} NOT LIKE '${path}[%]/%' AND ${columnName} NOT LIKE '${path}[%][%'`;
        return where;
    }
    /**
     * Helper function that returns a regular expression to test if paths are children of the given path
     * @param path Path to test children of
     * @returns Returns regular expression to test paths with
     */
    static ChildPathsRegex(path) {
        return new RegExp(`^${path}(?:/[^/[]+|\\[[0-9]+\\])$`);
    }
    /**
     * Helper function that returns a SQL where clause for all descendants of given path
     * @param path Path to get descendants of
     * @param columnName Name of the Path column in your SQL db, default is 'path'
     * @returns Returns the SQL where clause
     */
    static DescendantPathsSql(path, columnName = 'path') {
        const where = path === ''
            ? `${columnName} <> ''`
            : `${columnName} LIKE '${path}/%' OR ${columnName} LIKE '${path}[%'`;
        return where;
    }
    /**
     * Helper function that returns a regular expression to test if paths are descendants of the given path
     * @param path Path to test descendants of
     * @returns Returns regular expression to test paths with
     */
    static DescendantPathsRegex(path) {
        return new RegExp(`^${path}(?:/[^/[]+|\\[[0-9]+\\])`);
    }
    /**
     * PathInfo helper class. Can be used to extract keys from a given path, get parent paths, check if a path is a child or descendant of other path etc
     * @example
     * var pathInfo = CustomStorage.PathInfo.get('my/path/to/data');
     * pathInfo.key === 'data';
     * pathInfo.parentPath === 'my/path/to';
     * pathInfo.pathKeys; // ['my','path','to','data'];
     * pathInfo.isChildOf('my/path/to') === true;
     * pathInfo.isDescendantOf('my/path') === true;
     * pathInfo.isParentOf('my/path/to/data/child') === true;
     * pathInfo.isAncestorOf('my/path/to/data/child/grandchild') === true;
     * pathInfo.childPath('child') === 'my/path/to/data/child';
     * pathInfo.childPath(0) === 'my/path/to/data[0]';
     */
    static get PathInfo() {
        return acebase_core_1.PathInfo;
    }
}
exports.CustomStorageHelpers = CustomStorageHelpers;

},{"acebase-core":43}],21:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CustomStorage = exports.CustomStorageNodeInfo = exports.CustomStorageNodeAddress = exports.CustomStorageSettings = exports.CustomStorageTransaction = exports.ICustomStorageNode = exports.ICustomStorageNodeMetaData = exports.CustomStorageHelpers = void 0;
const acebase_core_1 = require("acebase-core");
const { compareValues } = acebase_core_1.Utils;
const node_info_1 = require("../../node-info");
const node_lock_1 = require("../../node-lock");
const node_value_types_1 = require("../../node-value-types");
const node_errors_1 = require("../../node-errors");
const index_1 = require("../index");
const helpers_1 = require("./helpers");
const node_address_1 = require("../../node-address");
const assert_1 = require("../../assert");
var helpers_2 = require("./helpers");
Object.defineProperty(exports, "CustomStorageHelpers", { enumerable: true, get: function () { return helpers_2.CustomStorageHelpers; } });
/** Interface for metadata being stored for nodes */
class ICustomStorageNodeMetaData {
    constructor() {
        /** cuid (time sortable revision id). Nodes stored in the same operation share this id */
        this.revision = '';
        /** Number of revisions, starting with 1. Resets to 1 after deletion and recreation */
        this.revision_nr = 0;
        /** Creation date/time in ms since epoch UTC */
        this.created = 0;
        /** Last modification date/time in ms since epoch UTC */
        this.modified = 0;
        /** Type of the node's value. 1=object, 2=array, 3=number, 4=boolean, 5=string, 6=date, 7=reserved, 8=binary, 9=reference */
        this.type = 0;
    }
}
exports.ICustomStorageNodeMetaData = ICustomStorageNodeMetaData;
/** Interface for metadata combined with a stored value */
class ICustomStorageNode extends ICustomStorageNodeMetaData {
    constructor() {
        super();
        /** only Object, Array, large string and binary values. */
        this.value = null;
    }
}
exports.ICustomStorageNode = ICustomStorageNode;
/** Enables get/set/remove operations to be wrapped in transactions to improve performance and reliability. */
class CustomStorageTransaction {
    /**
     * @param target Which path the transaction is taking place on, and whether it is a read or read/write lock. If your storage backend does not support transactions, is synchronous, or if you are able to lock resources based on path: use storage.nodeLocker to ensure threadsafe transactions
     */
    constructor(target) {
        this.production = false; // dev mode by default
        this.target = {
            get originalPath() { return target.path; },
            path: target.path,
            get write() { return target.write; },
        };
        this.id = acebase_core_1.ID.generate();
    }
    /**
     * Returns the number of children stored in their own records. This implementation uses `childrenOf` to count, override if storage supports a quicker way.
     * Eg: For SQL databases, you can implement this with a single query like `SELECT count(*) FROM nodes WHERE ${CustomStorageHelpers.ChildPathsSql(path)}`
     * @param path
     * @returns Returns a promise that resolves with the number of children
     */
    async getChildCount(path) {
        let childCount = 0;
        await this.childrenOf(path, { metadata: false, value: false }, () => { childCount++; return false; });
        return childCount;
    }
    /**
     * NOT USED YET
     * Default implementation of getMultiple that executes .get for each given path. Override for custom logic
     * @param paths
     * @returns Returns promise with a Map of paths to nodes
     */
    async getMultiple(paths) {
        const map = new Map();
        await Promise.all(paths.map(path => this.get(path).then(val => map.set(path, val))));
        return map;
    }
    /**
     * NOT USED YET
     * Default implementation of setMultiple that executes .set for each given path. Override for custom logic
     * @param nodes
     */
    async setMultiple(nodes) {
        await Promise.all(nodes.map(({ path, node }) => this.set(path, node)));
    }
    /**
     * Default implementation of removeMultiple that executes .remove for each given path. Override for custom logic
     * @param paths
     */
    async removeMultiple(paths) {
        await Promise.all(paths.map(path => this.remove(path)));
    }
    /**
     * @returns {Promise<any>}
     */
    async commit() { throw new Error(`CustomStorageTransaction.rollback must be overridden by subclass`); }
    /**
     * Moves the transaction path to the parent node. If node locking is used, it will request a new lock
     * Used internally, must not be overridden unless custom locking mechanism is required
     * @param targetPath
     */
    async moveToParentPath(targetPath) {
        const currentPath = (this._lock && this._lock.path) || this.target.path;
        if (currentPath === targetPath) {
            return targetPath; // Already on the right path
        }
        const pathInfo = helpers_1.CustomStorageHelpers.PathInfo.get(targetPath);
        if (pathInfo.isParentOf(currentPath)) {
            if (this._lock) {
                this._lock = await this._lock.moveToParent();
            }
        }
        else {
            throw new Error(`Locking issue. Locked path "${this._lock.path}" is not a child/descendant of "${targetPath}"`);
        }
        this.target.path = targetPath;
        return targetPath;
    }
}
exports.CustomStorageTransaction = CustomStorageTransaction;
/**
 * Allows data to be stored in a custom storage backend of your choice! Simply provide a couple of functions
 * to get, set and remove data and you're done.
 */
class CustomStorageSettings extends index_1.StorageSettings {
    constructor(settings) {
        super(settings);
        /**
         * Whether default node locking should be used.
         * Set to false if your storage backend disallows multiple simultanious write transactions.
         * Set to true if your storage backend does not support transactions (eg LocalStorage) or allows
         * multiple simultanious write transactions (eg AceBase binary).
         * @default true
         */
        this.locking = true;
        if (typeof settings !== 'object') {
            throw new Error('settings missing');
        }
        if (typeof settings.ready !== 'function') {
            throw new Error(`ready must be a function`);
        }
        if (typeof settings.getTransaction !== 'function') {
            throw new Error(`getTransaction must be a function`);
        }
        this.name = settings.name;
        // this.info = `${this.name || 'CustomStorage'} realtime database`;
        this.locking = settings.locking !== false;
        if (this.locking) {
            this.lockTimeout = typeof settings.lockTimeout === 'number' ? settings.lockTimeout : 120;
        }
        this.ready = settings.ready;
        // Hijack getTransaction to add locking
        const useLocking = this.locking;
        const nodeLocker = useLocking ? new node_lock_1.NodeLocker(console, this.lockTimeout) : null;
        this.getTransaction = async ({ path, write }) => {
            // console.log(`${write ? 'WRITE' : 'READ'} transaction requested for path "${path}"`)
            const transaction = await settings.getTransaction({ path, write });
            (0, assert_1.assert)(typeof transaction.id === 'string', `transaction id not set`);
            // console.log(`Got transaction ${transaction.id} for ${write ? 'WRITE' : 'READ'} on path "${path}"`);
            // Hijack rollback and commit
            const rollback = transaction.rollback;
            const commit = transaction.commit;
            transaction.commit = async () => {
                // console.log(`COMMIT ${transaction.id} for ${write ? 'WRITE' : 'READ'} on path "${path}"`);
                const ret = await commit.call(transaction);
                // console.log(`COMMIT DONE ${transaction.id} for ${write ? 'WRITE' : 'READ'} on path "${path}"`);
                if (useLocking) {
                    await transaction._lock.release('commit');
                }
                return ret;
            };
            transaction.rollback = async (reason) => {
                // const reasonText = reason instanceof Error ? reason.message : reason.toString();
                // console.error(`ROLLBACK ${transaction.id} for ${write ? 'WRITE' : 'READ'} on path "${path}":`, reason);
                const ret = await rollback.call(transaction, reason);
                // console.log(`ROLLBACK DONE ${transaction.id} for ${write ? 'WRITE' : 'READ'} on path "${path}"`);
                if (useLocking) {
                    await transaction._lock.release('rollback');
                }
                return ret;
            };
            if (useLocking) {
                // Lock the path before continuing
                transaction._lock = await nodeLocker.lock(path, transaction.id, write, `${this.name}::getTransaction`);
            }
            return transaction;
        };
    }
}
exports.CustomStorageSettings = CustomStorageSettings;
class CustomStorageNodeAddress {
    constructor(containerPath) {
        this.path = containerPath;
    }
}
exports.CustomStorageNodeAddress = CustomStorageNodeAddress;
class CustomStorageNodeInfo extends node_info_1.NodeInfo {
    constructor(info) {
        super(info);
        this.revision = info.revision;
        this.revision_nr = info.revision_nr;
        this.created = info.created;
        this.modified = info.modified;
    }
}
exports.CustomStorageNodeInfo = CustomStorageNodeInfo;
class CustomStorage extends index_1.Storage {
    constructor(dbname, settings, env) {
        super(dbname, settings, env);
        this._customImplementation = settings;
        this._init();
    }
    async _init() {
        this.debug.log(`Database "${this.name}" details:`.colorize(acebase_core_1.ColorStyle.dim));
        this.debug.log(`- Type: CustomStorage`.colorize(acebase_core_1.ColorStyle.dim));
        this.debug.log(`- Path: ${this.settings.path}`.colorize(acebase_core_1.ColorStyle.dim));
        this.debug.log(`- Max inline value size: ${this.settings.maxInlineValueSize}`.colorize(acebase_core_1.ColorStyle.dim));
        this.debug.log(`- Autoremove undefined props: ${this.settings.removeVoidProperties}`.colorize(acebase_core_1.ColorStyle.dim));
        // Create root node if it's not there yet
        await this._customImplementation.ready();
        const transaction = await this._customImplementation.getTransaction({ path: '', write: true });
        const info = await this.getNodeInfo('', { transaction });
        if (!info.exists) {
            await this._writeNode('', {}, { transaction });
        }
        await transaction.commit();
        if (this.indexes.supported) {
            await this.indexes.load();
        }
        this.emit('ready');
    }
    throwImplementationError(message) {
        throw new Error(`CustomStorage "${this._customImplementation.name}" ${message}`);
    }
    _storeNode(path, node, options) {
        // serialize the value to store
        const getTypedChildValue = (val) => {
            if (val === null) {
                throw new Error(`Not allowed to store null values. remove the property`);
            }
            else if (['string', 'number', 'boolean'].includes(typeof val)) {
                return val;
            }
            else if (val instanceof Date) {
                return { type: node_value_types_1.VALUE_TYPES.DATETIME, value: val.getTime() };
            }
            else if (val instanceof acebase_core_1.PathReference) {
                return { type: node_value_types_1.VALUE_TYPES.REFERENCE, value: val.path };
            }
            else if (val instanceof ArrayBuffer) {
                return { type: node_value_types_1.VALUE_TYPES.BINARY, value: acebase_core_1.ascii85.encode(val) };
            }
            else if (typeof val === 'object') {
                (0, assert_1.assert)(Object.keys(val).length === 0, 'child object stored in parent can only be empty');
                return val;
            }
        };
        const unprocessed = `Caller should have pre-processed the value by converting it to a string`;
        if (node.type === node_value_types_1.VALUE_TYPES.ARRAY && node.value instanceof Array) {
            // Convert array to object with numeric properties
            // NOTE: caller should have done this already
            console.warn(`Unprocessed array. ${unprocessed}`);
            const obj = {};
            for (let i = 0; i < node.value.length; i++) {
                obj[i] = node.value[i];
            }
            node.value = obj;
        }
        if (node.type === node_value_types_1.VALUE_TYPES.BINARY && typeof node.value !== 'string') {
            console.warn(`Unprocessed binary value. ${unprocessed}`);
            node.value = acebase_core_1.ascii85.encode(node.value);
        }
        if (node.type === node_value_types_1.VALUE_TYPES.REFERENCE && node.value instanceof acebase_core_1.PathReference) {
            console.warn(`Unprocessed path reference. ${unprocessed}`);
            node.value = node.value.path;
        }
        if ([node_value_types_1.VALUE_TYPES.OBJECT, node_value_types_1.VALUE_TYPES.ARRAY].includes(node.type)) {
            const original = node.value;
            node.value = {};
            // If original is an array, it'll automatically be converted to an object now
            Object.keys(original).forEach(key => {
                node.value[key] = getTypedChildValue(original[key]);
            });
        }
        return options.transaction.set(path, node);
    }
    _processReadNodeValue(node) {
        const getTypedChildValue = (val) => {
            // Typed value stored in parent record
            if (val.type === node_value_types_1.VALUE_TYPES.BINARY) {
                // binary stored in a parent record as a string
                return acebase_core_1.ascii85.decode(val.value);
            }
            else if (val.type === node_value_types_1.VALUE_TYPES.DATETIME) {
                // Date value stored as number
                return new Date(val.value);
            }
            else if (val.type === node_value_types_1.VALUE_TYPES.REFERENCE) {
                // Path reference stored as string
                return new acebase_core_1.PathReference(val.value);
            }
            else {
                throw new Error(`Unhandled child value type ${val.type}`);
            }
        };
        switch (node.type) {
            case node_value_types_1.VALUE_TYPES.ARRAY:
            case node_value_types_1.VALUE_TYPES.OBJECT: {
                // check if any value needs to be converted
                // NOTE: Arrays are stored with numeric properties
                const obj = node.value;
                Object.keys(obj).forEach(key => {
                    const item = obj[key];
                    if (typeof item === 'object' && 'type' in item) {
                        obj[key] = getTypedChildValue(item);
                    }
                });
                node.value = obj;
                break;
            }
            case node_value_types_1.VALUE_TYPES.BINARY: {
                node.value = acebase_core_1.ascii85.decode(node.value);
                break;
            }
            case node_value_types_1.VALUE_TYPES.REFERENCE: {
                node.value = new acebase_core_1.PathReference(node.value);
                break;
            }
            case node_value_types_1.VALUE_TYPES.STRING: {
                // No action needed
                // node.value = node.value;
                break;
            }
            default:
                throw new Error(`Invalid standalone record value type`); // should never happen
        }
    }
    async _readNode(path, options) {
        // deserialize a stored value (always an object with "type", "value", "revision", "revision_nr", "created", "modified")
        const node = await options.transaction.get(path);
        if (node === null) {
            return null;
        }
        if (typeof node !== 'object') {
            this.throwImplementationError(`transaction.get must return an ICustomStorageNode object. Use JSON.parse if your set function stored it as a string`);
        }
        this._processReadNodeValue(node);
        return node;
    }
    _getTypeFromStoredValue(val) {
        let type;
        if (typeof val === 'string') {
            type = node_value_types_1.VALUE_TYPES.STRING;
        }
        else if (typeof val === 'number') {
            type = node_value_types_1.VALUE_TYPES.NUMBER;
        }
        else if (typeof val === 'boolean') {
            type = node_value_types_1.VALUE_TYPES.BOOLEAN;
        }
        else if (val instanceof Array) {
            type = node_value_types_1.VALUE_TYPES.ARRAY;
        }
        else if (typeof val === 'object') {
            if ('type' in val) {
                const serialized = val;
                type = serialized.type;
                val = serialized.value;
                if (type === node_value_types_1.VALUE_TYPES.DATETIME) {
                    val = new Date(val);
                }
                else if (type === node_value_types_1.VALUE_TYPES.REFERENCE) {
                    val = new acebase_core_1.PathReference(val);
                }
            }
            else {
                type = node_value_types_1.VALUE_TYPES.OBJECT;
            }
        }
        else {
            throw new Error(`Unknown value type`);
        }
        return { type, value: val };
    }
    /**
     * Creates or updates a node in its own record. DOES NOT CHECK if path exists in parent node, or if parent paths exist! Calling code needs to do this
     */
    async _writeNode(path, value, options) {
        if (!options.merge && this.valueFitsInline(value) && path !== '') {
            throw new Error(`invalid value to store in its own node`);
        }
        else if (path === '' && (typeof value !== 'object' || value instanceof Array)) {
            throw new Error(`Invalid root node value. Must be an object`);
        }
        // Check if the value for this node changed, to prevent recursive calls to
        // perform unnecessary writes that do not change any data
        if (typeof options.diff === 'undefined' && typeof options.currentValue !== 'undefined') {
            const diff = compareValues(options.currentValue, value);
            if (options.merge && typeof diff === 'object') {
                diff.removed = diff.removed.filter(key => value[key] === null); // Only keep "removed" items that are really being removed by setting to null
            }
            options.diff = diff;
        }
        if (options.diff === 'identical') {
            return; // Done!
        }
        const transaction = options.transaction;
        // Get info about current node at path
        const currentRow = options.currentValue === null
            ? null // No need to load info if currentValue is null (we already know it doesn't exist)
            : await this._readNode(path, { transaction });
        if (options.merge && currentRow) {
            if (currentRow.type === node_value_types_1.VALUE_TYPES.ARRAY && !(value instanceof Array) && typeof value === 'object' && Object.keys(value).some(key => isNaN(parseInt(key)))) {
                throw new Error(`Cannot merge existing array of path "${path}" with an object`);
            }
            if (value instanceof Array && currentRow.type !== node_value_types_1.VALUE_TYPES.ARRAY) {
                throw new Error(`Cannot merge existing object of path "${path}" with an array`);
            }
        }
        const revision = options.revision || acebase_core_1.ID.generate();
        const mainNode = {
            type: currentRow && currentRow.type === node_value_types_1.VALUE_TYPES.ARRAY ? node_value_types_1.VALUE_TYPES.ARRAY : node_value_types_1.VALUE_TYPES.OBJECT,
            value: {},
        };
        const childNodeValues = {};
        if (value instanceof Array) {
            mainNode.type = node_value_types_1.VALUE_TYPES.ARRAY;
            // Convert array to object with numeric properties
            const obj = {};
            for (let i = 0; i < value.length; i++) {
                obj[i] = value[i];
            }
            value = obj;
        }
        else if (value instanceof acebase_core_1.PathReference) {
            mainNode.type = node_value_types_1.VALUE_TYPES.REFERENCE;
            mainNode.value = value.path;
        }
        else if (value instanceof ArrayBuffer) {
            mainNode.type = node_value_types_1.VALUE_TYPES.BINARY;
            mainNode.value = acebase_core_1.ascii85.encode(value);
        }
        else if (typeof value === 'string') {
            mainNode.type = node_value_types_1.VALUE_TYPES.STRING;
            mainNode.value = value;
        }
        const currentIsObjectOrArray = currentRow ? [node_value_types_1.VALUE_TYPES.OBJECT, node_value_types_1.VALUE_TYPES.ARRAY].includes(currentRow.type) : false;
        const newIsObjectOrArray = [node_value_types_1.VALUE_TYPES.OBJECT, node_value_types_1.VALUE_TYPES.ARRAY].includes(mainNode.type);
        const children = {
            current: [],
            new: [],
        };
        let currentObject = null;
        if (currentIsObjectOrArray) {
            currentObject = currentRow.value;
            children.current = Object.keys(currentObject);
            // if (currentObject instanceof Array) { // ALWAYS FALSE BECAUSE THEY ARE STORED AS OBJECTS WITH NUMERIC PROPERTIES
            //     // Convert array to object with numeric properties
            //     const obj = {};
            //     for (let i = 0; i < value.length; i++) {
            //         obj[i] = value[i];
            //     }
            //     currentObject = obj;
            // }
            if (newIsObjectOrArray) {
                mainNode.value = currentObject;
            }
        }
        if (newIsObjectOrArray) {
            // Object or array. Determine which properties can be stored in the main node,
            // and which should be stored in their own nodes
            if (!options.merge) {
                // Check which keys are present in the old object, but not in newly given object
                Object.keys(mainNode.value).forEach(key => {
                    if (!(key in value)) {
                        // Property that was in old object, is not in new value -> set to null to mark deletion!
                        value[key] = null;
                    }
                });
            }
            Object.keys(value).forEach(key => {
                const val = value[key];
                delete mainNode.value[key]; // key is being overwritten, moved from inline to dedicated, or deleted. TODO: check if this needs to be done SQLite & MSSQL implementations too
                if (val === null) { //  || typeof val === 'undefined'
                    // This key is being removed
                    return;
                }
                else if (typeof val === 'undefined') {
                    if (this.settings.removeVoidProperties === true) {
                        delete value[key]; // Kill the property in the passed object as well, to prevent differences in stored and working values
                        return;
                    }
                    else {
                        throw new Error(`Property "${key}" has invalid value. Cannot store undefined values. Set removeVoidProperties option to true to automatically remove undefined properties`);
                    }
                }
                // Where to store this value?
                if (this.valueFitsInline(val)) {
                    // Store in main node
                    mainNode.value[key] = val;
                }
                else {
                    // Store in child node
                    childNodeValues[key] = val;
                }
            });
        }
        // Insert or update node
        const isArray = mainNode.type === node_value_types_1.VALUE_TYPES.ARRAY;
        if (currentRow) {
            // update
            this.debug.log(`Node "/${path}" is being ${options.merge ? 'updated' : 'overwritten'}`.colorize(acebase_core_1.ColorStyle.cyan));
            // If existing is an array or object, we have to find out which children are affected
            if (currentIsObjectOrArray || newIsObjectOrArray) {
                // Get current child nodes in dedicated child records
                const pathInfo = acebase_core_1.PathInfo.get(path);
                const keys = [];
                let checkExecuted = false;
                const includeChildCheck = (childPath) => {
                    checkExecuted = true;
                    if (!transaction.production && !pathInfo.isParentOf(childPath)) {
                        // Double check failed
                        this.throwImplementationError(`"${childPath}" is not a child of "${path}" - childrenOf must only check and return paths that are children`);
                    }
                    return true;
                };
                const addChildPath = (childPath) => {
                    if (!checkExecuted) {
                        this.throwImplementationError(`childrenOf did not call checkCallback before addCallback`);
                    }
                    const key = acebase_core_1.PathInfo.get(childPath).key;
                    keys.push(key.toString()); // .toString to make sure all keys are compared as strings
                    return true; // Keep streaming
                };
                await transaction.childrenOf(path, { metadata: false, value: false }, includeChildCheck, addChildPath);
                children.current = children.current.concat(keys);
                if (newIsObjectOrArray) {
                    if (options && options.merge) {
                        children.new = children.current.slice();
                    }
                    Object.keys(value).forEach(key => {
                        if (!children.new.includes(key)) {
                            children.new.push(key);
                        }
                    });
                }
                const changes = {
                    insert: children.new.filter(key => !children.current.includes(key)),
                    update: [],
                    delete: options && options.merge ? Object.keys(value).filter(key => value[key] === null) : children.current.filter(key => !children.new.includes(key)),
                };
                changes.update = children.new.filter(key => children.current.includes(key) && !changes.delete.includes(key));
                if (isArray && options.merge && (changes.insert.length > 0 || changes.delete.length > 0)) {
                    // deletes or inserts of individual array entries are not allowed, unless it is the last entry:
                    // - deletes would cause the paths of following items to change, which is unwanted because the actual data does not change,
                    // eg: removing index 3 on array of size 10 causes entries with index 4 to 9 to 'move' to indexes 3 to 8
                    // - inserts might introduce gaps in indexes,
                    // eg: adding to index 7 on an array of size 3 causes entries with indexes 3 to 6 to go 'missing'
                    const newArrayKeys = changes.update.concat(changes.insert);
                    const isExhaustive = newArrayKeys.every((k, index, arr) => arr.includes(index.toString()));
                    if (!isExhaustive) {
                        throw new Error(`Elements cannot be inserted beyond, or removed before the end of an array. Rewrite the whole array at path "${path}" or change your schema to use an object collection instead`);
                    }
                }
                // (over)write all child nodes that must be stored in their own record
                const writePromises = Object.keys(childNodeValues).map(key => {
                    const keyOrIndex = isArray ? parseInt(key) : key;
                    const childDiff = typeof options.diff === 'object' ? options.diff.forChild(keyOrIndex) : undefined;
                    if (childDiff === 'identical') {
                        // console.warn(`Skipping _writeNode recursion for child "${keyOrIndex}"`);
                        return; // Skip
                    }
                    const childPath = pathInfo.childPath(keyOrIndex); // PathInfo.getChildPath(path, key);
                    const childValue = childNodeValues[keyOrIndex];
                    // Pass current child value to _writeNode
                    const currentChildValue = typeof options.currentValue === 'undefined' // Fixing issue #20
                        ? undefined
                        : options.currentValue !== null && typeof options.currentValue === 'object' && keyOrIndex in options.currentValue
                            ? options.currentValue[keyOrIndex]
                            : null;
                    return this._writeNode(childPath, childValue, { transaction, revision, merge: false, currentValue: currentChildValue, diff: childDiff });
                });
                // Delete all child nodes that were stored in their own record, but are being removed
                // Also delete nodes that are being moved from a dedicated record to inline
                const movingNodes = newIsObjectOrArray ? keys.filter(key => key in mainNode.value) : []; // moving from dedicated to inline value
                const deleteDedicatedKeys = changes.delete.concat(movingNodes);
                const deletePromises = deleteDedicatedKeys.map(key => {
                    const keyOrIndex = isArray ? parseInt(key) : key;
                    const childPath = pathInfo.childPath(keyOrIndex);
                    return this._deleteNode(childPath, { transaction });
                });
                const promises = writePromises.concat(deletePromises);
                await Promise.all(promises);
            }
            // Update main node
            // TODO: Check if revision should change?
            const p = this._storeNode(path, {
                type: mainNode.type,
                value: mainNode.value,
                revision: currentRow.revision,
                revision_nr: currentRow.revision_nr + 1,
                created: currentRow.created,
                modified: Date.now(),
            }, {
                transaction,
            });
            if (p instanceof Promise) {
                return await p;
            }
        }
        else {
            // Current node does not exist, create it and any child nodes
            // write all child nodes that must be stored in their own record
            this.debug.log(`Node "/${path}" is being created`.colorize(acebase_core_1.ColorStyle.cyan));
            if (isArray) {
                // Check if the array is "intact" (all entries have an index from 0 to the end with no gaps)
                const arrayKeys = Object.keys(mainNode.value).concat(Object.keys(childNodeValues));
                const isExhaustive = arrayKeys.every((k, index, arr) => arr.includes(index.toString()));
                if (!isExhaustive) {
                    throw new Error(`Cannot store arrays with missing entries`);
                }
            }
            const promises = Object.keys(childNodeValues).map(key => {
                const keyOrIndex = isArray ? parseInt(key) : key;
                const childPath = acebase_core_1.PathInfo.getChildPath(path, keyOrIndex);
                const childValue = childNodeValues[keyOrIndex];
                return this._writeNode(childPath, childValue, { transaction, revision, merge: false, currentValue: null });
            });
            // Create current node
            const p = this._storeNode(path, {
                type: mainNode.type,
                value: mainNode.value,
                revision,
                revision_nr: 1,
                created: Date.now(),
                modified: Date.now(),
            }, {
                transaction,
            });
            if (p instanceof Promise) {
                promises.push(p);
            }
            await Promise.all(promises);
        }
    }
    /**
     * Deletes (dedicated) node and all subnodes without checking for existence. Use with care - all removed nodes will lose their revision stats! DOES NOT REMOVE INLINE CHILD NODES!
     */
    async _deleteNode(path, options) {
        const pathInfo = acebase_core_1.PathInfo.get(path);
        this.debug.log(`Node "/${path}" is being deleted`.colorize(acebase_core_1.ColorStyle.cyan));
        const deletePaths = [path];
        let checkExecuted = false;
        const includeDescendantCheck = (descPath) => {
            checkExecuted = true;
            if (!transaction.production && !pathInfo.isAncestorOf(descPath)) {
                // Double check failed
                this.throwImplementationError(`"${descPath}" is not a descendant of "${path}" - descendantsOf must only check and return paths that are descendants`);
            }
            return true;
        };
        const addDescendant = (descPath) => {
            if (!checkExecuted) {
                this.throwImplementationError(`descendantsOf did not call checkCallback before addCallback`);
            }
            deletePaths.push(descPath);
            return true;
        };
        const transaction = options.transaction;
        await transaction.descendantsOf(path, { metadata: false, value: false }, includeDescendantCheck, addDescendant);
        this.debug.log(`Nodes ${deletePaths.map(p => `"/${p}"`).join(',')} are being deleted`.colorize(acebase_core_1.ColorStyle.cyan));
        return transaction.removeMultiple(deletePaths);
    }
    /**
     * Enumerates all children of a given Node for reflection purposes
     */
    getChildren(path, options = {}) {
        let callback;
        const generator = {
            /**
             *
             * @param valueCallback callback function to run for each child. Return false to stop iterating
             * @returns returns a promise that resolves with a boolean indicating if all children have been enumerated, or was canceled by the valueCallback function
             */
            next(valueCallback) {
                callback = valueCallback;
                return start();
            },
        };
        const start = async () => {
            const transaction = options.transaction || await this._customImplementation.getTransaction({ path, write: false });
            try {
                let canceled = false;
                await (async () => {
                    const node = await this._readNode(path, { transaction });
                    if (!node) {
                        throw new node_errors_1.NodeNotFoundError(`Node "/${path}" does not exist`);
                    }
                    if (![node_value_types_1.VALUE_TYPES.OBJECT, node_value_types_1.VALUE_TYPES.ARRAY].includes(node.type)) {
                        // No children
                        return;
                    }
                    const isArray = node.type === node_value_types_1.VALUE_TYPES.ARRAY;
                    const value = node.value;
                    let keys = Object.keys(value).map(key => isArray ? parseInt(key) : key);
                    if (options.keyFilter) {
                        keys = keys.filter(key => options.keyFilter.includes(key));
                    }
                    const pathInfo = acebase_core_1.PathInfo.get(path);
                    keys.length > 0 && keys.every(key => {
                        const child = this._getTypeFromStoredValue(value[key]);
                        const info = new CustomStorageNodeInfo({
                            path: pathInfo.childPath(key),
                            key: isArray ? null : key,
                            index: isArray ? key : null,
                            type: child.type,
                            address: null,
                            exists: true,
                            value: child.value,
                            revision: node.revision,
                            revision_nr: node.revision_nr,
                            created: new Date(node.created),
                            modified: new Date(node.modified),
                        });
                        canceled = callback(info) === false;
                        return !canceled; // stop .every loop if canceled
                    });
                    if (canceled) {
                        return;
                    }
                    // Go on... get other children
                    let checkExecuted = false;
                    const includeChildCheck = (childPath) => {
                        checkExecuted = true;
                        if (!transaction.production && !pathInfo.isParentOf(childPath)) {
                            // Double check failed
                            this.throwImplementationError(`"${childPath}" is not a child of "${path}" - childrenOf must only check and return paths that are children`);
                        }
                        if (options.keyFilter) {
                            const key = acebase_core_1.PathInfo.get(childPath).key;
                            return options.keyFilter.includes(key);
                        }
                        return true;
                    };
                    const addChildNode = (childPath, node) => {
                        if (!checkExecuted) {
                            this.throwImplementationError(`childrenOf did not call checkCallback before addCallback`);
                        }
                        const key = acebase_core_1.PathInfo.get(childPath).key;
                        const info = new CustomStorageNodeInfo({
                            path: childPath,
                            type: node.type,
                            key: isArray ? null : key,
                            index: isArray ? key : null,
                            address: new node_address_1.NodeAddress(childPath),
                            exists: true,
                            value: null,
                            revision: node.revision,
                            revision_nr: node.revision_nr,
                            created: new Date(node.created),
                            modified: new Date(node.modified),
                        });
                        canceled = callback(info) === false;
                        return !canceled;
                    };
                    await transaction.childrenOf(path, { metadata: true, value: false }, includeChildCheck, addChildNode);
                })();
                if (!options.transaction) {
                    // transaction was created by us, commit
                    await transaction.commit();
                }
                return canceled;
            }
            catch (err) {
                if (!options.transaction) {
                    // transaction was created by us, rollback
                    await transaction.rollback(err);
                }
                throw err;
            }
        }; // start()
        return generator;
    }
    async getNode(path, options) {
        // path = path.replace(/'/g, '');  // prevent sql injection, remove single quotes
        options = options || {};
        const transaction = options.transaction || await this._customImplementation.getTransaction({ path, write: false });
        try {
            const node = await (async () => {
                // Get path, path/* and path[*
                const filtered = (options.include && options.include.length > 0) || (options.exclude && options.exclude.length > 0) || options.child_objects === false;
                const pathInfo = acebase_core_1.PathInfo.get(path);
                const targetNode = await this._readNode(path, { transaction });
                if (!targetNode) {
                    // Lookup parent node
                    if (path === '') {
                        return { value: null };
                    } // path is root. There is no parent.
                    const lockPath = await transaction.moveToParentPath(pathInfo.parentPath);
                    (0, assert_1.assert)(lockPath === pathInfo.parentPath, `transaction.moveToParentPath() did not move to the right parent path of "${path}"`);
                    const parentNode = await this._readNode(pathInfo.parentPath, { transaction });
                    if (parentNode && [node_value_types_1.VALUE_TYPES.OBJECT, node_value_types_1.VALUE_TYPES.ARRAY].includes(parentNode.type) && pathInfo.key in parentNode.value) {
                        const childValueInfo = this._getTypeFromStoredValue(parentNode.value[pathInfo.key]);
                        return {
                            revision: parentNode.revision,
                            revision_nr: parentNode.revision_nr,
                            created: parentNode.created,
                            modified: parentNode.modified,
                            type: childValueInfo.type,
                            value: childValueInfo.value,
                        };
                    }
                    return { value: null };
                }
                const isArray = targetNode.type === node_value_types_1.VALUE_TYPES.ARRAY;
                /**
                 * Convert include & exclude filters to PathInfo instances for easier handling
                 */
                const convertFilterArray = (arr) => {
                    const isNumber = (key) => /^[0-9]+$/.test(key);
                    return arr.map(path => acebase_core_1.PathInfo.get(isArray && isNumber(path) ? `[${path}]` : path));
                };
                const includeFilter = options.include ? convertFilterArray(options.include) : [];
                const excludeFilter = options.exclude ? convertFilterArray(options.exclude) : [];
                /**
                 * Apply include filters to prevent unwanted properties stored inline to be added.
                 *
                 * Removes properties that are not on the trail of any include filter, but were loaded because they are
                 * stored inline in the parent node.
                 *
                 * Example:
                 * data of `"users/someuser/posts/post1"`: `{ title: 'My first post', posted: (date), history: {} }`
                 * code: `db.ref('users/someuser').get({ include: ['posts/*\/title'] })`
                 * descPath: `"users/someuser/posts/post1"`,
                 * trailKeys: `["posts", "post1"]`,
                 * includeFilter[0]: `["posts", "*", "title"]`
                 * properties `posted` and `history` must be removed from the object
                 */
                const applyFiltersOnInlineData = (descPath, node) => {
                    if ([node_value_types_1.VALUE_TYPES.OBJECT, node_value_types_1.VALUE_TYPES.ARRAY].includes(node.type) && includeFilter.length > 0) {
                        const trailKeys = acebase_core_1.PathInfo.getPathKeys(descPath).slice(pathInfo.keys.length);
                        const checkPathInfo = new acebase_core_1.PathInfo(trailKeys);
                        const remove = [];
                        const includes = includeFilter.filter(info => info.isDescendantOf(checkPathInfo));
                        if (includes.length > 0) {
                            const isArray = node.type === node_value_types_1.VALUE_TYPES.ARRAY;
                            remove.push(...Object.keys(node.value).map(key => isArray ? +key : key)); // Mark all at first
                            for (const info of includes) {
                                const targetProp = info.keys[trailKeys.length];
                                if (typeof targetProp === 'string' && (targetProp === '*' || targetProp.startsWith('$'))) {
                                    remove.splice(0);
                                    break;
                                }
                                const index = remove.indexOf(targetProp);
                                index >= 0 && remove.splice(index, 1);
                            }
                        }
                        const hasIncludeOnChild = includeFilter.some(info => info.isChildOf(checkPathInfo));
                        const hasExcludeOnChild = excludeFilter.some(info => info.isChildOf(checkPathInfo));
                        if (hasExcludeOnChild && !hasIncludeOnChild) {
                            // do not remove children that are NOT in direct exclude filters (which includes them again)
                            const excludes = excludeFilter.filter(info => info.isChildOf(checkPathInfo));
                            for (let i = 0; i < remove.length; i++) {
                                if (!excludes.find(info => info.equals(remove[i]))) {
                                    remove.splice(i, 1);
                                    i--;
                                }
                            }
                        }
                        // remove.length > 0 && this.debug.log(`Remove properties:`, remove);
                        for (const key of remove) {
                            delete node.value[key];
                        }
                    }
                };
                applyFiltersOnInlineData(path, targetNode);
                let checkExecuted = false;
                const includeDescendantCheck = (descPath, metadata) => {
                    checkExecuted = true;
                    if (!transaction.production && !pathInfo.isAncestorOf(descPath)) {
                        // Double check failed
                        this.throwImplementationError(`"${descPath}" is not a descendant of "${path}" - descendantsOf must only check and return paths that are descendants`);
                    }
                    if (!filtered) {
                        return true;
                    }
                    // Apply include & exclude filters
                    const descPathKeys = acebase_core_1.PathInfo.getPathKeys(descPath);
                    const trailKeys = descPathKeys.slice(pathInfo.keys.length);
                    const checkPathInfo = new acebase_core_1.PathInfo(trailKeys);
                    let include = (includeFilter.length > 0
                        ? includeFilter.some(info => checkPathInfo.isOnTrailOf(info))
                        : true)
                        && (excludeFilter.length > 0
                            ? !excludeFilter.some(info => info.equals(checkPathInfo) || info.isAncestorOf(checkPathInfo))
                            : true);
                    // Apply child_objects filter. If metadata is not loaded, we can only skip deeper descendants here - any child object that does get through will be ignored by addDescendant
                    if (include
                        && options.child_objects === false
                        && (pathInfo.isParentOf(descPath) && [node_value_types_1.VALUE_TYPES.OBJECT, node_value_types_1.VALUE_TYPES.ARRAY].includes(metadata ? metadata.type : -1)
                            || acebase_core_1.PathInfo.getPathKeys(descPath).length > pathInfo.pathKeys.length + 1)) {
                        include = false;
                    }
                    return include;
                };
                const descRows = [];
                const addDescendant = (descPath, node) => {
                    // console.warn(`Adding descendant "${descPath}"`);
                    if (!checkExecuted) {
                        this.throwImplementationError('descendantsOf did not call checkCallback before addCallback');
                    }
                    if (options.child_objects === false && [node_value_types_1.VALUE_TYPES.OBJECT, node_value_types_1.VALUE_TYPES.ARRAY].includes(node.type)) {
                        // child objects are filtered out, but this one got through because includeDescendantCheck did not have access to its metadata,
                        // which is ok because doing that might drastically improve performance in client code. Skip it now.
                        return true;
                    }
                    // Apply include filters to prevent unwanted properties stored inline to be added
                    applyFiltersOnInlineData(descPath, node);
                    // Process the value
                    this._processReadNodeValue(node);
                    // Add node
                    const row = node;
                    row.path = descPath;
                    descRows.push(row);
                    return true; // Keep streaming
                };
                await transaction.descendantsOf(path, { metadata: true, value: true }, includeDescendantCheck, addDescendant);
                this.debug.log(`Read node "/${path}" and ${filtered ? '(filtered) ' : ''}descendants from ${descRows.length + 1} records`.colorize(acebase_core_1.ColorStyle.magenta));
                const result = targetNode;
                const objectToArray = (obj) => {
                    // Convert object value to array
                    const arr = [];
                    Object.keys(obj).forEach(key => {
                        const index = parseInt(key);
                        arr[index] = obj[index];
                    });
                    return arr;
                };
                if (targetNode.type === node_value_types_1.VALUE_TYPES.ARRAY) {
                    result.value = objectToArray(result.value);
                }
                if (targetNode.type === node_value_types_1.VALUE_TYPES.OBJECT || targetNode.type === node_value_types_1.VALUE_TYPES.ARRAY) {
                    // target node is an object or array
                    // merge with other found (child) nodes
                    const targetPathKeys = acebase_core_1.PathInfo.getPathKeys(path);
                    const value = targetNode.value;
                    for (let i = 0; i < descRows.length; i++) {
                        const otherNode = descRows[i];
                        const pathKeys = acebase_core_1.PathInfo.getPathKeys(otherNode.path);
                        const trailKeys = pathKeys.slice(targetPathKeys.length);
                        let parent = value;
                        for (let j = 0; j < trailKeys.length; j++) {
                            (0, assert_1.assert)(typeof parent === 'object', 'parent must be an object/array to have children!!');
                            const key = trailKeys[j];
                            const isLast = j === trailKeys.length - 1;
                            const nodeType = isLast
                                ? otherNode.type
                                : typeof trailKeys[j + 1] === 'number'
                                    ? node_value_types_1.VALUE_TYPES.ARRAY
                                    : node_value_types_1.VALUE_TYPES.OBJECT;
                            let nodeValue;
                            if (!isLast) {
                                nodeValue = nodeType === node_value_types_1.VALUE_TYPES.OBJECT ? {} : [];
                            }
                            else {
                                nodeValue = otherNode.value;
                                if (nodeType === node_value_types_1.VALUE_TYPES.ARRAY) {
                                    nodeValue = objectToArray(nodeValue);
                                }
                            }
                            if (key in parent) {
                                // Merge with parent
                                const mergePossible = typeof parent[key] === typeof nodeValue && [node_value_types_1.VALUE_TYPES.OBJECT, node_value_types_1.VALUE_TYPES.ARRAY].includes(nodeType);
                                if (!mergePossible) {
                                    // Ignore the value in the child record, see issue #20: "Assertion failed: Merging child values can only be done if existing and current values are both an array or object"
                                    this.debug.error(`The value stored in node "${otherNode.path}" cannot be merged with the parent node, value will be ignored. This error should disappear once the target node value is updated. See issue #20 for more information`, { path, parent, key, nodeType, nodeValue });
                                }
                                else {
                                    Object.keys(nodeValue).forEach(childKey => {
                                        if (childKey in parent[key]) {
                                            this.throwImplementationError(`Custom storage merge error: child key "${childKey}" is in parent value already! Make sure the get/childrenOf/descendantsOf methods of the custom storage class return values that can be modified by AceBase without affecting the stored source`);
                                        }
                                        parent[key][childKey] = nodeValue[childKey];
                                    });
                                }
                            }
                            else {
                                parent[key] = nodeValue;
                            }
                            parent = parent[key];
                        }
                    }
                }
                else if (descRows.length > 0) {
                    this.throwImplementationError(`multiple records found for non-object value!`);
                }
                // Post process filters to remove any data that got through because they were
                // not stored in dedicated records. This will happen with smaller values because
                // they are stored inline in their parent node.
                // eg:
                // { number: 1, small_string: 'small string', bool: true, obj: {}, arr: [] }
                // All properties of this object are stored inline,
                // if exclude: ['obj'], or child_objects: false was passed, these will still
                // have to be removed from the value
                if (options.child_objects === false) {
                    Object.keys(result.value).forEach(key => {
                        if (typeof result.value[key] === 'object' && result.value[key].constructor === Object) {
                            // This can only happen if the object was empty
                            (0, assert_1.assert)(Object.keys(result.value[key]).length === 0);
                            delete result.value[key];
                        }
                    });
                }
                if (options.include) {
                    // TODO: remove any unselected children that did get through
                }
                if (options.exclude) {
                    const process = (obj, keys) => {
                        if (typeof obj !== 'object') {
                            return;
                        }
                        const key = keys[0];
                        if (key === '*') {
                            Object.keys(obj).forEach(k => {
                                process(obj[k], keys.slice(1));
                            });
                        }
                        else if (keys.length > 1) {
                            key in obj && process(obj[key], keys.slice(1));
                        }
                        else {
                            delete obj[key];
                        }
                    };
                    options.exclude.forEach(path => {
                        const checkKeys = acebase_core_1.PathInfo.getPathKeys(path);
                        process(result.value, checkKeys);
                    });
                }
                return result;
            })();
            if (!options.transaction) {
                // transaction was created by us, commit
                await transaction.commit();
            }
            return node;
        }
        catch (err) {
            if (!options.transaction) {
                // transaction was created by us, rollback
                await transaction.rollback(err);
            }
            throw err;
        }
    }
    async getNodeInfo(path, options = {}) {
        options = options || {};
        const pathInfo = acebase_core_1.PathInfo.get(path);
        const transaction = options.transaction || await this._customImplementation.getTransaction({ path, write: false });
        try {
            const node = await this._readNode(path, { transaction });
            const info = new CustomStorageNodeInfo({
                path,
                key: typeof pathInfo.key === 'string' ? pathInfo.key : null,
                index: typeof pathInfo.key === 'number' ? pathInfo.key : null,
                type: node ? node.type : 0,
                exists: node !== null,
                address: node ? new node_address_1.NodeAddress(path) : null,
                created: node ? new Date(node.created) : null,
                modified: node ? new Date(node.modified) : null,
                revision: node ? node.revision : null,
                revision_nr: node ? node.revision_nr : null,
            });
            if (!node && path !== '') {
                // Try parent node
                const lockPath = await transaction.moveToParentPath(pathInfo.parentPath);
                (0, assert_1.assert)(lockPath === pathInfo.parentPath, `transaction.moveToParentPath() did not move to the right parent path of "${path}"`);
                const parent = await this._readNode(pathInfo.parentPath, { transaction });
                if (parent && [node_value_types_1.VALUE_TYPES.OBJECT, node_value_types_1.VALUE_TYPES.ARRAY].includes(parent.type) && pathInfo.key in parent.value) {
                    // Stored in parent node
                    info.exists = true;
                    info.value = parent.value[pathInfo.key];
                    info.address = null;
                    info.type = parent.type;
                    info.created = new Date(parent.created);
                    info.modified = new Date(parent.modified);
                    info.revision = parent.revision;
                    info.revision_nr = parent.revision_nr;
                }
                else {
                    // Parent doesn't exist, so the node we're looking for cannot exist either
                    info.address = null;
                }
            }
            if (options.include_child_count) {
                info.childCount = 0;
                if ([node_value_types_1.VALUE_TYPES.OBJECT, node_value_types_1.VALUE_TYPES.ARRAY].includes(info.valueType) && info.address) {
                    // Get number of children
                    info.childCount = node.value ? Object.keys(node.value).length : 0;
                    info.childCount += await transaction.getChildCount(path);
                }
            }
            if (!options.transaction) {
                // transaction was created by us, commit
                await transaction.commit();
            }
            return info;
        }
        catch (err) {
            if (!options.transaction) {
                // transaction was created by us, rollback
                await transaction.rollback(err);
            }
            throw err;
        }
    }
    // TODO: Move to Storage base class?
    async setNode(path, value, options = { suppress_events: false, context: null }) {
        if (this.settings.readOnly) {
            throw new Error(`Database is opened in read-only mode`);
        }
        const pathInfo = acebase_core_1.PathInfo.get(path);
        const transaction = options.transaction || await this._customImplementation.getTransaction({ path, write: true });
        try {
            if (path === '') {
                if (value === null || typeof value !== 'object' || value instanceof Array || value instanceof ArrayBuffer || ('buffer' in value && value.buffer instanceof ArrayBuffer)) {
                    throw new Error(`Invalid value for root node: ${value}`);
                }
                await this._writeNodeWithTracking('', value, { merge: false, transaction, suppress_events: options.suppress_events, context: options.context });
            }
            else if (typeof options.assert_revision !== 'undefined') {
                const info = await this.getNodeInfo(path, { transaction });
                if (info.revision !== options.assert_revision) {
                    throw new node_errors_1.NodeRevisionError(`revision '${info.revision}' does not match requested revision '${options.assert_revision}'`);
                }
                if (info.address && info.address.path === path && value !== null && !this.valueFitsInline(value)) {
                    // Overwrite node
                    await this._writeNodeWithTracking(path, value, { merge: false, transaction, suppress_events: options.suppress_events, context: options.context });
                }
                else {
                    // Update parent node
                    const lockPath = await transaction.moveToParentPath(pathInfo.parentPath);
                    (0, assert_1.assert)(lockPath === pathInfo.parentPath, `transaction.moveToParentPath() did not move to the right parent path of "${path}"`);
                    await this._writeNodeWithTracking(pathInfo.parentPath, { [pathInfo.key]: value }, { merge: true, transaction, suppress_events: options.suppress_events, context: options.context });
                }
            }
            else {
                // Delegate operation to update on parent node
                const lockPath = await transaction.moveToParentPath(pathInfo.parentPath);
                (0, assert_1.assert)(lockPath === pathInfo.parentPath, `transaction.moveToParentPath() did not move to the right parent path of "${path}"`);
                await this.updateNode(pathInfo.parentPath, { [pathInfo.key]: value }, { transaction, suppress_events: options.suppress_events, context: options.context });
            }
            if (!options.transaction) {
                // transaction was created by us, commit
                await transaction.commit();
            }
        }
        catch (err) {
            if (!options.transaction) {
                // transaction was created by us, rollback
                await transaction.rollback(err);
            }
            throw err;
        }
    }
    // TODO: Move to Storage base class?
    async updateNode(path, updates, options = { suppress_events: false, context: null }) {
        if (this.settings.readOnly) {
            throw new Error(`Database is opened in read-only mode`);
        }
        if (typeof updates !== 'object') {
            throw new Error(`invalid updates argument`); //. Must be a non-empty object or array
        }
        else if (Object.keys(updates).length === 0) {
            return; // Nothing to update. Done!
        }
        const transaction = options.transaction || await this._customImplementation.getTransaction({ path, write: true });
        try {
            // Get info about current node
            const nodeInfo = await this.getNodeInfo(path, { transaction });
            const pathInfo = acebase_core_1.PathInfo.get(path);
            if (nodeInfo.exists && nodeInfo.address && nodeInfo.address.path === path) {
                // Node exists and is stored in its own record.
                // Update it
                await this._writeNodeWithTracking(path, updates, { transaction, merge: true, suppress_events: options.suppress_events, context: options.context });
            }
            else if (nodeInfo.exists) {
                // Node exists, but is stored in its parent node.
                const pathInfo = acebase_core_1.PathInfo.get(path);
                const lockPath = await transaction.moveToParentPath(pathInfo.parentPath);
                (0, assert_1.assert)(lockPath === pathInfo.parentPath, `transaction.moveToParentPath() did not move to the right parent path of "${path}"`);
                await this._writeNodeWithTracking(pathInfo.parentPath, { [pathInfo.key]: updates }, { transaction, merge: true, suppress_events: options.suppress_events, context: options.context });
            }
            else {
                // The node does not exist, it's parent doesn't have it either. Update the parent instead
                const lockPath = await transaction.moveToParentPath(pathInfo.parentPath);
                (0, assert_1.assert)(lockPath === pathInfo.parentPath, `transaction.moveToParentPath() did not move to the right parent path of "${path}"`);
                await this.updateNode(pathInfo.parentPath, { [pathInfo.key]: updates }, { transaction, suppress_events: options.suppress_events, context: options.context });
            }
            if (!options.transaction) {
                // transaction was created by us, commit
                await transaction.commit();
            }
        }
        catch (err) {
            if (!options.transaction) {
                // transaction was created by us, rollback
                await transaction.rollback(err);
            }
            throw err;
        }
    }
}
exports.CustomStorage = CustomStorage;

},{"../../assert":4,"../../node-address":10,"../../node-errors":11,"../../node-info":12,"../../node-lock":13,"../../node-value-types":14,"../index":28,"./helpers":20,"acebase-core":43}],22:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createIndexedDBInstance = void 0;
const acebase_core_1 = require("acebase-core");
const __1 = require("..");
const __2 = require("../../..");
const settings_1 = require("./settings");
const transaction_1 = require("./transaction");
function createIndexedDBInstance(dbname, init = {}) {
    const settings = new settings_1.IndexedDBStorageSettings(init);
    // We'll create an IndexedDB with name "dbname.acebase"
    const request = indexedDB.open(`${dbname}.acebase`, 1);
    request.onupgradeneeded = (e) => {
        // create datastore
        const db = request.result;
        // Create "nodes" object store for metadata
        db.createObjectStore('nodes', { keyPath: 'path' });
        // Create "content" object store with all data
        db.createObjectStore('content');
    };
    let idb;
    const readyPromise = new Promise((resolve, reject) => {
        request.onsuccess = e => {
            idb = request.result;
            resolve();
        };
        request.onerror = e => {
            reject(e);
        };
    });
    const cache = new acebase_core_1.SimpleCache(typeof settings.cacheSeconds === 'number' ? settings.cacheSeconds : 60); // 60 second node cache by default
    // cache.enabled = false;
    const storageSettings = new __1.CustomStorageSettings({
        name: 'IndexedDB',
        locking: true,
        removeVoidProperties: settings.removeVoidProperties,
        maxInlineValueSize: settings.maxInlineValueSize,
        lockTimeout: settings.lockTimeout,
        ready() {
            return readyPromise;
        },
        async getTransaction(target) {
            await readyPromise;
            const context = {
                debug: false,
                db: idb,
                cache,
                ipc,
            };
            return new transaction_1.IndexedDBStorageTransaction(context, target);
        },
    });
    const db = new __2.AceBase(dbname, {
        logLevel: settings.logLevel,
        storage: storageSettings,
        sponsor: settings.sponsor,
        // isolated: settings.isolated,
    });
    const ipc = db.api.storage.ipc;
    db.settings.ipcEvents = settings.multipleTabs === true;
    ipc.on('notification', async (notification) => {
        const message = notification.data;
        if (typeof message !== 'object') {
            return;
        }
        if (message.action === 'cache.invalidate') {
            // console.warn(`Invalidating cache for paths`, message.paths);
            for (const path of message.paths) {
                cache.remove(path);
            }
        }
    });
    return db;
}
exports.createIndexedDBInstance = createIndexedDBInstance;

},{"..":21,"../../..":6,"./settings":23,"./transaction":24,"acebase-core":43}],23:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IndexedDBStorageSettings = void 0;
const __1 = require("../..");
class IndexedDBStorageSettings extends __1.StorageSettings {
    constructor(settings) {
        super(settings);
        /**
         * Whether to enable cross-tab synchronization
         * @default false
         */
        this.multipleTabs = false;
        /**
         * How many seconds to keep node info in memory, to speed up IndexedDB performance.
         * @default 60
         */
        this.cacheSeconds = 60;
        /**
         * You can turn this on if you are a sponsor
         * @default false
         */
        this.sponsor = false;
        if (typeof settings.logLevel === 'string') {
            this.logLevel = settings.logLevel;
        }
        if (typeof settings.multipleTabs === 'boolean') {
            this.multipleTabs = settings.multipleTabs;
        }
        if (typeof settings.cacheSeconds === 'number') {
            this.cacheSeconds = settings.cacheSeconds;
        }
        if (typeof settings.sponsor === 'boolean') {
            this.sponsor = settings.sponsor;
        }
        ['type', 'ipc', 'path'].forEach((prop) => {
            if (prop in settings) {
                console.warn(`${prop} setting is not supported for AceBase IndexedDBStorage`);
            }
        });
    }
}
exports.IndexedDBStorageSettings = IndexedDBStorageSettings;

},{"../..":28}],24:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IndexedDBStorageTransaction = void 0;
const __1 = require("..");
function _requestToPromise(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = event => {
            return resolve(request.result || null);
        };
        request.onerror = reject;
    });
}
class IndexedDBStorageTransaction extends __1.CustomStorageTransaction {
    /**
     * Creates a transaction object for IndexedDB usage. Because IndexedDB automatically commits
     * transactions when they have not been touched for a number of microtasks (eg promises
     * resolving whithout querying data), we will enqueue set and remove operations until commit
     * or rollback. We'll create separate IndexedDB transactions for get operations, caching their
     * values to speed up successive requests for the same data.
     */
    constructor(context, target) {
        super(target);
        this.context = context;
        this.production = true; // Improves performance, only set when all works well
        this._pending = [];
    }
    _createTransaction(write = false) {
        const tx = this.context.db.transaction(['nodes', 'content'], write ? 'readwrite' : 'readonly');
        return tx;
    }
    _splitMetadata(node) {
        const value = node.value;
        const copy = Object.assign({}, node);
        delete copy.value;
        const metadata = copy;
        return { metadata, value };
    }
    async commit() {
        // console.log(`*** commit ${this._pending.length} operations ****`);
        if (this._pending.length === 0) {
            return;
        }
        const batch = this._pending.splice(0);
        this.context.ipc.sendNotification({ action: 'cache.invalidate', paths: batch.map(op => op.path) });
        const tx = this._createTransaction(true);
        try {
            await new Promise((resolve, reject) => {
                let stop = false, processed = 0;
                const handleError = (err) => {
                    stop = true;
                    reject(err);
                };
                const handleSuccess = () => {
                    if (++processed === batch.length) {
                        resolve();
                    }
                };
                batch.forEach((op, i) => {
                    if (stop) {
                        return;
                    }
                    let r1, r2;
                    const path = op.path;
                    if (op.action === 'set') {
                        const { metadata, value } = this._splitMetadata(op.node);
                        const nodeInfo = { path, metadata };
                        r1 = tx.objectStore('nodes').put(nodeInfo); // Insert into "nodes" object store
                        r2 = tx.objectStore('content').put(value, path); // Add value to "content" object store
                        this.context.cache.set(path, op.node);
                    }
                    else if (op.action === 'remove') {
                        r1 = tx.objectStore('content').delete(path); // Remove from "content" object store
                        r2 = tx.objectStore('nodes').delete(path); // Remove from "nodes" data store
                        this.context.cache.set(path, null);
                    }
                    else {
                        handleError(new Error(`Unknown pending operation "${op.action}" on path "${path}" `));
                    }
                    let succeeded = 0;
                    r1.onsuccess = r2.onsuccess = () => {
                        if (++succeeded === 2) {
                            handleSuccess();
                        }
                    };
                    r1.onerror = r2.onerror = handleError;
                });
            });
            tx.commit && tx.commit();
        }
        catch (err) {
            console.error(err);
            tx.abort && tx.abort();
            throw err;
        }
    }
    async rollback(err) {
        // Nothing has committed yet, so we'll leave it like that
        this._pending = [];
    }
    async get(path) {
        // console.log(`*** get "${path}" ****`);
        if (this.context.cache.has(path)) {
            const cache = this.context.cache.get(path);
            // console.log(`Using cached node for path "${path}": `, cache);
            return cache;
        }
        const tx = this._createTransaction(false);
        const r1 = _requestToPromise(tx.objectStore('nodes').get(path)); // Get metadata from "nodes" object store
        const r2 = _requestToPromise(tx.objectStore('content').get(path)); // Get content from "content" object store
        try {
            const results = await Promise.all([r1, r2]);
            tx.commit && tx.commit();
            const info = results[0];
            if (!info) {
                // Node doesn't exist
                this.context.cache.set(path, null);
                return null;
            }
            const node = info.metadata;
            node.value = results[1];
            this.context.cache.set(path, node);
            return node;
        }
        catch (err) {
            console.error(`IndexedDB get error`, err);
            tx.abort && tx.abort();
            throw err;
        }
    }
    set(path, node) {
        // Queue the operation until commit
        this._pending.push({ action: 'set', path, node });
    }
    remove(path) {
        // Queue the operation until commit
        this._pending.push({ action: 'remove', path });
    }
    async removeMultiple(paths) {
        // Queues multiple items at once, dramatically improves performance for large datasets
        paths.forEach(path => {
            this._pending.push({ action: 'remove', path });
        });
    }
    childrenOf(path, include, checkCallback, addCallback) {
        // console.log(`*** childrenOf "${path}" ****`);
        return this._getChildrenOf(path, Object.assign(Object.assign({}, include), { descendants: false }), checkCallback, addCallback);
    }
    descendantsOf(path, include, checkCallback, addCallback) {
        // console.log(`*** descendantsOf "${path}" ****`);
        return this._getChildrenOf(path, Object.assign(Object.assign({}, include), { descendants: true }), checkCallback, addCallback);
    }
    _getChildrenOf(path, include, checkCallback, addCallback) {
        // Use cursor to loop from path on
        return new Promise((resolve, reject) => {
            const pathInfo = __1.CustomStorageHelpers.PathInfo.get(path);
            const tx = this._createTransaction(false);
            const store = tx.objectStore('nodes');
            const query = IDBKeyRange.lowerBound(path, true);
            const cursor = include.metadata ? store.openCursor(query) : store.openKeyCursor(query);
            cursor.onerror = e => {
                var _a;
                (_a = tx.abort) === null || _a === void 0 ? void 0 : _a.call(tx);
                reject(e);
            };
            cursor.onsuccess = async (e) => {
                var _a, _b, _c;
                const otherPath = (_b = (_a = cursor.result) === null || _a === void 0 ? void 0 : _a.key) !== null && _b !== void 0 ? _b : null;
                let keepGoing = true;
                if (otherPath === null) {
                    // No more results
                    keepGoing = false;
                }
                else if (!pathInfo.isAncestorOf(otherPath)) {
                    // Paths are sorted, no more children or ancestors to be expected!
                    keepGoing = false;
                }
                else if (include.descendants || pathInfo.isParentOf(otherPath)) {
                    let node;
                    if (include.metadata) {
                        const valueCursor = cursor;
                        const data = valueCursor.result.value;
                        node = data.metadata;
                    }
                    const shouldAdd = checkCallback(otherPath, node);
                    if (shouldAdd) {
                        if (include.value) {
                            // Load value!
                            if (this.context.cache.has(otherPath)) {
                                const cache = this.context.cache.get(otherPath);
                                node.value = cache.value;
                            }
                            else {
                                const req = tx.objectStore('content').get(otherPath);
                                node.value = await new Promise((resolve, reject) => {
                                    req.onerror = e => {
                                        resolve(null); // Value missing?
                                    };
                                    req.onsuccess = e => {
                                        resolve(req.result);
                                    };
                                });
                                this.context.cache.set(otherPath, node.value === null ? null : node);
                            }
                        }
                        keepGoing = addCallback(otherPath, node);
                    }
                }
                if (keepGoing) {
                    try {
                        cursor.result.continue();
                    }
                    catch (err) {
                        // We reached the end of the cursor?
                        keepGoing = false;
                    }
                }
                if (!keepGoing) {
                    (_c = tx.commit) === null || _c === void 0 ? void 0 : _c.call(tx);
                    resolve();
                }
            };
        });
    }
}
exports.IndexedDBStorageTransaction = IndexedDBStorageTransaction;

},{"..":21}],25:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLocalStorageInstance = exports.LocalStorageTransaction = exports.LocalStorageSettings = void 0;
const __1 = require("..");
const __2 = require("../../..");
const settings_1 = require("./settings");
Object.defineProperty(exports, "LocalStorageSettings", { enumerable: true, get: function () { return settings_1.LocalStorageSettings; } });
const transaction_1 = require("./transaction");
Object.defineProperty(exports, "LocalStorageTransaction", { enumerable: true, get: function () { return transaction_1.LocalStorageTransaction; } });
function createLocalStorageInstance(dbname, init = {}) {
    const settings = new settings_1.LocalStorageSettings(init);
    // Determine whether to use localStorage or sessionStorage
    const ls = settings.provider ? settings.provider : settings.temp ? localStorage : sessionStorage;
    // Setup our CustomStorageSettings
    const storageSettings = new __1.CustomStorageSettings({
        name: 'LocalStorage',
        locking: true,
        removeVoidProperties: settings.removeVoidProperties,
        maxInlineValueSize: settings.maxInlineValueSize,
        async ready() {
            // LocalStorage is always ready
        },
        async getTransaction(target) {
            // Create an instance of our transaction class
            const context = {
                debug: true,
                dbname,
                localStorage: ls,
            };
            const transaction = new transaction_1.LocalStorageTransaction(context, target);
            return transaction;
        },
    });
    const db = new __2.AceBase(dbname, { logLevel: settings.logLevel, storage: storageSettings, sponsor: settings.sponsor });
    db.settings.ipcEvents = settings.multipleTabs === true;
    return db;
}
exports.createLocalStorageInstance = createLocalStorageInstance;

},{"..":21,"../../..":6,"./settings":26,"./transaction":27}],26:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalStorageSettings = void 0;
const __1 = require("../..");
class LocalStorageSettings extends __1.StorageSettings {
    constructor(settings) {
        super(settings);
        /**
         * whether to use sessionStorage instead of localStorage
         * @default false
         */
        this.temp = false;
        /**
         * Whether to enable cross-tab synchronization
         * @default false
         */
        this.multipleTabs = false;
        if (typeof settings.temp === 'boolean') {
            this.temp = settings.temp;
        }
        if (typeof settings.provider === 'object') {
            this.provider = settings.provider;
        }
        if (typeof settings.multipleTabs === 'boolean') {
            this.multipleTabs = settings.multipleTabs;
        }
        if (typeof settings.logLevel === 'string') {
            this.logLevel = settings.logLevel;
        }
        if (typeof settings.sponsor === 'boolean') {
            this.sponsor = settings.sponsor;
        }
        ['type', 'ipc', 'path'].forEach((prop) => {
            if (prop in settings) {
                console.warn(`${prop} setting is not supported for AceBase LocalStorage`);
            }
        });
    }
}
exports.LocalStorageSettings = LocalStorageSettings;

},{"../..":28}],27:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalStorageTransaction = void 0;
const __1 = require("..");
// Setup CustomStorageTransaction for browser's LocalStorage
class LocalStorageTransaction extends __1.CustomStorageTransaction {
    constructor(context, target) {
        super(target);
        this.context = context;
        this._storageKeysPrefix = `${this.context.dbname}.acebase::`;
    }
    async commit() {
        // All changes have already been committed. TODO: use same approach as IndexedDB
    }
    async rollback(err) {
        // Not able to rollback changes, because we did not keep track
    }
    async get(path) {
        // Gets value from localStorage, wrapped in Promise
        const json = this.context.localStorage.getItem(this.getStorageKeyForPath(path));
        const val = JSON.parse(json);
        return val;
    }
    async set(path, val) {
        // Sets value in localStorage, wrapped in Promise
        const json = JSON.stringify(val);
        this.context.localStorage.setItem(this.getStorageKeyForPath(path), json);
    }
    async remove(path) {
        // Removes a value from localStorage, wrapped in Promise
        this.context.localStorage.removeItem(this.getStorageKeyForPath(path));
    }
    async childrenOf(path, include, checkCallback, addCallback) {
        // Streams all child paths
        // Cannot query localStorage, so loop through all stored keys to find children
        const pathInfo = __1.CustomStorageHelpers.PathInfo.get(path);
        for (let i = 0; i < this.context.localStorage.length; i++) {
            const key = this.context.localStorage.key(i);
            if (!key.startsWith(this._storageKeysPrefix)) {
                continue;
            }
            const otherPath = this.getPathFromStorageKey(key);
            if (pathInfo.isParentOf(otherPath) && checkCallback(otherPath)) {
                let node;
                if (include.metadata || include.value) {
                    const json = this.context.localStorage.getItem(key);
                    node = JSON.parse(json);
                }
                const keepGoing = addCallback(otherPath, node);
                if (!keepGoing) {
                    break;
                }
            }
        }
    }
    async descendantsOf(path, include, checkCallback, addCallback) {
        // Streams all descendant paths
        // Cannot query localStorage, so loop through all stored keys to find descendants
        const pathInfo = __1.CustomStorageHelpers.PathInfo.get(path);
        for (let i = 0; i < this.context.localStorage.length; i++) {
            const key = this.context.localStorage.key(i);
            if (!key.startsWith(this._storageKeysPrefix)) {
                continue;
            }
            const otherPath = this.getPathFromStorageKey(key);
            if (pathInfo.isAncestorOf(otherPath) && checkCallback(otherPath)) {
                let node;
                if (include.metadata || include.value) {
                    const json = this.context.localStorage.getItem(key);
                    node = JSON.parse(json);
                }
                const keepGoing = addCallback(otherPath, node);
                if (!keepGoing) {
                    break;
                }
            }
        }
    }
    /**
     * Helper function to get the path from a localStorage key
     */
    getPathFromStorageKey(key) {
        return key.slice(this._storageKeysPrefix.length);
    }
    /**
     * Helper function to get the localStorage key for a path
     */
    getStorageKeyForPath(path) {
        return `${this._storageKeysPrefix}${path}`;
    }
}
exports.LocalStorageTransaction = LocalStorageTransaction;

},{"..":21}],28:[function(require,module,exports){
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

},{"../assert":4,"../data-index":7,"../ipc":8,"../node-errors":11,"../node-info":12,"../node-value-types":14,"../promise-fs":16,"./indexes":29,"acebase-core":43}],29:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createIndex = void 0;
var create_index_1 = require("./create-index");
Object.defineProperty(exports, "createIndex", { enumerable: true, get: function () { return create_index_1.createIndex; } });

},{"./create-index":19}],30:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MSSQLStorage = exports.MSSQLStorageSettings = void 0;
const not_supported_1 = require("../../not-supported");
/**
 * Not supported in browser context
 */
class MSSQLStorageSettings extends not_supported_1.NotSupported {
}
exports.MSSQLStorageSettings = MSSQLStorageSettings;
/**
 * Not supported in browser context
 */
class MSSQLStorage extends not_supported_1.NotSupported {
}
exports.MSSQLStorage = MSSQLStorage;

},{"../../not-supported":15}],31:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SQLiteStorage = exports.SQLiteStorageSettings = void 0;
const not_supported_1 = require("../../not-supported");
/**
 * Not supported in browser context
 */
class SQLiteStorageSettings extends not_supported_1.NotSupported {
}
exports.SQLiteStorageSettings = SQLiteStorageSettings;
/**
 * Not supported in browser context
 */
class SQLiteStorage extends not_supported_1.NotSupported {
}
exports.SQLiteStorage = SQLiteStorage;

},{"../../not-supported":15}],32:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AceBaseBase = exports.AceBaseBaseSettings = void 0;
/**
   ________________________________________________________________________________

      ___          ______
     / _ \         | ___ \
    / /_\ \ ___ ___| |_/ / __ _ ___  ___
    |  _  |/ __/ _ \ ___ \/ _` / __|/ _ \
    | | | | (_|  __/ |_/ / (_| \__ \  __/
    \_| |_/\___\___\____/ \__,_|___/\___|
                        realtime database

   Copyright 2018-2022 by Ewout Stortenbeker (me@appy.one)
   Published under MIT license

   See docs at https://github.com/appy-one/acebase
   ________________________________________________________________________________

*/
const simple_event_emitter_1 = require("./simple-event-emitter");
const data_reference_1 = require("./data-reference");
const type_mappings_1 = require("./type-mappings");
const optional_observable_1 = require("./optional-observable");
const debug_1 = require("./debug");
const simple_colors_1 = require("./simple-colors");
class AceBaseBaseSettings {
    constructor(options) {
        /**
         * What level to use for console logging.
         * @default 'log'
         */
        this.logLevel = 'log';
        /**
         * Whether to use colors in the console logs output
         * @default true
         */
        this.logColors = true;
        /**
         * @internal (for internal use)
         */
        this.info = 'realtime database';
        /**
         * You can turn this on if you are a sponsor. See https://github.com/appy-one/acebase/discussions/100 for more info
         */
        this.sponsor = false;
        if (typeof options !== 'object') {
            options = {};
        }
        if (typeof options.logLevel === 'string') {
            this.logLevel = options.logLevel;
        }
        if (typeof options.logColors === 'boolean') {
            this.logColors = options.logColors;
        }
        if (typeof options.info === 'string') {
            this.info = options.info;
        }
        if (typeof options.sponsor === 'boolean') {
            this.sponsor = options.sponsor;
        }
    }
}
exports.AceBaseBaseSettings = AceBaseBaseSettings;
class AceBaseBase extends simple_event_emitter_1.SimpleEventEmitter {
    /**
     * @param dbname Name of the database to open or create
     */
    constructor(dbname, options = {}) {
        super();
        this._ready = false;
        options = new AceBaseBaseSettings(options);
        this.name = dbname;
        // Setup console logging
        this.debug = new debug_1.DebugLogger(options.logLevel, `[${dbname}]`);
        // Enable/disable logging with colors
        (0, simple_colors_1.SetColorsEnabled)(options.logColors);
        // ASCI art: http://patorjk.com/software/taag/#p=display&f=Doom&t=AceBase
        const logoStyle = [simple_colors_1.ColorStyle.magenta, simple_colors_1.ColorStyle.bold];
        const logo = '     ___          ______                ' + '\n' +
            '    / _ \\         | ___ \\               ' + '\n' +
            '   / /_\\ \\ ___ ___| |_/ / __ _ ___  ___ ' + '\n' +
            '   |  _  |/ __/ _ \\ ___ \\/ _` / __|/ _ \\' + '\n' +
            '   | | | | (_|  __/ |_/ / (_| \\__ \\  __/' + '\n' +
            '   \\_| |_/\\___\\___\\____/ \\__,_|___/\\___|';
        const info = (options.info ? ''.padStart(40 - options.info.length, ' ') + options.info + '\n' : '');
        if (!options.sponsor) {
            // if you are a sponsor, you can switch off the "AceBase banner ad"
            this.debug.write(logo.colorize(logoStyle));
            info && this.debug.write(info.colorize(simple_colors_1.ColorStyle.magenta));
        }
        // Setup type mapping functionality
        this.types = new type_mappings_1.TypeMappings(this);
        this.once('ready', () => {
            // console.log(`database "${dbname}" (${this.constructor.name}) is ready to use`);
            this._ready = true;
        });
    }
    /**
     * Waits for the database to be ready before running your callback.
     * @param callback (optional) callback function that is called when the database is ready to be used. You can also use the returned promise.
     * @returns returns a promise that resolves when ready
     */
    async ready(callback) {
        if (!this._ready) {
            // Wait for ready event
            await new Promise(resolve => this.on('ready', resolve));
        }
        callback === null || callback === void 0 ? void 0 : callback();
    }
    get isReady() {
        return this._ready;
    }
    /**
     * Allow specific observable implementation to be used
     * @param ObservableImpl Implementation to use
     */
    setObservable(ObservableImpl) {
        (0, optional_observable_1.setObservable)(ObservableImpl);
    }
    /**
     * Creates a reference to a node
     * @param path
     * @returns reference to the requested node
     */
    ref(path) {
        return new data_reference_1.DataReference(this, path);
    }
    /**
     * Get a reference to the root database node
     * @returns reference to root node
     */
    get root() {
        return this.ref('');
    }
    /**
     * Creates a query on the requested node
     * @param path
     * @returns query for the requested node
     */
    query(path) {
        const ref = new data_reference_1.DataReference(this, path);
        return new data_reference_1.DataReferenceQuery(ref);
    }
    get indexes() {
        return {
            /**
             * Gets all indexes
             */
            get: () => {
                return this.api.getIndexes();
            },
            /**
             * Creates an index on "key" for all child nodes at "path". If the index already exists, nothing happens.
             * Example: creating an index on all "name" keys of child objects of path "system/users",
             * will index "system/users/user1/name", "system/users/user2/name" etc.
             * You can also use wildcard paths to enable indexing and quering of fragmented data.
             * Example: path "users/*\/posts", key "title": will index all "title" keys in all posts of all users.
             * @param path path to the container node
             * @param key name of the key to index every container child node
             * @param options any additional options
             */
            create: (path, key, options) => {
                return this.api.createIndex(path, key, options);
            },
            /**
             * Deletes an existing index from the database
             */
            delete: async (filePath) => {
                return this.api.deleteIndex(filePath);
            },
        };
    }
    get schema() {
        return {
            get: (path) => {
                return this.api.getSchema(path);
            },
            set: (path, schema, warnOnly = false) => {
                return this.api.setSchema(path, schema, warnOnly);
            },
            all: () => {
                return this.api.getSchemas();
            },
            check: (path, value, isUpdate) => {
                return this.api.validateSchema(path, value, isUpdate);
            },
        };
    }
}
exports.AceBaseBase = AceBaseBase;

},{"./data-reference":39,"./debug":41,"./optional-observable":45,"./simple-colors":52,"./simple-event-emitter":53,"./type-mappings":57}],33:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Api = void 0;
/* eslint-disable @typescript-eslint/no-unused-vars */
const simple_event_emitter_1 = require("./simple-event-emitter");
class NotImplementedError extends Error {
    constructor(name) { super(`${name} is not implemented`); }
}
/**
 * Refactor to type/interface once acebase and acebase-client have been ported to TS
 */
class Api extends simple_event_emitter_1.SimpleEventEmitter {
    constructor() {
        super();
    }
    /**
     * Provides statistics
     * @param options
     */
    stats(options) { throw new NotImplementedError('stats'); }
    /**
     * @param path
     * @param event event to subscribe to ("value", "child_added" etc)
     * @param callback callback function
     */
    subscribe(path, event, callback, settings) { throw new NotImplementedError('subscribe'); }
    unsubscribe(path, event, callback) { throw new NotImplementedError('unsubscribe'); }
    update(path, updates, options) { throw new NotImplementedError('update'); }
    set(path, value, options) { throw new NotImplementedError('set'); }
    get(path, options) { throw new NotImplementedError('get'); }
    transaction(path, callback, options) { throw new NotImplementedError('transaction'); }
    exists(path) { throw new NotImplementedError('exists'); }
    query(path, query, options) { throw new NotImplementedError('query'); }
    reflect(path, type, args) { throw new NotImplementedError('reflect'); }
    export(path, write, options) { throw new NotImplementedError('export'); }
    import(path, read, options) { throw new NotImplementedError('import'); }
    /** Creates an index on key for all child nodes at path */
    createIndex(path, key, options) { throw new NotImplementedError('createIndex'); }
    getIndexes() { throw new NotImplementedError('getIndexes'); }
    deleteIndex(filePath) { throw new NotImplementedError('deleteIndex'); }
    setSchema(path, schema, warnOnly) { throw new NotImplementedError('setSchema'); }
    getSchema(path) { throw new NotImplementedError('getSchema'); }
    getSchemas() { throw new NotImplementedError('getSchemas'); }
    validateSchema(path, value, isUpdate) { throw new NotImplementedError('validateSchema'); }
    getMutations(filter) { throw new NotImplementedError('getMutations'); }
    getChanges(filter) { throw new NotImplementedError('getChanges'); }
}
exports.Api = Api;

},{"./simple-event-emitter":53}],34:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ascii85 = void 0;
function c(input, length, result) {
    const b = [0, 0, 0, 0, 0];
    for (let i = 0; i < length; i += 4) {
        let n = ((input[i] * 256 + input[i + 1]) * 256 + input[i + 2]) * 256 + input[i + 3];
        if (!n) {
            result.push('z');
        }
        else {
            for (let j = 0; j < 5; b[j++] = n % 85 + 33, n = Math.floor(n / 85)) { }
            result.push(String.fromCharCode(b[4], b[3], b[2], b[1], b[0]));
        }
    }
}
function encode(arr) {
    // summary: encodes input data in ascii85 string
    // input: ArrayLike
    const input = arr, result = [], remainder = input.length % 4, length = input.length - remainder;
    c(input, length, result);
    if (remainder) {
        const t = new Uint8Array(4);
        t.set(input.slice(length), 0);
        c(t, 4, result);
        let x = result.pop();
        if (x == 'z') {
            x = '!!!!!';
        }
        result.push(x.substr(0, remainder + 1));
    }
    let ret = result.join(''); // String
    ret = '<~' + ret + '~>';
    return ret;
}
exports.ascii85 = {
    encode: function (arr) {
        if (arr instanceof ArrayBuffer) {
            arr = new Uint8Array(arr, 0, arr.byteLength);
        }
        return encode(arr);
    },
    decode: function (input) {
        // summary: decodes the input string back to an ArrayBuffer
        // input: String: the input string to decode
        if (!input.startsWith('<~') || !input.endsWith('~>')) {
            throw new Error('Invalid input string');
        }
        input = input.substr(2, input.length - 4);
        const n = input.length, r = [], b = [0, 0, 0, 0, 0];
        let t, x, y, d;
        for (let i = 0; i < n; ++i) {
            if (input.charAt(i) == 'z') {
                r.push(0, 0, 0, 0);
                continue;
            }
            for (let j = 0; j < 5; ++j) {
                b[j] = input.charCodeAt(i + j) - 33;
            }
            d = n - i;
            if (d < 5) {
                for (let j = d; j < 4; b[++j] = 0) { }
                b[d] = 85;
            }
            t = (((b[0] * 85 + b[1]) * 85 + b[2]) * 85 + b[3]) * 85 + b[4];
            x = t & 255;
            t >>>= 8;
            y = t & 255;
            t >>>= 8;
            r.push(t >>> 8, t & 255, y, x);
            for (let j = d; j < 5; ++j, r.pop()) { }
            i += 4;
        }
        const data = new Uint8Array(r);
        return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    },
};

},{}],35:[function(require,module,exports){
"use strict";
var _a, _b;
Object.defineProperty(exports, "__esModule", { value: true });
const pad_1 = require("../pad");
const env = typeof window === 'object' ? window : self, globalCount = Object.keys(env).length, mimeTypesLength = (_b = (_a = navigator.mimeTypes) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0, clientId = (0, pad_1.default)((mimeTypesLength
    + navigator.userAgent.length).toString(36)
    + globalCount.toString(36), 4);
function fingerprint() {
    return clientId;
}
exports.default = fingerprint;

},{"../pad":37}],36:[function(require,module,exports){
"use strict";
/**
 * cuid.js
 * Collision-resistant UID generator for browsers and node.
 * Sequential for fast db lookups and recency sorting.
 * Safe for element IDs and server-side lookups.
 *
 * Extracted from CLCTR
 *
 * Copyright (c) Eric Elliott 2012
 * MIT License
 *
 * time biasing added by Ewout Stortenbeker for AceBase
 */
Object.defineProperty(exports, "__esModule", { value: true });
const fingerprint_1 = require("./fingerprint");
const pad_1 = require("./pad");
let c = 0;
const blockSize = 4, base = 36, discreteValues = Math.pow(base, blockSize);
function randomBlock() {
    return (0, pad_1.default)((Math.random() * discreteValues << 0).toString(base), blockSize);
}
function safeCounter() {
    c = c < discreteValues ? c : 0;
    c++; // this is not subliminal
    return c - 1;
}
function cuid(timebias = 0) {
    // Starting with a lowercase letter makes
    // it HTML element ID friendly.
    const letter = 'c', // hard-coded allows for sequential access
    // timestamp
    // warning: this exposes the exact date and time
    // that the uid was created.
    // NOTES Ewout:
    // - added timebias
    // - at '2059/05/25 19:38:27.456', timestamp will become 1 character larger!
    timestamp = (new Date().getTime() + timebias).toString(base), 
    // Prevent same-machine collisions.
    counter = (0, pad_1.default)(safeCounter().toString(base), blockSize), 
    // A few chars to generate distinct ids for different
    // clients (so different computers are far less
    // likely to generate the same id)
    print = (0, fingerprint_1.default)(), 
    // Grab some more chars from Math.random()
    random = randomBlock() + randomBlock();
    return letter + timestamp + counter + print + random;
}
exports.default = cuid;
// Not using slugs, removed code

},{"./fingerprint":35,"./pad":37}],37:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function pad(num, size) {
    const s = '000000000' + num;
    return s.substr(s.length - size);
}
exports.default = pad;

},{}],38:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrderedCollectionProxy = exports.proxyAccess = exports.LiveDataProxy = void 0;
const utils_1 = require("./utils");
const data_reference_1 = require("./data-reference");
const data_snapshot_1 = require("./data-snapshot");
const path_reference_1 = require("./path-reference");
const id_1 = require("./id");
const optional_observable_1 = require("./optional-observable");
const process_1 = require("./process");
const path_info_1 = require("./path-info");
const simple_event_emitter_1 = require("./simple-event-emitter");
class RelativeNodeTarget extends Array {
    static areEqual(t1, t2) {
        return t1.length === t2.length && t1.every((key, i) => t2[i] === key);
    }
    static isAncestor(ancestor, other) {
        return ancestor.length < other.length && ancestor.every((key, i) => other[i] === key);
    }
    static isDescendant(descendant, other) {
        return descendant.length > other.length && other.every((key, i) => descendant[i] === key);
    }
}
const isProxy = Symbol('isProxy');
class LiveDataProxy {
    /**
     * Creates a live data proxy for the given reference. The data of the reference's path will be loaded, and kept in-sync
     * with live data by listening for 'mutations' events. Any changes made to the value by the client will be synced back
     * to the database.
     * @param ref DataReference to create proxy for.
     * @param options proxy initialization options
     * be written to the database.
     */
    static async create(ref, options) {
        var _a;
        ref = new data_reference_1.DataReference(ref.db, ref.path); // Use copy to prevent context pollution on original reference
        let cache, loaded = false;
        let latestCursor = options === null || options === void 0 ? void 0 : options.cursor;
        let proxy;
        const proxyId = id_1.ID.generate(); //ref.push().key;
        // let onMutationCallback: ProxyObserveMutationsCallback;
        // let onErrorCallback: ProxyObserveErrorCallback = err => {
        //     console.error(err.message, err.details);
        // };
        const clientSubscriptions = [];
        const clientEventEmitter = new simple_event_emitter_1.SimpleEventEmitter();
        clientEventEmitter.on('cursor', (cursor) => latestCursor = cursor);
        clientEventEmitter.on('error', (err) => {
            console.error(err.message, err.details);
        });
        const applyChange = (keys, newValue) => {
            // Make changes to cache
            if (keys.length === 0) {
                cache = newValue;
                return true;
            }
            const allowCreation = false; //cache === null; // If the proxy'd target did not exist upon load, we must allow it to be created now.
            if (allowCreation) {
                cache = typeof keys[0] === 'number' ? [] : {};
            }
            let target = cache;
            const trailKeys = keys.slice();
            while (trailKeys.length > 1) {
                const key = trailKeys.shift();
                if (!(key in target)) {
                    if (allowCreation) {
                        target[key] = typeof key === 'number' ? [] : {};
                    }
                    else {
                        // Have we missed an event, or are local pending mutations creating this conflict?
                        return false; // Do not proceed
                    }
                }
                target = target[key];
            }
            const prop = trailKeys.shift();
            if (newValue === null) {
                // Remove it
                target instanceof Array ? target.splice(prop, 1) : delete target[prop];
            }
            else {
                // Set or update it
                target[prop] = newValue;
            }
            return true;
        };
        // Subscribe to mutations events on the target path
        const syncFallback = async () => {
            if (!loaded) {
                return;
            }
            await reload();
        };
        const subscription = ref.on('mutations', { syncFallback }).subscribe(async (snap) => {
            var _a;
            if (!loaded) {
                return;
            }
            const context = snap.context();
            const isRemote = ((_a = context.acebase_proxy) === null || _a === void 0 ? void 0 : _a.id) !== proxyId;
            if (!isRemote) {
                return; // Update was done through this proxy, no need to update cache or trigger local value subscriptions
            }
            const mutations = snap.val(false);
            const proceed = mutations.every(mutation => {
                if (!applyChange(mutation.target, mutation.val)) {
                    return false;
                }
                // if (onMutationCallback) {
                const changeRef = mutation.target.reduce((ref, key) => ref.child(key), ref);
                const changeSnap = new data_snapshot_1.DataSnapshot(changeRef, mutation.val, false, mutation.prev, snap.context());
                // onMutationCallback(changeSnap, isRemote); // onMutationCallback uses try/catch for client callback
                clientEventEmitter.emit('mutation', { snapshot: changeSnap, isRemote });
                // }
                return true;
            });
            if (proceed) {
                clientEventEmitter.emit('cursor', context.acebase_cursor); // // NOTE: cursor is only present in mutations done remotely. For our own updates, server cursors are returned by ref.set and ref.update
                localMutationsEmitter.emit('mutations', { origin: 'remote', snap });
            }
            else {
                console.warn(`Cached value of live data proxy on "${ref.path}" appears outdated, will be reloaded`);
                await reload();
            }
        });
        // Setup updating functionality: enqueue all updates, process them at next tick in the order they were issued
        let processPromise = Promise.resolve();
        const mutationQueue = [];
        const transactions = [];
        const pushLocalMutations = async () => {
            // Sync all local mutations that are not in a transaction
            const mutations = [];
            for (let i = 0, m = mutationQueue[0]; i < mutationQueue.length; i++, m = mutationQueue[i]) {
                if (!transactions.find(t => RelativeNodeTarget.areEqual(t.target, m.target) || RelativeNodeTarget.isAncestor(t.target, m.target))) {
                    mutationQueue.splice(i, 1);
                    i--;
                    mutations.push(m);
                }
            }
            if (mutations.length === 0) {
                return;
            }
            // Add current (new) values to mutations
            mutations.forEach(mutation => {
                mutation.value = (0, utils_1.cloneObject)(getTargetValue(cache, mutation.target));
            });
            // Run local onMutation & onChange callbacks in the next tick
            process_1.default.nextTick(() => {
                // Run onMutation callback for each changed node
                const context = { acebase_proxy: { id: proxyId, source: 'update' } };
                // if (onMutationCallback) {
                mutations.forEach(mutation => {
                    const mutationRef = mutation.target.reduce((ref, key) => ref.child(key), ref);
                    const mutationSnap = new data_snapshot_1.DataSnapshot(mutationRef, mutation.value, false, mutation.previous, context);
                    // onMutationCallback(mutationSnap, false);
                    clientEventEmitter.emit('mutation', { snapshot: mutationSnap, isRemote: false });
                });
                // }
                // Notify local subscribers
                const snap = new data_snapshot_1.MutationsDataSnapshot(ref, mutations.map(m => ({ target: m.target, val: m.value, prev: m.previous })), context);
                localMutationsEmitter.emit('mutations', { origin: 'local', snap });
            });
            // Update database async
            // const batchId = ID.generate();
            processPromise = mutations
                .reduce((mutations, m, i, arr) => {
                // Only keep top path mutations to prevent unneccessary child path updates
                if (!arr.some(other => RelativeNodeTarget.isAncestor(other.target, m.target))) {
                    mutations.push(m);
                }
                return mutations;
            }, [])
                .reduce((updates, m) => {
                // Prepare db updates
                const target = m.target;
                if (target.length === 0) {
                    // Overwrite this proxy's root value
                    updates.push({ ref, target, value: cache, type: 'set', previous: m.previous });
                }
                else {
                    const parentTarget = target.slice(0, -1);
                    const key = target.slice(-1)[0];
                    const parentRef = parentTarget.reduce((ref, key) => ref.child(key), ref);
                    const parentUpdate = updates.find(update => update.ref.path === parentRef.path);
                    const cacheValue = getTargetValue(cache, target); // m.value?
                    const prevValue = m.previous;
                    if (parentUpdate) {
                        parentUpdate.value[key] = cacheValue;
                        parentUpdate.previous[key] = prevValue;
                    }
                    else {
                        updates.push({ ref: parentRef, target: parentTarget, value: { [key]: cacheValue }, type: 'update', previous: { [key]: prevValue } });
                    }
                }
                return updates;
            }, [])
                .reduce(async (promise, update /*, i, updates */) => {
                // Execute db update
                // i === 0 && console.log(`Proxy: processing ${updates.length} db updates to paths:`, updates.map(update => update.ref.path));
                const context = {
                    acebase_proxy: {
                        id: proxyId,
                        source: update.type,
                        // update_id: ID.generate(),
                        // batch_id: batchId,
                        // batch_updates: updates.length
                    },
                };
                await promise;
                await update.ref
                    .context(context)[update.type](update.value) // .set or .update
                    .catch(err => {
                    clientEventEmitter.emit('error', { source: 'update', message: `Error processing update of "/${ref.path}"`, details: err });
                    // console.warn(`Proxy could not update DB, should rollback (${update.type}) the proxy value of "${update.ref.path}" to: `, update.previous);
                    const context = { acebase_proxy: { id: proxyId, source: 'update-rollback' } };
                    const mutations = [];
                    if (update.type === 'set') {
                        setTargetValue(cache, update.target, update.previous);
                        const mutationSnap = new data_snapshot_1.DataSnapshot(update.ref, update.previous, false, update.value, context);
                        clientEventEmitter.emit('mutation', { snapshot: mutationSnap, isRemote: false });
                        mutations.push({ target: update.target, val: update.previous, prev: update.value });
                    }
                    else {
                        // update
                        Object.keys(update.previous).forEach(key => {
                            setTargetValue(cache, update.target.concat(key), update.previous[key]);
                            const mutationSnap = new data_snapshot_1.DataSnapshot(update.ref.child(key), update.previous[key], false, update.value[key], context);
                            clientEventEmitter.emit('mutation', { snapshot: mutationSnap, isRemote: false });
                            mutations.push({ target: update.target.concat(key), val: update.previous[key], prev: update.value[key] });
                        });
                    }
                    // Run onMutation callback for each node being rolled back
                    mutations.forEach(m => {
                        const mutationRef = m.target.reduce((ref, key) => ref.child(key), ref);
                        const mutationSnap = new data_snapshot_1.DataSnapshot(mutationRef, m.val, false, m.prev, context);
                        clientEventEmitter.emit('mutation', { snapshot: mutationSnap, isRemote: false });
                    });
                    // Notify local subscribers:
                    const snap = new data_snapshot_1.MutationsDataSnapshot(update.ref, mutations, context);
                    localMutationsEmitter.emit('mutations', { origin: 'local', snap });
                });
                if (update.ref.cursor) {
                    // Should also be available in context.acebase_cursor now
                    clientEventEmitter.emit('cursor', update.ref.cursor);
                }
            }, processPromise);
            await processPromise;
        };
        let syncInProgress = false;
        const syncPromises = [];
        const syncCompleted = () => {
            let resolve;
            const promise = new Promise(rs => resolve = rs);
            syncPromises.push({ resolve });
            return promise;
        };
        let processQueueTimeout = null;
        const scheduleSync = () => {
            if (!processQueueTimeout) {
                processQueueTimeout = setTimeout(async () => {
                    syncInProgress = true;
                    processQueueTimeout = null;
                    await pushLocalMutations();
                    syncInProgress = false;
                    syncPromises.splice(0).forEach(p => p.resolve());
                }, 0);
            }
        };
        const flagOverwritten = (target) => {
            if (!mutationQueue.find(m => RelativeNodeTarget.areEqual(m.target, target))) {
                mutationQueue.push({ target, previous: (0, utils_1.cloneObject)(getTargetValue(cache, target)) });
            }
            // schedule database updates
            scheduleSync();
        };
        const localMutationsEmitter = new simple_event_emitter_1.SimpleEventEmitter();
        const addOnChangeHandler = (target, callback) => {
            const isObject = (val) => val !== null && typeof val === 'object';
            const mutationsHandler = async (details) => {
                var _a;
                const { snap, origin } = details;
                const context = snap.context();
                const causedByOurProxy = ((_a = context.acebase_proxy) === null || _a === void 0 ? void 0 : _a.id) === proxyId;
                if (details.origin === 'remote' && causedByOurProxy) {
                    // Any local changes already triggered subscription callbacks
                    console.error('DEV ISSUE: mutationsHandler was called from remote event originating from our own proxy');
                    return;
                }
                const mutations = snap.val(false).filter(mutation => {
                    // Keep mutations impacting the subscribed target: mutations on target, or descendant or ancestor of target
                    return mutation.target.slice(0, target.length).every((key, i) => target[i] === key);
                });
                if (mutations.length === 0) {
                    return;
                }
                let newValue, previousValue;
                // If there is a mutation on the target itself, or parent/ancestor path, there can only be one. We can take a shortcut
                const singleMutation = mutations.find(m => m.target.length <= target.length);
                if (singleMutation) {
                    const trailKeys = target.slice(singleMutation.target.length);
                    newValue = trailKeys.reduce((val, key) => !isObject(val) || !(key in val) ? null : val[key], singleMutation.val);
                    previousValue = trailKeys.reduce((val, key) => !isObject(val) || !(key in val) ? null : val[key], singleMutation.prev);
                }
                else {
                    // All mutations are on children/descendants of our target
                    // Construct new & previous values by combining cache and snapshot
                    const currentValue = getTargetValue(cache, target);
                    newValue = (0, utils_1.cloneObject)(currentValue);
                    previousValue = (0, utils_1.cloneObject)(newValue);
                    mutations.forEach(mutation => {
                        // mutation.target is relative to proxy root
                        const trailKeys = mutation.target.slice(target.length);
                        for (let i = 0, val = newValue, prev = previousValue; i < trailKeys.length; i++) { // arr = PathInfo.getPathKeys(mutationPath).slice(PathInfo.getPathKeys(targetRef.path).length)
                            const last = i + 1 === trailKeys.length, key = trailKeys[i];
                            if (last) {
                                val[key] = mutation.val;
                                if (val[key] === null) {
                                    delete val[key];
                                }
                                prev[key] = mutation.prev;
                                if (prev[key] === null) {
                                    delete prev[key];
                                }
                            }
                            else {
                                val = val[key] = key in val ? val[key] : {};
                                prev = prev[key] = key in prev ? prev[key] : {};
                            }
                        }
                    });
                }
                process_1.default.nextTick(() => {
                    // Run callback with read-only (frozen) values in next tick
                    let keepSubscription = true;
                    try {
                        keepSubscription = false !== callback(Object.freeze(newValue), Object.freeze(previousValue), !causedByOurProxy, context);
                    }
                    catch (err) {
                        clientEventEmitter.emit('error', { source: origin === 'remote' ? 'remote_update' : 'local_update', message: 'Error running subscription callback', details: err });
                    }
                    if (keepSubscription === false) {
                        stop();
                    }
                });
            };
            localMutationsEmitter.on('mutations', mutationsHandler);
            const stop = () => {
                localMutationsEmitter.off('mutations', mutationsHandler);
                clientSubscriptions.splice(clientSubscriptions.findIndex(cs => cs.stop === stop), 1);
            };
            clientSubscriptions.push({ target, stop });
            return { stop };
        };
        const handleFlag = (flag, target, args) => {
            if (flag === 'write') {
                return flagOverwritten(target);
            }
            else if (flag === 'onChange') {
                return addOnChangeHandler(target, args.callback);
            }
            else if (flag === 'subscribe' || flag === 'observe') {
                const subscribe = (subscriber) => {
                    const currentValue = getTargetValue(cache, target);
                    subscriber.next(currentValue);
                    const subscription = addOnChangeHandler(target, (value /*, previous, isRemote, context */) => {
                        subscriber.next(value);
                    });
                    return function unsubscribe() {
                        subscription.stop();
                    };
                };
                if (flag === 'subscribe') {
                    return subscribe;
                }
                // Try to load Observable
                const Observable = (0, optional_observable_1.getObservable)();
                return new Observable(subscribe);
            }
            else if (flag === 'transaction') {
                const hasConflictingTransaction = transactions.some(t => RelativeNodeTarget.areEqual(target, t.target) || RelativeNodeTarget.isAncestor(target, t.target) || RelativeNodeTarget.isDescendant(target, t.target));
                if (hasConflictingTransaction) {
                    // TODO: Wait for this transaction to finish, then try again
                    return Promise.reject(new Error('Cannot start transaction because it conflicts with another transaction'));
                }
                return new Promise(async (resolve) => {
                    // If there are pending mutations on target (or deeper), wait until they have been synchronized
                    const hasPendingMutations = mutationQueue.some(m => RelativeNodeTarget.areEqual(target, m.target) || RelativeNodeTarget.isAncestor(target, m.target));
                    if (hasPendingMutations) {
                        if (!syncInProgress) {
                            scheduleSync();
                        }
                        await syncCompleted();
                    }
                    const tx = { target, status: 'started', transaction: null };
                    transactions.push(tx);
                    tx.transaction = {
                        get status() { return tx.status; },
                        get completed() { return tx.status !== 'started'; },
                        get mutations() {
                            return mutationQueue.filter(m => RelativeNodeTarget.areEqual(tx.target, m.target) || RelativeNodeTarget.isAncestor(tx.target, m.target));
                        },
                        get hasMutations() {
                            return this.mutations.length > 0;
                        },
                        async commit() {
                            if (this.completed) {
                                throw new Error(`Transaction has completed already (status '${tx.status}')`);
                            }
                            tx.status = 'finished';
                            transactions.splice(transactions.indexOf(tx), 1);
                            if (syncInProgress) {
                                // Currently syncing without our mutations
                                await syncCompleted();
                            }
                            scheduleSync();
                            await syncCompleted();
                        },
                        rollback() {
                            // Remove mutations from queue
                            if (this.completed) {
                                throw new Error(`Transaction has completed already (status '${tx.status}')`);
                            }
                            tx.status = 'canceled';
                            const mutations = [];
                            for (let i = 0; i < mutationQueue.length; i++) {
                                const m = mutationQueue[i];
                                if (RelativeNodeTarget.areEqual(tx.target, m.target) || RelativeNodeTarget.isAncestor(tx.target, m.target)) {
                                    mutationQueue.splice(i, 1);
                                    i--;
                                    mutations.push(m);
                                }
                            }
                            // Replay mutations in reverse order
                            mutations.reverse()
                                .forEach(m => {
                                if (m.target.length === 0) {
                                    cache = m.previous;
                                }
                                else {
                                    setTargetValue(cache, m.target, m.previous);
                                }
                            });
                            // Remove transaction
                            transactions.splice(transactions.indexOf(tx), 1);
                        },
                    };
                    resolve(tx.transaction);
                });
            }
        };
        const snap = await ref.get({ cache_mode: 'allow', cache_cursor: options === null || options === void 0 ? void 0 : options.cursor });
        // const gotOfflineStartValue = snap.context().acebase_origin === 'cache';
        // if (gotOfflineStartValue) {
        //     console.warn(`Started data proxy with cached value of "${ref.path}", check if its value is reloaded on next connection!`);
        // }
        if (snap.context().acebase_origin !== 'cache') {
            clientEventEmitter.emit('cursor', (_a = ref.cursor) !== null && _a !== void 0 ? _a : null); // latestCursor = snap.context().acebase_cursor ?? null;
        }
        loaded = true;
        cache = snap.val();
        if (cache === null && typeof (options === null || options === void 0 ? void 0 : options.defaultValue) !== 'undefined') {
            cache = options.defaultValue;
            const context = {
                acebase_proxy: {
                    id: proxyId,
                    source: 'default',
                    // update_id: ID.generate()
                },
            };
            await ref.context(context).set(cache);
        }
        proxy = createProxy({ root: { ref, get cache() { return cache; } }, target: [], id: proxyId, flag: handleFlag });
        const assertProxyAvailable = () => {
            if (proxy === null) {
                throw new Error('Proxy was destroyed');
            }
        };
        const reload = async () => {
            // Manually reloads current value when cache is out of sync, which should only
            // be able to happen if an AceBaseClient is used without cache database,
            // and the connection to the server was lost for a while. In all other cases,
            // there should be no need to call this method.
            assertProxyAvailable();
            mutationQueue.splice(0); // Remove pending mutations. Will be empty in production, but might not be while debugging, leading to weird behaviour.
            const snap = await ref.get({ allow_cache: false });
            const oldVal = cache, newVal = snap.val();
            cache = newVal;
            // Compare old and new values
            const mutations = (0, utils_1.getMutations)(oldVal, newVal);
            if (mutations.length === 0) {
                return; // Nothing changed
            }
            // Run onMutation callback for each changed node
            const context = snap.context(); // context might contain acebase_cursor if server support that
            context.acebase_proxy = { id: proxyId, source: 'reload' };
            // if (onMutationCallback) {
            mutations.forEach(m => {
                const targetRef = getTargetRef(ref, m.target);
                const newSnap = new data_snapshot_1.DataSnapshot(targetRef, m.val, m.val === null, m.prev, context);
                clientEventEmitter.emit('mutation', { snapshot: newSnap, isRemote: true });
            });
            // }
            // Notify local subscribers
            const mutationsSnap = new data_snapshot_1.MutationsDataSnapshot(ref, mutations, context);
            localMutationsEmitter.emit('mutations', { origin: 'local', snap: mutationsSnap });
        };
        return {
            async destroy() {
                await processPromise;
                const promises = [
                    subscription.stop(),
                    ...clientSubscriptions.map(cs => cs.stop()),
                ];
                await Promise.all(promises);
                ['cursor', 'mutation', 'error'].forEach(event => clientEventEmitter.off(event));
                cache = null; // Remove cache
                proxy = null;
            },
            stop() {
                this.destroy();
            },
            get value() {
                assertProxyAvailable();
                return proxy;
            },
            get hasValue() {
                assertProxyAvailable();
                return cache !== null;
            },
            set value(val) {
                // Overwrite the value of the proxied path itself!
                assertProxyAvailable();
                if (val !== null && typeof val === 'object' && val[isProxy]) {
                    // Assigning one proxied value to another
                    val = val.valueOf();
                }
                flagOverwritten([]);
                cache = val;
            },
            get ref() {
                return ref;
            },
            get cursor() {
                return latestCursor;
            },
            reload,
            onMutation(callback) {
                // Fires callback each time anything changes
                assertProxyAvailable();
                clientEventEmitter.off('mutation'); // Mimic legacy behaviour that overwrites handler
                clientEventEmitter.on('mutation', ({ snapshot, isRemote }) => {
                    try {
                        callback(snapshot, isRemote);
                    }
                    catch (err) {
                        clientEventEmitter.emit('error', { source: 'mutation_callback', message: 'Error in dataproxy onMutation callback', details: err });
                    }
                });
            },
            onError(callback) {
                // Fires callback each time anything goes wrong
                assertProxyAvailable();
                clientEventEmitter.off('error'); // Mimic legacy behaviour that overwrites handler
                clientEventEmitter.on('error', (err) => {
                    try {
                        callback(err);
                    }
                    catch (err) {
                        console.error(`Error in dataproxy onError callback: ${err.message}`);
                    }
                });
            },
            on(event, callback) {
                clientEventEmitter.on(event, callback);
            },
            off(event, callback) {
                clientEventEmitter.off(event, callback);
            },
        };
    }
}
exports.LiveDataProxy = LiveDataProxy;
function getTargetValue(obj, target) {
    let val = obj;
    for (const key of target) {
        val = typeof val === 'object' && val !== null && key in val ? val[key] : null;
    }
    return val;
}
function setTargetValue(obj, target, value) {
    if (target.length === 0) {
        throw new Error('Cannot update root target, caller must do that itself!');
    }
    const targetObject = target.slice(0, -1).reduce((obj, key) => obj[key], obj);
    const prop = target.slice(-1)[0];
    if (value === null || typeof value === 'undefined') {
        // Remove it
        targetObject instanceof Array ? targetObject.splice(prop, 1) : delete targetObject[prop];
    }
    else {
        // Set or update it
        targetObject[prop] = value;
    }
}
function getTargetRef(ref, target) {
    // Create new DataReference to prevent context reuse
    const path = path_info_1.PathInfo.get(ref.path).childPath(target);
    return new data_reference_1.DataReference(ref.db, path);
}
function createProxy(context) {
    const targetRef = getTargetRef(context.root.ref, context.target);
    const childProxies = [];
    const handler = {
        get(target, prop, receiver) {
            target = getTargetValue(context.root.cache, context.target);
            if (typeof prop === 'symbol') {
                if (prop.toString() === Symbol.iterator.toString()) {
                    // Use .values for @@iterator symbol
                    prop = 'values';
                }
                else if (prop.toString() === isProxy.toString()) {
                    return true;
                }
                else {
                    return Reflect.get(target, prop, receiver);
                }
            }
            if (prop === 'valueOf') {
                return function valueOf() { return target; };
            }
            if (target === null || typeof target !== 'object') {
                throw new Error(`Cannot read property "${prop}" of ${target}. Value of path "/${targetRef.path}" is not an object (anymore)`);
            }
            if (target instanceof Array && typeof prop === 'string' && /^[0-9]+$/.test(prop)) {
                // Proxy type definitions say prop can be a number, but this is never the case.
                prop = parseInt(prop);
            }
            const value = target[prop];
            if (value === null) {
                // Removed property. Should never happen, but if it does:
                delete target[prop];
                return; // undefined
            }
            // Check if we have a child proxy for this property already.
            // If so, and the properties' typeof value did not change, return that
            const childProxy = childProxies.find(proxy => proxy.prop === prop);
            if (childProxy) {
                if (childProxy.typeof === typeof value) {
                    return childProxy.value;
                }
                childProxies.splice(childProxies.indexOf(childProxy), 1);
            }
            const proxifyChildValue = (prop) => {
                const value = target[prop]; //
                const childProxy = childProxies.find(child => child.prop === prop);
                if (childProxy) {
                    if (childProxy.typeof === typeof value) {
                        return childProxy.value;
                    }
                    childProxies.splice(childProxies.indexOf(childProxy), 1);
                }
                if (typeof value !== 'object') {
                    // Can't proxify non-object values
                    return value;
                }
                const newChildProxy = createProxy({ root: context.root, target: context.target.concat(prop), id: context.id, flag: context.flag });
                childProxies.push({ typeof: typeof value, prop, value: newChildProxy });
                return newChildProxy;
            };
            const unproxyValue = (value) => {
                return value !== null && typeof value === 'object' && value[isProxy]
                    ? value.getTarget()
                    : value;
            };
            // If the property contains a simple value, return it.
            if (['string', 'number', 'boolean'].includes(typeof value)
                || value instanceof Date
                || value instanceof path_reference_1.PathReference
                || value instanceof ArrayBuffer
                || (typeof value === 'object' && 'buffer' in value) // Typed Arrays
            ) {
                return value;
            }
            const isArray = target instanceof Array;
            if (prop === 'toString') {
                return function toString() {
                    return `[LiveDataProxy for "${targetRef.path}"]`;
                };
            }
            if (typeof value === 'undefined') {
                if (prop === 'push') {
                    // Push item to an object collection
                    return function push(item) {
                        const childRef = targetRef.push();
                        context.flag('write', context.target.concat(childRef.key)); //, { previous: null }
                        target[childRef.key] = item;
                        return childRef.key;
                    };
                }
                if (prop === 'getTarget') {
                    // Get unproxied readonly (but still live) version of data.
                    return function (warn = true) {
                        warn && console.warn('Use getTarget with caution - any changes will not be synchronized!');
                        return target;
                    };
                }
                if (prop === 'getRef') {
                    // Gets the DataReference to this data target
                    return function getRef() {
                        const ref = getTargetRef(context.root.ref, context.target);
                        return ref;
                    };
                }
                if (prop === 'forEach') {
                    return function forEach(callback) {
                        const keys = Object.keys(target);
                        // Fix: callback with unproxied value
                        let stop = false;
                        for (let i = 0; !stop && i < keys.length; i++) {
                            const key = keys[i];
                            const value = proxifyChildValue(key); //, target[key]
                            stop = callback(value, key, i) === false;
                        }
                    };
                }
                if (['values', 'entries', 'keys'].includes(prop)) {
                    return function* generator() {
                        const keys = Object.keys(target);
                        for (const key of keys) {
                            if (prop === 'keys') {
                                yield key;
                            }
                            else {
                                const value = proxifyChildValue(key); //, target[key]
                                if (prop === 'entries') {
                                    yield [key, value];
                                }
                                else {
                                    yield value;
                                }
                            }
                        }
                    };
                }
                if (prop === 'toArray') {
                    return function toArray(sortFn) {
                        const arr = Object.keys(target).map(key => proxifyChildValue(key)); //, target[key]
                        if (sortFn) {
                            arr.sort(sortFn);
                        }
                        return arr;
                    };
                }
                if (prop === 'onChanged') {
                    // Starts monitoring the value
                    return function onChanged(callback) {
                        return context.flag('onChange', context.target, { callback });
                    };
                }
                if (prop === 'subscribe') {
                    // Gets subscriber function to use with Observables, or custom handling
                    return function subscribe() {
                        return context.flag('subscribe', context.target);
                    };
                }
                if (prop === 'getObservable') {
                    // Creates an observable for monitoring the value
                    return function getObservable() {
                        return context.flag('observe', context.target);
                    };
                }
                if (prop === 'getOrderedCollection') {
                    return function getOrderedCollection(orderProperty, orderIncrement) {
                        return new OrderedCollectionProxy(this, orderProperty, orderIncrement);
                    };
                }
                if (prop === 'startTransaction') {
                    return function startTransaction() {
                        return context.flag('transaction', context.target);
                    };
                }
                if (prop === 'remove' && !isArray) {
                    // Removes target from object collection
                    return function remove() {
                        if (context.target.length === 0) {
                            throw new Error('Can\'t remove proxy root value');
                        }
                        const parent = getTargetValue(context.root.cache, context.target.slice(0, -1));
                        const key = context.target.slice(-1)[0];
                        context.flag('write', context.target);
                        delete parent[key];
                    };
                }
                return; // undefined
            }
            else if (typeof value === 'function') {
                if (isArray) {
                    // Handle array methods
                    const writeArray = (action) => {
                        context.flag('write', context.target);
                        return action();
                    };
                    const cleanArrayValues = (values) => values.map((value) => {
                        value = unproxyValue(value);
                        removeVoidProperties(value);
                        return value;
                    });
                    // Methods that directly change the array:
                    if (prop === 'push') {
                        return function push(...items) {
                            items = cleanArrayValues(items);
                            return writeArray(() => target.push(...items)); // push the items to the cache array
                        };
                    }
                    if (prop === 'pop') {
                        return function pop() {
                            return writeArray(() => target.pop());
                        };
                    }
                    if (prop === 'splice') {
                        return function splice(start, deleteCount, ...items) {
                            items = cleanArrayValues(items);
                            return writeArray(() => target.splice(start, deleteCount, ...items));
                        };
                    }
                    if (prop === 'shift') {
                        return function shift() {
                            return writeArray(() => target.shift());
                        };
                    }
                    if (prop === 'unshift') {
                        return function unshift(...items) {
                            items = cleanArrayValues(items);
                            return writeArray(() => target.unshift(...items));
                        };
                    }
                    if (prop === 'sort') {
                        return function sort(compareFn) {
                            return writeArray(() => target.sort(compareFn));
                        };
                    }
                    if (prop === 'reverse') {
                        return function reverse() {
                            return writeArray(() => target.reverse());
                        };
                    }
                    // Methods that do not change the array themselves, but
                    // have callbacks that might, or return child values:
                    if (['indexOf', 'lastIndexOf'].includes(prop)) {
                        return function indexOf(item, start) {
                            if (item !== null && typeof item === 'object' && item[isProxy]) {
                                // Use unproxied value, or array.indexOf will return -1 (fixes issue #1)
                                item = item.getTarget(false);
                            }
                            return target[prop](item, start);
                        };
                    }
                    if (['forEach', 'every', 'some', 'filter', 'map'].includes(prop)) {
                        return function iterate(callback) {
                            return target[prop]((value, i) => {
                                return callback(proxifyChildValue(i), i, proxy); //, value
                            });
                        };
                    }
                    if (['reduce', 'reduceRight'].includes(prop)) {
                        return function reduce(callback, initialValue) {
                            return target[prop]((prev, value, i) => {
                                return callback(prev, proxifyChildValue(i), i, proxy); //, value
                            }, initialValue);
                        };
                    }
                    if (['find', 'findIndex'].includes(prop)) {
                        return function find(callback) {
                            let value = target[prop]((value, i) => {
                                return callback(proxifyChildValue(i), i, proxy); // , value
                            });
                            if (prop === 'find' && value) {
                                const index = target.indexOf(value);
                                value = proxifyChildValue(index); //, value
                            }
                            return value;
                        };
                    }
                    if (['values', 'entries', 'keys'].includes(prop)) {
                        return function* generator() {
                            for (let i = 0; i < target.length; i++) {
                                if (prop === 'keys') {
                                    yield i;
                                }
                                else {
                                    const value = proxifyChildValue(i); //, target[i]
                                    if (prop === 'entries') {
                                        yield [i, value];
                                    }
                                    else {
                                        yield value;
                                    }
                                }
                            }
                        };
                    }
                }
                // Other function (or not an array), should not alter its value
                // return function fn(...args) {
                //     return target[prop](...args);
                // }
                return value;
            }
            // Proxify any other value
            return proxifyChildValue(prop); //, value
        },
        set(target, prop, value, receiver) {
            // Eg: chats.chat1.title = 'New chat title';
            // target === chats.chat1, prop === 'title'
            target = getTargetValue(context.root.cache, context.target);
            if (typeof prop === 'symbol') {
                return Reflect.set(target, prop, value, receiver);
            }
            if (target === null || typeof target !== 'object') {
                throw new Error(`Cannot set property "${prop}" of ${target}. Value of path "/${targetRef.path}" is not an object`);
            }
            if (target instanceof Array && typeof prop === 'string') {
                if (!/^[0-9]+$/.test(prop)) {
                    throw new Error(`Cannot set property "${prop}" on array value of path "/${targetRef.path}"`);
                }
                prop = parseInt(prop);
            }
            if (value !== null) {
                if (typeof value === 'object') {
                    if (value[isProxy]) {
                        // Assigning one proxied value to another
                        value = value.valueOf();
                    }
                    // else if (Object.isFrozen(value)) {
                    //     // Create a copy to unfreeze it
                    //     value = cloneObject(value);
                    // }
                    value = (0, utils_1.cloneObject)(value); // Fix #10, always clone objects so changes made through the proxy won't change the original object (and vice versa)
                }
                if ((0, utils_1.valuesAreEqual)(value, target[prop])) { //if (compareValues(value, target[prop]) === 'identical') { // (typeof value !== 'object' && target[prop] === value) {
                    // not changing the actual value, ignore
                    return true;
                }
            }
            if (context.target.some(key => typeof key === 'number')) {
                // Updating an object property inside an array. Flag the first array in target to be written.
                // Eg: when chat.members === [{ name: 'Ewout', id: 'someid' }]
                // --> chat.members[0].name = 'Ewout' --> Rewrite members array instead of chat/members[0]/name
                context.flag('write', context.target.slice(0, context.target.findIndex(key => typeof key === 'number')));
            }
            else if (target instanceof Array) {
                // Flag the entire array to be overwritten
                context.flag('write', context.target);
            }
            else {
                // Flag child property
                context.flag('write', context.target.concat(prop));
            }
            // Set cached value:
            if (value === null) {
                delete target[prop];
            }
            else {
                removeVoidProperties(value);
                target[prop] = value;
            }
            return true;
        },
        deleteProperty(target, prop) {
            target = getTargetValue(context.root.cache, context.target);
            if (target === null) {
                throw new Error(`Cannot delete property ${prop.toString()} of null`);
            }
            if (typeof prop === 'symbol') {
                return Reflect.deleteProperty(target, prop);
            }
            if (!(prop in target)) {
                return true; // Nothing to delete
            }
            context.flag('write', context.target.concat(prop));
            delete target[prop];
            return true;
        },
        ownKeys(target) {
            target = getTargetValue(context.root.cache, context.target);
            return Reflect.ownKeys(target);
        },
        has(target, prop) {
            target = getTargetValue(context.root.cache, context.target);
            return Reflect.has(target, prop);
        },
        getOwnPropertyDescriptor(target, prop) {
            target = getTargetValue(context.root.cache, context.target);
            const descriptor = Reflect.getOwnPropertyDescriptor(target, prop);
            if (descriptor) {
                descriptor.configurable = true; // prevent "TypeError: 'getOwnPropertyDescriptor' on proxy: trap reported non-configurability for property '...' which is either non-existant or configurable in the proxy target"
            }
            return descriptor;
        },
        getPrototypeOf(target) {
            target = getTargetValue(context.root.cache, context.target);
            return Reflect.getPrototypeOf(target);
        },
    };
    const proxy = new Proxy({}, handler);
    return proxy;
}
function removeVoidProperties(obj) {
    if (typeof obj !== 'object') {
        return;
    }
    Object.keys(obj).forEach(key => {
        const val = obj[key];
        if (val === null || typeof val === 'undefined') {
            delete obj[key];
        }
        else if (typeof val === 'object') {
            removeVoidProperties(val);
        }
    });
}
/**
 * Convenience function to access ILiveDataProxyValue methods on a proxied value
 * @param proxiedValue The proxied value to get access to
 * @returns Returns the same object typecasted to an ILiveDataProxyValue
 * @example
 * // IChatMessages is an ObjectCollection<IChatMessage>
 * let observable: Observable<IChatMessages>;
 *
 * // Allows you to do this:
 * observable = proxyAccess<IChatMessages>(chat.messages).getObservable();
 *
 * // Instead of:
 * observable = (chat.messages.msg1 as any as ILiveDataProxyValue<IChatMessages>).getObservable();
 *
 * // Both do the exact same, but the first is less obscure
 */
function proxyAccess(proxiedValue) {
    if (typeof proxiedValue !== 'object' || !proxiedValue[isProxy]) {
        throw new Error('Given value is not proxied. Make sure you are referencing the value through the live data proxy.');
    }
    return proxiedValue;
}
exports.proxyAccess = proxyAccess;
/**
 * Provides functionality to work with ordered collections through a live data proxy. Eliminates
 * the need for arrays to handle ordered data by adding a 'sort' properties to child objects in a
 * collection, and provides functionality to sort and reorder items with a minimal amount of database
 * updates.
 */
class OrderedCollectionProxy {
    constructor(collection, orderProperty = 'order', orderIncrement = 10) {
        this.collection = collection;
        this.orderProperty = orderProperty;
        this.orderIncrement = orderIncrement;
        if (typeof collection !== 'object' || !collection[isProxy]) {
            throw new Error('Collection is not proxied');
        }
        if (collection.valueOf() instanceof Array) {
            throw new Error('Collection is an array, not an object collection');
        }
        if (!Object.keys(collection).every(key => typeof collection[key] === 'object')) {
            throw new Error('Collection has non-object children');
        }
        // Check if the collection has order properties. If not, assign them now
        const ok = Object.keys(collection).every(key => typeof collection[key][orderProperty] === 'number');
        if (!ok) {
            // Assign order properties now. Database will be updated automatically
            const keys = Object.keys(collection);
            for (let i = 0; i < keys.length; i++) {
                const item = collection[keys[i]];
                item[orderProperty] = i * orderIncrement; // 0, 10, 20, 30 etc
            }
        }
    }
    /**
     * Gets an observable for the target object collection. Same as calling `collection.getObservable()`
     * @returns
     */
    getObservable() {
        return proxyAccess(this.collection).getObservable();
    }
    /**
     * Gets an observable that emits a new ordered array representation of the object collection each time
     * the unlaying data is changed. Same as calling `getArray()` in a `getObservable().subscribe` callback
     * @returns
     */
    getArrayObservable() {
        const Observable = (0, optional_observable_1.getObservable)();
        return new Observable((subscriber => {
            const subscription = this.getObservable().subscribe(( /*value*/) => {
                const newArray = this.getArray();
                subscriber.next(newArray);
            });
            return function unsubscribe() {
                subscription.unsubscribe();
            };
        }));
    }
    /**
     * Gets an ordered array representation of the items in your object collection. The items in the array
     * are proxied values, changes will be in sync with the database. Note that the array itself
     * is not mutable: adding or removing items to it will NOT update the collection in the
     * the database and vice versa. Use `add`, `delete`, `sort` and `move` methods to make changes
     * that impact the collection's sorting order
     * @returns order array
     */
    getArray() {
        const arr = proxyAccess(this.collection).toArray((a, b) => a[this.orderProperty] - b[this.orderProperty]);
        // arr.push = (...items: T[]) => {
        //     items.forEach(item => this.add(item));
        //     return arr.length;
        // };
        return arr;
    }
    /**
     * Adds or moves an item to/within the object collection and takes care of the proper sorting order.
     * @param item Item to add or move
     * @param index Optional target index in the sorted representation, appends if not specified.
     * @param from If the item is being moved
     * @returns
     */
    add(item, index, from) {
        const arr = this.getArray();
        let minOrder = Number.POSITIVE_INFINITY, maxOrder = Number.NEGATIVE_INFINITY;
        for (let i = 0; i < arr.length; i++) {
            const order = arr[i][this.orderProperty];
            minOrder = Math.min(order, minOrder);
            maxOrder = Math.max(order, maxOrder);
        }
        let fromKey;
        if (typeof from === 'number') {
            // Moving existing item
            fromKey = Object.keys(this.collection).find(key => this.collection[key] === item);
            if (!fromKey) {
                throw new Error('item not found in collection');
            }
            if (from === index) {
                return { key: fromKey, index };
            }
            if (Math.abs(from - index) === 1) {
                // Position being swapped, swap their order property values
                const otherItem = arr[index];
                const otherOrder = otherItem[this.orderProperty];
                otherItem[this.orderProperty] = item[this.orderProperty];
                item[this.orderProperty] = otherOrder;
                return { key: fromKey, index };
            }
            else {
                // Remove from array, code below will add again
                arr.splice(from, 1);
            }
        }
        if (typeof index !== 'number' || index >= arr.length) {
            // append at the end
            index = arr.length;
            item[this.orderProperty] = (arr.length == 0 ? 0 : maxOrder + this.orderIncrement);
        }
        else if (index === 0) {
            // insert before all others
            item[this.orderProperty] = (arr.length == 0 ? 0 : minOrder - this.orderIncrement);
        }
        else {
            // insert between 2 others
            const orders = arr.map(item => item[this.orderProperty]);
            const gap = orders[index] - orders[index - 1];
            if (gap > 1) {
                item[this.orderProperty] = (orders[index] - Math.floor(gap / 2));
            }
            else {
                // TODO: Can this gap be enlarged by moving one of both orders?
                // For now, change all other orders
                arr.splice(index, 0, item);
                for (let i = 0; i < arr.length; i++) {
                    arr[i][this.orderProperty] = (i * this.orderIncrement);
                }
            }
        }
        const key = typeof fromKey === 'string'
            ? fromKey // Moved item, don't add it
            : proxyAccess(this.collection).push(item);
        return { key, index };
    }
    /**
     * Deletes an item from the object collection using the their index in the sorted array representation
     * @param index
     * @returns the key of the collection's child that was deleted
     */
    delete(index) {
        const arr = this.getArray();
        const item = arr[index];
        if (!item) {
            throw new Error(`Item at index ${index} not found`);
        }
        const key = Object.keys(this.collection).find(key => this.collection[key] === item);
        if (!key) {
            throw new Error('Cannot find target object to delete');
        }
        this.collection[key] = null; // Deletes it from db
        return { key, index };
    }
    /**
     * Moves an item in the object collection by reordering it
     * @param fromIndex Current index in the array (the ordered representation of the object collection)
     * @param toIndex Target index in the array
     * @returns
     */
    move(fromIndex, toIndex) {
        const arr = this.getArray();
        return this.add(arr[fromIndex], toIndex, fromIndex);
    }
    /**
     * Reorders the object collection using given sort function. Allows quick reordering of the collection which is persisted in the database
     * @param sortFn
     */
    sort(sortFn) {
        const arr = this.getArray();
        arr.sort(sortFn);
        for (let i = 0; i < arr.length; i++) {
            arr[i][this.orderProperty] = i * this.orderIncrement;
        }
    }
}
exports.OrderedCollectionProxy = OrderedCollectionProxy;

},{"./data-reference":39,"./data-snapshot":40,"./id":42,"./optional-observable":45,"./path-info":47,"./path-reference":48,"./process":49,"./simple-event-emitter":53,"./utils":58}],39:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DataReferencesArray = exports.DataSnapshotsArray = exports.DataReferenceQuery = exports.DataReference = exports.QueryDataRetrievalOptions = exports.DataRetrievalOptions = void 0;
const data_snapshot_1 = require("./data-snapshot");
const subscription_1 = require("./subscription");
const id_1 = require("./id");
const path_info_1 = require("./path-info");
const data_proxy_1 = require("./data-proxy");
const optional_observable_1 = require("./optional-observable");
class DataRetrievalOptions {
    /**
     * Options for data retrieval, allows selective loading of object properties
     */
    constructor(options) {
        if (!options) {
            options = {};
        }
        if (typeof options.include !== 'undefined' && !(options.include instanceof Array)) {
            throw new TypeError('options.include must be an array');
        }
        if (typeof options.exclude !== 'undefined' && !(options.exclude instanceof Array)) {
            throw new TypeError('options.exclude must be an array');
        }
        if (typeof options.child_objects !== 'undefined' && typeof options.child_objects !== 'boolean') {
            throw new TypeError('options.child_objects must be a boolean');
        }
        if (typeof options.cache_mode === 'string' && !['allow', 'bypass', 'force'].includes(options.cache_mode)) {
            throw new TypeError('invalid value for options.cache_mode');
        }
        this.include = options.include || undefined;
        this.exclude = options.exclude || undefined;
        this.child_objects = typeof options.child_objects === 'boolean' ? options.child_objects : undefined;
        this.cache_mode = typeof options.cache_mode === 'string'
            ? options.cache_mode
            : typeof options.allow_cache === 'boolean'
                ? options.allow_cache ? 'allow' : 'bypass'
                : 'allow';
        this.cache_cursor = typeof options.cache_cursor === 'string' ? options.cache_cursor : undefined;
    }
}
exports.DataRetrievalOptions = DataRetrievalOptions;
class QueryDataRetrievalOptions extends DataRetrievalOptions {
    /**
     * @param options Options for data retrieval, allows selective loading of object properties
     */
    constructor(options) {
        super(options);
        if (!['undefined', 'boolean'].includes(typeof options.snapshots)) {
            throw new TypeError('options.snapshots must be a boolean');
        }
        this.snapshots = typeof options.snapshots === 'boolean' ? options.snapshots : true;
    }
}
exports.QueryDataRetrievalOptions = QueryDataRetrievalOptions;
const _private = Symbol('private');
class DataReference {
    /**
     * Creates a reference to a node
     */
    constructor(db, path, vars) {
        this.db = db;
        if (!path) {
            path = '';
        }
        path = path.replace(/^\/|\/$/g, ''); // Trim slashes
        const pathInfo = path_info_1.PathInfo.get(path);
        const key = pathInfo.key;
        const callbacks = [];
        this[_private] = {
            get path() { return path; },
            get key() { return key; },
            get callbacks() { return callbacks; },
            vars: vars || {},
            context: {},
            pushed: false,
            cursor: null,
        };
    }
    context(context, merge = false) {
        const currentContext = this[_private].context;
        if (typeof context === 'object') {
            const newContext = context ? merge ? currentContext || {} : context : {};
            if (context) {
                // Merge new with current context
                Object.keys(context).forEach(key => {
                    newContext[key] = context[key];
                });
            }
            this[_private].context = newContext;
            return this;
        }
        else if (typeof context === 'undefined') {
            console.warn('Use snap.context() instead of snap.ref.context() to get updating context in event callbacks');
            return currentContext;
        }
        else {
            throw new Error('Invalid context argument');
        }
    }
    /**
     * Contains the last received cursor for this referenced path (if the connected database has transaction logging enabled).
     * If you want to be notified if this value changes, add a handler with `ref.onCursor(callback)`
     */
    get cursor() {
        return this[_private].cursor;
    }
    set cursor(value) {
        var _a;
        this[_private].cursor = value;
        (_a = this.onCursor) === null || _a === void 0 ? void 0 : _a.call(this, value);
    }
    /**
    * The path this instance was created with
    */
    get path() { return this[_private].path; }
    /**
     * The key or index of this node
     */
    get key() {
        const key = this[_private].key;
        return typeof key === 'number' ? `[${key}]` : key;
    }
    /**
     * If the "key" is a number, it is an index!
     */
    get index() {
        const key = this[_private].key;
        if (typeof key !== 'number') {
            throw new Error(`"${key}" is not a number`);
        }
        return key;
    }
    /**
     * Returns a new reference to this node's parent
     */
    get parent() {
        const currentPath = path_info_1.PathInfo.fillVariables2(this.path, this.vars);
        const info = path_info_1.PathInfo.get(currentPath);
        if (info.parentPath === null) {
            return null;
        }
        return new DataReference(this.db, info.parentPath).context(this[_private].context);
    }
    /**
     * Contains values of the variables/wildcards used in a subscription path if this reference was
     * created by an event ("value", "child_added" etc), or in a type mapping path when serializing / instantiating typed objects
     */
    get vars() {
        return this[_private].vars;
    }
    /**
     * Returns a new reference to a child node
     * @param childPath Child key, index or path
     * @returns reference to the child
     */
    child(childPath) {
        childPath = typeof childPath === 'number' ? childPath : childPath.replace(/^\/|\/$/g, '');
        const currentPath = path_info_1.PathInfo.fillVariables2(this.path, this.vars);
        const targetPath = path_info_1.PathInfo.getChildPath(currentPath, childPath);
        return new DataReference(this.db, targetPath).context(this[_private].context); //  `${this.path}/${childPath}`
    }
    /**
     * Sets or overwrites the stored value
     * @param value value to store in database
     * @param onComplete optional completion callback to use instead of returning promise
     * @returns promise that resolves with this reference when completed
     */
    async set(value, onComplete) {
        try {
            if (this.isWildcardPath) {
                throw new Error(`Cannot set the value of wildcard path "/${this.path}"`);
            }
            if (this.parent === null) {
                throw new Error('Cannot set the root object. Use update, or set individual child properties');
            }
            if (typeof value === 'undefined') {
                throw new TypeError(`Cannot store undefined value in "/${this.path}"`);
            }
            if (!this.db.isReady) {
                await this.db.ready();
            }
            value = this.db.types.serialize(this.path, value);
            const { cursor } = await this.db.api.set(this.path, value, { context: this[_private].context });
            this.cursor = cursor;
            if (typeof onComplete === 'function') {
                try {
                    onComplete(null, this);
                }
                catch (err) {
                    console.error('Error in onComplete callback:', err);
                }
            }
        }
        catch (err) {
            if (typeof onComplete === 'function') {
                try {
                    onComplete(err, this);
                }
                catch (err) {
                    console.error('Error in onComplete callback:', err);
                }
            }
            else {
                // throw again
                throw err;
            }
        }
        return this;
    }
    /**
     * Updates properties of the referenced node
     * @param updates containing the properties to update
     * @param onComplete optional completion callback to use instead of returning promise
     * @return returns promise that resolves with this reference once completed
     */
    async update(updates, onComplete) {
        try {
            if (this.isWildcardPath) {
                throw new Error(`Cannot update the value of wildcard path "/${this.path}"`);
            }
            if (!this.db.isReady) {
                await this.db.ready();
            }
            if (typeof updates !== 'object' || updates instanceof Array || updates instanceof ArrayBuffer || updates instanceof Date) {
                await this.set(updates);
            }
            else if (Object.keys(updates).length === 0) {
                console.warn(`update called on path "/${this.path}", but there is nothing to update`);
            }
            else {
                updates = this.db.types.serialize(this.path, updates);
                const { cursor } = await this.db.api.update(this.path, updates, { context: this[_private].context });
                this.cursor = cursor;
            }
            if (typeof onComplete === 'function') {
                try {
                    onComplete(null, this);
                }
                catch (err) {
                    console.error('Error in onComplete callback:', err);
                }
            }
        }
        catch (err) {
            if (typeof onComplete === 'function') {
                try {
                    onComplete(err, this);
                }
                catch (err) {
                    console.error('Error in onComplete callback:', err);
                }
            }
            else {
                // throw again
                throw err;
            }
        }
        return this;
    }
    /**
     * Sets the value a node using a transaction: it runs your callback function with the current value, uses its return value as the new value to store.
     * The transaction is canceled if your callback returns undefined, or throws an error. If your callback returns null, the target node will be removed.
     * @param callback - callback function that performs the transaction on the node's current value. It must return the new value to store (or promise with new value), undefined to cancel the transaction, or null to remove the node.
     * @returns returns a promise that resolves with the DataReference once the transaction has been processed
     */
    async transaction(callback) {
        if (this.isWildcardPath) {
            throw new Error(`Cannot start a transaction on wildcard path "/${this.path}"`);
        }
        if (!this.db.isReady) {
            await this.db.ready();
        }
        let throwError;
        const cb = (currentValue) => {
            currentValue = this.db.types.deserialize(this.path, currentValue);
            const snap = new data_snapshot_1.DataSnapshot(this, currentValue);
            let newValue;
            try {
                newValue = callback(snap);
            }
            catch (err) {
                // callback code threw an error
                throwError = err; // Remember error
                return; // cancel transaction by returning undefined
            }
            if (newValue instanceof Promise) {
                return newValue
                    .then((val) => {
                    return this.db.types.serialize(this.path, val);
                })
                    .catch(err => {
                    throwError = err; // Remember error
                    return; // cancel transaction by returning undefined
                });
            }
            else {
                return this.db.types.serialize(this.path, newValue);
            }
        };
        const { cursor } = await this.db.api.transaction(this.path, cb, { context: this[_private].context });
        this.cursor = cursor;
        if (throwError) {
            // Rethrow error from callback code
            throw throwError;
        }
        return this;
    }
    on(event, callback, cancelCallback) {
        if (this.path === '' && ['value', 'child_changed'].includes(event)) {
            // Removed 'notify_value' and 'notify_child_changed' events from the list, they do not require additional data loading anymore.
            console.warn('WARNING: Listening for value and child_changed events on the root node is a bad practice. These events require loading of all data (value event), or potentially lots of data (child_changed event) each time they are fired');
        }
        let eventPublisher = null;
        const eventStream = new subscription_1.EventStream(publisher => { eventPublisher = publisher; });
        // Map OUR callback to original callback, so .off can remove the right callback(s)
        const cb = {
            event,
            stream: eventStream,
            userCallback: typeof callback === 'function' && callback,
            ourCallback: (err, path, newValue, oldValue, eventContext) => {
                if (err) {
                    // TODO: Investigate if this ever happens?
                    this.db.debug.error(`Error getting data for event ${event} on path "${path}"`, err);
                    return;
                }
                const ref = this.db.ref(path);
                ref[_private].vars = path_info_1.PathInfo.extractVariables(this.path, path);
                let callbackObject;
                if (event.startsWith('notify_')) {
                    // No data event, callback with reference
                    callbackObject = ref.context(eventContext || {});
                }
                else {
                    const values = {
                        previous: this.db.types.deserialize(path, oldValue),
                        current: this.db.types.deserialize(path, newValue),
                    };
                    if (event === 'child_removed') {
                        callbackObject = new data_snapshot_1.DataSnapshot(ref, values.previous, true, values.previous, eventContext);
                    }
                    else if (event === 'mutations') {
                        callbackObject = new data_snapshot_1.MutationsDataSnapshot(ref, values.current, eventContext);
                    }
                    else {
                        const isRemoved = event === 'mutated' && values.current === null;
                        callbackObject = new data_snapshot_1.DataSnapshot(ref, values.current, isRemoved, values.previous, eventContext);
                    }
                }
                eventPublisher.publish(callbackObject);
                if (eventContext === null || eventContext === void 0 ? void 0 : eventContext.acebase_cursor) {
                    this.cursor = eventContext.acebase_cursor;
                }
            },
        };
        this[_private].callbacks.push(cb);
        const subscribe = () => {
            // (NEW) Add callback to event stream
            // ref.on('value', callback) is now exactly the same as ref.on('value').subscribe(callback)
            if (typeof callback === 'function') {
                eventStream.subscribe(callback, (activated, cancelReason) => {
                    if (!activated) {
                        cancelCallback && cancelCallback(cancelReason);
                    }
                });
            }
            const advancedOptions = typeof callback === 'object'
                ? callback
                : { newOnly: !callback }; // newOnly: if callback is not 'truthy', could change this to (typeof callback !== 'function' && callback !== true) but that would break client code that uses a truthy argument.
            if (typeof advancedOptions.newOnly !== 'boolean') {
                advancedOptions.newOnly = false;
            }
            if (this.isWildcardPath) {
                advancedOptions.newOnly = true;
            }
            const cancelSubscription = (err) => {
                // Access denied?
                // Cancel subscription
                const callbacks = this[_private].callbacks;
                callbacks.splice(callbacks.indexOf(cb), 1);
                this.db.api.unsubscribe(this.path, event, cb.ourCallback);
                // Call cancelCallbacks
                this.db.debug.error(`Subscription "${event}" on path "/${this.path}" canceled because of an error: ${err.message}`);
                eventPublisher.cancel(err.message);
            };
            const authorized = this.db.api.subscribe(this.path, event, cb.ourCallback, { newOnly: advancedOptions.newOnly, cancelCallback: cancelSubscription, syncFallback: advancedOptions.syncFallback });
            const allSubscriptionsStoppedCallback = () => {
                const callbacks = this[_private].callbacks;
                callbacks.splice(callbacks.indexOf(cb), 1);
                return this.db.api.unsubscribe(this.path, event, cb.ourCallback);
            };
            if (authorized instanceof Promise) {
                // Web API now returns a promise that resolves if the request is allowed
                // and rejects when access is denied by the set security rules
                authorized.then(() => {
                    // Access granted
                    eventPublisher.start(allSubscriptionsStoppedCallback);
                }).catch(cancelSubscription);
            }
            else {
                // Local API, always authorized
                eventPublisher.start(allSubscriptionsStoppedCallback);
            }
            if (!advancedOptions.newOnly) {
                // If callback param is supplied (either a callback function or true or something else truthy),
                // it will fire events for current values right now.
                // Otherwise, it expects the .subscribe methode to be used, which will then
                // only be called for future events
                if (event === 'value') {
                    this.get(snap => {
                        eventPublisher.publish(snap);
                    });
                }
                else if (event === 'child_added') {
                    this.get(snap => {
                        const val = snap.val();
                        if (val === null || typeof val !== 'object') {
                            return;
                        }
                        Object.keys(val).forEach(key => {
                            const childSnap = new data_snapshot_1.DataSnapshot(this.child(key), val[key]);
                            eventPublisher.publish(childSnap);
                        });
                    });
                }
                else if (event === 'notify_child_added') {
                    // Use the reflect API to get current children.
                    // NOTE: This does not work with AceBaseServer <= v0.9.7, only when signed in as admin
                    const step = 100, limit = step;
                    let skip = 0;
                    const more = async () => {
                        const children = await this.db.api.reflect(this.path, 'children', { limit, skip });
                        children.list.forEach(child => {
                            const childRef = this.child(child.key);
                            eventPublisher.publish(childRef);
                            // typeof callback === 'function' && callback(childRef);
                        });
                        if (children.more) {
                            skip += step;
                            more();
                        }
                    };
                    more();
                }
            }
        };
        if (this.db.isReady) {
            subscribe();
        }
        else {
            this.db.ready(subscribe);
        }
        return eventStream;
    }
    off(event, callback) {
        const subscriptions = this[_private].callbacks;
        const stopSubs = subscriptions.filter(sub => (!event || sub.event === event) && (!callback || sub.userCallback === callback));
        if (stopSubs.length === 0) {
            this.db.debug.warn(`Can't find event subscriptions to stop (path: "${this.path}", event: ${event || '(any)'}, callback: ${callback})`);
        }
        stopSubs.forEach(sub => {
            sub.stream.stop();
        });
        return this;
    }
    get(optionsOrCallback, callback) {
        if (!this.db.isReady) {
            const promise = this.db.ready().then(() => this.get(optionsOrCallback, callback));
            return typeof optionsOrCallback !== 'function' && typeof callback !== 'function' ? promise : undefined; // only return promise if no callback is used
        }
        callback =
            typeof optionsOrCallback === 'function'
                ? optionsOrCallback
                : typeof callback === 'function'
                    ? callback
                    : undefined;
        if (this.isWildcardPath) {
            const error = new Error(`Cannot get value of wildcard path "/${this.path}". Use .query() instead`);
            if (typeof callback === 'function') {
                throw error;
            }
            return Promise.reject(error);
        }
        const options = new DataRetrievalOptions(typeof optionsOrCallback === 'object' ? optionsOrCallback : { cache_mode: 'allow' });
        const promise = this.db.api.get(this.path, options).then(result => {
            var _a;
            const isNewApiResult = ('context' in result && 'value' in result);
            if (!isNewApiResult) {
                // acebase-core version package was updated but acebase or acebase-client package was not? Warn, but don't throw an error.
                console.warn('AceBase api.get method returned an old response value. Update your acebase or acebase-client package');
                result = { value: result, context: {} };
            }
            const value = this.db.types.deserialize(this.path, result.value);
            const snapshot = new data_snapshot_1.DataSnapshot(this, value, undefined, undefined, result.context);
            if ((_a = result.context) === null || _a === void 0 ? void 0 : _a.acebase_cursor) {
                this.cursor = result.context.acebase_cursor;
            }
            return snapshot;
        });
        if (callback) {
            promise.then(callback).catch(err => {
                console.error('Uncaught error:', err);
            });
            return;
        }
        else {
            return promise;
        }
    }
    /**
     * Waits for an event to occur
     * @param event Name of the event, eg "value", "child_added", "child_changed", "child_removed"
     * @param options data retrieval options, to include or exclude specific child keys
     * @returns returns promise that resolves with a snapshot of the data
     */
    once(event, options) {
        if (event === 'value' && !this.isWildcardPath) {
            // Shortcut, do not start listening for future events
            return this.get(options);
        }
        return new Promise((resolve) => {
            const callback = (snap) => {
                this.off(event, callback); // unsubscribe directly
                resolve(snap);
            };
            this.on(event, callback);
        });
    }
    /**
     * @param value optional value to store into the database right away
     * @param onComplete optional callback function to run once value has been stored
     * @returns returns promise that resolves with the reference after the passed value has been stored
     */
    push(value, onComplete) {
        if (this.isWildcardPath) {
            const error = new Error(`Cannot push to wildcard path "/${this.path}"`);
            if (typeof value === 'undefined' || typeof onComplete === 'function') {
                throw error;
            }
            return Promise.reject(error);
        }
        const id = id_1.ID.generate();
        const ref = this.child(id);
        ref[_private].pushed = true;
        if (typeof value !== 'undefined') {
            return ref.set(value, onComplete).then(() => ref);
        }
        else {
            return ref;
        }
    }
    /**
     * Removes this node and all children
     */
    async remove() {
        if (this.isWildcardPath) {
            throw new Error(`Cannot remove wildcard path "/${this.path}". Use query().remove instead`);
        }
        if (this.parent === null) {
            throw new Error('Cannot remove the root node');
        }
        return this.set(null);
    }
    /**
     * Quickly checks if this reference has a value in the database, without returning its data
     * @returns returns a promise that resolves with a boolean value
     */
    async exists() {
        if (this.isWildcardPath) {
            throw new Error(`Cannot check wildcard path "/${this.path}" existence`);
        }
        if (!this.db.isReady) {
            await this.db.ready();
        }
        return this.db.api.exists(this.path);
    }
    get isWildcardPath() {
        return this.path.indexOf('*') >= 0 || this.path.indexOf('$') >= 0;
    }
    /**
     * Creates a query object for current node
     */
    query() {
        return new DataReferenceQuery(this);
    }
    /**
     * Gets the number of children this node has, uses reflection
     */
    async count() {
        const info = await this.reflect('info', { child_count: true });
        return info.children.count;
    }
    async reflect(type, args) {
        if (this.isWildcardPath) {
            throw new Error(`Cannot reflect on wildcard path "/${this.path}"`);
        }
        if (!this.db.isReady) {
            await this.db.ready();
        }
        return this.db.api.reflect(this.path, type, args);
    }
    async export(write, options = { format: 'json', type_safe: true }) {
        if (this.isWildcardPath) {
            throw new Error(`Cannot export wildcard path "/${this.path}"`);
        }
        if (!this.db.isReady) {
            await this.db.ready();
        }
        const writeFn = typeof write === 'function' ? write : write.write.bind(write);
        return this.db.api.export(this.path, writeFn, options);
    }
    /**
     * Imports the value of this node and all children
     * @param read Function that reads data from your stream
     * @param options Only supported format currently is json
     * @returns returns a promise that resolves once all data is imported
     */
    async import(read, options = { format: 'json', suppress_events: false }) {
        if (this.isWildcardPath) {
            throw new Error(`Cannot import to wildcard path "/${this.path}"`);
        }
        if (!this.db.isReady) {
            await this.db.ready();
        }
        return this.db.api.import(this.path, read, options);
    }
    proxy(options) {
        const isOptionsArg = typeof options === 'object' && (typeof options.cursor !== 'undefined' || typeof options.defaultValue !== 'undefined');
        if (typeof options !== 'undefined' && !isOptionsArg) {
            this.db.debug.warn('Warning: live data proxy is being initialized with a deprecated method signature. Use ref.proxy(options) instead of ref.proxy(defaultValue)');
            options = { defaultValue: options };
        }
        return data_proxy_1.LiveDataProxy.create(this, options);
    }
    /**
      * @param options optional initial data retrieval options.
      * Not recommended to use yet - given includes/excludes are not applied to received mutations,
      * or sync actions when using an AceBaseClient with cache db.
      */
    observe(options) {
        // options should not be used yet - we can't prevent/filter mutation events on excluded paths atm
        if (options) {
            throw new Error('observe does not support data retrieval options yet');
        }
        if (this.isWildcardPath) {
            throw new Error(`Cannot observe wildcard path "/${this.path}"`);
        }
        const Observable = (0, optional_observable_1.getObservable)();
        return new Observable((observer => {
            let cache, resolved = false;
            let promise = this.get(options).then(snap => {
                resolved = true;
                cache = snap.val();
                observer.next(cache);
            });
            const updateCache = (snap) => {
                if (!resolved) {
                    promise = promise.then(() => updateCache(snap));
                    return;
                }
                const mutatedPath = snap.ref.path;
                if (mutatedPath === this.path) {
                    cache = snap.val();
                    return observer.next(cache);
                }
                const trailKeys = path_info_1.PathInfo.getPathKeys(mutatedPath).slice(path_info_1.PathInfo.getPathKeys(this.path).length);
                let target = cache;
                while (trailKeys.length > 1) {
                    const key = trailKeys.shift();
                    if (!(key in target)) {
                        // Happens if initial loaded data did not include / excluded this data,
                        // or we missed out on an event
                        target[key] = typeof trailKeys[0] === 'number' ? [] : {};
                    }
                    target = target[key];
                }
                const prop = trailKeys.shift();
                const newValue = snap.val();
                if (newValue === null) {
                    // Remove it
                    target instanceof Array && typeof prop === 'number' ? target.splice(prop, 1) : delete target[prop];
                }
                else {
                    // Set or update it
                    target[prop] = newValue;
                }
                observer.next(cache);
            };
            this.on('mutated', updateCache); // TODO: Refactor to 'mutations' event instead
            // Return unsubscribe function
            return () => {
                this.off('mutated', updateCache);
            };
        }));
    }
    async forEach(callbackOrOptions, callback) {
        let options;
        if (typeof callbackOrOptions === 'function') {
            callback = callbackOrOptions;
        }
        else {
            options = callbackOrOptions;
        }
        if (typeof callback !== 'function') {
            throw new TypeError('No callback function given');
        }
        // Get all children through reflection. This could be tweaked further using paging
        const info = await this.reflect('children', { limit: 0, skip: 0 }); // Gets ALL child keys
        const summary = {
            canceled: false,
            total: info.list.length,
            processed: 0,
        };
        // Iterate through all children until callback returns false
        for (let i = 0; i < info.list.length; i++) {
            const key = info.list[i].key;
            // Get child data
            const snapshot = await this.child(key).get(options);
            summary.processed++;
            if (!snapshot.exists()) {
                // Was removed in the meantime, skip
                continue;
            }
            // Run callback
            const result = await callback(snapshot);
            if (result === false) {
                summary.canceled = true;
                break; // Stop looping
            }
        }
        return summary;
    }
    async getMutations(cursorOrDate) {
        const cursor = typeof cursorOrDate === 'string' ? cursorOrDate : undefined;
        const timestamp = cursorOrDate === null || typeof cursorOrDate === 'undefined' ? 0 : cursorOrDate instanceof Date ? cursorOrDate.getTime() : undefined;
        return this.db.api.getMutations({ path: this.path, cursor, timestamp });
    }
    async getChanges(cursorOrDate) {
        const cursor = typeof cursorOrDate === 'string' ? cursorOrDate : undefined;
        const timestamp = cursorOrDate === null || typeof cursorOrDate === 'undefined' ? 0 : cursorOrDate instanceof Date ? cursorOrDate.getTime() : undefined;
        return this.db.api.getChanges({ path: this.path, cursor, timestamp });
    }
}
exports.DataReference = DataReference;
class DataReferenceQuery {
    /**
     * Creates a query on a reference
     */
    constructor(ref) {
        this.ref = ref;
        this[_private] = {
            filters: [],
            skip: 0,
            take: 0,
            order: [],
            events: {},
        };
    }
    /**
     * Applies a filter to the children of the refence being queried.
     * If there is an index on the property key being queried, it will be used
     * to speed up the query
     * @param key property to test value of
     * @param op operator to use
     * @param compare value to compare with
     */
    filter(key, op, compare) {
        if ((op === 'in' || op === '!in') && (!(compare instanceof Array) || compare.length === 0)) {
            throw new Error(`${op} filter for ${key} must supply an Array compare argument containing at least 1 value`);
        }
        if ((op === 'between' || op === '!between') && (!(compare instanceof Array) || compare.length !== 2)) {
            throw new Error(`${op} filter for ${key} must supply an Array compare argument containing 2 values`);
        }
        if ((op === 'matches' || op === '!matches') && !(compare instanceof RegExp)) {
            throw new Error(`${op} filter for ${key} must supply a RegExp compare argument`);
        }
        // DISABLED 2019/10/23 because it is not fully implemented only works locally
        // if (op === "custom" && typeof compare !== "function") {
        //     throw `${op} filter for ${key} must supply a Function compare argument`;
        // }
        // DISABLED 2022/08/15, implemented by query.ts in acebase
        // if ((op === 'contains' || op === '!contains') && ((typeof compare === 'object' && !(compare instanceof Array) && !(compare instanceof Date)) || (compare instanceof Array && compare.length === 0))) {
        //     throw new Error(`${op} filter for ${key} must supply a simple value or (non-zero length) array compare argument`);
        // }
        this[_private].filters.push({ key, op, compare });
        return this;
    }
    /**
     * @deprecated use `.filter` instead
     */
    where(key, op, compare) {
        return this.filter(key, op, compare);
    }
    /**
     * Limits the number of query results
     */
    take(n) {
        this[_private].take = n;
        return this;
    }
    /**
     * Skips the first n query results
     */
    skip(n) {
        this[_private].skip = n;
        return this;
    }
    sort(key, ascending = true) {
        if (!['string', 'number'].includes(typeof key)) {
            throw 'key must be a string or number';
        }
        this[_private].order.push({ key, ascending });
        return this;
    }
    /**
     * @deprecated use `.sort` instead
     */
    order(key, ascending = true) {
        return this.sort(key, ascending);
    }
    get(optionsOrCallback, callback) {
        if (!this.ref.db.isReady) {
            const promise = this.ref.db.ready().then(() => this.get(optionsOrCallback, callback));
            return typeof optionsOrCallback !== 'function' && typeof callback !== 'function' ? promise : undefined; // only return promise if no callback is used
        }
        callback =
            typeof optionsOrCallback === 'function'
                ? optionsOrCallback
                : typeof callback === 'function'
                    ? callback
                    : undefined;
        const options = new QueryDataRetrievalOptions(typeof optionsOrCallback === 'object' ? optionsOrCallback : { snapshots: true, cache_mode: 'allow' });
        options.allow_cache = options.cache_mode !== 'bypass'; // Backward compatibility when using older acebase-client
        options.eventHandler = ev => {
            // TODO: implement context for query events
            if (!this[_private].events[ev.name]) {
                return false;
            }
            const listeners = this[_private].events[ev.name];
            if (typeof listeners !== 'object' || listeners.length === 0) {
                return false;
            }
            if (['add', 'change', 'remove'].includes(ev.name)) {
                const eventData = {
                    name: ev.name,
                    ref: new DataReference(this.ref.db, ev.path),
                };
                if (options.snapshots && ev.name !== 'remove') {
                    const val = db.types.deserialize(ev.path, ev.value);
                    eventData.snapshot = new data_snapshot_1.DataSnapshot(eventData.ref, val, false);
                }
                ev = eventData;
            }
            listeners.forEach(callback => {
                var _a, _b;
                try {
                    callback(ev);
                }
                catch (err) {
                    this.ref.db.debug.error(`Error executing "${ev.name}" event handler of realtime query on path "${this.ref.path}": ${(_b = (_a = err === null || err === void 0 ? void 0 : err.stack) !== null && _a !== void 0 ? _a : err === null || err === void 0 ? void 0 : err.message) !== null && _b !== void 0 ? _b : err}`);
                }
            });
        };
        // Check if there are event listeners set for realtime changes
        options.monitor = { add: false, change: false, remove: false };
        if (this[_private].events) {
            if (this[_private].events['add'] && this[_private].events['add'].length > 0) {
                options.monitor.add = true;
            }
            if (this[_private].events['change'] && this[_private].events['change'].length > 0) {
                options.monitor.change = true;
            }
            if (this[_private].events['remove'] && this[_private].events['remove'].length > 0) {
                options.monitor.remove = true;
            }
        }
        // Stop realtime results if they are still enabled on a previous .get on this instance
        this.stop();
        // NOTE: returning promise here, regardless of callback argument. Good argument to refactor method to async/await soon
        const db = this.ref.db;
        return db.api.query(this.ref.path, this[_private], options)
            .catch(err => {
            throw new Error(err);
        })
            .then(res => {
            const { stop } = res;
            let { results, context } = res;
            this.stop = async () => {
                await stop();
            };
            if (!('results' in res && 'context' in res)) {
                console.warn('Query results missing context. Update your acebase and/or acebase-client packages');
                results = res, context = {};
            }
            if (options.snapshots) {
                const snaps = results.map(result => {
                    const val = db.types.deserialize(result.path, result.val);
                    return new data_snapshot_1.DataSnapshot(db.ref(result.path), val, false, undefined, context);
                });
                return DataSnapshotsArray.from(snaps);
            }
            else {
                const refs = results.map(path => db.ref(path));
                return DataReferencesArray.from(refs);
            }
        })
            .then(results => {
            callback && callback(results);
            return results;
        });
    }
    /**
     * Stops a realtime query, no more notifications will be received.
     */
    async stop() {
        // Overridden by .get
    }
    /**
     * Executes the query and returns references. Short for `.get({ snapshots: false })`
     * @param callback callback to use instead of returning a promise
     * @returns returns an Promise that resolves with an array of DataReferences, or void when using a callback
     * @deprecated Use `find` instead
     */
    getRefs(callback) {
        return this.get({ snapshots: false }, callback);
    }
    /**
     * Executes the query and returns an array of references. Short for `.get({ snapshots: false })`
     */
    find() {
        return this.get({ snapshots: false });
    }
    /**
     * Executes the query and returns the number of results
     */
    async count() {
        const refs = await this.find();
        return refs.length;
    }
    /**
     * Executes the query and returns if there are any results
     */
    async exists() {
        const originalTake = this[_private].take;
        const p = this.take(1).find();
        this.take(originalTake);
        const refs = await p;
        return refs.length !== 0;
    }
    /**
     * Executes the query, removes all matches from the database
     * @returns returns a Promise that resolves once all matches have been removed
     */
    async remove(callback) {
        const refs = await this.find();
        // Perform updates on each distinct parent collection (only 1 parent if this is not a wildcard path)
        const parentUpdates = refs.reduce((parents, ref) => {
            const parent = parents[ref.parent.path];
            if (!parent) {
                parents[ref.parent.path] = [ref];
            }
            else {
                parent.push(ref);
            }
            return parents;
        }, {});
        const db = this.ref.db;
        const promises = Object.keys(parentUpdates).map(async (parentPath) => {
            const updates = refs.reduce((updates, ref) => {
                updates[ref.key] = null;
                return updates;
            }, {});
            const ref = db.ref(parentPath);
            try {
                await ref.update(updates);
                return { ref, success: true };
            }
            catch (error) {
                return { ref, success: false, error };
            }
        });
        const results = await Promise.all(promises);
        callback && callback(results);
        return results;
    }
    on(event, callback) {
        if (!this[_private].events[event]) {
            this[_private].events[event] = [];
        }
        this[_private].events[event].push(callback);
        return this;
    }
    /**
     * Unsubscribes from (a) previously added event(s)
     * @param event Name of the event
     * @param callback callback function to remove
     * @returns returns reference to this query
     */
    off(event, callback) {
        if (typeof event === 'undefined') {
            this[_private].events = {};
            return this;
        }
        if (!this[_private].events[event]) {
            return this;
        }
        if (typeof callback === 'undefined') {
            delete this[_private].events[event];
            return this;
        }
        const index = this[_private].events[event].indexOf(callback);
        if (!~index) {
            return this;
        }
        this[_private].events[event].splice(index, 1);
        return this;
    }
    async forEach(callbackOrOptions, callback) {
        let options;
        if (typeof callbackOrOptions === 'function') {
            callback = callbackOrOptions;
        }
        else {
            options = callbackOrOptions;
        }
        if (typeof callback !== 'function') {
            throw new TypeError('No callback function given');
        }
        // Get all query results. This could be tweaked further using paging
        const refs = await this.find();
        const summary = {
            canceled: false,
            total: refs.length,
            processed: 0,
        };
        // Iterate through all children until callback returns false
        for (let i = 0; i < refs.length; i++) {
            const ref = refs[i];
            // Get child data
            const snapshot = await ref.get(options);
            summary.processed++;
            if (!snapshot.exists()) {
                // Was removed in the meantime, skip
                continue;
            }
            // Run callback
            const result = await callback(snapshot);
            if (result === false) {
                summary.canceled = true;
                break; // Stop looping
            }
        }
        return summary;
    }
}
exports.DataReferenceQuery = DataReferenceQuery;
class DataSnapshotsArray extends Array {
    static from(snaps) {
        const arr = new DataSnapshotsArray(snaps.length);
        snaps.forEach((snap, i) => arr[i] = snap);
        return arr;
    }
    getValues() {
        return this.map(snap => snap.val());
    }
}
exports.DataSnapshotsArray = DataSnapshotsArray;
class DataReferencesArray extends Array {
    static from(refs) {
        const arr = new DataReferencesArray(refs.length);
        refs.forEach((ref, i) => arr[i] = ref);
        return arr;
    }
    getPaths() {
        return this.map(ref => ref.path);
    }
}
exports.DataReferencesArray = DataReferencesArray;

},{"./data-proxy":38,"./data-snapshot":40,"./id":42,"./optional-observable":45,"./path-info":47,"./subscription":55}],40:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MutationsDataSnapshot = exports.DataSnapshot = void 0;
const path_info_1 = require("./path-info");
function getChild(snapshot, path, previous = false) {
    if (!snapshot.exists()) {
        return null;
    }
    let child = previous ? snapshot.previous() : snapshot.val();
    if (typeof path === 'number') {
        return child[path];
    }
    path_info_1.PathInfo.getPathKeys(path).every(key => {
        child = child[key];
        return typeof child !== 'undefined';
    });
    return child || null;
}
function getChildren(snapshot) {
    if (!snapshot.exists()) {
        return [];
    }
    const value = snapshot.val();
    if (value instanceof Array) {
        return new Array(value.length).map((v, i) => i);
    }
    if (typeof value === 'object') {
        return Object.keys(value);
    }
    return [];
}
class DataSnapshot {
    /**
     * Indicates whether the node exists in the database
     */
    exists() { return false; }
    /**
     * Creates a new DataSnapshot instance
     */
    constructor(ref, value, isRemoved = false, prevValue, context) {
        this.ref = ref;
        this.val = () => { return value; };
        this.previous = () => { return prevValue; };
        this.exists = () => {
            if (isRemoved) {
                return false;
            }
            return value !== null && typeof value !== 'undefined';
        };
        this.context = () => { return context || {}; };
    }
    /**
     * Creates a `DataSnapshot` instance
     * @internal (for internal use)
     */
    static for(ref, value) {
        return new DataSnapshot(ref, value);
    }
    child(path) {
        // Create new snapshot for child data
        const val = getChild(this, path, false);
        const prev = getChild(this, path, true);
        return new DataSnapshot(this.ref.child(path), val, false, prev);
    }
    /**
     * Checks if the snapshot's value has a child with the given key or path
     * @param path child key or path
     */
    hasChild(path) {
        return getChild(this, path) !== null;
    }
    /**
     * Indicates whether the the snapshot's value has any child nodes
     */
    hasChildren() {
        return getChildren(this).length > 0;
    }
    /**
     * The number of child nodes in this snapshot
     */
    numChildren() {
        return getChildren(this).length;
    }
    /**
     * Runs a callback function for each child node in this snapshot until the callback returns false
     * @param callback function that is called with a snapshot of each child node in this snapshot.
     * Must return a boolean value that indicates whether to continue iterating or not.
     */
    forEach(callback) {
        const value = this.val();
        const prev = this.previous();
        return getChildren(this).every((key) => {
            const snap = new DataSnapshot(this.ref.child(key), value[key], false, prev[key]);
            return callback(snap);
        });
    }
    /**
     * The key of the node's path
     */
    get key() { return this.ref.key; }
}
exports.DataSnapshot = DataSnapshot;
class MutationsDataSnapshot extends DataSnapshot {
    constructor(ref, mutations, context) {
        super(ref, mutations, false, undefined, context);
        /**
         * Don't use this to get previous values of mutated nodes.
         * Use `.previous` properties on the individual child snapshots instead.
         * @throws Throws an error if you do use it.
         */
        this.previous = () => { throw new Error('Iterate values to get previous values for each mutation'); };
        this.val = (warn = true) => {
            if (warn) {
                console.warn('Unless you know what you are doing, it is best not to use the value of a mutations snapshot directly. Use child methods and forEach to iterate the mutations instead');
            }
            return mutations;
        };
    }
    /**
     * Runs a callback function for each mutation in this snapshot until the callback returns false
     * @param callback function that is called with a snapshot of each mutation in this snapshot. Must return a boolean value that indicates whether to continue iterating or not.
     * @returns Returns whether every child was interated
     */
    forEach(callback) {
        const mutations = this.val(false);
        return mutations.every(mutation => {
            const ref = mutation.target.reduce((ref, key) => ref.child(key), this.ref);
            const snap = new DataSnapshot(ref, mutation.val, false, mutation.prev);
            return callback(snap);
        });
    }
    child(index) {
        if (typeof index !== 'number') {
            throw new Error('child index must be a number');
        }
        const mutation = this.val(false)[index];
        const ref = mutation.target.reduce((ref, key) => ref.child(key), this.ref);
        return new DataSnapshot(ref, mutation.val, false, mutation.prev);
    }
}
exports.MutationsDataSnapshot = MutationsDataSnapshot;

},{"./path-info":47}],41:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DebugLogger = void 0;
const process_1 = require("./process");
// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = () => { };
class DebugLogger {
    constructor(level = 'log', prefix = '') {
        this.level = level;
        this.prefix = prefix;
        this.setLevel(level);
    }
    setLevel(level) {
        const prefix = this.prefix ? this.prefix + ' %s' : '';
        this.verbose = ['verbose'].includes(level) ? prefix ? console.log.bind(console, prefix) : console.log.bind(console) : noop;
        this.log = ['verbose', 'log'].includes(level) ? prefix ? console.log.bind(console, prefix) : console.log.bind(console) : noop;
        this.warn = ['verbose', 'log', 'warn'].includes(level) ? prefix ? console.warn.bind(console, prefix) : console.warn.bind(console) : noop;
        this.error = ['verbose', 'log', 'warn', 'error'].includes(level) ? prefix ? console.error.bind(console, prefix) : console.error.bind(console) : noop;
        this.write = (text) => {
            const isRunKit = typeof process_1.default !== 'undefined' && process_1.default.env && typeof process_1.default.env.RUNKIT_ENDPOINT_PATH === 'string';
            if (text && isRunKit) {
                text.split('\n').forEach(line => console.log(line)); // Logs each line separately
            }
            else {
                console.log(text);
            }
        };
    }
}
exports.DebugLogger = DebugLogger;

},{"./process":49}],42:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ID = void 0;
const cuid_1 = require("./cuid");
// const uuid62 = require('uuid62');
let timeBias = 0;
class ID {
    /**
     * (for internal use)
     * bias in milliseconds to adjust generated cuid timestamps with
     */
    static set timeBias(bias) {
        if (typeof bias !== 'number') {
            return;
        }
        timeBias = bias;
    }
    static generate() {
        // Could also use https://www.npmjs.com/package/pushid for Firebase style 20 char id's
        return (0, cuid_1.default)(timeBias).slice(1); // Cuts off the always leading 'c'
        // return uuid62.v1();
    }
}
exports.ID = ID;

},{"./cuid":36}],43:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ObjectCollection = exports.PartialArray = exports.SimpleObservable = exports.SchemaDefinition = exports.Colorize = exports.ColorStyle = exports.SimpleEventEmitter = exports.SimpleCache = exports.ascii85 = exports.PathInfo = exports.Utils = exports.TypeMappings = exports.Transport = exports.EventSubscription = exports.EventPublisher = exports.EventStream = exports.PathReference = exports.ID = exports.DebugLogger = exports.OrderedCollectionProxy = exports.proxyAccess = exports.MutationsDataSnapshot = exports.DataSnapshot = exports.DataReferencesArray = exports.DataSnapshotsArray = exports.QueryDataRetrievalOptions = exports.DataRetrievalOptions = exports.DataReferenceQuery = exports.DataReference = exports.Api = exports.AceBaseBaseSettings = exports.AceBaseBase = void 0;
var acebase_base_1 = require("./acebase-base");
Object.defineProperty(exports, "AceBaseBase", { enumerable: true, get: function () { return acebase_base_1.AceBaseBase; } });
Object.defineProperty(exports, "AceBaseBaseSettings", { enumerable: true, get: function () { return acebase_base_1.AceBaseBaseSettings; } });
var api_1 = require("./api");
Object.defineProperty(exports, "Api", { enumerable: true, get: function () { return api_1.Api; } });
var data_reference_1 = require("./data-reference");
Object.defineProperty(exports, "DataReference", { enumerable: true, get: function () { return data_reference_1.DataReference; } });
Object.defineProperty(exports, "DataReferenceQuery", { enumerable: true, get: function () { return data_reference_1.DataReferenceQuery; } });
Object.defineProperty(exports, "DataRetrievalOptions", { enumerable: true, get: function () { return data_reference_1.DataRetrievalOptions; } });
Object.defineProperty(exports, "QueryDataRetrievalOptions", { enumerable: true, get: function () { return data_reference_1.QueryDataRetrievalOptions; } });
Object.defineProperty(exports, "DataSnapshotsArray", { enumerable: true, get: function () { return data_reference_1.DataSnapshotsArray; } });
Object.defineProperty(exports, "DataReferencesArray", { enumerable: true, get: function () { return data_reference_1.DataReferencesArray; } });
var data_snapshot_1 = require("./data-snapshot");
Object.defineProperty(exports, "DataSnapshot", { enumerable: true, get: function () { return data_snapshot_1.DataSnapshot; } });
Object.defineProperty(exports, "MutationsDataSnapshot", { enumerable: true, get: function () { return data_snapshot_1.MutationsDataSnapshot; } });
var data_proxy_1 = require("./data-proxy");
Object.defineProperty(exports, "proxyAccess", { enumerable: true, get: function () { return data_proxy_1.proxyAccess; } });
Object.defineProperty(exports, "OrderedCollectionProxy", { enumerable: true, get: function () { return data_proxy_1.OrderedCollectionProxy; } });
var debug_1 = require("./debug");
Object.defineProperty(exports, "DebugLogger", { enumerable: true, get: function () { return debug_1.DebugLogger; } });
var id_1 = require("./id");
Object.defineProperty(exports, "ID", { enumerable: true, get: function () { return id_1.ID; } });
var path_reference_1 = require("./path-reference");
Object.defineProperty(exports, "PathReference", { enumerable: true, get: function () { return path_reference_1.PathReference; } });
var subscription_1 = require("./subscription");
Object.defineProperty(exports, "EventStream", { enumerable: true, get: function () { return subscription_1.EventStream; } });
Object.defineProperty(exports, "EventPublisher", { enumerable: true, get: function () { return subscription_1.EventPublisher; } });
Object.defineProperty(exports, "EventSubscription", { enumerable: true, get: function () { return subscription_1.EventSubscription; } });
exports.Transport = require("./transport");
var type_mappings_1 = require("./type-mappings");
Object.defineProperty(exports, "TypeMappings", { enumerable: true, get: function () { return type_mappings_1.TypeMappings; } });
exports.Utils = require("./utils");
var path_info_1 = require("./path-info");
Object.defineProperty(exports, "PathInfo", { enumerable: true, get: function () { return path_info_1.PathInfo; } });
var ascii85_1 = require("./ascii85");
Object.defineProperty(exports, "ascii85", { enumerable: true, get: function () { return ascii85_1.ascii85; } });
var simple_cache_1 = require("./simple-cache");
Object.defineProperty(exports, "SimpleCache", { enumerable: true, get: function () { return simple_cache_1.SimpleCache; } });
var simple_event_emitter_1 = require("./simple-event-emitter");
Object.defineProperty(exports, "SimpleEventEmitter", { enumerable: true, get: function () { return simple_event_emitter_1.SimpleEventEmitter; } });
var simple_colors_1 = require("./simple-colors");
Object.defineProperty(exports, "ColorStyle", { enumerable: true, get: function () { return simple_colors_1.ColorStyle; } });
Object.defineProperty(exports, "Colorize", { enumerable: true, get: function () { return simple_colors_1.Colorize; } });
var schema_1 = require("./schema");
Object.defineProperty(exports, "SchemaDefinition", { enumerable: true, get: function () { return schema_1.SchemaDefinition; } });
var simple_observable_1 = require("./simple-observable");
Object.defineProperty(exports, "SimpleObservable", { enumerable: true, get: function () { return simple_observable_1.SimpleObservable; } });
var partial_array_1 = require("./partial-array");
Object.defineProperty(exports, "PartialArray", { enumerable: true, get: function () { return partial_array_1.PartialArray; } });
const object_collection_1 = require("./object-collection");
Object.defineProperty(exports, "ObjectCollection", { enumerable: true, get: function () { return object_collection_1.ObjectCollection; } });

},{"./acebase-base":32,"./api":33,"./ascii85":34,"./data-proxy":38,"./data-reference":39,"./data-snapshot":40,"./debug":41,"./id":42,"./object-collection":44,"./partial-array":46,"./path-info":47,"./path-reference":48,"./schema":50,"./simple-cache":51,"./simple-colors":52,"./simple-event-emitter":53,"./simple-observable":54,"./subscription":55,"./transport":56,"./type-mappings":57,"./utils":58}],44:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ObjectCollection = void 0;
const id_1 = require("./id");
/**
 * Convenience interface for defining an object collection
 * @example
 * type ChatMessage = {
 *    text: string, uid: string, sent: Date
 * }
 * type Chat = {
 *    title: text
 *    messages: ObjectCollection<ChatMessage>
 * }
 */
class ObjectCollection {
    /**
     * Converts and array of values into an object collection, generating a unique key for each item in the array
     * @param array
     * @example
     * const array = [
     *  { title: "Don't make me think!", author: "Steve Krug" },
     *  { title: "The tipping point", author: "Malcolm Gladwell" }
     * ];
     *
     * // Convert:
     * const collection = ObjectCollection.from(array);
     * // --> {
     * //   kh1x3ygb000120r7ipw6biln: {
     * //       title: "Don't make me think!",
     * //       author: "Steve Krug"
     * //   },
     * //   kh1x3ygb000220r757ybpyec: {
     * //       title: "The tipping point",
     * //       author: "Malcolm Gladwell"
     * //   }
     * // }
     *
     * // Now it's easy to add them to the db:
     * db.ref('books').update(collection);
     */
    static from(array) {
        const collection = {};
        array.forEach(child => {
            collection[id_1.ID.generate()] = child;
        });
        return collection;
    }
}
exports.ObjectCollection = ObjectCollection;

},{"./id":42}],45:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setObservable = exports.getObservable = void 0;
const simple_observable_1 = require("./simple-observable");
const utils_1 = require("./utils");
let _shimRequested = false;
let _observable;
(async () => {
    // Try pre-loading rxjs Observable
    // Test availability in global scope first
    const global = (0, utils_1.getGlobalObject)();
    if (typeof global.Observable !== 'undefined') {
        _observable = global.Observable;
        return;
    }
    // Try importing it from dependencies
    try {
        const { Observable } = await Promise.resolve().then(() => require('rxjs'));
        _observable = Observable;
    }
    catch (_a) {
        // rxjs Observable not available, setObservable must be used if usage of SimpleObservable is not desired
        _observable = simple_observable_1.SimpleObservable;
    }
})();
function getObservable() {
    if (_observable === simple_observable_1.SimpleObservable && !_shimRequested) {
        console.warn('Using AceBase\'s simple Observable implementation because rxjs is not available. ' +
            'Add it to your project with "npm install rxjs", add it to AceBase using db.setObservable(Observable), ' +
            'or call db.setObservable("shim") to suppress this warning');
    }
    if (_observable) {
        return _observable;
    }
    throw new Error('RxJS Observable could not be loaded. ');
}
exports.getObservable = getObservable;
function setObservable(Observable) {
    if (Observable === 'shim') {
        _observable = simple_observable_1.SimpleObservable;
        _shimRequested = true;
    }
    else {
        _observable = Observable;
    }
}
exports.setObservable = setObservable;

},{"./simple-observable":54,"./utils":58,"rxjs":59}],46:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PartialArray = void 0;
/**
 * Sparse/partial array converted to a serializable object. Use `Object.keys(sparseArray)` and `Object.values(sparseArray)` to iterate its indice and/or values
 */
class PartialArray {
    constructor(sparseArray) {
        if (sparseArray instanceof Array) {
            for (let i = 0; i < sparseArray.length; i++) {
                if (typeof sparseArray[i] !== 'undefined') {
                    this[i] = sparseArray[i];
                }
            }
        }
        else if (sparseArray) {
            Object.assign(this, sparseArray);
        }
    }
}
exports.PartialArray = PartialArray;

},{}],47:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PathInfo = void 0;
function getPathKeys(path) {
    path = path.replace(/\[/g, '/[').replace(/^\/+/, '').replace(/\/+$/, ''); // Replace [ with /[, remove leading slashes, remove trailing slashes
    if (path.length === 0) {
        return [];
    }
    const keys = path.split('/');
    return keys.map(key => {
        return key.startsWith('[') ? parseInt(key.slice(1, -1)) : key;
    });
}
class PathInfo {
    static get(path) {
        return new PathInfo(path);
    }
    static getChildPath(path, childKey) {
        // return getChildPath(path, childKey);
        return PathInfo.get(path).child(childKey).path;
    }
    static getPathKeys(path) {
        return getPathKeys(path);
    }
    constructor(path) {
        if (typeof path === 'string') {
            this.keys = getPathKeys(path);
        }
        else if (path instanceof Array) {
            this.keys = path;
        }
        this.path = this.keys.reduce((path, key, i) => i === 0 ? `${key}` : typeof key === 'string' ? `${path}/${key}` : `${path}[${key}]`, '');
    }
    get key() {
        return this.keys.length === 0 ? null : this.keys.slice(-1)[0];
    }
    get parent() {
        if (this.keys.length == 0) {
            return null;
        }
        const parentKeys = this.keys.slice(0, -1);
        return new PathInfo(parentKeys);
    }
    get parentPath() {
        return this.keys.length === 0 ? null : this.parent.path;
    }
    child(childKey) {
        if (typeof childKey === 'string') {
            if (childKey.length === 0) {
                throw new Error(`child key for path "${this.path}" cannot be empty`);
            }
            // Allow expansion of a child path (eg "user/name") into equivalent `child('user').child('name')`
            const keys = getPathKeys(childKey);
            keys.forEach(key => {
                // Check AceBase key rules here so they will be enforced regardless of storage target.
                // This prevents specific keys to be allowed in one environment (eg browser), but then
                // refused upon syncing to a binary AceBase db. Fixes https://github.com/appy-one/acebase/issues/172
                if (typeof key !== 'string') {
                    return;
                }
                if (/[\x00-\x08\x0b\x0c\x0e-\x1f/[\]\\]/.test(key)) {
                    throw new Error(`Invalid child key "${key}" for path "${this.path}". Keys cannot contain control characters or any of the following characters: \\ / [ ]`);
                }
                if (key.length > 128) {
                    throw new Error(`child key "${key}" for path "${this.path}" is too long. Max key length is 128`);
                }
                if (key.length === 0) {
                    throw new Error(`child key for path "${this.path}" cannot be empty`);
                }
            });
            childKey = keys;
        }
        return new PathInfo(this.keys.concat(childKey));
    }
    childPath(childKey) {
        return this.child(childKey).path;
    }
    get pathKeys() {
        return this.keys;
    }
    /**
     * If varPath contains variables or wildcards, it will return them with the values found in fullPath
     * @param {string} varPath path containing variables such as * and $name
     * @param {string} fullPath real path to a node
     * @returns {{ [index: number]: string|number, [variable: string]: string|number }} returns an array-like object with all variable values. All named variables are also set on the array by their name (eg vars.uid and vars.$uid)
     * @example
     * PathInfo.extractVariables('users/$uid/posts/$postid', 'users/ewout/posts/post1/title') === {
     *  0: 'ewout',
     *  1: 'post1',
     *  uid: 'ewout', // or $uid
     *  postid: 'post1' // or $postid
     * };
     *
     * PathInfo.extractVariables('users/*\/posts/*\/$property', 'users/ewout/posts/post1/title') === {
     *  0: 'ewout',
     *  1: 'post1',
     *  2: 'title',
     *  property: 'title' // or $property
     * };
     *
     * PathInfo.extractVariables('users/$user/friends[*]/$friend', 'users/dora/friends[4]/diego') === {
     *  0: 'dora',
     *  1: 4,
     *  2: 'diego',
     *  user: 'dora', // or $user
     *  friend: 'diego' // or $friend
     * };
    */
    static extractVariables(varPath, fullPath) {
        if (!varPath.includes('*') && !varPath.includes('$')) {
            return [];
        }
        // if (!this.equals(fullPath)) {
        //     throw new Error(`path does not match with the path of this PathInfo instance: info.equals(path) === false!`)
        // }
        const keys = getPathKeys(varPath);
        const pathKeys = getPathKeys(fullPath);
        let count = 0;
        const variables = {
            get length() { return count; },
        };
        keys.forEach((key, index) => {
            const pathKey = pathKeys[index];
            if (key === '*') {
                variables[count++] = pathKey;
            }
            else if (typeof key === 'string' && key[0] === '$') {
                variables[count++] = pathKey;
                // Set the $variable property
                variables[key] = pathKey;
                // Set friendly property name (without $)
                const varName = key.slice(1);
                if (typeof variables[varName] === 'undefined') {
                    variables[varName] = pathKey;
                }
            }
        });
        return variables;
    }
    /**
     * If varPath contains variables or wildcards, it will return a path with the variables replaced by the keys found in fullPath.
     * @example
     * PathInfo.fillVariables('users/$uid/posts/$postid', 'users/ewout/posts/post1/title') === 'users/ewout/posts/post1'
     */
    static fillVariables(varPath, fullPath) {
        if (varPath.indexOf('*') < 0 && varPath.indexOf('$') < 0) {
            return varPath;
        }
        const keys = getPathKeys(varPath);
        const pathKeys = getPathKeys(fullPath);
        const merged = keys.map((key, index) => {
            if (key === pathKeys[index] || index >= pathKeys.length) {
                return key;
            }
            else if (typeof key === 'string' && (key === '*' || key[0] === '$')) {
                return pathKeys[index];
            }
            else {
                throw new Error(`Path "${fullPath}" cannot be used to fill variables of path "${varPath}" because they do not match`);
            }
        });
        let mergedPath = '';
        merged.forEach(key => {
            if (typeof key === 'number') {
                mergedPath += `[${key}]`;
            }
            else {
                if (mergedPath.length > 0) {
                    mergedPath += '/';
                }
                mergedPath += key;
            }
        });
        return mergedPath;
    }
    /**
     * Replaces all variables in a path with the values in the vars argument
     * @param varPath path containing variables
     * @param vars variables object such as one gotten from PathInfo.extractVariables
     */
    static fillVariables2(varPath, vars) {
        if (typeof vars !== 'object' || Object.keys(vars).length === 0) {
            return varPath; // Nothing to fill
        }
        const pathKeys = getPathKeys(varPath);
        let n = 0;
        const targetPath = pathKeys.reduce((path, key) => {
            if (typeof key === 'string' && (key === '*' || key.startsWith('$'))) {
                return PathInfo.getChildPath(path, vars[n++]);
            }
            else {
                return PathInfo.getChildPath(path, key);
            }
        }, '');
        return targetPath;
    }
    /**
     * Checks if a given path matches this path, eg "posts/*\/title" matches "posts/12344/title" and "users/123/name" matches "users/$uid/name"
     */
    equals(otherPath) {
        const other = otherPath instanceof PathInfo ? otherPath : new PathInfo(otherPath);
        if (this.path === other.path) {
            return true;
        } // they are identical
        if (this.keys.length !== other.keys.length) {
            return false;
        }
        return this.keys.every((key, index) => {
            const otherKey = other.keys[index];
            return otherKey === key
                || (typeof otherKey === 'string' && (otherKey === '*' || otherKey[0] === '$'))
                || (typeof key === 'string' && (key === '*' || key[0] === '$'));
        });
    }
    /**
     * Checks if a given path is an ancestor, eg "posts" is an ancestor of "posts/12344/title"
     */
    isAncestorOf(descendantPath) {
        const descendant = descendantPath instanceof PathInfo ? descendantPath : new PathInfo(descendantPath);
        if (descendant.path === '' || this.path === descendant.path) {
            return false;
        }
        if (this.path === '') {
            return true;
        }
        if (this.keys.length >= descendant.keys.length) {
            return false;
        }
        return this.keys.every((key, index) => {
            const otherKey = descendant.keys[index];
            return otherKey === key
                || (typeof otherKey === 'string' && (otherKey === '*' || otherKey[0] === '$'))
                || (typeof key === 'string' && (key === '*' || key[0] === '$'));
        });
    }
    /**
     * Checks if a given path is a descendant, eg "posts/1234/title" is a descendant of "posts"
     */
    isDescendantOf(ancestorPath) {
        const ancestor = ancestorPath instanceof PathInfo ? ancestorPath : new PathInfo(ancestorPath);
        if (this.path === '' || this.path === ancestor.path) {
            return false;
        }
        if (ancestorPath === '') {
            return true;
        }
        if (ancestor.keys.length >= this.keys.length) {
            return false;
        }
        return ancestor.keys.every((key, index) => {
            const otherKey = this.keys[index];
            return otherKey === key
                || (typeof otherKey === 'string' && (otherKey === '*' || otherKey[0] === '$'))
                || (typeof key === 'string' && (key === '*' || key[0] === '$'));
        });
    }
    /**
     * Checks if the other path is on the same trail as this path. Paths on the same trail if they share a
     * common ancestor. Eg: "posts" is on the trail of "posts/1234/title" and vice versa.
     */
    isOnTrailOf(otherPath) {
        const other = otherPath instanceof PathInfo ? otherPath : new PathInfo(otherPath);
        if (this.path.length === 0 || other.path.length === 0) {
            return true;
        }
        if (this.path === other.path) {
            return true;
        }
        return this.pathKeys.every((key, index) => {
            if (index >= other.keys.length) {
                return true;
            }
            const otherKey = other.keys[index];
            return otherKey === key
                || (typeof otherKey === 'string' && (otherKey === '*' || otherKey[0] === '$'))
                || (typeof key === 'string' && (key === '*' || key[0] === '$'));
        });
    }
    /**
     * Checks if a given path is a direct child, eg "posts/1234/title" is a child of "posts/1234"
     */
    isChildOf(otherPath) {
        const other = otherPath instanceof PathInfo ? otherPath : new PathInfo(otherPath);
        if (this.path === '') {
            return false;
        } // If our path is the root, it's nobody's child...
        return this.parent.equals(other);
    }
    /**
     * Checks if a given path is its parent, eg "posts/1234" is the parent of "posts/1234/title"
     */
    isParentOf(otherPath) {
        const other = otherPath instanceof PathInfo ? otherPath : new PathInfo(otherPath);
        if (other.path === '') {
            return false;
        } // If the other path is the root, this path cannot be its parent
        return this.equals(other.parent);
    }
}
exports.PathInfo = PathInfo;

},{}],48:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PathReference = void 0;
class PathReference {
    /**
     * Creates a reference to a path that can be stored in the database. Use this to create cross-references to other data in your database
     * @param path
     */
    constructor(path) {
        this.path = path;
    }
}
exports.PathReference = PathReference;

},{}],49:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = {
    // eslint-disable-next-line @typescript-eslint/ban-types
    nextTick(fn) {
        setTimeout(fn, 0);
    },
};

},{}],50:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SchemaDefinition = void 0;
// parses a typestring, creates checker functions
function parse(definition) {
    // tokenize
    let pos = 0;
    function consumeSpaces() {
        let c;
        while (c = definition[pos], [' ', '\r', '\n', '\t'].includes(c)) {
            pos++;
        }
    }
    function consumeCharacter(c) {
        if (definition[pos] !== c) {
            throw new Error(`Unexpected character at position ${pos}. Expected: '${c}', found '${definition[pos]}'`);
        }
        pos++;
    }
    function readProperty() {
        consumeSpaces();
        const prop = { name: '', optional: false, wildcard: false };
        let c;
        while (c = definition[pos], c === '_' || c === '$' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (prop.name.length > 0 && c >= '0' && c <= '9') || (prop.name.length === 0 && c === '*')) {
            prop.name += c;
            pos++;
        }
        if (prop.name.length === 0) {
            throw new Error(`Property name expected at position ${pos}, found: ${definition.slice(pos, pos + 10)}..`);
        }
        if (definition[pos] === '?') {
            prop.optional = true;
            pos++;
        }
        if (prop.name === '*' || prop.name[0] === '$') {
            prop.optional = true;
            prop.wildcard = true;
        }
        consumeSpaces();
        consumeCharacter(':');
        return prop;
    }
    function readType() {
        consumeSpaces();
        let type = { typeOf: 'any' }, c;
        // try reading simple type first: (string,number,boolean,Date etc)
        let name = '';
        while (c = definition[pos], (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) {
            name += c;
            pos++;
        }
        if (name.length === 0) {
            if (definition[pos] === '*') {
                // any value
                consumeCharacter('*');
                type.typeOf = 'any';
            }
            else if (['\'', '"', '`'].includes(definition[pos])) {
                // Read string value
                type.typeOf = 'string';
                type.value = '';
                const quote = definition[pos];
                consumeCharacter(quote);
                while (c = definition[pos], c && c !== quote) {
                    type.value += c;
                    pos++;
                }
                consumeCharacter(quote);
            }
            else if (definition[pos] >= '0' && definition[pos] <= '9') {
                // read numeric value
                type.typeOf = 'number';
                let nr = '';
                while (c = definition[pos], c === '.' || c === 'n' || (c >= '0' && c <= '9')) {
                    nr += c;
                    pos++;
                }
                if (nr.endsWith('n')) {
                    type.value = BigInt(nr);
                }
                else if (nr.includes('.')) {
                    type.value = parseFloat(nr);
                }
                else {
                    type.value = parseInt(nr);
                }
            }
            else if (definition[pos] === '{') {
                // Read object (interface) definition
                consumeCharacter('{');
                type.typeOf = 'object';
                type.instanceOf = Object;
                // Read children:
                type.children = [];
                while (true) {
                    const prop = readProperty();
                    const types = readTypes();
                    type.children.push({ name: prop.name, optional: prop.optional, wildcard: prop.wildcard, types });
                    consumeSpaces();
                    if (definition[pos] === ';' || definition[pos] === ',') {
                        consumeCharacter(definition[pos]);
                        consumeSpaces();
                    }
                    if (definition[pos] === '}') {
                        break;
                    }
                }
                consumeCharacter('}');
            }
            else if (definition[pos] === '/') {
                // Read regular expression definition
                consumeCharacter('/');
                let pattern = '', flags = '';
                while (c = definition[pos], c !== '/' || pattern.endsWith('\\')) {
                    pattern += c;
                    pos++;
                }
                consumeCharacter('/');
                while (c = definition[pos], ['g', 'i', 'm', 's', 'u', 'y', 'd'].includes(c)) {
                    flags += c;
                    pos++;
                }
                type.typeOf = 'string';
                type.matches = new RegExp(pattern, flags);
            }
            else {
                throw new Error(`Expected a type definition at position ${pos}, found character '${definition[pos]}'`);
            }
        }
        else if (['string', 'number', 'boolean', 'bigint', 'undefined', 'String', 'Number', 'Boolean', 'BigInt'].includes(name)) {
            type.typeOf = name.toLowerCase();
        }
        else if (name === 'Object' || name === 'object') {
            type.typeOf = 'object';
            type.instanceOf = Object;
        }
        else if (name === 'Date') {
            type.typeOf = 'object';
            type.instanceOf = Date;
        }
        else if (name === 'Binary' || name === 'binary') {
            type.typeOf = 'object';
            type.instanceOf = ArrayBuffer;
        }
        else if (name === 'any') {
            type.typeOf = 'any';
        }
        else if (name === 'null') {
            // This is ignored, null values are not stored in the db (null indicates deletion)
            type.typeOf = 'object';
            type.value = null;
        }
        else if (name === 'Array') {
            // Read generic Array defintion
            consumeCharacter('<');
            type.typeOf = 'object';
            type.instanceOf = Array; //name;
            type.genericTypes = readTypes();
            consumeCharacter('>');
        }
        else if (['true', 'false'].includes(name)) {
            type.typeOf = 'boolean';
            type.value = name === 'true';
        }
        else {
            throw new Error(`Unknown type at position ${pos}: "${type}"`);
        }
        // Check if it's an Array of given type (eg: string[] or string[][])
        // Also converts to generics, string[] becomes Array<string>, string[][] becomes Array<Array<string>>
        consumeSpaces();
        while (definition[pos] === '[') {
            consumeCharacter('[');
            consumeCharacter(']');
            type = { typeOf: 'object', instanceOf: Array, genericTypes: [type] };
        }
        return type;
    }
    function readTypes() {
        consumeSpaces();
        const types = [readType()];
        while (definition[pos] === '|') {
            consumeCharacter('|');
            types.push(readType());
            consumeSpaces();
        }
        return types;
    }
    return readType();
}
function checkObject(path, properties, obj, partial) {
    // Are there any properties that should not be in there?
    const invalidProperties = properties.find(prop => prop.name === '*' || prop.name[0] === '$') // Only if no wildcard properties are allowed
        ? []
        : Object.keys(obj).filter(key => ![null, undefined].includes(obj[key]) // Ignore null or undefined values
            && !properties.find(prop => prop.name === key));
    if (invalidProperties.length > 0) {
        return { ok: false, reason: `Object at path "${path}" cannot have propert${invalidProperties.length === 1 ? 'y' : 'ies'} ${invalidProperties.map(p => `"${p}"`).join(', ')}` };
    }
    // Loop through properties that should be present
    function checkProperty(property) {
        const hasValue = ![null, undefined].includes(obj[property.name]);
        if (!property.optional && (partial ? obj[property.name] === null : !hasValue)) {
            return { ok: false, reason: `Property at path "${path}/${property.name}" is not optional` };
        }
        if (hasValue && property.types.length === 1) {
            return checkType(`${path}/${property.name}`, property.types[0], obj[property.name], false);
        }
        if (hasValue && !property.types.some(type => checkType(`${path}/${property.name}`, type, obj[property.name], false).ok)) {
            return { ok: false, reason: `Property at path "${path}/${property.name}" does not match any of ${property.types.length} allowed types` };
        }
        return { ok: true };
    }
    const namedProperties = properties.filter(prop => !prop.wildcard);
    const failedProperty = namedProperties.find(prop => !checkProperty(prop).ok);
    if (failedProperty) {
        const reason = checkProperty(failedProperty).reason;
        return { ok: false, reason };
    }
    const wildcardProperty = properties.find(prop => prop.wildcard);
    if (!wildcardProperty) {
        return { ok: true };
    }
    const wildcardChildKeys = Object.keys(obj).filter(key => !namedProperties.find(prop => prop.name === key));
    let result = { ok: true };
    for (let i = 0; i < wildcardChildKeys.length && result.ok; i++) {
        const childKey = wildcardChildKeys[i];
        result = checkProperty({ name: childKey, types: wildcardProperty.types, optional: true, wildcard: true });
    }
    return result;
}
function checkType(path, type, value, partial, trailKeys) {
    const ok = { ok: true };
    if (type.typeOf === 'any') {
        return ok;
    }
    if (trailKeys instanceof Array && trailKeys.length > 0) {
        // The value to check resides in a descendant path of given type definition.
        // Recursivly check child type definitions to find a match
        if (type.typeOf !== 'object') {
            return { ok: false, reason: `path "${path}" must be typeof ${type.typeOf}` }; // given value resides in a child path, but parent is not allowed be an object.
        }
        if (!type.children) {
            return ok;
        }
        const childKey = trailKeys[0];
        let property = type.children.find(prop => prop.name === childKey);
        if (!property) {
            property = type.children.find(prop => prop.name === '*' || prop.name[0] === '$');
        }
        if (!property) {
            return { ok: false, reason: `Object at path "${path}" cannot have property "${childKey}"` };
        }
        if (property.optional && value === null && trailKeys.length === 1) {
            return ok;
        }
        let result;
        property.types.some(type => {
            const childPath = typeof childKey === 'number' ? `${path}[${childKey}]` : `${path}/${childKey}`;
            result = checkType(childPath, type, value, partial, trailKeys.slice(1));
            return result.ok;
        });
        return result;
    }
    if (value === null) {
        return ok;
    }
    if (type.instanceOf === Object && (typeof value !== 'object' || value instanceof Array || value instanceof Date)) {
        return { ok: false, reason: `path "${path}" must be an object collection` };
    }
    if (type.instanceOf && (typeof value !== 'object' || value.constructor !== type.instanceOf)) { // !(value instanceof type.instanceOf) // value.constructor.name !== type.instanceOf
        return { ok: false, reason: `path "${path}" must be an instance of ${type.instanceOf.name}` };
    }
    if ('value' in type && value !== type.value) {
        return { ok: false, reason: `path "${path}" must be value: ${type.value}` };
    }
    if (typeof value !== type.typeOf) {
        return { ok: false, reason: `path "${path}" must be typeof ${type.typeOf}` };
    }
    if (type.instanceOf === Array && type.genericTypes && !value.every(v => type.genericTypes.some(t => checkType(path, t, v, false).ok))) {
        return { ok: false, reason: `every array value of path "${path}" must match one of the specified types` };
    }
    if (type.typeOf === 'object' && type.children) {
        return checkObject(path, type.children, value, partial);
    }
    if (type.matches && !type.matches.test(value)) {
        return { ok: false, reason: `path "${path}" must match regular expression /${type.matches.source}/${type.matches.flags}` };
    }
    return ok;
}
// eslint-disable-next-line @typescript-eslint/ban-types
function getConstructorType(val) {
    switch (val) {
        case String: return 'string';
        case Number: return 'number';
        case Boolean: return 'boolean';
        case Date: return 'Date';
        case BigInt: return 'bigint';
        case Array: throw new Error('Schema error: Array cannot be used without a type. Use string[] or Array<string> instead');
        default: throw new Error(`Schema error: unknown type used: ${val.name}`);
    }
}
class SchemaDefinition {
    constructor(definition, handling = { warnOnly: false }) {
        this.handling = handling;
        this.source = definition;
        if (typeof definition === 'object') {
            // Turn object into typescript definitions
            // eg:
            // const example = {
            //     name: String,
            //     born: Date,
            //     instrument: "'guitar'|'piano'",
            //     "address?": {
            //         street: String
            //     }
            // };
            // Resulting ts: "{name:string,born:Date,instrument:'guitar'|'piano',address?:{street:string}}"
            const toTS = (obj) => {
                return '{' + Object.keys(obj)
                    .map(key => {
                    let val = obj[key];
                    if (val === undefined) {
                        val = 'undefined';
                    }
                    else if (val instanceof RegExp) {
                        val = `/${val.source}/${val.flags}`;
                    }
                    else if (typeof val === 'object') {
                        val = toTS(val);
                    }
                    else if (typeof val === 'function') {
                        val = getConstructorType(val);
                    }
                    else if (!['string', 'number', 'boolean', 'bigint'].includes(typeof val)) {
                        throw new Error(`Type definition for key "${key}" must be a string, number, boolean, bigint, object, regular expression, or one of these classes: String, Number, Boolean, Date, BigInt`);
                    }
                    return `${key}:${val}`;
                })
                    .join(',') + '}';
            };
            this.text = toTS(definition);
        }
        else if (typeof definition === 'string') {
            this.text = definition;
        }
        else {
            throw new Error('Type definiton must be a string or an object');
        }
        this.type = parse(this.text);
    }
    check(path, value, partial, trailKeys) {
        const result = checkType(path, this.type, value, partial, trailKeys);
        if (!result.ok && this.handling.warnOnly) {
            // Only issue a warning, allows schema definitions to be added to a production db to monitor if they are accurate before enforcing them.
            result.warning = `${partial ? 'Partial schema' : 'Schema'} check on path "${path}"${trailKeys ? ` for child "${trailKeys.join('/')}"` : ''} failed: ${result.reason}`;
            result.ok = true;
            this.handling.warnCallback(result.warning);
        }
        return result;
    }
}
exports.SchemaDefinition = SchemaDefinition;

},{}],51:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SimpleCache = void 0;
const utils_1 = require("./utils");
const calculateExpiryTime = (expirySeconds) => expirySeconds > 0 ? Date.now() + (expirySeconds * 1000) : Infinity;
/**
 * Simple cache implementation that retains immutable values in memory for a limited time.
 * Immutability is enforced by cloning the stored and retrieved values. To change a cached value, it will have to be `set` again with the new value.
 */
class SimpleCache {
    get size() { return this.cache.size; }
    constructor(options) {
        var _a;
        this.enabled = true;
        if (typeof options === 'number') {
            // Old signature: only expirySeconds given
            options = { expirySeconds: options };
        }
        options.cloneValues = options.cloneValues !== false;
        if (typeof options.expirySeconds !== 'number' && typeof options.maxEntries !== 'number') {
            throw new Error('Either expirySeconds or maxEntries must be specified');
        }
        this.options = options;
        this.cache = new Map();
        // Cleanup every minute
        const interval = setInterval(() => { this.cleanUp(); }, 60 * 1000);
        (_a = interval.unref) === null || _a === void 0 ? void 0 : _a.call(interval);
    }
    has(key) {
        if (!this.enabled) {
            return false;
        }
        return this.cache.has(key);
    }
    get(key) {
        if (!this.enabled) {
            return null;
        }
        const entry = this.cache.get(key);
        if (!entry) {
            return null;
        } // if (!entry || entry.expires <= Date.now()) { return null; }
        entry.expires = calculateExpiryTime(this.options.expirySeconds);
        entry.accessed = Date.now();
        return this.options.cloneValues ? (0, utils_1.cloneObject)(entry.value) : entry.value;
    }
    set(key, value) {
        if (this.options.maxEntries > 0 && this.cache.size >= this.options.maxEntries && !this.cache.has(key)) {
            // console.warn(`* cache limit ${this.options.maxEntries} reached: ${this.cache.size}`);
            // Remove an expired item or the one that was accessed longest ago
            let oldest = null;
            const now = Date.now();
            for (const [key, entry] of this.cache.entries()) {
                if (entry.expires <= now) {
                    // Found an expired item. Remove it now and stop
                    this.cache.delete(key);
                    oldest = null;
                    break;
                }
                if (!oldest || entry.accessed < oldest.accessed) {
                    oldest = { key, accessed: entry.accessed };
                }
            }
            if (oldest !== null) {
                this.cache.delete(oldest.key);
            }
        }
        this.cache.set(key, { value: this.options.cloneValues ? (0, utils_1.cloneObject)(value) : value, added: Date.now(), accessed: Date.now(), expires: calculateExpiryTime(this.options.expirySeconds) });
    }
    remove(key) {
        this.cache.delete(key);
    }
    cleanUp() {
        const now = Date.now();
        this.cache.forEach((entry, key) => {
            if (entry.expires <= now) {
                this.cache.delete(key);
            }
        });
    }
}
exports.SimpleCache = SimpleCache;

},{"./utils":58}],52:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Colorize = exports.SetColorsEnabled = exports.ColorsSupported = exports.ColorStyle = void 0;
const process_1 = require("./process");
// See from https://en.wikipedia.org/wiki/ANSI_escape_code
const FontCode = {
    bold: 1,
    dim: 2,
    italic: 3,
    underline: 4,
    inverse: 7,
    hidden: 8,
    strikethrough: 94,
};
const ColorCode = {
    black: 30,
    red: 31,
    green: 32,
    yellow: 33,
    blue: 34,
    magenta: 35,
    cyan: 36,
    white: 37,
    grey: 90,
    // Bright colors:
    brightRed: 91,
    // TODO, other bright colors
};
const BgColorCode = {
    bgBlack: 40,
    bgRed: 41,
    bgGreen: 42,
    bgYellow: 43,
    bgBlue: 44,
    bgMagenta: 45,
    bgCyan: 46,
    bgWhite: 47,
    bgGrey: 100,
    bgBrightRed: 101,
    // TODO, other bright colors
};
const ResetCode = {
    all: 0,
    color: 39,
    background: 49,
    bold: 22,
    dim: 22,
    italic: 23,
    underline: 24,
    inverse: 27,
    hidden: 28,
    strikethrough: 29,
};
var ColorStyle;
(function (ColorStyle) {
    ColorStyle["reset"] = "reset";
    ColorStyle["bold"] = "bold";
    ColorStyle["dim"] = "dim";
    ColorStyle["italic"] = "italic";
    ColorStyle["underline"] = "underline";
    ColorStyle["inverse"] = "inverse";
    ColorStyle["hidden"] = "hidden";
    ColorStyle["strikethrough"] = "strikethrough";
    ColorStyle["black"] = "black";
    ColorStyle["red"] = "red";
    ColorStyle["green"] = "green";
    ColorStyle["yellow"] = "yellow";
    ColorStyle["blue"] = "blue";
    ColorStyle["magenta"] = "magenta";
    ColorStyle["cyan"] = "cyan";
    ColorStyle["grey"] = "grey";
    ColorStyle["bgBlack"] = "bgBlack";
    ColorStyle["bgRed"] = "bgRed";
    ColorStyle["bgGreen"] = "bgGreen";
    ColorStyle["bgYellow"] = "bgYellow";
    ColorStyle["bgBlue"] = "bgBlue";
    ColorStyle["bgMagenta"] = "bgMagenta";
    ColorStyle["bgCyan"] = "bgCyan";
    ColorStyle["bgWhite"] = "bgWhite";
    ColorStyle["bgGrey"] = "bgGrey";
})(ColorStyle = exports.ColorStyle || (exports.ColorStyle = {}));
function ColorsSupported() {
    // Checks for basic color support
    if (typeof process_1.default === 'undefined' || !process_1.default.stdout || !process_1.default.env || !process_1.default.platform || process_1.default.platform === 'browser') {
        return false;
    }
    if (process_1.default.platform === 'win32') {
        return true;
    }
    const env = process_1.default.env;
    if (env.COLORTERM) {
        return true;
    }
    if (env.TERM === 'dumb') {
        return false;
    }
    if (env.CI || env.TEAMCITY_VERSION) {
        return !!env.TRAVIS;
    }
    if (['iTerm.app', 'HyperTerm', 'Hyper', 'MacTerm', 'Apple_Terminal', 'vscode'].includes(env.TERM_PROGRAM)) {
        return true;
    }
    if (/^xterm-256|^screen|^xterm|^vt100|color|ansi|cygwin|linux/i.test(env.TERM)) {
        return true;
    }
    return false;
}
exports.ColorsSupported = ColorsSupported;
let _enabled = ColorsSupported();
function SetColorsEnabled(enabled) {
    _enabled = ColorsSupported() && enabled;
}
exports.SetColorsEnabled = SetColorsEnabled;
function Colorize(str, style) {
    if (!_enabled) {
        return str;
    }
    const openCodes = [], closeCodes = [];
    const addStyle = (style) => {
        if (style === ColorStyle.reset) {
            openCodes.push(ResetCode.all);
        }
        else if (style in FontCode) {
            openCodes.push(FontCode[style]);
            closeCodes.push(ResetCode[style]);
        }
        else if (style in ColorCode) {
            openCodes.push(ColorCode[style]);
            closeCodes.push(ResetCode.color);
        }
        else if (style in BgColorCode) {
            openCodes.push(BgColorCode[style]);
            closeCodes.push(ResetCode.background);
        }
    };
    if (style instanceof Array) {
        style.forEach(addStyle);
    }
    else {
        addStyle(style);
    }
    // const open = '\u001b[' + openCodes.join(';') + 'm';
    // const close = '\u001b[' + closeCodes.join(';') + 'm';
    const open = openCodes.map(code => '\u001b[' + code + 'm').join('');
    const close = closeCodes.map(code => '\u001b[' + code + 'm').join('');
    // return open + str + close;
    return str.split('\n').map(line => open + line + close).join('\n');
}
exports.Colorize = Colorize;
String.prototype.colorize = function (style) {
    return Colorize(this, style);
};

},{"./process":49}],53:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SimpleEventEmitter = void 0;
function runCallback(callback, data) {
    try {
        callback(data);
    }
    catch (err) {
        console.error('Error in subscription callback', err);
    }
}
const _subscriptions = Symbol('subscriptions');
const _oneTimeEvents = Symbol('oneTimeEvents');
class SimpleEventEmitter {
    constructor() {
        this[_subscriptions] = [];
        this[_oneTimeEvents] = new Map();
    }
    on(event, callback) {
        if (this[_oneTimeEvents].has(event)) {
            return runCallback(callback, this[_oneTimeEvents].get(event));
        }
        this[_subscriptions].push({ event, callback, once: false });
        return this;
    }
    off(event, callback) {
        this[_subscriptions] = this[_subscriptions].filter(s => s.event !== event || (callback && s.callback !== callback));
        return this;
    }
    once(event, callback) {
        return new Promise(resolve => {
            const ourCallback = (data) => {
                resolve(data);
                callback === null || callback === void 0 ? void 0 : callback(data);
            };
            if (this[_oneTimeEvents].has(event)) {
                runCallback(ourCallback, this[_oneTimeEvents].get(event));
            }
            else {
                this[_subscriptions].push({ event, callback: ourCallback, once: true });
            }
        });
    }
    emit(event, data) {
        if (this[_oneTimeEvents].has(event)) {
            throw new Error(`Event "${event}" was supposed to be emitted only once`);
        }
        for (let i = 0; i < this[_subscriptions].length; i++) {
            const s = this[_subscriptions][i];
            if (s.event !== event) {
                continue;
            }
            runCallback(s.callback, data);
            if (s.once) {
                this[_subscriptions].splice(i, 1);
                i--;
            }
        }
        return this;
    }
    emitOnce(event, data) {
        if (this[_oneTimeEvents].has(event)) {
            throw new Error(`Event "${event}" was supposed to be emitted only once`);
        }
        this.emit(event, data);
        this[_oneTimeEvents].set(event, data); // Mark event as being emitted once for future subscribers
        this.off(event); // Remove all listeners for this event, they won't fire again
        return this;
    }
    pipe(event, eventEmitter) {
        this.on(event, (data) => {
            eventEmitter.emit(event, data);
        });
    }
    pipeOnce(event, eventEmitter) {
        this.once(event, (data) => {
            eventEmitter.emitOnce(event, data);
        });
    }
}
exports.SimpleEventEmitter = SimpleEventEmitter;

},{}],54:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SimpleObservable = void 0;
/**
 * rxjs is an optional dependency that only needs installing when any of AceBase's observe methods are used.
 * If for some reason rxjs is not available (eg in test suite), we can provide a shim. This class is used when
 * `db.setObservable("shim")` is called
 */
class SimpleObservable {
    constructor(create) {
        this._active = false;
        this._subscribers = [];
        this._create = create;
    }
    subscribe(subscriber) {
        if (!this._active) {
            const next = (value) => {
                // emit value to all subscribers
                this._subscribers.forEach(s => {
                    try {
                        s(value);
                    }
                    catch (err) {
                        console.error('Error in subscriber callback:', err);
                    }
                });
            };
            const observer = { next };
            this._cleanup = this._create(observer);
            this._active = true;
        }
        this._subscribers.push(subscriber);
        const unsubscribe = () => {
            this._subscribers.splice(this._subscribers.indexOf(subscriber), 1);
            if (this._subscribers.length === 0) {
                this._active = false;
                this._cleanup();
            }
        };
        const subscription = {
            unsubscribe,
        };
        return subscription;
    }
}
exports.SimpleObservable = SimpleObservable;

},{}],55:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventStream = exports.EventPublisher = exports.EventSubscription = void 0;
class EventSubscription {
    /**
     * @param stop function that stops the subscription from receiving future events
     */
    constructor(stop) {
        this.stop = stop;
        this._internal = {
            state: 'init',
            activatePromises: [],
        };
    }
    /**
     * Notifies when subscription is activated or canceled
     * @param callback optional callback to run each time activation state changes
     * @returns returns a promise that resolves once activated, or rejects when it is denied (and no callback was supplied)
     */
    activated(callback) {
        if (callback) {
            this._internal.activatePromises.push({ callback });
            if (this._internal.state === 'active') {
                callback(true);
            }
            else if (this._internal.state === 'canceled') {
                callback(false, this._internal.cancelReason);
            }
        }
        // Changed behaviour: now also returns a Promise when the callback is used.
        // This allows for 1 activated call to both handle: first activation result,
        // and any future events using the callback
        return new Promise((resolve, reject) => {
            if (this._internal.state === 'active') {
                return resolve();
            }
            else if (this._internal.state === 'canceled' && !callback) {
                return reject(new Error(this._internal.cancelReason));
            }
            // eslint-disable-next-line @typescript-eslint/no-empty-function
            const noop = () => { };
            this._internal.activatePromises.push({
                resolve,
                reject: callback ? noop : reject, // Don't reject when callback is used: let callback handle this (prevents UnhandledPromiseRejection if only callback is used)
            });
        });
    }
    /** (for internal use) */
    _setActivationState(activated, cancelReason) {
        this._internal.cancelReason = cancelReason;
        this._internal.state = activated ? 'active' : 'canceled';
        while (this._internal.activatePromises.length > 0) {
            const p = this._internal.activatePromises.shift();
            if (activated) {
                p.callback && p.callback(true);
                p.resolve && p.resolve();
            }
            else {
                p.callback && p.callback(false, cancelReason);
                p.reject && p.reject(cancelReason);
            }
        }
    }
}
exports.EventSubscription = EventSubscription;
class EventPublisher {
    /**
     *
     * @param publish function that publishes a new value to subscribers, return if there are any active subscribers
     * @param start function that notifies subscribers their subscription is activated
     * @param cancel function that notifies subscribers their subscription has been canceled, removes all subscriptions
     */
    constructor(publish, start, cancel) {
        this.publish = publish;
        this.start = start;
        this.cancel = cancel;
    }
}
exports.EventPublisher = EventPublisher;
class EventStream {
    constructor(eventPublisherCallback) {
        const subscribers = [];
        let noMoreSubscribersCallback;
        let activationState; // TODO: refactor to string only: STATE_INIT, STATE_STOPPED, STATE_ACTIVATED, STATE_CANCELED
        const STATE_STOPPED = 'stopped (no more subscribers)';
        this.subscribe = (callback, activationCallback) => {
            if (typeof callback !== 'function') {
                throw new TypeError('callback must be a function');
            }
            else if (activationState === STATE_STOPPED) {
                throw new Error('stream can\'t be used anymore because all subscribers were stopped');
            }
            const sub = {
                callback,
                activationCallback: function (activated, cancelReason) {
                    activationCallback === null || activationCallback === void 0 ? void 0 : activationCallback(activated, cancelReason);
                    this.subscription._setActivationState(activated, cancelReason);
                },
                subscription: new EventSubscription(function stop() {
                    subscribers.splice(subscribers.indexOf(this), 1);
                    return checkActiveSubscribers();
                }),
            };
            subscribers.push(sub);
            if (typeof activationState !== 'undefined') {
                if (activationState === true) {
                    activationCallback === null || activationCallback === void 0 ? void 0 : activationCallback(true);
                    sub.subscription._setActivationState(true);
                }
                else if (typeof activationState === 'string') {
                    activationCallback === null || activationCallback === void 0 ? void 0 : activationCallback(false, activationState);
                    sub.subscription._setActivationState(false, activationState);
                }
            }
            return sub.subscription;
        };
        const checkActiveSubscribers = () => {
            let ret;
            if (subscribers.length === 0) {
                ret = noMoreSubscribersCallback === null || noMoreSubscribersCallback === void 0 ? void 0 : noMoreSubscribersCallback();
                activationState = STATE_STOPPED;
            }
            return Promise.resolve(ret);
        };
        this.unsubscribe = (callback) => {
            const remove = callback
                ? subscribers.filter(sub => sub.callback === callback)
                : subscribers;
            remove.forEach(sub => {
                const i = subscribers.indexOf(sub);
                subscribers.splice(i, 1);
            });
            checkActiveSubscribers();
        };
        this.stop = () => {
            // Stop (remove) all subscriptions
            subscribers.splice(0);
            checkActiveSubscribers();
        };
        /**
         * For publishing side: adds a value that will trigger callbacks to all subscribers
         * @param val
         * @returns returns whether there are subscribers left
         */
        const publish = (val) => {
            subscribers.forEach(sub => {
                try {
                    sub.callback(val);
                }
                catch (err) {
                    console.error(`Error running subscriber callback: ${err.message}`);
                }
            });
            if (subscribers.length === 0) {
                checkActiveSubscribers();
            }
            return subscribers.length > 0;
        };
        /**
         * For publishing side: let subscribers know their subscription is activated. Should be called only once
         */
        const start = (allSubscriptionsStoppedCallback) => {
            activationState = true;
            noMoreSubscribersCallback = allSubscriptionsStoppedCallback;
            subscribers.forEach(sub => {
                var _a;
                (_a = sub.activationCallback) === null || _a === void 0 ? void 0 : _a.call(sub, true);
            });
        };
        /**
         * For publishing side: let subscribers know their subscription has been canceled. Should be called only once
         */
        const cancel = (reason) => {
            activationState = reason;
            subscribers.forEach(sub => {
                var _a;
                (_a = sub.activationCallback) === null || _a === void 0 ? void 0 : _a.call(sub, false, reason || new Error('unknown reason'));
            });
            subscribers.splice(0); // Clear all
        };
        const publisher = new EventPublisher(publish, start, cancel);
        eventPublisherCallback(publisher);
    }
}
exports.EventStream = EventStream;

},{}],56:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deserialize2 = exports.serialize2 = exports.serialize = exports.detectSerializeVersion = exports.deserialize = void 0;
const path_reference_1 = require("./path-reference");
const utils_1 = require("./utils");
const ascii85_1 = require("./ascii85");
const path_info_1 = require("./path-info");
const partial_array_1 = require("./partial-array");
/*
    There are now 2 different serialization methods for transporting values.

    v1:
    The original version (v1) created an object with "map" and "val" properties.
    The "map" property was made optional in v1.14.1 so they won't be present for values needing no serializing

    v2:
    The new version replaces serialized values inline by objects containing ".type" and ".val" properties.
    This serializing method was introduced by `export` and `import` methods because they use streaming and
    are unable to prepare type mappings up-front. This format is smaller in transmission (in many cases),
    and easier to read and process.

    original: { "date": (some date) }
    v1 serialized: { "map": { "date": "date" }, "val": { date: "2022-04-22T07:49:23Z" } }
    v2 serialized: { "date": { ".type": "date", ".val": "2022-04-22T07:49:23Z" } }

    original: (some date)
    v1 serialized: { "map": "date", "val": "2022-04-22T07:49:23Z" }
    v2 serialized: { ".type": "date", ".val": "2022-04-22T07:49:23Z" }
    comment: top level value that need serializing is wrapped in an object with ".type" and ".val". v1 is smaller in this case

    original: 'some string'
    v1 serialized: { "map": {}, "val": "some string" }
    v2 serialized: "some string"
    comment: primitive types such as strings don't need serializing and are returned as is in v2

    original: { "date": (some date), "text": "Some string" }
    v1 serialized: { "map": { "date": "date" }, "val": { date: "2022-04-22T07:49:23Z", "text": "Some string" } }
    v2 serialized: { "date": { ".type": "date", ".val": "2022-04-22T07:49:23Z" }, "text": "Some string" }
*/
/**
 * Original deserialization method using global `map` and `val` properties
 * @param data
 * @returns
 */
const deserialize = (data) => {
    if (data.map === null || typeof data.map === 'undefined') {
        if (typeof data.val === 'undefined') {
            throw new Error('serialized value must have a val property');
        }
        return data.val;
    }
    const deserializeValue = (type, val) => {
        if (type === 'date') {
            // Date was serialized as a string (UTC)
            return new Date(val);
        }
        else if (type === 'binary') {
            // ascii85 encoded binary data
            return ascii85_1.ascii85.decode(val);
        }
        else if (type === 'reference') {
            return new path_reference_1.PathReference(val);
        }
        else if (type === 'regexp') {
            return new RegExp(val.pattern, val.flags);
        }
        else if (type === 'array') {
            return new partial_array_1.PartialArray(val);
        }
        else if (type === 'bigint') {
            return BigInt(val);
        }
        return val;
    };
    if (typeof data.map === 'string') {
        // Single value
        return deserializeValue(data.map, data.val);
    }
    Object.keys(data.map).forEach(path => {
        const type = data.map[path];
        const keys = path_info_1.PathInfo.getPathKeys(path);
        let parent = data;
        let key = 'val';
        let val = data.val;
        keys.forEach(k => {
            key = k;
            parent = val;
            val = val[key]; // If an error occurs here, there's something wrong with the calling code...
        });
        parent[key] = deserializeValue(type, val);
    });
    return data.val;
};
exports.deserialize = deserialize;
/**
 * Function to detect the used serialization method with for the given object
 * @param data
 * @returns
 */
const detectSerializeVersion = (data) => {
    if (typeof data !== 'object' || data === null) {
        // This can only be v2, which allows primitive types to bypass serializing
        return 2;
    }
    if ('map' in data && 'val' in data) {
        return 1;
    }
    else if ('val' in data) {
        // If it's v1, 'val' will be the only key in the object because serialize2 adds ".version": 2 to the object to prevent confusion.
        if (Object.keys(data).length > 1) {
            return 2;
        }
        return 1;
    }
    return 2;
};
exports.detectSerializeVersion = detectSerializeVersion;
/**
 * Original serialization method using global `map` and `val` properties
 * @param data
 * @returns
 */
const serialize = (obj) => {
    var _a;
    // Recursively find dates and binary data
    if (obj === null || typeof obj !== 'object' || obj instanceof Date || obj instanceof ArrayBuffer || obj instanceof path_reference_1.PathReference || obj instanceof RegExp) {
        // Single value
        const ser = (0, exports.serialize)({ value: obj });
        return {
            map: (_a = ser.map) === null || _a === void 0 ? void 0 : _a.value,
            val: ser.val.value,
        };
    }
    obj = (0, utils_1.cloneObject)(obj); // Make sure we don't alter the original object
    const process = (obj, mappings, prefix) => {
        if (obj instanceof partial_array_1.PartialArray) {
            mappings[prefix] = 'array';
        }
        Object.keys(obj).forEach(key => {
            const val = obj[key];
            const path = prefix.length === 0 ? key : `${prefix}/${key}`;
            if (typeof val === 'bigint') {
                obj[key] = val.toString();
                mappings[path] = 'bigint';
            }
            else if (val instanceof Date) {
                // serialize date to UTC string
                obj[key] = val.toISOString();
                mappings[path] = 'date';
            }
            else if (val instanceof ArrayBuffer) {
                // Serialize binary data with ascii85
                obj[key] = ascii85_1.ascii85.encode(val); //ascii85.encode(Buffer.from(val)).toString();
                mappings[path] = 'binary';
            }
            else if (val instanceof path_reference_1.PathReference) {
                obj[key] = val.path;
                mappings[path] = 'reference';
            }
            else if (val instanceof RegExp) {
                // Queries using the 'matches' filter with a regular expression can now also be used on remote db's
                obj[key] = { pattern: val.source, flags: val.flags };
                mappings[path] = 'regexp';
            }
            else if (typeof val === 'object' && val !== null) {
                process(val, mappings, path);
            }
        });
    };
    const mappings = {};
    process(obj, mappings, '');
    const serialized = { val: obj };
    if (Object.keys(mappings).length > 0) {
        serialized.map = mappings;
    }
    return serialized;
};
exports.serialize = serialize;
/**
 * New serialization method using inline `.type` and `.val` properties
 * @param obj
 * @returns
 */
const serialize2 = (obj) => {
    // Recursively find data that needs serializing
    const getSerializedValue = (val) => {
        if (typeof val === 'bigint') {
            // serialize bigint to string
            return {
                '.type': 'bigint',
                '.val': val.toString(),
            };
        }
        else if (val instanceof Date) {
            // serialize date to UTC string
            return {
                '.type': 'date',
                '.val': val.toISOString(),
            };
        }
        else if (val instanceof ArrayBuffer) {
            // Serialize binary data with ascii85
            return {
                '.type': 'binary',
                '.val': ascii85_1.ascii85.encode(val),
            };
        }
        else if (val instanceof path_reference_1.PathReference) {
            return {
                '.type': 'reference',
                '.val': val.path,
            };
        }
        else if (val instanceof RegExp) {
            // Queries using the 'matches' filter with a regular expression can now also be used on remote db's
            return {
                '.type': 'regexp',
                '.val': `/${val.source}/${val.flags}`, // new: shorter
                // '.val': {
                //     pattern: val.source,
                //     flags: val.flags
                // }
            };
        }
        else if (typeof val === 'object' && val !== null) {
            if (val instanceof Array) {
                const copy = [];
                for (let i = 0; i < val.length; i++) {
                    copy[i] = getSerializedValue(val[i]);
                }
                return copy;
            }
            else {
                const copy = {}; //val instanceof Array ? [] : {} as SerializedValueV2;
                if (val instanceof partial_array_1.PartialArray) {
                    // Mark the object as partial ("sparse") array
                    copy['.type'] = 'array';
                }
                for (const prop in val) {
                    copy[prop] = getSerializedValue(val[prop]);
                }
                return copy;
            }
        }
        else {
            // Primitive value. Don't serialize
            return val;
        }
    };
    const serialized = getSerializedValue(obj);
    if (serialized !== null && typeof serialized === 'object' && 'val' in serialized && Object.keys(serialized).length === 1) {
        // acebase-core v1.14.1 made the 'map' property optional.
        // This v2 serialized object might be confused with a v1 without mappings, because it only has a "val" property
        // To prevent this, mark the serialized object with version 2
        serialized['.version'] = 2;
    }
    return serialized;
};
exports.serialize2 = serialize2;
/**
 * New deserialization method using inline `.type` and `.val` properties
 * @param obj
 * @returns
 */
const deserialize2 = (data) => {
    if (typeof data !== 'object' || data === null) {
        // primitive value, not serialized
        return data;
    }
    if (typeof data['.type'] === 'undefined') {
        // No type given: this is a plain object or array
        if (data instanceof Array) {
            // Plain array, deserialize items into a copy
            const copy = [];
            const arr = data;
            for (let i = 0; i < arr.length; i++) {
                copy.push((0, exports.deserialize2)(arr[i]));
            }
            return copy;
        }
        else {
            // Plain object, deserialize properties into a copy
            const copy = {};
            const obj = data;
            for (const prop in obj) {
                copy[prop] = (0, exports.deserialize2)(obj[prop]);
            }
            return copy;
        }
    }
    else if (typeof data['.type'] === 'string') {
        const dataType = data['.type'].toLowerCase();
        if (dataType === 'bigint') {
            const val = data['.val'];
            return BigInt(val);
        }
        else if (dataType === 'array') {
            // partial ("sparse") array, deserialize children into a copy
            const arr = data;
            const copy = {};
            for (const index in arr) {
                copy[index] = (0, exports.deserialize2)(arr[index]);
            }
            delete copy['.type'];
            return new partial_array_1.PartialArray(copy);
        }
        else if (dataType === 'date') {
            // Date was serialized as a string (UTC)
            const val = data['.val'];
            return new Date(val);
        }
        else if (dataType === 'binary') {
            // ascii85 encoded binary data
            const val = data['.val'];
            return ascii85_1.ascii85.decode(val);
        }
        else if (dataType === 'reference') {
            const val = data['.val'];
            return new path_reference_1.PathReference(val);
        }
        else if (dataType === 'regexp') {
            const val = data['.val'];
            if (typeof val === 'string') {
                // serialized as '/(pattern)/flags'
                const match = /^\/(.*)\/([a-z]+)$/.exec(val);
                return new RegExp(match[1], match[2]);
            }
            // serialized as object with pattern & flags properties
            return new RegExp(val.pattern, val.flags);
        }
    }
    throw new Error(`Unknown data type "${data['.type']}" in serialized value`);
};
exports.deserialize2 = deserialize2;

},{"./ascii85":34,"./partial-array":46,"./path-info":47,"./path-reference":48,"./utils":58}],57:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TypeMappings = void 0;
const utils_1 = require("./utils");
const path_info_1 = require("./path-info");
const data_reference_1 = require("./data-reference");
const data_snapshot_1 = require("./data-snapshot");
/**
 * (for internal use) - gets the mapping set for a specific path
 */
function get(mappings, path) {
    // path points to the mapped (object container) location
    path = path.replace(/^\/|\/$/g, ''); // trim slashes
    const keys = path_info_1.PathInfo.getPathKeys(path);
    const mappedPath = Object.keys(mappings).find(mpath => {
        const mkeys = path_info_1.PathInfo.getPathKeys(mpath);
        if (mkeys.length !== keys.length) {
            return false; // Can't be a match
        }
        return mkeys.every((mkey, index) => {
            if (mkey === '*' || (typeof mkey === 'string' && mkey[0] === '$')) {
                return true; // wildcard
            }
            return mkey === keys[index];
        });
    });
    const mapping = mappings[mappedPath];
    return mapping;
}
/**
 * (for internal use) - gets the mapping set for a specific path's parent
 */
function map(mappings, path) {
    // path points to the object location, its parent should have the mapping
    const targetPath = path_info_1.PathInfo.get(path).parentPath;
    if (targetPath === null) {
        return;
    }
    return get(mappings, targetPath);
}
/**
 * (for internal use) - gets all mappings set for a specific path and all subnodes
 * @returns returns array of all matched mappings in path
 */
function mapDeep(mappings, entryPath) {
    // returns mapping for this node, and all mappings for nested nodes
    // entryPath: "users/ewout"
    // mappingPath: "users"
    // mappingPath: "users/*/posts"
    entryPath = entryPath.replace(/^\/|\/$/g, ''); // trim slashes
    // Start with current path's parent node
    const pathInfo = path_info_1.PathInfo.get(entryPath);
    const startPath = pathInfo.parentPath;
    const keys = startPath ? path_info_1.PathInfo.getPathKeys(startPath) : [];
    // Every path that starts with startPath, is a match
    // TODO: refactor to return Object.keys(mappings),filter(...)
    const matches = Object.keys(mappings).reduce((m, mpath) => {
        //const mkeys = mpath.length > 0 ? mpath.split("/") : [];
        const mkeys = path_info_1.PathInfo.getPathKeys(mpath);
        if (mkeys.length < keys.length) {
            return m; // Can't be a match
        }
        let isMatch = true;
        if (keys.length === 0 && startPath !== null) {
            // Only match first node's children if mapping pattern is "*" or "$variable"
            isMatch = mkeys.length === 1 && (mkeys[0] === '*' || (typeof mkeys[0] === 'string' && mkeys[0][0] === '$'));
        }
        else {
            mkeys.every((mkey, index) => {
                if (index >= keys.length) {
                    return false; // stop .every loop
                }
                else if ((mkey === '*' || (typeof mkey === 'string' && mkey[0] === '$')) || mkey === keys[index]) {
                    return true; // continue .every loop
                }
                else {
                    isMatch = false;
                    return false; // stop .every loop
                }
            });
        }
        if (isMatch) {
            const mapping = mappings[mpath];
            m.push({ path: mpath, type: mapping });
        }
        return m;
    }, []);
    return matches;
}
/**
 * (for internal use) - serializes or deserializes an object using type mappings
 * @returns returns the (de)serialized value
 */
function process(db, mappings, path, obj, action) {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }
    const keys = path_info_1.PathInfo.getPathKeys(path); // path.length > 0 ? path.split("/") : [];
    const m = mapDeep(mappings, path);
    const changes = [];
    m.sort((a, b) => path_info_1.PathInfo.getPathKeys(a.path).length > path_info_1.PathInfo.getPathKeys(b.path).length ? -1 : 1); // Deepest paths first
    m.forEach(mapping => {
        const mkeys = path_info_1.PathInfo.getPathKeys(mapping.path); //mapping.path.length > 0 ? mapping.path.split("/") : [];
        mkeys.push('*');
        const mTrailKeys = mkeys.slice(keys.length);
        if (mTrailKeys.length === 0) {
            const vars = path_info_1.PathInfo.extractVariables(mapping.path, path);
            const ref = new data_reference_1.DataReference(db, path, vars);
            if (action === 'serialize') {
                // serialize this object
                obj = mapping.type.serialize(obj, ref);
            }
            else if (action === 'deserialize') {
                // deserialize this object
                const snap = new data_snapshot_1.DataSnapshot(ref, obj);
                obj = mapping.type.deserialize(snap);
            }
            return;
        }
        // Find all nested objects at this trail path
        const process = (parentPath, parent, keys) => {
            if (obj === null || typeof obj !== 'object') {
                return obj;
            }
            const key = keys[0];
            let children = [];
            if (key === '*' || (typeof key === 'string' && key[0] === '$')) {
                // Include all children
                if (parent instanceof Array) {
                    children = parent.map((val, index) => ({ key: index, val }));
                }
                else {
                    children = Object.keys(parent).map(k => ({ key: k, val: parent[k] }));
                }
            }
            else {
                // Get the 1 child
                const child = parent[key];
                if (typeof child === 'object') {
                    children.push({ key, val: child });
                }
            }
            children.forEach(child => {
                const childPath = path_info_1.PathInfo.getChildPath(parentPath, child.key);
                const vars = path_info_1.PathInfo.extractVariables(mapping.path, childPath);
                const ref = new data_reference_1.DataReference(db, childPath, vars);
                if (keys.length === 1) {
                    // TODO: this alters the existing object, we must build our own copy!
                    if (action === 'serialize') {
                        // serialize this object
                        changes.push({ parent, key: child.key, original: parent[child.key] });
                        parent[child.key] = mapping.type.serialize(child.val, ref);
                    }
                    else if (action === 'deserialize') {
                        // deserialize this object
                        const snap = new data_snapshot_1.DataSnapshot(ref, child.val);
                        parent[child.key] = mapping.type.deserialize(snap);
                    }
                }
                else {
                    // Dig deeper
                    process(childPath, child.val, keys.slice(1));
                }
            });
        };
        process(path, obj, mTrailKeys);
    });
    if (action === 'serialize') {
        // Clone this serialized object so any types that remained
        // will become plain objects without functions, and we can restore
        // the original object's values if any mappings were processed.
        // This will also prevent circular references
        obj = (0, utils_1.cloneObject)(obj);
        if (changes.length > 0) {
            // Restore the changes made to the original object
            changes.forEach(change => {
                change.parent[change.key] = change.original;
            });
        }
    }
    return obj;
}
const _mappings = Symbol('mappings');
class TypeMappings {
    constructor(db) {
        this.db = db;
        this[_mappings] = {};
    }
    /** (for internal use) */
    get mappings() { return this[_mappings]; }
    /** (for internal use) */
    map(path) {
        return map(this[_mappings], path);
    }
    /**
     * Maps objects that are stored in a specific path to a class, so they can automatically be
     * serialized when stored to, and deserialized (instantiated) when loaded from the database.
     * @param path path to an object container, eg "users" or "users/*\/posts"
     * @param type class to bind all child objects of path to
     * Best practice is to implement 2 methods for instantiation and serializing of your objects:
     * 1) `static create(snap: DataSnapshot)` and 2) `serialize(ref: DataReference)`. See example
     * @param options (optional) You can specify the functions to use to
     * serialize and/or instantiate your class. If you do not specificy a creator (constructor) method,
     * AceBase will call `YourClass.create(snapshot)` method if it exists, or create an instance of
     * YourClass with `new YourClass(snapshot)`.
     * If you do not specifiy a serializer method, AceBase will call `YourClass.prototype.serialize(ref)`
     * if it exists, or tries storing your object's fields unaltered. NOTE: `this` in your creator
     * function will point to `YourClass`, and `this` in your serializer function will point to the
     * `instance` of `YourClass`.
     * @example
     * class User {
     *    static create(snap: DataSnapshot): User {
     *        // Deserialize (instantiate) User from plain database object
     *        let user = new User();
     *        Object.assign(user, snap.val()); // Copy all properties to user
     *        user.id = snap.ref.key; // Add the key as id
     *        return user;
     *    }
     *    serialize(ref: DataReference) {
     *        // Serialize user for database storage
     *        return {
     *            name: this.name
     *            email: this.email
     *        };
     *    }
     * }
     * db.types.bind('users', User); // Automatically uses serialize and static create methods
     */
    bind(path, type, options = {}) {
        // Maps objects that are stored in a specific path to a constructor method,
        // so they are automatically deserialized
        if (typeof path !== 'string') {
            throw new TypeError('path must be a string');
        }
        if (typeof type !== 'function') {
            throw new TypeError('constructor must be a function');
        }
        if (typeof options.serializer === 'undefined') {
            // if (typeof type.prototype.serialize === 'function') {
            //     // Use .serialize instance method
            //     options.serializer = type.prototype.serialize;
            // }
            // Use object's serialize method upon serialization (if available)
        }
        else if (typeof options.serializer === 'string') {
            if (typeof type.prototype[options.serializer] === 'function') {
                options.serializer = type.prototype[options.serializer];
            }
            else {
                throw new TypeError(`${type.name}.prototype.${options.serializer} is not a function, cannot use it as serializer`);
            }
        }
        else if (typeof options.serializer !== 'function') {
            throw new TypeError(`serializer for class ${type.name} must be a function, or the name of a prototype method`);
        }
        if (typeof options.creator === 'undefined') {
            if (typeof type.create === 'function') {
                // Use static .create as creator method
                options.creator = type.create;
            }
        }
        else if (typeof options.creator === 'string') {
            if (typeof type[options.creator] === 'function') {
                options.creator = type[options.creator];
            }
            else {
                throw new TypeError(`${type.name}.${options.creator} is not a function, cannot use it as creator`);
            }
        }
        else if (typeof options.creator !== 'function') {
            throw new TypeError(`creator for class ${type.name} must be a function, or the name of a static method`);
        }
        path = path.replace(/^\/|\/$/g, ''); // trim slashes
        this[_mappings][path] = {
            db: this.db,
            type,
            creator: options.creator,
            serializer: options.serializer,
            deserialize(snap) {
                // run constructor method
                let obj;
                if (this.creator) {
                    obj = this.creator.call(this.type, snap);
                }
                else {
                    obj = new this.type(snap);
                }
                return obj;
            },
            serialize(obj, ref) {
                if (this.serializer) {
                    obj = this.serializer.call(obj, ref, obj);
                }
                else if (obj && typeof obj.serialize === 'function') {
                    obj = obj.serialize(ref, obj);
                }
                return obj;
            },
        };
    }
    /**
     * @internal (for internal use)
     * Serializes any child in given object that has a type mapping
     * @param path | path to the object's location
     * @param obj object to serialize
     */
    serialize(path, obj) {
        return process(this.db, this[_mappings], path, obj, 'serialize');
    }
    /**
     * @internal (for internal use)
     * Deserialzes any child in given object that has a type mapping
     * @param path path to the object's location
     * @param obj object to deserialize
     */
    deserialize(path, obj) {
        return process(this.db, this[_mappings], path, obj, 'deserialize');
    }
}
exports.TypeMappings = TypeMappings;

},{"./data-reference":39,"./data-snapshot":40,"./path-info":47,"./utils":58}],58:[function(require,module,exports){
(function (global,Buffer){(function (){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getGlobalObject = exports.defer = exports.getChildValues = exports.getMutations = exports.compareValues = exports.ObjectDifferences = exports.valuesAreEqual = exports.cloneObject = exports.concatTypedArrays = exports.decodeString = exports.encodeString = exports.bytesToBigint = exports.bigintToBytes = exports.bytesToNumber = exports.numberToBytes = void 0;
const path_reference_1 = require("./path-reference");
const process_1 = require("./process");
const partial_array_1 = require("./partial-array");
function numberToBytes(number) {
    const bytes = new Uint8Array(8);
    const view = new DataView(bytes.buffer);
    view.setFloat64(0, number);
    return new Array(...bytes);
}
exports.numberToBytes = numberToBytes;
function bytesToNumber(bytes) {
    const length = Array.isArray(bytes) ? bytes.length : bytes.byteLength;
    if (length !== 8) {
        throw new TypeError('must be 8 bytes');
    }
    const bin = new Uint8Array(bytes);
    const view = new DataView(bin.buffer);
    const nr = view.getFloat64(0);
    return nr;
}
exports.bytesToNumber = bytesToNumber;
const hasBigIntSupport = (() => {
    try {
        return typeof BigInt(0) === 'bigint';
    }
    catch (err) {
        return false;
    }
})();
const noBigIntError = 'BigInt is not supported on this platform';
const bigIntFunctions = {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    bigintToBytes(number) { throw new Error(noBigIntError); },
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    bytesToBigint(bytes) { throw new Error(noBigIntError); },
};
if (hasBigIntSupport) {
    const big = {
        zero: BigInt(0),
        one: BigInt(1),
        two: BigInt(2),
        eight: BigInt(8),
        ff: BigInt(0xff),
    };
    bigIntFunctions.bigintToBytes = function bigintToBytes(number) {
        if (typeof number !== 'bigint') {
            throw new Error('number must be a bigint');
        }
        const bytes = [];
        const negative = number < big.zero;
        do {
            const byte = Number(number & big.ff); // NOTE: bits are inverted on negative numbers
            bytes.push(byte);
            number = number >> big.eight;
        } while (number !== (negative ? -big.one : big.zero));
        bytes.reverse(); // little-endian
        if (negative ? bytes[0] < 128 : bytes[0] >= 128) {
            bytes.unshift(negative ? 255 : 0); // extra sign byte needed
        }
        return bytes;
    };
    bigIntFunctions.bytesToBigint = function bytesToBigint(bytes) {
        const negative = bytes[0] >= 128;
        let number = big.zero;
        for (let b of bytes) {
            if (negative) {
                b = ~b & 0xff;
            } // Invert the bits
            number = (number << big.eight) + BigInt(b);
        }
        if (negative) {
            number = -(number + big.one);
        }
        return number;
    };
}
exports.bigintToBytes = bigIntFunctions.bigintToBytes;
exports.bytesToBigint = bigIntFunctions.bytesToBigint;
/**
 * Converts a string to a utf-8 encoded Uint8Array
 */
function encodeString(str) {
    if (typeof TextEncoder !== 'undefined') {
        // Modern browsers, Node.js v11.0.0+ (or v8.3.0+ with util.TextEncoder)
        const encoder = new TextEncoder();
        return encoder.encode(str);
    }
    else if (typeof Buffer === 'function') {
        // Node.js
        const buf = Buffer.from(str, 'utf-8');
        return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    }
    else {
        // Older browsers. Manually encode
        const arr = [];
        for (let i = 0; i < str.length; i++) {
            let code = str.charCodeAt(i);
            if (code > 128) {
                // Attempt simple UTF-8 conversion. See https://en.wikipedia.org/wiki/UTF-8
                if ((code & 0xd800) === 0xd800) {
                    // code starts with 1101 10...: this is a 2-part utf-16 char code
                    const nextCode = str.charCodeAt(i + 1);
                    if ((nextCode & 0xdc00) !== 0xdc00) {
                        // next code must start with 1101 11...
                        throw new Error('follow-up utf-16 character does not start with 0xDC00');
                    }
                    i++;
                    const p1 = code & 0x3ff; // Only use last 10 bits
                    const p2 = nextCode & 0x3ff;
                    // Create code point from these 2: (see https://en.wikipedia.org/wiki/UTF-16)
                    code = 0x10000 | (p1 << 10) | p2;
                }
                if (code < 2048) {
                    // Use 2 bytes for 11 bit value, first byte starts with 110xxxxx (0xc0), 2nd byte with 10xxxxxx (0x80)
                    const b1 = 0xc0 | ((code >> 6) & 0x1f); // 0xc0 = 11000000, 0x1f = 11111
                    const b2 = 0x80 | (code & 0x3f); // 0x80 = 10000000, 0x3f = 111111
                    arr.push(b1, b2);
                }
                else if (code < 65536) {
                    // Use 3 bytes for 16-bit value, bits per byte: 4, 6, 6
                    const b1 = 0xe0 | ((code >> 12) & 0xf); // 0xe0 = 11100000, 0xf = 1111
                    const b2 = 0x80 | ((code >> 6) & 0x3f); // 0x80 = 10000000, 0x3f = 111111
                    const b3 = 0x80 | (code & 0x3f);
                    arr.push(b1, b2, b3);
                }
                else if (code < 2097152) {
                    // Use 4 bytes for 21-bit value, bits per byte: 3, 6, 6, 6
                    const b1 = 0xf0 | ((code >> 18) & 0x7); // 0xf0 = 11110000, 0x7 = 111
                    const b2 = 0x80 | ((code >> 12) & 0x3f); // 0x80 = 10000000, 0x3f = 111111
                    const b3 = 0x80 | ((code >> 6) & 0x3f); // 0x80 = 10000000, 0x3f = 111111
                    const b4 = 0x80 | (code & 0x3f);
                    arr.push(b1, b2, b3, b4);
                }
                else {
                    throw new Error(`Cannot convert character ${str.charAt(i)} (code ${code}) to utf-8`);
                }
            }
            else {
                arr.push(code < 128 ? code : 63); // 63 = ?
            }
        }
        return new Uint8Array(arr);
    }
}
exports.encodeString = encodeString;
/**
 * Converts a utf-8 encoded buffer to string
 */
function decodeString(buffer) {
    if (typeof TextDecoder !== 'undefined') {
        // Modern browsers, Node.js v11.0.0+ (or v8.3.0+ with util.TextDecoder)
        const decoder = new TextDecoder();
        if (buffer instanceof Uint8Array) {
            return decoder.decode(buffer);
        }
        const buf = Uint8Array.from(buffer);
        return decoder.decode(buf);
    }
    else if (typeof Buffer === 'function') {
        // Node.js (v10 and below)
        if (buffer instanceof Array) {
            buffer = Uint8Array.from(buffer); // convert to typed array
        }
        if (!(buffer instanceof Buffer) && 'buffer' in buffer && buffer.buffer instanceof ArrayBuffer) {
            const typedArray = buffer;
            buffer = Buffer.from(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength); // Convert typed array to node.js Buffer
        }
        if (!(buffer instanceof Buffer)) {
            throw new Error('Unsupported buffer argument');
        }
        return buffer.toString('utf-8');
    }
    else {
        // Older browsers. Manually decode!
        if (!(buffer instanceof Uint8Array) && 'buffer' in buffer && buffer['buffer'] instanceof ArrayBuffer) {
            // Convert TypedArray to Uint8Array
            const typedArray = buffer;
            buffer = new Uint8Array(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
        }
        if (buffer instanceof Buffer || buffer instanceof Array || buffer instanceof Uint8Array) {
            let str = '';
            for (let i = 0; i < buffer.length; i++) {
                let code = buffer[i];
                if (code > 128) {
                    // Decode Unicode character
                    if ((code & 0xf0) === 0xf0) {
                        // 4 byte char
                        const b1 = code, b2 = buffer[i + 1], b3 = buffer[i + 2], b4 = buffer[i + 3];
                        code = ((b1 & 0x7) << 18) | ((b2 & 0x3f) << 12) | ((b3 & 0x3f) << 6) | (b4 & 0x3f);
                        i += 3;
                    }
                    else if ((code & 0xe0) === 0xe0) {
                        // 3 byte char
                        const b1 = code, b2 = buffer[i + 1], b3 = buffer[i + 2];
                        code = ((b1 & 0xf) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f);
                        i += 2;
                    }
                    else if ((code & 0xc0) === 0xc0) {
                        // 2 byte char
                        const b1 = code, b2 = buffer[i + 1];
                        code = ((b1 & 0x1f) << 6) | (b2 & 0x3f);
                        i++;
                    }
                    else {
                        throw new Error('invalid utf-8 data');
                    }
                }
                if (code >= 65536) {
                    // Split into 2-part utf-16 char codes
                    code ^= 0x10000;
                    const p1 = 0xd800 | (code >> 10);
                    const p2 = 0xdc00 | (code & 0x3ff);
                    str += String.fromCharCode(p1);
                    str += String.fromCharCode(p2);
                }
                else {
                    str += String.fromCharCode(code);
                }
            }
            return str;
        }
        else {
            throw new Error('Unsupported buffer argument');
        }
    }
}
exports.decodeString = decodeString;
function concatTypedArrays(a, b) {
    const c = new a.constructor(a.length + b.length);
    c.set(a);
    c.set(b, a.length);
    return c;
}
exports.concatTypedArrays = concatTypedArrays;
function cloneObject(original, stack) {
    var _a;
    if (((_a = original === null || original === void 0 ? void 0 : original.constructor) === null || _a === void 0 ? void 0 : _a.name) === 'DataSnapshot') {
        throw new TypeError(`Object to clone is a DataSnapshot (path "${original.ref.path}")`);
    }
    const checkAndFixTypedArray = (obj) => {
        if (obj !== null && typeof obj === 'object'
            && typeof obj.constructor === 'function' && typeof obj.constructor.name === 'string'
            && ['Buffer', 'Uint8Array', 'Int8Array', 'Uint16Array', 'Int16Array', 'Uint32Array', 'Int32Array', 'BigUint64Array', 'BigInt64Array'].includes(obj.constructor.name)) {
            // FIX for typed array being converted to objects with numeric properties:
            // Convert Buffer or TypedArray to ArrayBuffer
            obj = obj.buffer.slice(obj.byteOffset, obj.byteOffset + obj.byteLength);
        }
        return obj;
    };
    original = checkAndFixTypedArray(original);
    if (typeof original !== 'object' || original === null || original instanceof Date || original instanceof ArrayBuffer || original instanceof path_reference_1.PathReference || original instanceof RegExp) {
        return original;
    }
    const cloneValue = (val) => {
        if (stack.indexOf(val) >= 0) {
            throw new ReferenceError('object contains a circular reference');
        }
        val = checkAndFixTypedArray(val);
        if (val === null || val instanceof Date || val instanceof ArrayBuffer || val instanceof path_reference_1.PathReference || val instanceof RegExp) { // || val instanceof ID
            return val;
        }
        else if (typeof val === 'object') {
            stack.push(val);
            val = cloneObject(val, stack);
            stack.pop();
            return val;
        }
        else {
            return val; // Anything other can just be copied
        }
    };
    if (typeof stack === 'undefined') {
        stack = [original];
    }
    const clone = original instanceof Array ? [] : original instanceof partial_array_1.PartialArray ? new partial_array_1.PartialArray() : {};
    Object.keys(original).forEach(key => {
        const val = original[key];
        if (typeof val === 'function') {
            return; // skip functions
        }
        clone[key] = cloneValue(val);
    });
    return clone;
}
exports.cloneObject = cloneObject;
const isTypedArray = (val) => typeof val === 'object' && ['ArrayBuffer', 'Buffer', 'Uint8Array', 'Uint16Array', 'Uint32Array', 'Int8Array', 'Int16Array', 'Int32Array'].includes(val.constructor.name);
// CONSIDER: updating isTypedArray to: const isTypedArray = val => typeof val === 'object' && 'buffer' in val && 'byteOffset' in val && 'byteLength' in val;
function valuesAreEqual(val1, val2) {
    if (val1 === val2) {
        return true;
    }
    if (typeof val1 !== typeof val2) {
        return false;
    }
    if (typeof val1 === 'object' || typeof val2 === 'object') {
        if (val1 === null || val2 === null) {
            return false;
        }
        if (val1 instanceof path_reference_1.PathReference || val2 instanceof path_reference_1.PathReference) {
            return val1 instanceof path_reference_1.PathReference && val2 instanceof path_reference_1.PathReference && val1.path === val2.path;
        }
        if (val1 instanceof Date || val2 instanceof Date) {
            return val1 instanceof Date && val2 instanceof Date && val1.getTime() === val2.getTime();
        }
        if (val1 instanceof Array || val2 instanceof Array) {
            return val1 instanceof Array && val2 instanceof Array && val1.length === val2.length && val1.every((item, i) => valuesAreEqual(val1[i], val2[i]));
        }
        if (isTypedArray(val1) || isTypedArray(val2)) {
            if (!isTypedArray(val1) || !isTypedArray(val2) || val1.byteLength === val2.byteLength) {
                return false;
            }
            const typed1 = val1 instanceof ArrayBuffer ? new Uint8Array(val1) : new Uint8Array(val1.buffer, val1.byteOffset, val1.byteLength), typed2 = val2 instanceof ArrayBuffer ? new Uint8Array(val2) : new Uint8Array(val2.buffer, val2.byteOffset, val2.byteLength);
            return typed1.every((val, i) => typed2[i] === val);
        }
        const keys1 = Object.keys(val1), keys2 = Object.keys(val2);
        return keys1.length === keys2.length && keys1.every(key => keys2.includes(key)) && keys1.every(key => valuesAreEqual(val1[key], val2[key]));
    }
    return false;
}
exports.valuesAreEqual = valuesAreEqual;
class ObjectDifferences {
    constructor(added, removed, changed) {
        this.added = added;
        this.removed = removed;
        this.changed = changed;
    }
    forChild(key) {
        if (this.added.includes(key)) {
            return 'added';
        }
        if (this.removed.includes(key)) {
            return 'removed';
        }
        const changed = this.changed.find(ch => ch.key === key);
        return changed ? changed.change : 'identical';
    }
}
exports.ObjectDifferences = ObjectDifferences;
function compareValues(oldVal, newVal, sortedResults = false) {
    const voids = [undefined, null];
    if (oldVal === newVal) {
        return 'identical';
    }
    else if (voids.indexOf(oldVal) >= 0 && voids.indexOf(newVal) < 0) {
        return 'added';
    }
    else if (voids.indexOf(oldVal) < 0 && voids.indexOf(newVal) >= 0) {
        return 'removed';
    }
    else if (typeof oldVal !== typeof newVal) {
        return 'changed';
    }
    else if (isTypedArray(oldVal) || isTypedArray(newVal)) {
        // One or both values are typed arrays.
        if (!isTypedArray(oldVal) || !isTypedArray(newVal)) {
            return 'changed';
        }
        // Both are typed. Compare lengths and byte content of typed arrays
        const typed1 = oldVal instanceof Uint8Array ? oldVal : oldVal instanceof ArrayBuffer ? new Uint8Array(oldVal) : new Uint8Array(oldVal.buffer, oldVal.byteOffset, oldVal.byteLength);
        const typed2 = newVal instanceof Uint8Array ? newVal : newVal instanceof ArrayBuffer ? new Uint8Array(newVal) : new Uint8Array(newVal.buffer, newVal.byteOffset, newVal.byteLength);
        return typed1.byteLength === typed2.byteLength && typed1.every((val, i) => typed2[i] === val) ? 'identical' : 'changed';
    }
    else if (oldVal instanceof Date || newVal instanceof Date) {
        return oldVal instanceof Date && newVal instanceof Date && oldVal.getTime() === newVal.getTime() ? 'identical' : 'changed';
    }
    else if (oldVal instanceof path_reference_1.PathReference || newVal instanceof path_reference_1.PathReference) {
        return oldVal instanceof path_reference_1.PathReference && newVal instanceof path_reference_1.PathReference && oldVal.path === newVal.path ? 'identical' : 'changed';
    }
    else if (typeof oldVal === 'object') {
        // Do key-by-key comparison of objects
        const isArray = oldVal instanceof Array;
        const getKeys = (obj) => {
            let keys = Object.keys(obj).filter(key => !voids.includes(obj[key]));
            if (isArray) {
                keys = keys.map((v) => parseInt(v));
            }
            return keys;
        };
        const oldKeys = getKeys(oldVal);
        const newKeys = getKeys(newVal);
        const removedKeys = oldKeys.filter(key => !newKeys.includes(key));
        const addedKeys = newKeys.filter(key => !oldKeys.includes(key));
        const changedKeys = newKeys.reduce((changed, key) => {
            if (oldKeys.includes(key)) {
                const val1 = oldVal[key];
                const val2 = newVal[key];
                const c = compareValues(val1, val2);
                if (c !== 'identical') {
                    changed.push({ key, change: c });
                }
            }
            return changed;
        }, []);
        if (addedKeys.length === 0 && removedKeys.length === 0 && changedKeys.length === 0) {
            return 'identical';
        }
        else {
            return new ObjectDifferences(addedKeys, removedKeys, sortedResults ? changedKeys.sort((a, b) => a.key < b.key ? -1 : 1) : changedKeys);
        }
    }
    return 'changed';
}
exports.compareValues = compareValues;
function getMutations(oldVal, newVal, sortedResults = false) {
    const process = (target, compareResult, prev, val) => {
        switch (compareResult) {
            case 'identical': return [];
            case 'changed': return [{ target, prev, val }];
            case 'added': return [{ target, prev: null, val }];
            case 'removed': return [{ target, prev, val: null }];
            default: {
                let changes = [];
                compareResult.added.forEach(key => changes.push({ target: target.concat(key), prev: null, val: val[key] }));
                compareResult.removed.forEach(key => changes.push({ target: target.concat(key), prev: prev[key], val: null }));
                compareResult.changed.forEach(item => {
                    const childChanges = process(target.concat(item.key), item.change, prev[item.key], val[item.key]);
                    changes = changes.concat(childChanges);
                });
                return changes;
            }
        }
    };
    const compareResult = compareValues(oldVal, newVal, sortedResults);
    return process([], compareResult, oldVal, newVal);
}
exports.getMutations = getMutations;
function getChildValues(childKey, oldValue, newValue) {
    oldValue = oldValue === null ? null : oldValue[childKey];
    if (typeof oldValue === 'undefined') {
        oldValue = null;
    }
    newValue = newValue === null ? null : newValue[childKey];
    if (typeof newValue === 'undefined') {
        newValue = null;
    }
    return { oldValue, newValue };
}
exports.getChildValues = getChildValues;
function defer(fn) {
    process_1.default.nextTick(fn);
}
exports.defer = defer;
function getGlobalObject() {
    var _a;
    if (typeof globalThis !== 'undefined') {
        return globalThis;
    }
    if (typeof global !== 'undefined') {
        return global;
    }
    if (typeof window !== 'undefined') {
        return window;
    }
    if (typeof self !== 'undefined') {
        return self;
    }
    return (_a = (function () { return this; }())) !== null && _a !== void 0 ? _a : Function('return this')();
}
exports.getGlobalObject = getGlobalObject;

}).call(this)}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer)
},{"./partial-array":46,"./path-reference":48,"./process":49,"buffer":59}],59:[function(require,module,exports){

},{}]},{},[6])(6)
});
