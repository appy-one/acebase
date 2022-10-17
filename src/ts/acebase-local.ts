import { AceBaseBase, AceBaseBaseSettings, LoggingLevel } from 'acebase-core';
import { AceBaseStorage } from './storage/binary';
import { LocalApi } from './api-local';
import { IPCClientSettings, StorageSettings, TransactionLogSettings } from './storage';
import { CustomStorageSettings, CustomStorageTransaction, CustomStorageHelpers, ICustomStorageNode, ICustomStorageNodeMetaData } from './storage/custom';

export class AceBaseLocalSettings extends AceBaseBaseSettings {

    storage: Partial<StorageSettings>;
    ipc: IPCClientSettings;
    transactions: TransactionLogSettings;
    info: string;

    constructor(options: Partial<AceBaseLocalSettings>) {
        super(options);
        if (!options) { options = {}; }
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

export class AceBase extends AceBaseBase {

    /**
     * @internal should not be accessed from external modules
     */
    public api: LocalApi;

    /**
     * @param dbname Name of the database to open or create
     */
    constructor(dbname: string, options: Partial<AceBaseLocalSettings>) {
        options = new AceBaseLocalSettings(options);
        options.info = options.info || 'realtime database';
        super(dbname, options);
        const apiSettings = {
            db: this as AceBaseBase,
            storage: options.storage as StorageSettings,
            logLevel: options.logLevel,
        };
        this.api = new LocalApi(dbname, apiSettings, () => {
            this.emit('ready');
        });
        this.recovery = {
            repairNode: async (path, options) => {
                if (this.api.storage instanceof AceBaseStorage) {
                    await (this.api.storage as AceBaseStorage).repairNode(path, options);
                }
                else if (!(this.api.storage as any).repairNode) {
                    throw new Error(`fixNode is not supported with chosen storage engine`);
                }
            },
        };
    }

    public recovery: {
        repairNode(path: string, options: any): Promise<void>;
    };

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
    static WithLocalStorage(dbname: string, settings: Partial<{
        /**
         * what level to use for logging to the console
         */
        logLevel: LoggingLevel;
        /**
         * whether to use sessionStorage instead of localStorage
         */
        temp: boolean;
        /**
         * Alternate localStorage provider for running in non-browser environments. Eg using 'node-localstorage'
         */
        provider: any;
        /**
         * Whether to remove undefined property values of objects being stored, instead of throwing an error
         * @default false
         */
        removeVoidProperties: boolean;
        /**
         * Maximum size of binary data/strings to store in parent object records. Larger values are stored in their own records.
         * Recommended to keep this at the default setting
         * @default 50
         */
        maxInlineValueSize: number;
        /**
         * Whether to enable cross-tab synchronization
         * @default false
         */
        multipleTabs: boolean;
        /**
         * You can turn this on if you are a sponsor
         * @default false
         */
        sponsor: boolean;
    }>) {

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
            getTransaction(target: { path: string; write: boolean }) {
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

// Setup CustomStorageTransaction for browser's LocalStorage
class LocalStorageTransaction extends CustomStorageTransaction {

    private _storageKeysPrefix: string;

    constructor(public context: {debug: boolean, dbname: string, localStorage: typeof window.localStorage}, target: {path: string, write: boolean}) {
        super(target);
        this._storageKeysPrefix = `${this.context.dbname}.acebase::`;
    }

    async commit() {
        // All changes have already been committed. TODO: use same approach as IndexedDB
    }

    async rollback(err: any) {
        // Not able to rollback changes, because we did not keep track
    }

    async get(path: string) {
        // Gets value from localStorage, wrapped in Promise
        const json = this.context.localStorage.getItem(this.getStorageKeyForPath(path));
        const val = JSON.parse(json);
        return val;
    }

    async set(path: string, val: any) {
        // Sets value in localStorage, wrapped in Promise
        const json = JSON.stringify(val);
        this.context.localStorage.setItem(this.getStorageKeyForPath(path), json);
    }

    async remove(path: string) {
        // Removes a value from localStorage, wrapped in Promise
        this.context.localStorage.removeItem(this.getStorageKeyForPath(path));
    }

    async childrenOf(path: string, include: { metadata?: boolean; value?: boolean }, checkCallback: (path: string) => boolean, addCallback: (path: string, node: ICustomStorageNodeMetaData|ICustomStorageNode) => boolean) {
        // Streams all child paths
        // Cannot query localStorage, so loop through all stored keys to find children
        const pathInfo = CustomStorageHelpers.PathInfo.get(path);
        for (let i = 0; i < this.context.localStorage.length; i++) {
            const key = this.context.localStorage.key(i);
            if (!key.startsWith(this._storageKeysPrefix)) { continue; }
            const otherPath = this.getPathFromStorageKey(key);
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

    async descendantsOf(path: string, include: { metadata?: boolean; value?: boolean }, checkCallback: (path: string) => boolean, addCallback: (path: string, node: ICustomStorageNodeMetaData|ICustomStorageNode) => boolean) {
        // Streams all descendant paths
        // Cannot query localStorage, so loop through all stored keys to find descendants
        const pathInfo = CustomStorageHelpers.PathInfo.get(path);
        for (let i = 0; i < this.context.localStorage.length; i++) {
            const key = this.context.localStorage.key(i);
            if (!key.startsWith(this._storageKeysPrefix)) { continue; }
            const otherPath = this.getPathFromStorageKey(key);
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
     */
    getPathFromStorageKey(key: string) {
        return key.slice(this._storageKeysPrefix.length);
    }

    /**
     * Helper function to get the localStorage key for a path
     */
    getStorageKeyForPath(path: string) {
        return `${this._storageKeysPrefix}${path}`;
    }
}

