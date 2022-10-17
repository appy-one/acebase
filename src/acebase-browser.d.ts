import { LoggingLevel } from 'acebase-core';
import { AceBase, AceBaseLocalSettings } from './acebase-local';
export declare class BrowserAceBase extends AceBase {
    /**
     * Constructor that is used in browser context
     * @param name database name
     * @param settings settings
     */
    constructor(name: string, settings: Partial<AceBaseLocalSettings> & {
        multipleTabs?: boolean;
    });
    /**
     * Creates an AceBase database instance using IndexedDB as storage engine
     * @param dbname Name of the database
     * @param settings optional settings
     */
    static WithIndexedDB(dbname: string, settings: Partial<{
        /**
         * what level to use for logging to the console
         * @default 'error'
         */
        logLevel: LoggingLevel;
        /**
         * Whether to remove undefined property values of objects being stored, instead of throwing an error
         * @default false
         */
        removeVoidProperties: boolean;
        /**
         * Maximum size of binary data/strings to store in parent object records. Larger values are stored in their own records. Recommended to keep this at the default setting
         * @default 50
         */
        maxInlineValueSize: number;
        /**
         * Whether to enable cross-tab synchronization
         * @default false
         */
        multipleTabs: boolean;
        /**
         * How many seconds to keep node info in memory, to speed up IndexedDB performance.
         * @default 60
         */
        cacheSeconds: number;
        /**
         * timeout setting for read and write locks in seconds. Operations taking longer than this will be aborted. Default is 120 seconds
         * @default 120
         */
        lockTimeout: number;
        /**
         * You can turn this on if you are a sponsor
         * @default false
         */
        sponsor: boolean;
    }>): AceBase;
}
