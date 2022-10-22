"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalStorageTransaction = void 0;
const __1 = require("..");
// Setup CustomStorageTransaction for browser's LocalStorage
class LocalStorageTransaction extends __1.CustomStorageTransaction {
    constructor(context, target) {
        super(target);
        this.context = context;
        this._storageKeysPrefix = `${this.context.dbname}.acebase::`;
    }
    async commit() {
        // All changes have already been committed. TODO: use same approach as IndexedDB
    }
    async rollback(err) {
        // Not able to rollback changes, because we did not keep track
    }
    async get(path) {
        // Gets value from localStorage, wrapped in Promise
        const json = this.context.localStorage.getItem(this.getStorageKeyForPath(path));
        const val = JSON.parse(json);
        return val;
    }
    async set(path, val) {
        // Sets value in localStorage, wrapped in Promise
        const json = JSON.stringify(val);
        this.context.localStorage.setItem(this.getStorageKeyForPath(path), json);
    }
    async remove(path) {
        // Removes a value from localStorage, wrapped in Promise
        this.context.localStorage.removeItem(this.getStorageKeyForPath(path));
    }
    async childrenOf(path, include, checkCallback, addCallback) {
        // Streams all child paths
        // Cannot query localStorage, so loop through all stored keys to find children
        const pathInfo = __1.CustomStorageHelpers.PathInfo.get(path);
        for (let i = 0; i < this.context.localStorage.length; i++) {
            const key = this.context.localStorage.key(i);
            if (!key.startsWith(this._storageKeysPrefix)) {
                continue;
            }
            const otherPath = this.getPathFromStorageKey(key);
            if (pathInfo.isParentOf(otherPath) && checkCallback(otherPath)) {
                let node;
                if (include.metadata || include.value) {
                    const json = this.context.localStorage.getItem(key);
                    node = JSON.parse(json);
                }
                const keepGoing = addCallback(otherPath, node);
                if (!keepGoing) {
                    break;
                }
            }
        }
    }
    async descendantsOf(path, include, checkCallback, addCallback) {
        // Streams all descendant paths
        // Cannot query localStorage, so loop through all stored keys to find descendants
        const pathInfo = __1.CustomStorageHelpers.PathInfo.get(path);
        for (let i = 0; i < this.context.localStorage.length; i++) {
            const key = this.context.localStorage.key(i);
            if (!key.startsWith(this._storageKeysPrefix)) {
                continue;
            }
            const otherPath = this.getPathFromStorageKey(key);
            if (pathInfo.isAncestorOf(otherPath) && checkCallback(otherPath)) {
                let node;
                if (include.metadata || include.value) {
                    const json = this.context.localStorage.getItem(key);
                    node = JSON.parse(json);
                }
                const keepGoing = addCallback(otherPath, node);
                if (!keepGoing) {
                    break;
                }
            }
        }
    }
    /**
     * Helper function to get the path from a localStorage key
     */
    getPathFromStorageKey(key) {
        return key.slice(this._storageKeysPrefix.length);
    }
    /**
     * Helper function to get the localStorage key for a path
     */
    getStorageKeyForPath(path) {
        return `${this._storageKeysPrefix}${path}`;
    }
}
exports.LocalStorageTransaction = LocalStorageTransaction;
//# sourceMappingURL=transaction.js.map