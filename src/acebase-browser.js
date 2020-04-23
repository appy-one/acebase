const { AceBase, AceBaseLocalSettings } = require('./acebase-local');
const { CustomStorageSettings, CustomStorageHelpers, ICustomStorageNode, ICustomStorageNodeMetaData } = require('./storage-custom');

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
        }
        request.onerror = e => {
            readyReject(e);
        };

        const storageSettings = new CustomStorageSettings({
            name: 'IndexedDB',
            ready() {
                return readyPromise;
            },
            get(path) {
                // Get metadata from "nodes" object store
                const tx = db.transaction(['nodes', 'content'], 'readonly');
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
            },
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
                    const tx = db.transaction(['nodes', 'content'], 'readwrite');
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
            },
            remove(path) {
                const tx = db.transaction(['nodes','content'], 'readwrite');
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
            },
            childrenOf(path, include, checkCallback, addCallback) {
                // Use cursor to loop from path on
                const pathInfo = CustomStorageHelpers.PathInfo.get(path);
                const lockStores = include.value ? ['nodes','content'] : 'nodes';
                const tx = db.transaction(lockStores, 'readonly');
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
            },
            descendantsOf(path, include, checkCallback, addCallback) {
                // Use cursor to loop from path on
                // NOTE: Implementation is almost identical to childrenOf, consider merging them
                const pathInfo = CustomStorageHelpers.PathInfo.get(path);
                const lockStores = include.value ? ['nodes','content'] : 'nodes';
                const tx = db.transaction(lockStores, 'readonly');
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
        });

        return new AceBase(dbname, { logLevel: settings.logLevel, storage: storageSettings });
    }

    /**
     * Creates an AceBase database instance using LocalStorage as storage engine
     * @param {string} dbname Name of the database
     * @param {object} [settings] optional settings
     * @param {string} [settings.logLevel] what level to use for logging to the console
     * @param {boolean} [settings.temp] whether to use sessionStorage instead of localStorage
     * @param {any} [settings.provider] Alternate localStorage provider. Eg using 'node-localstorage'
     */    
    static WithLocalStorage(dbname, settings) {

        settings = settings || {};
        if (!settings.logLevel) { settings.logLevel = 'error'; }

        // Determine whether to use localStorage or sessionStorage
        const localStorage = settings.provider ? settings.provider : settings.temp ? window.localStorage : window.sessionStorage;

        // Helper functions to prefix all localStorage keys with dbname
        // to allows multiple db's in localStorage
        const storageKeysPrefix = `${dbname}.acebase::`; // Prefix all localStorage keys with dbname
        function getPathFromStorageKey(key) {
            return key.slice(storageKeysPrefix.length);
        }
        function getStorageKeyForPath(path) {
            return `${storageKeysPrefix}${path}`;
        }

        // Setup our CustomStorageSettings
        const storageSettings = new CustomStorageSettings({
            name: 'LocalStorage',
            ready() {
                return Promise.resolve();
            },
            get(path) {
                // Gets value from localStorage, wrapped in Promise
                return new Promise(resolve => {
                    const json = localStorage.getItem(getStorageKeyForPath(path));
                    const val = JSON.parse(json);
                    resolve(val);
                });
            },
            set(path, val) {
                // Sets value in localStorage, wrapped in Promise
                return new Promise(resolve => {
                    const json = JSON.stringify(val);
                    localStorage.setItem(getStorageKeyForPath(path), json);
                    resolve();
                });
            },
            remove(path) {
                // Removes a value from localStorage, wrapped in Promise
                return new Promise(resolve => {
                    localStorage.removeItem(getStorageKeyForPath(path));
                    resolve();
                });
            },
            childrenOf(path, include, checkCallback, addCallback) {
                // Gets all child paths
                // Cannot query localStorage, so loop through all stored keys to find children
                return new Promise(resolve => {
                    const pathInfo = CustomStorageHelpers.PathInfo.get(path);
                    for (let i = 0; i < localStorage.length; i++) {
                        const key = localStorage.key(i);
                        if (!key.startsWith(storageKeysPrefix)) { continue; }                
                        let otherPath = getPathFromStorageKey(key);
                        if (pathInfo.isParentOf(otherPath) && checkCallback(otherPath)) {
                            let node;
                            if (include.metadata || include.value) {
                                const json = localStorage.getItem(key);
                                node = JSON.parse(json);
                            }
                            const keepGoing = addCallback(otherPath, node);
                            if (!keepGoing) { break; }
                        }
                    }
                    resolve();
                });
            },
            descendantsOf(path, include, checkCallback, addCallback) {
                // Gets all descendant paths
                // Cannot query localStorage, so loop through all stored keys to find descendants
                return new Promise(resolve => {
                    const pathInfo = CustomStorageHelpers.PathInfo.get(path);
                    for (let i = 0; i < localStorage.length; i++) {
                        const key = localStorage.key(i);
                        if (!key.startsWith(storageKeysPrefix)) { continue; }
                        let otherPath = getPathFromStorageKey(key);
                        if (pathInfo.isAncestorOf(otherPath) && checkCallback(otherPath)) {
                            let node;
                            if (include.metadata || include.value) {
                                const json = localStorage.getItem(key);
                                node = JSON.parse(json);
                            }
                            const keepGoing = addCallback(otherPath, node);
                            if (!keepGoing) { break; }
                        }
                    }
                    resolve();
                });
            }
        });
        return new AceBase(dbname, { logLevel: settings.logLevel, storage: storageSettings });
    }
}

module.exports = { BrowserAceBase };