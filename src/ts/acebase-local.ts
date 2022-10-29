import { AceBaseBase, AceBaseBaseSettings } from 'acebase-core';
import { AceBaseStorage } from './storage/binary';
import { LocalApi } from './api-local';
import { IPCClientSettings, StorageSettings, TransactionLogSettings } from './storage';
import { createLocalStorageInstance, LocalStorageSettings } from './storage/custom/local-storage';
import { IndexedDBStorageSettings } from './storage/custom/indexed-db/settings';

export { LocalStorageSettings, IndexedDBStorageSettings };

export class AceBaseLocalSettings extends AceBaseBaseSettings {

    /**
     * Optional storage settings
     */
    storage?: Partial<StorageSettings>;

    /**
     * IPC settings if you are using AceBase in pm2 or cloud-based clusters
     * @deprecated Move this to `storage` settings
     */
    ipc?: IPCClientSettings;

    /**
     * Settings for optional transaction logging
     * @deprecated Move this to `storage` settings
     */
    transactions?: TransactionLogSettings;

    constructor(options: Partial<AceBaseLocalSettings> = {}) {
        super(options);

        if (options.storage) {
            this.storage = options.storage;
            // If they were set on global settings, copy IPC and transaction settings to storage settings
            if (options.ipc) { this.storage.ipc = options.ipc; }
            if (options.transactions) { this.storage.transactions = options.transactions; }
        }
    }
}


export class AceBase extends AceBaseBase {

    /**
     * @internal (for internal use)
     */
    public api: LocalApi;

    /**
     * @param dbname Name of the database to open or create
     */
    constructor(dbname: string, init: Partial<AceBaseLocalSettings> = {}) {
        const settings = new AceBaseLocalSettings(init);
        super(dbname, settings);
        const apiSettings = {
            db: this as AceBaseBase,
            settings,
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
                    throw new Error(`repairNode is not supported with chosen storage engine`);
                }
            },
        };
    }

    public recovery: {
        repairNode(
            path: string,
            options?: {
                /**
                 * Included for testing purposes: whether to proceed if the target node does not appear broken.
                 * @default false
                 */
                ignoreIntact?: boolean;
                /**
                 * Whether to mark the target as removed (getting its value will yield `"[[removed]]"`). Set to `false` to completely remove it.
                 * @default true
                 */
                markAsRemoved?: boolean;
            }
        ): Promise<void>;
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
    static WithLocalStorage(dbname: string, settings: Partial<LocalStorageSettings> = {}) {
        const db = createLocalStorageInstance(dbname, settings);
        return db;
    }

    /**
     * Creates an AceBase database instance using IndexedDB as storage engine. Only available in browser contexts!
     * @param dbname Name of the database
     * @param settings optional settings
     */
    static WithIndexedDB(dbname: string, init: Partial<IndexedDBStorageSettings> = {}): AceBase {
        throw new Error(`IndexedDB storage can only be used in browser contexts`);
    }
}
