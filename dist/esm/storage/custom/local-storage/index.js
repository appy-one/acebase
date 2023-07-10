import { CustomStorageSettings } from '../index.js';
import { AceBase } from '../../../index.js';
import { LocalStorageSettings } from './settings.js';
import { LocalStorageTransaction } from './transaction.js';
export { LocalStorageSettings, LocalStorageTransaction };
export function createLocalStorageInstance(dbname, init = {}) {
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
        async getTransaction(target) {
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
//# sourceMappingURL=index.js.map