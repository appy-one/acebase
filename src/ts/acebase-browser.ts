import { LoggingLevel, SimpleCache } from 'acebase-core';
import { AceBase, AceBaseLocalSettings } from './acebase-local';
import { IPCPeer } from './ipc';
import { CustomStorageSettings, CustomStorageTransaction, CustomStorageHelpers, ICustomStorageNode, ICustomStorageNodeMetaData } from './storage/custom';
import { IndexedDBStorageSettings } from './storage/custom/indexed-db/settings';

interface IIndexedDBNodeData {
    path: string;
    metadata: ICustomStorageNodeMetaData;
}

const deprecatedConstructorError = `Using AceBase constructor in the browser to use localStorage is deprecated!
Switch to:
IndexedDB implementation (FASTER, MORE RELIABLE):
    let db = AceBase.WithIndexedDB(name, settings)
Or, new LocalStorage implementation:
    let db = AceBase.WithLocalStorage(name, settings)
Or, write your own CustomStorage adapter:
    let myCustomStorage = new CustomStorageSettings({ ... });
    let db = new AceBase(name, { storage: myCustomStorage })`;

export class BrowserAceBase extends AceBase {
    /**
     * Constructor that is used in browser context
     * @param name database name
     * @param settings settings
     */
    constructor(name: string, settings: Partial<AceBaseLocalSettings> & { multipleTabs?: boolean }) {
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
     * @param dbname Name of the database
     * @param settings optional settings
     */
    static WithIndexedDB(dbname: string, init: Partial<IndexedDBStorageSettings> = {}) {

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

        let db: IDBDatabase;
        const readyPromise = new Promise<void>((resolve, reject) => {
            request.onsuccess = e => {
                db = request.result;
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
                const context = {
                    debug: false,
                    db,
                    cache,
                    ipc,
                };
                return new IndexedDBStorageTransaction(context, target);
            },
        });
        const acebase: AceBase = new BrowserAceBase(dbname, {
            logLevel: settings.logLevel,
            storage: storageSettings,
            sponsor: settings.sponsor,
        });
        const ipc = acebase.api.storage.ipc;
        acebase.settings.ipcEvents = settings.multipleTabs === true;
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
        return acebase;
    }
}

function _requestToPromise(request: IDBRequest) {
    return new Promise((resolve, reject) => {
        request.onsuccess = event => {
            return resolve(request.result || null);
        };
        request.onerror = reject;
    });
}

class IndexedDBStorageTransaction extends CustomStorageTransaction {

    production = true; // Improves performance, only set when all works well

    private _pending: Array<{ path: string; action: 'set' | 'update' | 'remove'; node?: ICustomStorageNode }>;

    /**
     * Creates a transaction object for IndexedDB usage. Because IndexedDB automatically commits
     * transactions when they have not been touched for a number of microtasks (eg promises
     * resolving whithout querying data), we will enqueue set and remove operations until commit
     * or rollback. We'll create separate IndexedDB transactions for get operations, caching their
     * values to speed up successive requests for the same data.
     */
    constructor(public context: {debug: boolean, db: IDBDatabase, cache: SimpleCache<string, ICustomStorageNode>, ipc: IPCPeer }, target: { path: string, write: boolean }) {
        super(target);
        this._pending = [];
    }

    _createTransaction(write = false) {
        const tx = this.context.db.transaction(['nodes', 'content'], write ? 'readwrite' : 'readonly');
        return tx;
    }

    _splitMetadata(node: ICustomStorageNode) {
        const value = node.value;
        const copy: ICustomStorageNode = { ...node };
        delete copy.value;
        const metadata = copy as ICustomStorageNodeMetaData;
        return { metadata, value };
    }

