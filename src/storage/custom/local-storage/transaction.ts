import { CustomStorageHelpers, CustomStorageTransaction, ICustomStorageNode, ICustomStorageNodeMetaData } from '..';
import { LocalStorageLike } from './interface';

// Setup CustomStorageTransaction for browser's LocalStorage
export class LocalStorageTransaction extends CustomStorageTransaction {

    private _storageKeysPrefix: string;

    constructor(public context: { debug: boolean, dbname: string, localStorage: LocalStorageLike }, target: {path: string, write: boolean}) {
        super(target);
        this._storageKeysPrefix = `${this.context.dbname}.acebase::`;
    }

    async commit() {
        // All changes have already been committed. TODO: use same approach as IndexedDB
    }

    async rollback(err: any) {
        // Not able to rollback changes, because we did not keep track
    }

    async get(path: string) {
        // Gets value from localStorage, wrapped in Promise
        const json = this.context.localStorage.getItem(this.getStorageKeyForPath(path));
        const val = JSON.parse(json);
        return val;
    }

    async set(path: string, val: any) {
        // Sets value in localStorage, wrapped in Promise
        const json = JSON.stringify(val);
        this.context.localStorage.setItem(this.getStorageKeyForPath(path), json);
    }

    async remove(path: string) {
        // Removes a value from localStorage, wrapped in Promise
        this.context.localStorage.removeItem(this.getStorageKeyForPath(path));
    }

    async childrenOf(path: string,
        include: { metadata?: boolean; value?: boolean },
        checkCallback: (path: string) => boolean,
        addCallback: (path: string, node: ICustomStorageNodeMetaData | ICustomStorageNode) => boolean,
    ) {
        // Streams all child paths
        // Cannot query localStorage, so loop through all stored keys to find children
        const pathInfo = CustomStorageHelpers.PathInfo.get(path);
        for (let i = 0; i < this.context.localStorage.length; i++) {
            const key = this.context.localStorage.key(i);
            if (!key.startsWith(this._storageKeysPrefix)) { continue; }
            const otherPath = this.getPathFromStorageKey(key);
            if (pathInfo.isParentOf(otherPath) && checkCallback(otherPath)) {
                let node;
                if (include.metadata || include.value) {
                    const json = this.context.localStorage.getItem(key);
                    node = JSON.parse(json);
                }
                const keepGoing = addCallback(otherPath, node);
                if (!keepGoing) { break; }
            }
        }
    }

    async descendantsOf(path: string,
        include: { metadata?: boolean; value?: boolean },
        checkCallback: (path: string) => boolean,
        addCallback: (path: string, node: ICustomStorageNodeMetaData | ICustomStorageNode) => boolean,
    ) {
        // Streams all descendant paths
        // Cannot query localStorage, so loop through all stored keys to find descendants
        const pathInfo = CustomStorageHelpers.PathInfo.get(path);
        for (let i = 0; i < this.context.localStorage.length; i++) {
            const key = this.context.localStorage.key(i);
            if (!key.startsWith(this._storageKeysPrefix)) { continue; }
            const otherPath = this.getPathFromStorageKey(key);
            if (pathInfo.isAncestorOf(otherPath) && checkCallback(otherPath)) {
                let node;
                if (include.metadata || include.value) {
                    const json = this.context.localStorage.getItem(key);
                    node = JSON.parse(json);
                }
                const keepGoing = addCallback(otherPath, node);
                if (!keepGoing) { break; }
            }
        }
    }

    /**
     * Helper function to get the path from a localStorage key
     */
    getPathFromStorageKey(key: string) {
        return key.slice(this._storageKeysPrefix.length);
    }

    /**
     * Helper function to get the localStorage key for a path
     */
    getStorageKeyForPath(path: string) {
        return `${this._storageKeysPrefix}${path}`;
    }
}
