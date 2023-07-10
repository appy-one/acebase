"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createIndexedDBInstance = void 0;
const acebase_core_1 = require("acebase-core");
const __1 = require("..");
const __2 = require("../../..");
const settings_1 = require("./settings");
const transaction_1 = require("./transaction");
function createIndexedDBInstance(dbname, init = {}) {
    const settings = new settings_1.IndexedDBStorageSettings(init);
    // We'll create an IndexedDB with name "dbname.acebase"
    const request = indexedDB.open(`${dbname}.acebase`, 1);
    request.onupgradeneeded = (e) => {
        // create datastore
        const db = request.result;
        // Create "nodes" object store for metadata
        db.createObjectStore('nodes', { keyPath: 'path' });
        // Create "content" object store with all data
        db.createObjectStore('content');
    };
    let idb;
    const readyPromise = new Promise((resolve, reject) => {
        request.onsuccess = e => {
            idb = request.result;
            resolve();
        };
        request.onerror = e => {
            reject(e);
        };
    });
    const cache = new acebase_core_1.SimpleCache(typeof settings.cacheSeconds === 'number' ? settings.cacheSeconds : 60); // 60 second node cache by default
    // cache.enabled = false;
    const storageSettings = new __1.CustomStorageSettings({
        name: 'IndexedDB',
        locking: true,
        removeVoidProperties: settings.removeVoidProperties,
        maxInlineValueSize: settings.maxInlineValueSize,
        lockTimeout: settings.lockTimeout,
        ready() {
            return readyPromise;
        },
        async getTransaction(target) {
            await readyPromise;
            const context = {
                debug: false,
                db: idb,
                cache,
                ipc,
            };
            return new transaction_1.IndexedDBStorageTransaction(context, target);
        },
    });
    const db = new __2.AceBase(dbname, {
        logLevel: settings.logLevel,
        storage: storageSettings,
        sponsor: settings.sponsor,
        // isolated: settings.isolated,
    });
    const ipc = db.api.storage.ipc;
    db.settings.ipcEvents = settings.multipleTabs === true;
    ipc.on('notification', async (notification) => {
        const message = notification.data;
        if (typeof message !== 'object') {
            return;
        }
        if (message.action === 'cache.invalidate') {
            // console.warn(`Invalidating cache for paths`, message.paths);
            for (const path of message.paths) {
                cache.remove(path);
            }
        }
    });
    return db;
}
exports.createIndexedDBInstance = createIndexedDBInstance;
//# sourceMappingURL=index.js.map