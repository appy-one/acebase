import { NodeInfo } from './node-info';
import { PathInfo } from 'acebase-core';
export declare class NodeCacheEntry {
    nodeInfo: NodeInfo;
    pathInfo: PathInfo;
    created: number;
    updated: number;
    expires: number;
    constructor(nodeInfo: NodeInfo);
    keepAlive(): void;
    update(nodeInfo: NodeInfo): void;
}
/**
 * Isolated cache, this enables using multiple databases each with their own cache
 */
export declare class NodeCache {
    static get CACHE_DURATION(): number;
    private _cleanupTimeout;
    private _cache;
    has(key: string): boolean;
    /**
     *  For announced lookups, will bind subsequent .find calls to a promise that resolves once the cache item is set
     */
    private _announcements;
    private _assertCleanupTimeout;
    announce(path: string): void;
    /**
     * Updates or adds a NodeAddress to the cache
     */
    update(nodeInfo: NodeInfo): void;
    /**
     * Invalidates a node and (optionally) its children by removing them from cache
     */
    invalidate(path: string, recursive: boolean | {
        [key: string]: 'delete' | 'invalidate';
    }, reason: string): void;
    /**
     * Marks the node at path, and all its descendants as deleted
     * @param path
     */
    delete(path: string): void;
    cleanup(): void;
    clear(): void;
    /**
     * Finds cached NodeInfo for a given path. Returns null if the info is not found in cache
     * @returns returns cached info, a promise, or null
     */
    find(path: string, checkAnnounced?: boolean): NodeInfo | Promise<NodeInfo>;
}
//# sourceMappingURL=node-cache.d.ts.map