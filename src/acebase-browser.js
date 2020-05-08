const { AceBase, AceBaseLocalSettings } = require('./acebase-local');
const { CustomStorageSettings, CustomStorageTransaction, CustomStorageHelpers, ICustomStorageNode, ICustomStorageNodeMetaData } = require('./storage-custom');

/**
 * @typedef {Object} IIndexedDBNodeData
 * @property {string} path
 * @property {ICustomStorageNodeMetaData} metadata
 */

const deprecatedConstructorError = `Using AceBase constructor in the browser to use localStorage is deprecated!
Switch to:
IndexedDB implementation (FASTER, MORE RELIABLE):
    let db = AceBase.WithIndexedDB(name, settings)
Or, new LocalStorage implementation:
    let db = AceBase.WithLocalStorage(name, settings)
Or, write your own CustomStorage adapter:
    let myCustomStorage = new CustomStorageSettings({ ... });
    let db = new AceBase(name, { storage: myCustomStorage })`;

class BrowserAceBase extends AceBase {
    /**
     * Constructor that is used in browser context
     * @param {string} name database name
     * @param {AceBaseLocalSettings} settings settings
     */
    constructor(name, settings) {
        if (typeof settings !== 'object' || typeof settings.storage !== 'object') {
            // Client is using old AceBaseBrowser signature, eg:
            // let db = new AceBase('name', { temp: false })
            //
            // Don't allow this anymore. If client wants to use localStorage,
            // they need to switch to AceBase.WithLocalStorage('name', settings).
            // If they want to use custom storage in the browser, they must 
            // use the same constructor signature AceBase has:
            // let db = new AceBase('name', { storage: new CustomStorageSettings({ ... }) });

            throw new Error(deprecatedConstructorError);
        }
        super(name, settings);
    }

    /**
     * Creates an AceBase database instance using IndexedDB as storage engine
     * @param {string} dbname Name of the database
     * @param {object} [settings] optional settings
     * @param {string} [settings.logLevel] what level to use for logging to the console
     */
    static WithIndexedDB(dbname, settings) {

        settings = settings || {};
        if (!settings.logLevel) { settings.logLevel = 'error'; }

        // We'll create an IndexedDB with name "dbname.acebase"
        const IndexedDB = window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB; // browser prefixes not really needed, see https://caniuse.com/#feat=indexeddb
        let request = IndexedDB.open(`${dbname}.acebase`, 1);

        let readyResolve, readyReject, readyPromise = new Promise((rs,rj) => { readyResolve = rs; readyReject = rj; });

        request.onupgradeneeded = (e) => {
            // create datastore
            let db = request.result;

            // Create "nodes" object store for metadata
            db.createObjectStore('nodes', { keyPath: 'path'});

            // Create "content" object store with all data
            db.createObjectStore('content');
        };

        let db;
        request.onsuccess = e => {
            db = request.result;
            readyResolve();
        };
        request.onerror = e => {
            readyReject(e);
        };

        const storageSettings = new CustomStorageSettings({
            name: 'IndexedDB',
            locking: false,
            ready() {
                return readyPromise;
            },
            async getTransaction(target) {
                const context = {
                    debug: true,
                    db
                }
                const transaction = new IndexedDBStorageTransaction(context, target);
                await transaction.start();
                return transaction;
            }
        });
        return new AceBase(dbname, { logLevel: settings.logLevel, storage: storageSettings });
    }
}

class IndexedDBStorageTransaction extends CustomStorageTransaction {

    /**
     * @param {{debug: boolean, db: typeof IndexedDB }} context
     * @param {{path: string, write: boolean}} target 
     * @param {NodeLocker} nodeLocker 
     */
    constructor(context, target) {
        super(target);
        this.context = context;
    }

    start() {
        // Start transaction
        return new Promise((resolve, reject) => {
            this._tx = this.context.db.transaction(['nodes', 'content'], this.target.write ? 'readwrite' : 'readonly');
            resolve();
        })
    }
    
    commit() {
        const tx = this._tx;
        tx.commit && tx.commit();
    }
    
    rollback(err) {
        const tx = this._tx;
        tx.abort && tx.abort();        
    }

    get(path) {
        // Get metadata from "nodes" object store
        const tx = this._tx;
        const request = tx.objectStore('nodes').get(path);
        return new Promise((resolve, reject) => {
            request.onsuccess = event => {
                /** @type {IIndexedDBNodeData} */
                const data = request.result;
                if (!data) {
                    return resolve(null);
                }
                /** @type {ICustomStorageNode} */
                const node = data.metadata;

                // Node exists, get content from "content" object store
                const contentReq = tx.objectStore('content').get(path);
                contentReq.onsuccess = e => {
                    node.value = contentReq.result;
                    resolve(node);
                };
                contentReq.onerror = e => reject(e);
            }
            request.onerror = e => {
                console.error(`IndexedDB get error`, e);
                reject(e);
            }
        });
    }

