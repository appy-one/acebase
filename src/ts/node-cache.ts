// TODO: Rename to NodeInfoCache

const { NodeInfo } = require('./node-info');
const { PathInfo } = require('acebase-core');

const SECOND = 1000;
const MINUTE = 60000;

const DEBUG_MODE = false;
const CACHE_TIMEOUT = DEBUG_MODE ? 5 * MINUTE : MINUTE;

class NodeCacheEntry {

    /**
     * 
     * @param {NodeInfo} nodeInfo 
     */
    constructor(nodeInfo) {
        this.nodeInfo = nodeInfo;
        this.pathInfo = PathInfo.get(nodeInfo.path);
        this.created = Date.now();
        this.keepAlive();
    }

    keepAlive() {
        this.expires = (this.updated || this.created) + NodeCache.CACHE_DURATION;
    }

    /**
     * 
     * @param {NodeInfo} nodeInfo 
     */
    update(nodeInfo) {
        this.nodeInfo = nodeInfo;
        this.updated = Date.now();
        this.keepAlive();
    }
}

class NodeCache {
    static get CACHE_DURATION() { return CACHE_TIMEOUT; }

    constructor() {
        // Isolated cache, this enables using multiple databases each with their own cache

        /** @type {NodeJS.Timeout} */
        this. _cleanupTimeout = null;
        /** @type {Map<string, NodeCacheEntry>} */
        this._cache = new Map(); //{ };
        this._announcements = new Map(); // For announced lookups, will bind subsequent .find calls to a promise that resolves once the cache item is set
    }

    _assertCleanupTimeout() {
        if (this._cleanupTimeout === null) {
            this._cleanupTimeout = setTimeout(() => {
                this.cleanup();
                this._cleanupTimeout = null;
                if (this._cache.size > 0) {
                    this._assertCleanupTimeout();
                }
            }, CACHE_TIMEOUT);

            // Make sure the cleanup timeout will not delay exiting the main process 
            // when the event loop is empty. See discussion #13 at github.
            // See https://nodejs.org/api/timers.html#timers_timeout_unref
            this._cleanupTimeout.unref && this._cleanupTimeout.unref(); 
        }
    }

    announce(path) {
        let announcement = this._announcements.get(path);
        if (!announcement) {
            announcement = {
                resolve: null,
                reject: null,
                promise: null
            }
            announcement.promise = new Promise((resolve, reject) => {
                announcement.resolve = resolve;
                announcement.reject = reject;
            });
            this._announcements.set(path, announcement);
        }
    }

    /**
     * Updates or adds a NodeAddress to the cache
     * @param {NodeInfo} nodeInfo 
     */
    update(nodeInfo) {
        if (!(nodeInfo instanceof NodeInfo)) {
            throw new TypeError(`nodeInfo must be an instance of NodeInfo`);
        }
        if (nodeInfo.path === "") {
            // Don't cache root address, it has to be retrieved from storage.rootAddress
            return;
        }
        let entry = this._cache.get(nodeInfo.path);
        if (entry) {
            DEBUG_MODE && console.error(`CACHE UPDATE ${nodeInfo}`);
            entry.update(nodeInfo);
        }
        else {
            // New entry
            DEBUG_MODE && console.error(`CACHE INSERT ${nodeInfo}`);
            entry = new NodeCacheEntry(nodeInfo);
            this._cache.set(nodeInfo.path, entry);
        }
        const announcement = this._announcements.get(nodeInfo.path);
        if (announcement) {
            this._announcements.delete(nodeInfo.path);
            announcement.resolve(nodeInfo);
        }
        this._assertCleanupTimeout();
    }