    async commit() {
        // console.log(`*** commit ${this._pending.length} operations ****`);
        if (this._pending.length === 0) { return; }
        const batch = this._pending.splice(0);

        this.context.ipc.sendNotification({ action: 'cache.invalidate', paths: batch.map(op => op.path) });

        const tx = this._createTransaction(true);
        try {
            await new Promise<void>((resolve, reject) => {
                let stop = false, processed = 0;
                const handleError = (err: any) => {
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
                        const nodeInfo: IIndexedDBNodeData = { path, metadata };
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

    async rollback(err: any) {
        // Nothing has committed yet, so we'll leave it like that
        this._pending = [];
    }

    async get(path: string) {
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
            const info = results[0] as IIndexedDBNodeData;
            if (!info) {
                // Node doesn't exist
                this.context.cache.set(path, null);
                return null;
            }
            const node = info.metadata as ICustomStorageNode;
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

    set(path: string, node: ICustomStorageNode) {
        // Queue the operation until commit
        this._pending.push({ action: 'set', path, node });
    }

    remove(path: string) {
        // Queue the operation until commit
        this._pending.push({ action: 'remove', path });
    }

    async removeMultiple(paths: string[]) {
        // Queues multiple items at once, dramatically improves performance for large datasets
        paths.forEach(path => {
            this._pending.push({ action: 'remove', path });
        });
    }

    childrenOf(
        path: string,
        include: {
            metadata: boolean;
            value: boolean;
        },
        checkCallback: (childPath: string) => boolean,
        addCallback?: (childPath: string, node?: ICustomStorageNodeMetaData|ICustomStorageNode) => boolean,
    ) {
        // console.log(`*** childrenOf "${path}" ****`);
        return this._getChildrenOf(path, { ...include, descendants: false }, checkCallback, addCallback);
    }

    descendantsOf(
        path: string,
        include: {
            metadata: boolean;
            value: boolean;
        },
        checkCallback: (descPath: string, metadata?: ICustomStorageNodeMetaData) => boolean,
        addCallback?: (descPath: string, node?: ICustomStorageNodeMetaData|ICustomStorageNode) => boolean,
    ) {
        // console.log(`*** descendantsOf "${path}" ****`);
        return this._getChildrenOf(path, { ...include, descendants: true }, checkCallback, addCallback);
    }

    _getChildrenOf(
        path: string,
        include: {
            metadata: boolean;
            value: boolean;
            descendants: boolean;
        },
        checkCallback: (path: string, metadata?: ICustomStorageNodeMetaData) => boolean,
        addCallback?: (path: string, node?: ICustomStorageNodeMetaData|ICustomStorageNode) => boolean,
    ) {
        // Use cursor to loop from path on
        return new Promise<void>((resolve, reject) => {
            const pathInfo = CustomStorageHelpers.PathInfo.get(path);
            const tx = this._createTransaction(false);
            const store = tx.objectStore('nodes');
            const query = IDBKeyRange.lowerBound(path, true);
            const cursor = include.metadata ? store.openCursor(query) as IDBRequest<IDBCursor> : store.openKeyCursor(query) as IDBRequest<IDBCursorWithValue>;
            cursor.onerror = e => {
                tx.abort?.();
                reject(e);
            };
            cursor.onsuccess = async e => {
                const otherPath = cursor.result?.key as string ?? null;
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

                    let node: ICustomStorageNode|ICustomStorageNodeMetaData;
                    if (include.metadata) {
                        const valueCursor = cursor as IDBRequest<IDBCursorWithValue>;
                        const data = valueCursor.result.value as IIndexedDBNodeData;
                        node = data.metadata;
                    }
                    const shouldAdd = checkCallback(otherPath, node);
                    if (shouldAdd) {
                        if (include.value) {
                            // Load value!
                            if (this.context.cache.has(otherPath)) {
                                const cache = this.context.cache.get(otherPath);
                                (node as ICustomStorageNode).value = cache.value;
                            }
                            else {
                                const req = tx.objectStore('content').get(otherPath);
                                (node as ICustomStorageNode).value = await new Promise((resolve, reject) => {
                                    req.onerror = e => {
                                        resolve(null); // Value missing?
                                    };
                                    req.onsuccess = e => {
                                        resolve(req.result);
                                    };
                                });
                                this.context.cache.set(otherPath, (node as ICustomStorageNode).value === null ? null : node as ICustomStorageNode);
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
                    tx.commit?.();
                    resolve();
                }
            };
        });
    }

}
