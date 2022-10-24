import { LoggingLevel } from 'acebase-core';
import { StorageSettings } from '../..';
import { LocalStorageLike } from './interface';
export declare class LocalStorageSettings extends StorageSettings {
    constructor(settings: Partial<LocalStorageSettings>);
    /**
     * whether to use sessionStorage instead of localStorage
     * @default false
     */
    temp: boolean;
    /**
     * Alternate localStorage provider for running in non-browser environments. Eg using 'node-localstorage'
     */
    provider?: LocalStorageLike;
    /**
     * Whether to enable cross-tab synchronization
     * @default false
     */
    multipleTabs: boolean;
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
//# sourceMappingURL=settings.d.ts.map