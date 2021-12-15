const { AceBaseBase, AceBaseBaseSettings } = require('acebase-core');
const { LocalApi } = require('./api-local');
const { CustomStorageSettings, CustomStorageTransaction, CustomStorageHelpers } = require('./storage-custom');

class AceBaseLocalSettings extends AceBaseBaseSettings {
    /**
     * 
     * @param {{ logLevel: 'verbose'|'log'|'warn'|'error', storage: import('./storage').StorageSettings, ipc: import('./storage').IPCClientSettings, transactions: import('..').TransactionLogSettings }} options 
     */
    constructor(options) {
        super(options);
        if (!options) { options = {}; }
        this.storage = options.storage || {};

        // Copy IPC and transaction settings to storage settings
        if (typeof options.ipc === 'object') {
            options.storage.ipc = options.ipc;
        }
        if (typeof options.transactions === 'object') {
            options.storage.transactions = options.transactions;
        }
    }
}

class AceBase extends AceBaseBase {

    /**
     * 
     * @param {string} dbname Name of the database to open or create
     * @param {AceBaseLocalSettings} options
     */
    constructor(dbname, options) {
        options = new AceBaseLocalSettings(options);
        options.info = options.info || 'realtime database';
        super(dbname, options);
        const apiSettings = { 
            db: this,
            storage: options.storage,
            logLevel: options.logLevel
        };
        this.api = new LocalApi(dbname, apiSettings, () => {
            this.emit("ready");
        });
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
            set ipcEvents(enabled) { ipc.eventsEnabled = enabled; }
        }
    }

    /**
     * Creates an AceBase database instance using LocalStorage or SessionStorage as storage engine. When running in non-browser environments, set
     * settings.provider to a custom LocalStorage provider, eg 'node-localstorage'
     * @param {string} dbname Name of the database
     * @param {object} [settings] optional settings
     * @param {string} [settings.logLevel] what level to use for logging to the console
     * @param {boolean} [settings.temp] whether to use sessionStorage instead of localStorage
     * @param {any} [settings.provider] Alternate localStorage provider for running in non-browser environments. Eg using 'node-localstorage'
     * @param {boolean} [settings.removeVoidProperties=false] Whether to remove undefined property values of objects being stored, instead of throwing an error
     * @param {number} [settings.maxInlineValueSize=50] Maximum size of binary data/strings to store in parent object records. Larger values are stored in their own records. Recommended to keep this at the default setting
     * @param {boolean} [settings.multipleTabs=false] Whether to enable cross-tab synchronization
     */
    static WithLocalStorage(dbname, settings) {

        settings = settings || {};
        if (!settings.logLevel) { settings.logLevel = 'error'; }

        // Determine whether to use localStorage or sessionStorage
        const localStorage = settings.provider ? settings.provider : settings.temp ? window.localStorage : window.sessionStorage;

        // Setup our CustomStorageSettings
        const storageSettings = new CustomStorageSettings({
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
                    localStorage
                }
                const transaction = new LocalStorageTransaction(context, target);
                return Promise.resolve(transaction);
            }
        });
        const db = new AceBase(dbname, { logLevel: settings.logLevel, storage: storageSettings });
        db.settings.ipcEvents = settings.multipleTabs === true;

        return db;
    }

}

// Setup CustomStorageTransaction for browser's LocalStorage
class LocalStorageTransaction extends CustomStorageTransaction {

    /**
     * @param {{debug: boolean, dbname: string, localStorage: typeof window.localStorage}} context
     * @param {{path: string, write: boolean}} target
     */
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
        const pathInfo = CustomStorageHelpers.PathInfo.get(path);
        for (let i = 0; i < this.context.localStorage.length; i++) {
            const key = this.context.localStorage.key(i);
            if (!key.startsWith(this._storageKeysPrefix)) { continue; }                
            let otherPath = this.getPathFromStorageKey(key);
            if (pathInfo.isParentOf(otherPath) && checkCallback(otherPath)) {
                let node;
                if (include.metadata || include.value) {
                    const json = this.context.localStorage.getItem(key);
                    node = JSON.parse(json);
                }
                const keepGoing = addCallback(otherPath, node);
                if (!keepGoing) { break; }
            }
        }
    }

    async descendantsOf(path, include, checkCallback, addCallback) {
        // Streams all descendant paths
        // Cannot query localStorage, so loop through all stored keys to find descendants
        const pathInfo = CustomStorageHelpers.PathInfo.get(path);
        for (let i = 0; i < this.context.localStorage.length; i++) {
            const key = this.context.localStorage.key(i);
            if (!key.startsWith(this._storageKeysPrefix)) { continue; }
            let otherPath = this.getPathFromStorageKey(key);
            if (pathInfo.isAncestorOf(otherPath) && checkCallback(otherPath)) {
                let node;
                if (include.metadata || include.value) {
                    const json = this.context.localStorage.getItem(key);
                    node = JSON.parse(json);
                }
                const keepGoing = addCallback(otherPath, node);
                if (!keepGoing) { break; }
            }
        }
    }

    /**
     * Helper function to get the path from a localStorage key
     * @param {string} key 
     */
    getPathFromStorageKey(key) {
        return key.slice(this._storageKeysPrefix.length);
    }

    /**
     * Helper function to get the localStorage key for a path
     * @param {string} path 
     */
    getStorageKeyForPath(path) {
        return `${this._storageKeysPrefix}${path}`;
    }
}

module.exports = { AceBase, AceBaseLocalSettings };