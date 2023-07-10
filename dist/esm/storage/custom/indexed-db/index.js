import { SimpleCache } from 'acebase-core';
import { CustomStorageSettings } from '../index.js';
import { AceBase } from '../../../index.js';
import { IndexedDBStorageSettings } from './settings.js';
import { IndexedDBStorageTransaction } from './transaction.js';
export function createIndexedDBInstance(dbname, init = {}) {
    const settings = new IndexedDBStorageSettings(init);
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
    const cache = new SimpleCache(typeof settings.cacheSeconds === 'number' ? settings.cacheSeconds : 60); // 60 second node cache by default
    // cache.enabled = false;
    const storageSettings = new CustomStorageSettings({
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
            return new IndexedDBStorageTransaction(context, target);
        },
    });
    const db = new AceBase(dbname, {
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
//# sourceMappingURL=index.js.map