    set(path, node) {
        /** @type {ICustomStorageNode} */
        const copy = {};
        const value = node.value;
        Object.assign(copy, node);
        delete copy.value;
        /** @type {ICustomStorageNodeMetaData} */
        const metadata = copy;                
        /** @type {IIndexedDBNodeData} */
        const obj = {
            path,
            metadata
        }
        return new Promise((resolve, reject) => {
            const tx = this._tx;
            // Insert into "nodes" object store first
            const request = tx.objectStore('nodes').put(obj);
            request.onerror = e => reject(e);
            request.onsuccess = e => {
                // Now add to "content" object store
                const contentReq = tx.objectStore('content').put(value, path);
                contentReq.onsuccess = e => resolve();
                contentReq.onerror = e => {
                    tx.abort(); // rollback transaction
                    reject(e);
                }
            };
        });
    }

    remove(path) {
        const tx = this._tx;
        return new Promise((resolve, reject) => {
            // First, remove from "content" object store
            const r1 = tx.objectStore('content').delete(path);
            r1.onerror = e => reject(e);
            r1.onsuccess = e => {
                // Now, remove from "nodes" data store
                const r2 = tx.objectStore('nodes').delete(path);
                r2.onerror = e => {
                    tx.abort(); // rollback transaction
                    reject(e);
                };
                r2.onsuccess = e => resolve();
            }
        });
    }

    childrenOf(path, include, checkCallback, addCallback) {
        // Use cursor to loop from path on
        const pathInfo = CustomStorageHelpers.PathInfo.get(path);
        const tx = this._tx;
        const store = tx.objectStore('nodes');
        const query = IDBKeyRange.lowerBound(path, true);
        return new Promise((resolve, reject) => {
            /** @type {IDBRequest<IDBCursorWithValue>|IDBRequest<IDBCursor>} */
            const cursor = include.metadata ? store.openCursor(query) : store.openKeyCursor(query);
            cursor.onerror = e => reject(e);
            cursor.onsuccess = async e => {
                /** type {string} */
                const otherPath = cursor.result ? cursor.result.key : null;
                let keepGoing = true;
                if (otherPath === null) {
                    // No more results
                    keepGoing = false;
                }
                else if (!pathInfo.isAncestorOf(otherPath)) {
                    // Paths are sorted, no more children to be expected!
                    keepGoing = false;
                }
                else if (pathInfo.isParentOf(otherPath) && checkCallback(otherPath)) {
                    /** @type {ICustomStorageNode|ICustomStorageNodeMetaData} */
                    let node;
                    if (include.metadata) {
                        /** @type {IDBRequest<IDBCursorWithValue>} */
                        const valueCursor = cursor;
                        /** @type {IIndexedDBNodeData} */
                        const data = valueCursor.result.value;
                        node = data.metadata;
                        if (include.value) {
                            // Load value!
                            const req = tx.objectStore('content').get(otherPath);
                            await new Promise((resolve, reject) => {
                                req.onerror = e => reject(e);
                                req.onsuccess = e => {
                                    node.value = req.result;
                                    resolve();
                                }
                            });
                        }
                    }
                    keepGoing = addCallback(otherPath, node);
                }
                if (keepGoing) {
                    try { cursor.result.continue(); }
                    catch(err) {
                        // We reached the end of the cursor?
                        keepGoing = false;
                    }
                }
                if (!keepGoing) {
                    resolve();
                }
            };
        });
    }

    descendantsOf(path, include, checkCallback, addCallback) {
        // Use cursor to loop from path on
        // NOTE: Implementation is almost identical to childrenOf, consider merging them
        const pathInfo = CustomStorageHelpers.PathInfo.get(path);
        const tx = this._tx;
        const store = tx.objectStore('nodes');
        const query = IDBKeyRange.lowerBound(path, true);
        return new Promise((resolve, reject) => {
            /** @type {IDBRequest<IDBCursorWithValue>|IDBRequest<IDBCursor>} */
            const cursor = include.metadata ? store.openCursor(query) : store.openKeyCursor(query);
            cursor.onerror = e => reject(e);
            cursor.onsuccess = async e => {
                /** @type {string} */
                const otherPath = cursor.result ? cursor.result.key : null;
                let keepGoing = true;
                if (otherPath === null) {
                    // No more results
                    keepGoing = false;
                }
                else if (!pathInfo.isAncestorOf(otherPath)) {
                    // Paths are sorted, no more ancestors to be expected!
                    keepGoing = false;
                }
                else if (checkCallback(otherPath)) {
                    /** @type {ICustomStorageNode|ICustomStorageNodeMetaData} */
                    let node;
                    if (include.metadata) {
                        /** @type {IDBRequest<IDBCursorWithValue>} */
                        const valueCursor = cursor;
                        /** @type {IIndexedDBNodeData} */
                        const data = valueCursor.result.value;
                        node = data.metadata;
                        if (include.value) {
                            // Load value!
                            const req = tx.objectStore('content').get(otherPath);
                            await new Promise((resolve, reject) => {
                                req.onerror = e => reject(e);
                                req.onsuccess = e => {
                                    node.value = req.result;
                                    resolve();
                                }
                            });
                        }
                    }
                    keepGoing = addCallback(otherPath, node);
                }
                if (keepGoing) {
                    try { cursor.result.continue(); }
                    catch(err) {
                        // We reached the end of the cursor?
                        keepGoing = false;
                    }
                }
                if (!keepGoing) {
                    resolve();
                }
            };
        });
    }            

}

module.exports = { BrowserAceBase };