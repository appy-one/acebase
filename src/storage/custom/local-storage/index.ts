import { CustomStorageSettings } from '..';
import { AceBase } from '../../..';
import { LocalStorageSettings } from './settings';
import { LocalStorageTransaction } from './transaction';

export { LocalStorageSettings, LocalStorageTransaction };

export function createLocalStorageInstance(dbname: string, init: Partial<LocalStorageSettings> = {}) {
    const settings = new LocalStorageSettings(init);

    // Determine whether to use localStorage or sessionStorage
    const ls = settings.provider ? settings.provider : settings.temp ? localStorage : sessionStorage;

    // Setup our CustomStorageSettings
    const storageSettings = new CustomStorageSettings({
        name: 'LocalStorage',
        locking: true,
        removeVoidProperties: settings.removeVoidProperties,
        maxInlineValueSize: settings.maxInlineValueSize,
        async ready() {
            // LocalStorage is always ready
        },
        async getTransaction(target: { path: string; write: boolean }) {
            // Create an instance of our transaction class
            const context = {
                debug: true,
                dbname,
                localStorage: ls,
            };
            const transaction = new LocalStorageTransaction(context, target);
            return transaction;
        },
    });
    const db = new AceBase(dbname, { logLevel: settings.logLevel, storage: storageSettings, sponsor: settings.sponsor });
    db.settings.ipcEvents = settings.multipleTabs === true;

    return db;
}
