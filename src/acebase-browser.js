const { SimpleCache } = require('acebase-core');
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
        this.settings.ipcEvents = settings.multipleTabs === true;
    }

    /**
     * Creates an AceBase database instance using IndexedDB as storage engine
     * @param {string} dbname Name of the database
     * @param {object} [settings] optional settings
     * @param {string} [settings.logLevel='error'] what level to use for logging to the console
     * @param {boolean} [settings.removeVoidProperties=false] Whether to remove undefined property values of objects being stored, instead of throwing an error
     * @param {number} [settings.maxInlineValueSize=50] Maximum size of binary data/strings to store in parent object records. Larger values are stored in their own records. Recommended to keep this at the default setting
     * @param {boolean} [settings.multipleTabs=false] Whether to enable cross-tab synchronization
     * @param {number} [settings.cacheSeconds=60] How many seconds to keep node info in memory, to speed up IndexedDB performance.
     * @param {number} [settings.lockTimeout=120] timeout setting for read and write locks in seconds. Operations taking longer than this will be aborted. Default is 120 seconds.
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

        const cache = new SimpleCache(typeof settings.cacheSeconds === 'number' ? settings.cacheSeconds : 60); // 60 second node cache by default
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
            async getTransaction(target) {
                await readyPromise;
                const context = {
                    debug: false,
                    db,
                    cache,
                    ipc
                }
                return new IndexedDBStorageTransaction(context, target);
            }
        });
        const acebase = new BrowserAceBase(dbname, { multipleTabs: settings.multipleTabs, logLevel: settings.logLevel, storage: storageSettings });
        const ipc = acebase.api.storage.ipc;
        ipc.on('notification', async notification => {
            const message = notification.data;
            if (typeof message !== 'object') { return; }
            if (message.action === 'cache.invalidate') {
                // console.warn(`Invalidating cache for paths`, message.paths);
                for (let path of message.paths) {
                    cache.remove(path);
                }
            }
        });
        return acebase;
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
     * resolving whithout querying data), we will enqueue set and remove operations until commit 
     * or rollback. We'll create separate IndexedDB transactions for get operations, caching their
     * values to speed up successive requests for the same data.
     * @param {{debug: boolean, db: IDBDatabase, cache: SimpleCache<string, ICustomStorageNode> }} context
     * @param {{path: string, write: boolean}} target 
     */
    constructor(context, target) {
        super(target);
        this.production = true; // Improves performance, only set when all works well
        /** @type {{debug: boolean, db: IDBDatabase, cache: SimpleCache<string, ICustomStorageNode> }} */
        this.context = context;
        this._pending = [];
    }

    /** @returns {IDBTransaction} */
    _createTransaction(write = false) {
        const tx = this.context.db.transaction(['nodes', 'content'], write ? 'readwrite' : 'readonly');
        return tx;
    }
    
    _splitMetadata(node) {
        /** @type {ICustomStorageNode} */
        const copy = {};
        const value = node.value;
        Object.assign(copy, node);
        delete copy.value;
        /** @type {ICustomStorageNodeMetaData} */
        const metadata = copy;                
        return { metadata, value };
    }

    async commit() {
        // console.log(`*** commit ${this._pending.length} operations ****`);
        if (this._pending.length === 0) { return; }
        const batch = this._pending.splice(0);

        this.context.ipc.sendMessage({ type: 'notification', data: { action: 'cache.invalidate', paths: batch.map(op => op.path) } });

        const tx = this._createTransaction(true);
        try {
            await new Promise((resolve, reject) => {
                let stop = false, processed = 0;
                const handleError = err => {
                    stop = true;
                    reject(err);
                };
                const handleSuccess = () => {
                    if (++processed === batch.length) {
                        resolve();
                    }
                };
                batch.forEach((op, i) => {
                    if (stop) { return; }
                    let r1, r2;
                    const path = op.path;
                    if (op.action === 'set') { 
                        const { metadata, value } = this._splitMetadata(op.node);
                        /** @type {IIndexedDBNodeData} */
                        const nodeInfo = { path, metadata };
                        r1 = tx.objectStore('nodes').put(nodeInfo); // Insert into "nodes" object store
                        r2 = tx.objectStore('content').put(value, path); // Add value to "content" object store
                        this.context.cache.set(path, op.node);
                    }
                    else if (op.action === 'remove') { 
                        r1 = tx.objectStore('content').delete(path); // Remove from "content" object store
                        r2 = tx.objectStore('nodes').delete(path); // Remove from "nodes" data store
                        this.context.cache.set(path, null);
                    }
                    else { 
                        handleError(new Error(`Unknown pending operation "${op.action}" on path "${path}" `)); 
                    }
                    let succeeded = 0;
                    r1.onsuccess = r2.onsuccess = () => {
                        if (++succeeded === 2) { handleSuccess(); }
                    };
                    r1.onerror = r2.onerror = handleError;
                });
            });
            tx.commit && tx.commit();
        }
        catch (err) {
            console.error(err);
            tx.abort && tx.abort();
            throw err;
        }
    }
    
    async rollback(err) {
        // Nothing has committed yet, so we'll leave it like that
        this._pending = [];
    }

    async get(path) {
        // console.log(`*** get "${path}" ****`);
        if (this.context.cache.has(path)) {
            const cache = this.context.cache.get(path);
            // console.log(`Using cached node for path "${path}": `, cache);
            return cache;
        }
        const tx = this._createTransaction(false);
        const r1 = _requestToPromise(tx.objectStore('nodes').get(path)); // Get metadata from "nodes" object store
        const r2 = _requestToPromise(tx.objectStore('content').get(path)); // Get content from "content" object store
        try {
            const results = await Promise.all([r1, r2]);
            tx.commit && tx.commit();
            /** @type {IIndexedDBNodeData} */
            const info = results[0];
            if (!info) {
                // Node doesn't exist
                this.context.cache.set(path, null);
                return null; 
            }
            /** @type {ICustomStorageNode} */
            const node = info.metadata;
            node.value = results[1];
            this.context.cache.set(path, node);
            return node;
        }
        catch(err) {
            console.error(`IndexedDB get error`, err);
            tx.abort && tx.abort();
            throw err;
        }
    }

    set(path, node) {
        // Queue the operation until commit
        this._pending.push({ action: 'set', path, node });
    }

    remove(path) {
        // Queue the operation until commit
        this._pending.push({ action: 'remove', path });
    }

    removeMultiple(paths) {
        // Queues multiple items at once, dramatically improves performance for large datasets
        paths.forEach(path => {
            this._pending.push({ action: 'remove', path });
        });
    }

    childrenOf(path, include, checkCallback, addCallback) {
        // console.log(`*** childrenOf "${path}" ****`);
        include.descendants = false;
        return this._getChildrenOf(path, include, checkCallback, addCallback);
    }

    descendantsOf(path, include, checkCallback, addCallback) {
        // console.log(`*** descendantsOf "${path}" ****`);
        include.descendants = true;
        return this._getChildrenOf(path, include, checkCallback, addCallback);
    }
    
    /**
     * 
     * @param {string} path 
     * @param {object} include 
     * @param {boolean} include.descendants
     * @param {boolean} include.metadata
     * @param {boolean} include.value
     * @param {(path: string, metadata?: ICustomStorageNodeMetaData) => boolean} checkCallback 
     * @param {(path: string, node: any) => boolean} addCallback 
     */
    _getChildrenOf(path, include, checkCallback, addCallback) {
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
                /** @type {string} */
                const otherPath = cursor.result ? cursor.result.key : null;
                let keepGoing = true;
                if (otherPath === null) {
                    // No more results
                    keepGoing = false;
                }
                else if (!pathInfo.isAncestorOf(otherPath)) {
                    // Paths are sorted, no more children or ancestors to be expected!
                    keepGoing = false;
                }
                else if (include.descendants || pathInfo.isParentOf(otherPath)) {
                    
                    /** @type {ICustomStorageNode|ICustomStorageNodeMetaData} */
                    let node;
                    if (include.metadata) {
                        /** @type {IDBRequest<IDBCursorWithValue>} */
                        const valueCursor = cursor;
                        /** @type {IIndexedDBNodeData} */
                        const data = valueCursor.result.value;
                        node = data.metadata;
                    }
                    const shouldAdd = checkCallback(otherPath, node);
                    if (shouldAdd) {
                        if (include.value) {
                            // Load value!
                            if (this.context.cache.has(otherPath)) {
                                const cache = this.context.cache.get(otherPath);
                                node.value = cache.value;
                            }
                            else {
                                const req = tx.objectStore('content').get(otherPath);
                                node.value = await new Promise((resolve, reject) => {
                                    req.onerror = e => {
                                        resolve(null); // Value missing?
                                    };
                                    req.onsuccess = e => {
                                        resolve(req.result);
                                    };
                                });
                                this.context.cache.set(otherPath, node.value === null ? null : node);
                            }
                        }
                        keepGoing = addCallback(otherPath, node);
                    }
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