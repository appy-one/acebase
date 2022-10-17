import { AceBaseBase, AceBaseBaseSettings, LoggingLevel } from 'acebase-core';
import { LocalApi } from './api-local';
import { IPCClientSettings, StorageSettings, TransactionLogSettings } from './storage';
export declare class AceBaseLocalSettings extends AceBaseBaseSettings {
    storage: Partial<StorageSettings>;
    ipc: IPCClientSettings;
    transactions: TransactionLogSettings;
    info: string;
    constructor(options: Partial<AceBaseLocalSettings>);
}
export declare class AceBase extends AceBaseBase {
    /**
     * @internal should not be accessed from external modules
     */
    api: LocalApi;
    /**
     * @param dbname Name of the database to open or create
     */
    constructor(dbname: string, options: Partial<AceBaseLocalSettings>);
    recovery: {
        repairNode(path: string, options: any): Promise<void>;
    };
    close(): Promise<void>;
    get settings(): {
        logLevel: LoggingLevel;
        ipcEvents: boolean;
    };
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
    }>): AceBase;
}
