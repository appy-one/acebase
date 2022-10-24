/// <reference types="node" />
import { DebugLogger } from 'acebase-core';
export declare const LOCK_STATE: {
    PENDING: string;
    LOCKED: string;
    EXPIRED: string;
    DONE: string;
};
export declare class NodeLocker {
    private _locks;
    private _lastTid;
    /**
     * When .quit() is called, will be set to the quit promise's resolve function
     */
    private _quit;
    private debug;
    timeout: number;
    /**
     * Provides locking mechanism for nodes, ensures no simultanious read and writes happen to overlapping paths
     */
    constructor(debug: DebugLogger, lockTimeout?: number);
    setTimeout(timeout: number): void;
    createTid(): string | number;
    _allowLock(path: string, tid: string | number, forWriting: boolean): {
        allow: boolean;
        conflict: NodeLock;
    };
    quit(): Promise<void>;
    /**
     * Safely reject a pending lock, catching any unhandled promise rejections (that should not happen in the first place, obviously)
     * @param lock
     */
    _rejectLock(lock: NodeLock, err: Error): void;
    _processLockQueue(): void;
    /**
     * Locks a path for writing. While the lock is in place, it's value cannot be changed by other transactions.
     * @param path path being locked
     * @param tid a unique value to identify your transaction
     * @param forWriting if the record will be written to. Multiple read locks can be granted access at the same time if there is no write lock. Once a write lock is granted, no others can read from or write to it.
     * @returns returns a promise with the lock object once it is granted. It's .release method can be used as a shortcut to .unlock(path, tid) to release the lock
     */
    lock(path: string, tid: string, forWriting?: boolean, comment?: string, options?: {
        withPriority?: boolean;
        noTimeout?: boolean;
    }): Promise<NodeLock>;
    lock(lock: NodeLock): Promise<NodeLock>;
    unlock(lockOrId: NodeLock | NodeLock['id'], comment: string, processQueue?: boolean): NodeLock;
    list(): NodeLock[];
    isAllowed(path: string, tid: string | number, forWriting: boolean): boolean;
}
export declare class NodeLock {
    private locker;
    path: string;
    tid: string;
    forWriting: boolean;
    priority: boolean;
    static get LOCK_STATE(): {
        PENDING: string;
        LOCKED: string;
        EXPIRED: string;
        DONE: string;
    };
    state: string;
    requested: number;
    granted: number;
    expires: number;
    comment: string;
    waitingFor: NodeLock;
    id: number;
    history: {
        action: string;
        path: string;
        forWriting: boolean;
        comment?: string;
    }[];
    timeout: NodeJS.Timeout;
    resolve: (lock: NodeLock) => void;
    reject: (err: Error) => void;
    /**
     * Constructor for a record lock
     * @param {NodeLocker} locker
     * @param {string} path
     * @param {string} tid
     * @param {boolean} forWriting
     * @param {boolean} priority
     */
    constructor(locker: NodeLocker, path: string, tid: string, forWriting: boolean, priority?: boolean);
    release(comment?: string): Promise<NodeLock>;
    moveToParent(): Promise<NodeLock>;
}
//# sourceMappingURL=node-lock.d.ts.map