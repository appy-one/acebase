import { NetIPCServer } from '../ipc/index.js';
import { IPCClientSettings } from './ipc-client-settings.js';
import { IPCSocketSettings } from './ipc-socket-settings.js';
import { TransactionLogSettings } from './transaction-log-settings.js';

/**
 * Storage Settings
 */
export class StorageSettings {

    /**
     * in bytes, max amount of child data to store within a parent record before moving to a dedicated record. Default is 50
     * @default 50
     */
    maxInlineValueSize = 50;

    /**
     * Instead of throwing errors on undefined values, remove the properties automatically. Default is false
     * @default false
     */
    removeVoidProperties = false;

    /**
     * Target path to store database files in, default is `'.'`
     * @default '.'
     */
    path = '.';

    /**
     * timeout setting for read and write locks in seconds. Operations taking longer than this will be aborted. Default is 120 seconds.
     * @default 120
     */
    lockTimeout = 120;

    /**
     * optional type of storage class - used by `AceBaseStorage` to create different specific db files (data, transaction, auth etc)
     * @see AceBaseStorageSettings see `AceBaseStorageSettings.type` for more info
     */
    type = 'data';

    /**
     * Whether the database should be opened in readonly mode
     * @default false
     */
    readOnly = false;

    /**
     * IPC settings if you are using AceBase in pm2 or cloud-based clusters, or (NEW) `'socket'` to connect
     * to an automatically spawned IPC service ("daemon") on this machine
     */
    ipc?: IPCClientSettings | 'socket' | IPCSocketSettings | NetIPCServer;

    /**
     * Settings for optional transaction logging
     */
    transactions?: TransactionLogSettings;

    constructor(settings: Partial<StorageSettings> = {}) {
        if (typeof settings.maxInlineValueSize === 'number') { this.maxInlineValueSize =  settings.maxInlineValueSize; }
        if (typeof settings.removeVoidProperties === 'boolean') { this.removeVoidProperties = settings.removeVoidProperties; }
        if (typeof settings.path === 'string') { this.path = settings.path; }
        if (this.path.endsWith('/')) { this.path = this.path.slice(0, -1); }
        if (typeof settings.lockTimeout === 'number') { this.lockTimeout = settings.lockTimeout; }
        if (typeof settings.type === 'string') { this.type = settings.type; }
        if (typeof settings.readOnly === 'boolean') { this.readOnly = settings.readOnly; }
        if (['object', 'string'].includes(typeof settings.ipc)) { this.ipc = settings.ipc; }
    }
}
