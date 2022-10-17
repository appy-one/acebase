"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AceBase = exports.AceBaseLocalSettings = void 0;
const acebase_core_1 = require("acebase-core");
const binary_1 = require("./storage/binary");
const api_local_1 = require("./api-local");
const custom_1 = require("./storage/custom");
class AceBaseLocalSettings extends acebase_core_1.AceBaseBaseSettings {
    constructor(options) {
        super(options);
        if (!options) {
            options = {};
        }
        this.storage = options.storage || {};
        // Copy IPC and transaction settings to storage settings
        if (typeof options.ipc === 'object') {
            this.storage.ipc = options.ipc;
        }
        if (typeof options.transactions === 'object') {
            this.storage.transactions = options.transactions;
        }
    }
}
exports.AceBaseLocalSettings = AceBaseLocalSettings;
class AceBase extends acebase_core_1.AceBaseBase {
    /**
     * @param dbname Name of the database to open or create
     */
    constructor(dbname, options) {
        options = new AceBaseLocalSettings(options);
        options.info = options.info || 'realtime database';
        super(dbname, options);
        const apiSettings = {
            db: this,
            storage: options.storage,
            logLevel: options.logLevel,
        };
        this.api = new api_local_1.LocalApi(dbname, apiSettings, () => {
            this.emit('ready');
        });
        this.recovery = {
            repairNode: async (path, options) => {
                if (this.api.storage instanceof binary_1.AceBaseStorage) {
                    await this.api.storage.repairNode(path, options);
                }
                else if (!this.api.storage.repairNode) {
                    throw new Error(`fixNode is not supported with chosen storage engine`);
                }
            },
        };
    }
    close() {
        // Close the database by calling exit on the ipc channel, which will emit an 'exit' event when the database can be safely closed.
        return this.api.storage.close();
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
    static WithLocalStorage(dbname, settings) {
        settings = settings || {};
        if (!settings.logLevel) {
            settings.logLevel = 'error';
        }
        // Determine whether to use localStorage or sessionStorage
        const localStorage = settings.provider ? settings.provider : settings.temp ? window.localStorage : window.sessionStorage;
        // Setup our CustomStorageSettings
        const storageSettings = new custom_1.CustomStorageSettings({
            name: 'LocalStorage',
            locking: true,
            removeVoidProperties: settings.removeVoidProperties,
            maxInlineValueSize: settings.maxInlineValueSize,
            ready() {
                // LocalStorage is always ready
                return Promise.resolve();
            },
            getTransaction(target) {
                // Create an instance of our transaction class
                const context = {
                    debug: true,
                    dbname,
                    localStorage,
                };
                const transaction = new LocalStorageTransaction(context, target);
                return Promise.resolve(transaction);
            },
        });
        const db = new AceBase(dbname, { logLevel: settings.logLevel, storage: storageSettings, sponsor: settings.sponsor });
        db.settings.ipcEvents = settings.multipleTabs === true;
        return db;
    }
}
exports.AceBase = AceBase;
// Setup CustomStorageTransaction for browser's LocalStorage
class LocalStorageTransaction extends custom_1.CustomStorageTransaction {
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
        const pathInfo = custom_1.CustomStorageHelpers.PathInfo.get(path);
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
        const pathInfo = custom_1.CustomStorageHelpers.PathInfo.get(path);
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
//# sourceMappingURL=acebase-local.js.map