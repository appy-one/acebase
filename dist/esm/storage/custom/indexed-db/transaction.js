import { CustomStorageHelpers, CustomStorageTransaction } from '../index.js';
function _requestToPromise(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = event => {
            return resolve(request.result || null);
        };
        request.onerror = reject;
    });
}
export class IndexedDBStorageTransaction extends CustomStorageTransaction {
    /**
     * Creates a transaction object for IndexedDB usage. Because IndexedDB automatically commits
     * transactions when they have not been touched for a number of microtasks (eg promises
     * resolving whithout querying data), we will enqueue set and remove operations until commit
     * or rollback. We'll create separate IndexedDB transactions for get operations, caching their
     * values to speed up successive requests for the same data.
     */
    constructor(context, target) {
        super(target);
        this.context = context;
        this.production = true; // Improves performance, only set when all works well
        this._pending = [];
    }
    _createTransaction(write = false) {
        const tx = this.context.db.transaction(['nodes', 'content'], write ? 'readwrite' : 'readonly');
        return tx;
    }
    _splitMetadata(node) {
        const value = node.value;
        const copy = { ...node };
        delete copy.value;
        const metadata = copy;
        return { metadata, value };
    }
    async commit() {
        // console.log(`*** commit ${this._pending.length} operations ****`);
        if (this._pending.length === 0) {
            return;
        }
        const batch = this._pending.splice(0);
        this.context.ipc.sendNotification({ action: 'cache.invalidate', paths: batch.map(op => op.path) });
        const tx = this._createTransaction(true);
        try {
            await new Promise((resolve, reject) => {
                let stop = false, processed = 0;
                const handleError = (err) => {
                    stop = true;
                    reject(err);
                };
                const handleSuccess = () => {
                    if (++processed === batch.length) {
                        resolve();
                    }
                };
                batch.forEach((op, i) => {
                    if (stop) {
                        return;
                    }
                    let r1, r2;
                    const path = op.path;
                    if (op.action === 'set') {
                        const { metadata, value } = this._splitMetadata(op.node);
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
                        if (++succeeded === 2) {
                            handleSuccess();
                        }
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
            const info = results[0];
            if (!info) {
                // Node doesn't exist
                this.context.cache.set(path, null);
                return null;
            }
            const node = info.metadata;
            node.value = results[1];
            this.context.cache.set(path, node);
            return node;
        }
        catch (err) {
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
    async removeMultiple(paths) {
        // Queues multiple items at once, dramatically improves performance for large datasets
        paths.forEach(path => {
            this._pending.push({ action: 'remove', path });
        });
    }
    childrenOf(path, include, checkCallback, addCallback) {
        // console.log(`*** childrenOf "${path}" ****`);
        return this._getChildrenOf(path, { ...include, descendants: false }, checkCallback, addCallback);
    }
    descendantsOf(path, include, checkCallback, addCallback) {
        // console.log(`*** descendantsOf "${path}" ****`);
        return this._getChildrenOf(path, { ...include, descendants: true }, checkCallback, addCallback);
    }
    _getChildrenOf(path, include, checkCallback, addCallback) {
        // Use cursor to loop from path on
        return new Promise((resolve, reject) => {
            const pathInfo = CustomStorageHelpers.PathInfo.get(path);
            const tx = this._createTransaction(false);
            const store = tx.objectStore('nodes');
            const query = IDBKeyRange.lowerBound(path, true);
            const cursor = include.metadata ? store.openCursor(query) : store.openKeyCursor(query);
            cursor.onerror = e => {
                tx.abort?.();
                reject(e);
            };
            cursor.onsuccess = async (e) => {
                const otherPath = cursor.result?.key ?? null;
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
                    let node;
                    if (include.metadata) {
                        const valueCursor = cursor;
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
                    try {
                        cursor.result.continue();
                    }
                    catch (err) {
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
//# sourceMappingURL=transaction.js.map