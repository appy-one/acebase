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
            locking: true, // IndexedDB transactions are short-lived, so we'll use AceBase's path based locking
            ready() {
                return readyPromise;
            },
            getTransaction(target) {
                const context = {
                    debug: true,
                    db
                }
                const transaction = new IndexedDBStorageTransaction(context, target);
                return Promise.resolve(transaction);
            }
        });
        return new AceBase(dbname, { logLevel: settings.logLevel, storage: storageSettings });
    }
}

function _requestToPromise(request) {
    return new Promise((resolve, reject) => { 
        request.onsuccess = event => {
            return resolve(request.result || null);
        }
        request.onerror = reject;
    });
}

class IndexedDBStorageTransaction extends CustomStorageTransaction {

    /** Creates a transaction object for IndexedDB usage. Because IndexedDB automatically commits
     * transactions when they have not been touched for a number of microtasks (eg promises 
     * resolving whithout querying data), we will actually create seperate IndexedDB transactions 
     * for each get, set and remove operation. Rollbacks are not possible for this reason.
     * @param {{debug: boolean, db: typeof IndexedDB }} context
     * @param {{path: string, write: boolean}} target 
     * @param {NodeLocker} nodeLocker 
     */
    constructor(context, target) {
        super(target);
        this.context = context;
        this._pending = [];
    }

    _createTransaction(write = false) {
        const tx = this.context.db.transaction(['nodes', 'content'], write ? 'readwrite' : 'readonly');
        return tx;
    }
    
    commit() {
        // console.log(`*** COMMIT ${this._pending.length} operations ****`);
        if (this._pending.length === 0) { return Promise.resolve(); }
        const ops = this._pending.splice(0);
        const tx = this._createTransaction(true);
        const promises = ops.map(op => {
            if (op.action === 'set') { return this._set(tx, op.path, op.node); }
            else if (op.action === 'remove') { return this._remove(tx, op.path); }
            else { throw new Error('Unknown pending operation'); }
        });
        return Promise.all(promises)
        .then(() => {
            tx.commit && tx.commit();
            // console.log(`*** COMMIT DONE! ***`);
        })
        .catch(err => {
            console.error(err);
            tx.abort && tx.abort();
        });
    }
    
    rollback(err) {
        // Nothing has committed yet, so we'll leave it like that
        this._pending = [];
        return Promise.resolve();
    }

    get(path) {
        const tx = this._createTransaction(false);
        const r1 = _requestToPromise(tx.objectStore('nodes').get(path)); // Get metadata from "nodes" object store
        const r2 = _requestToPromise(tx.objectStore('content').get(path)); // Get content from "content" object store
        return Promise.all([r1, r2])
        .then(results => {
            tx.commit && tx.commit();
            /** @type {IIndexedDBNodeData} */
            const info = results[0];
            if (!info) {
                // Node doesn't exist
                return null; 
            }
            /** @type {ICustomStorageNode} */
            const node = info.metadata;
            node.value = results[1];
            return node;
        })
        .catch(err => {
            tx.abort && tx.abort();
            console.error(`IndexedDB get error`, err);
            throw err;
        });
    }

    set(path, node) {
        // Queue the operation until commit
        this._pending.push({ action: 'set', path, node });
        return Promise.resolve();
    }

    remove(path) {
        // Queue the operation until commit
        this._pending.push({ action: 'remove', path });
        return Promise.resolve();
    }

    _set(tx, path, node) {
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
        const r1 = _requestToPromise(tx.objectStore('nodes').put(obj)); // Insert into "nodes" object store
        const r2 = _requestToPromise(tx.objectStore('content').put(value, path)); // Add value to "content" object store
        return Promise.all([r1, r2]);
    }

    _remove(tx, path) {
        const r1 = _requestToPromise(tx.objectStore('content').delete(path)); // Remove from "content" object store
        const r2 = _requestToPromise(tx.objectStore('nodes').delete(path)); // Remove from "nodes" data store
        return Promise.all([r1, r2]);
    }

    childrenOf(path, include, checkCallback, addCallback) {
        // Use cursor to loop from path on
        return new Promise((resolve, reject) => {
            const pathInfo = CustomStorageHelpers.PathInfo.get(path);
            const tx = this._createTransaction(false);
            const store = tx.objectStore('nodes');
            const query = IDBKeyRange.lowerBound(path, true);
            /** @type {IDBRequest<IDBCursorWithValue>|IDBRequest<IDBCursor>} */
            const cursor = include.metadata ? store.openCursor(query) : store.openKeyCursor(query);
            cursor.onerror = e => {
                tx.abort && tx.abort();
                reject(e);
            }
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
                            node.value = await new Promise((resolve, reject) => {
                                req.onerror = e => {
                                    resolve(null); // Value missing?
                                };
                                req.onsuccess = e => {
                                    resolve(req.result);
                                };
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
                    tx.commit && tx.commit();
                    resolve();
                }
            };
        });
    }

    descendantsOf(path, include, checkCallback, addCallback) {
        // Use cursor to loop from path on
        // NOTE: Implementation is almost identical to childrenOf, consider merging them
        return new Promise((resolve, reject) => {
            const pathInfo = CustomStorageHelpers.PathInfo.get(path);
            const tx = this._createTransaction(false);
            const store = tx.objectStore('nodes');
            const query = IDBKeyRange.lowerBound(path, true);
            /** @type {IDBRequest<IDBCursorWithValue>|IDBRequest<IDBCursor>} */
            const cursor = include.metadata ? store.openCursor(query) : store.openKeyCursor(query);
            cursor.onerror = e => {
                tx.abort && tx.abort();
                reject(e);
            }
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
                            node.value = await new Promise((resolve, reject) => {
                                req.onerror = e => {
                                    resolve(null); // Value missing?
                                };
                                req.onsuccess = e => {
                                    resolve(req.result);
                                };
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
                    tx.commit && tx.commit();
                    resolve();
                }
            };
        });
    }

}

module.exports = { BrowserAceBase };