    /**
     * Invalidates a node and (optionally) its children by removing them from cache
     * @param {string} path 
     * @param {boolean|{ [key]: 'delete'|'invalidate'>} recursive
     * @param {string} reason 
     */
    invalidate(path, recursive, reason) {
        const entry = this._cache.get(path);
        const pathInfo = PathInfo.get(path);
        if (entry) {
            DEBUG_MODE && console.error(`CACHE INVALIDATE ${reason} => ${entry.nodeInfo}`);
            this._cache.delete(path);
        }
        
        if (recursive) {
            this._cache.forEach((entry, cachedPath) => {
                if (pathInfo.isAncestorOf(entry.pathInfo)) {
                    if (typeof recursive === 'object') {
                        // invalidate selected child keys only
                        const key = entry.pathInfo.keys[pathInfo.keys.length];
                        const child = recursive[key];// recursive.find(child => child.key === key);
                        if (child) {
                            if (child.action === 'delete') { 
                                this.update(new NodeInfo({ path: cachedPath, exists: false }));
                            }
                            else { 
                                this._cache.delete(cachedPath); 
                            }
                        }
                    }
                    else {
                        DEBUG_MODE && console.error(`CACHE INVALIDATE ${reason} => (child) ${entry.nodeInfo}`);
                        this._cache.delete(cachedPath);
                    }
                }
            });
        }
    }

    /**
     * Marks the node at path, and all its descendants as deleted
     * @param {string} path 
     */
    delete(path) {
        const entry = this._cache.get(path);
        const pathInfo = PathInfo.get(path);
        DEBUG_MODE && console.error(`CACHE MARK_DELETED => ${entry.nodeInfo}`);
        this.update(new NodeInfo({ path, exists: false }));
        
        this._cache.forEach((entry, cachedPath) => {
            if (pathInfo.isAncestorOf(cachedPath)) {
                DEBUG_MODE && console.error(`CACHE MARK_DELETED => (child) ${entry.nodeInfo}`);
                entry.nodeInfo.exists = false;
                entry.nodeInfo.value = null;
                delete entry.nodeInfo.type;
                delete entry.nodeInfo.valueType;
                entry.updated = Date.now();
                entry.keepAlive();
                // this.update(new NodeInfo({ path: cachedPath, exists: false }));
            }
        });
    }

    cleanup() {
        const now = Date.now();
        const entriesBefore = this._cache.size;
        this._cache.forEach((entry, path) => {
            if (entry.expires <= now) {
                this._cache.delete(path);
            }
        });
        const entriesAfter = this._cache.size;
        const entriesRemoved = entriesBefore - entriesAfter;
        DEBUG_MODE && console.log(`CACHE Removed ${entriesRemoved} cache entries (${entriesAfter} remain cached)`);
    }

    clear() {
        this._cache.clear();
    }

    /**
     * Finds cached NodeInfo for a given path. Returns null if the info is not found in cache
     * @param {string} path 
     * @returns {NodeInfo|Promise<NodeInfo>|null} cached info, a promise, or null
     */
    find(path, checkAnnounced = false) {
        if (checkAnnounced === true) {
            const announcement = this._announcements.get(path);
            if (announcement) {
                let resolve;
                const p = new Promise(rs => { resolve = rs; });
                announcement.promise = announcement.promise.then(info => {
                    resolve(info);
                    return info;
                });
                return p;
            }
        }
        let entry = this._cache.get(path) || null;
        if (entry && entry.nodeInfo.path !== "") {
            if (entry.expires <= Date.now()) {
                // expired
                this._cache.delete(path);
                entry = null;
            }
            else {
                // Increase lifetime
                entry.keepAlive();
            }
        }
        this._assertCleanupTimeout();
        DEBUG_MODE && console.error(`CACHE FIND ${path}: ${entry ? entry.nodeInfo : 'null'}`);
        return entry ? entry.nodeInfo : null;
    }

    // /**
    //  * Finds the first cached NodeInfo for the closest ancestor of a given path
    //  * @param {string} path 
    //  * @returns {NodeInfo} cached info for an ancestor
    //  */
    // findAncestor(path) {
    //     while (true) {
    //         path = PathInfo.get(path).parentPath;
    //         if (path === null) { return null; }
    //         const entry = this.find(path);
    //         if (entry) { return entry; }
    //     }
    // }
}

module.exports = { NodeCache, NodeCacheEntry };