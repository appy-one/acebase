import { AceBaseBase, AceBaseBaseSettings } from 'acebase-core';
import { LocalApi } from './api-local';
import { IPCClientSettings, StorageSettings, TransactionLogSettings } from './storage';
import { LocalStorageSettings } from './storage/custom/local-storage';
import { IndexedDBStorageSettings } from './storage/custom/indexed-db/settings';
export { LocalStorageSettings, IndexedDBStorageSettings };
export declare class AceBaseLocalSettings extends AceBaseBaseSettings {
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
    constructor(options?: Partial<AceBaseLocalSettings>);
}
export declare class AceBase extends AceBaseBase {
    /**
     * @internal (for internal use)
     */
    api: LocalApi;
    /**
     * @param dbname Name of the database to open or create
     */
    constructor(dbname: string, init?: Partial<AceBaseLocalSettings>);
    recovery: {
        /**
         * Repairs a node that cannot be loaded by removing the reference from its parent, or marking it as removed
         */
        repairNode: (path: string, options?: {
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
        }) => Promise<void>;
        /**
         * Repairs a node that uses a B+Tree for its keys (100+ children).
         * See https://github.com/appy-one/acebase/issues/183
         * @param path Target path to fix
         */
        repairNodeTree: (path: string) => Promise<void>;
    };
    close(): Promise<void>;
    get settings(): {
        logLevel: import("acebase-core").LoggingLevel;
        ipcEvents: boolean;
    };
    /**
     * Creates an AceBase database instance using LocalStorage or SessionStorage as storage engine. When running in non-browser environments, set
     * settings.provider to a custom LocalStorage provider, eg 'node-localstorage'
     * @param dbname Name of the database
     * @param settings optional settings
     */
    static WithLocalStorage(dbname: string, settings?: Partial<LocalStorageSettings>): AceBase;
    /**
     * Creates an AceBase database instance using IndexedDB as storage engine. Only available in browser contexts!
     * @param dbname Name of the database
     * @param settings optional settings
     */
    static WithIndexedDB(dbname: string, init?: Partial<IndexedDBStorageSettings>): AceBase;
}
//# sourceMappingURL=acebase-local.d.ts.map