import { SimpleCache } from 'acebase-core';
import { CustomStorageSettings, ICustomStorageNode } from '..';
import { AceBase } from '../../..';
import { IndexedDBStorageSettings } from './settings';
import { IndexedDBStorageTransaction, IndexedDBTransactionContext } from './transaction';

export function createIndexedDBInstance(dbname: string, init: Partial<IndexedDBStorageSettings> = {}) {
    const settings = new IndexedDBStorageSettings(init);

    // We'll create an IndexedDB with name "dbname.acebase"
    const IndexedDB: IDBFactory = window.indexedDB || (window as any).mozIndexedDB || (window as any).webkitIndexedDB || (window as any).msIndexedDB; // browser prefixes not really needed, see https://caniuse.com/#feat=indexeddb
    const request = IndexedDB.open(`${dbname}.acebase`, 1);

    request.onupgradeneeded = (e) => {
        // create datastore
        const db = request.result;

        // Create "nodes" object store for metadata
        db.createObjectStore('nodes', { keyPath: 'path'});

        // Create "content" object store with all data
        db.createObjectStore('content');
    };

    let idb: IDBDatabase;
    const readyPromise = new Promise<void>((resolve, reject) => {
        request.onsuccess = e => {
            idb = request.result;
            resolve();
        };
        request.onerror = e => {
            reject(e);
        };
    });

    const cache = new SimpleCache<string, ICustomStorageNode>(typeof settings.cacheSeconds === 'number' ? settings.cacheSeconds : 60); // 60 second node cache by default
    // cache.enabled = false;

    const storageSettings = new CustomStorageSettings({
        name: 'IndexedDB',
        locking: true, // IndexedDB transactions are short-lived, so we'll use AceBase's path based locking
        removeVoidProperties: settings.removeVoidProperties,
        maxInlineValueSize: settings.maxInlineValueSize,
        lockTimeout: settings.lockTimeout,
        ready() {
            return readyPromise;
        },
        async getTransaction(target: { path: string; write: boolean }) {
            await readyPromise;
            const context: IndexedDBTransactionContext = {
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
    ipc.on('notification', async (notification: { data: any }) => {
        const message = notification.data;
        if (typeof message !== 'object') { return; }
        if (message.action === 'cache.invalidate') {
            // console.warn(`Invalidating cache for paths`, message.paths);
            for (const path of message.paths) {
                cache.remove(path);
            }
        }
    });
    return db;
}
