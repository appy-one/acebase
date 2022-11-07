import { LoggingLevel } from 'acebase-core';
import { StorageSettings } from '../..';
import { LocalStorageLike } from './interface';

export class LocalStorageSettings extends StorageSettings {
    constructor(settings: Partial<LocalStorageSettings>) {
        super(settings);
        if (typeof settings.temp === 'boolean') { this.temp = settings.temp; }
        if (typeof settings.provider === 'object') { this.provider = settings.provider; }
        if (typeof settings.multipleTabs === 'boolean') { this.multipleTabs = settings.multipleTabs; }
        if (typeof settings.logLevel === 'string') { this.logLevel = settings.logLevel; }
        if (typeof settings.sponsor === 'boolean') { this.sponsor = settings.sponsor; }
        ['type', 'ipc', 'path'].forEach((prop) => {
            if (prop in settings) {
                console.warn(`${prop} setting is not supported for AceBase LocalStorage`);
            }
        });
    }

    /**
     * whether to use sessionStorage instead of localStorage
     * @default false
     */
    temp = false;

    /**
     * Alternate localStorage provider for running in non-browser environments. Eg using 'node-localstorage'
     */
    provider?: LocalStorageLike;

    /**
     * Whether to enable cross-tab synchronization
     * @default false
     */
    multipleTabs = false;

    /**
     * what level to use for logging to the console
     */
    logLevel: LoggingLevel;

    /**
     * You can turn this on if you are a sponsor
     * @default false
     */
    sponsor: boolean;

    /**
     * Not available for LocalStorage adapter
     */
    ipc: any;

    /**
     * Not available for LocalStorage adapter
     */
    path: string;

    /**
     * Not available for LocalStorage adapter
     */
    type: string;
}
