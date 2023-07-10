"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLocalStorageInstance = exports.LocalStorageTransaction = exports.LocalStorageSettings = void 0;
const __1 = require("..");
const __2 = require("../../..");
const settings_1 = require("./settings");
Object.defineProperty(exports, "LocalStorageSettings", { enumerable: true, get: function () { return settings_1.LocalStorageSettings; } });
const transaction_1 = require("./transaction");
Object.defineProperty(exports, "LocalStorageTransaction", { enumerable: true, get: function () { return transaction_1.LocalStorageTransaction; } });
function createLocalStorageInstance(dbname, init = {}) {
    const settings = new settings_1.LocalStorageSettings(init);
    // Determine whether to use localStorage or sessionStorage
    const ls = settings.provider ? settings.provider : settings.temp ? localStorage : sessionStorage;
    // Setup our CustomStorageSettings
    const storageSettings = new __1.CustomStorageSettings({
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
            const transaction = new transaction_1.LocalStorageTransaction(context, target);
            return transaction;
        },
    });
    const db = new __2.AceBase(dbname, { logLevel: settings.logLevel, storage: storageSettings, sponsor: settings.sponsor });
    db.settings.ipcEvents = settings.multipleTabs === true;
    return db;
}
exports.createLocalStorageInstance = createLocalStorageInstance;
//# sourceMappingURL=index.js.map