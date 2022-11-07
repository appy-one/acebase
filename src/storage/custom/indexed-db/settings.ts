import { LoggingLevel } from 'acebase-core';
import { StorageSettings } from '../..';

export class IndexedDBStorageSettings extends StorageSettings {
    /**
     * what level to use for logging to the console
     */
    logLevel: LoggingLevel;

    /**
     * Whether to enable cross-tab synchronization
     * @default false
     */
    multipleTabs = false;

    /**
     * How many seconds to keep node info in memory, to speed up IndexedDB performance.
     * @default 60
     */
    cacheSeconds = 60;

    /**
     * You can turn this on if you are a sponsor
     * @default false
     */
    sponsor = false;

    constructor(settings: Partial<IndexedDBStorageSettings>) {
        super(settings);
        if (typeof settings.logLevel === 'string') { this.logLevel = settings.logLevel; }
        if (typeof settings.multipleTabs === 'boolean') { this.multipleTabs = settings.multipleTabs; }
        if (typeof settings.cacheSeconds === 'number') { this.cacheSeconds = settings.cacheSeconds; }
        if (typeof settings.sponsor === 'boolean') { this.sponsor = settings.sponsor; }
        ['type', 'ipc', 'path'].forEach((prop) => {
            if (prop in settings) {
                console.warn(`${prop} setting is not supported for AceBase IndexedDBStorage`);
            }
        });
    }
}
