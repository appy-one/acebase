import { LoggingLevel } from 'acebase-core';
import { StorageSettings } from '../..';
export declare class IndexedDBStorageSettings extends StorageSettings {
    /**
     * what level to use for logging to the console
     */
    logLevel: LoggingLevel;
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
     * You can turn this on if you are a sponsor
     * @default false
     */
    sponsor: boolean;
    constructor(settings: Partial<IndexedDBStorageSettings>);
}
//# sourceMappingURL=settings.d.ts.map