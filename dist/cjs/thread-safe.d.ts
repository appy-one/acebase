/// <reference types="node" />
import { SimpleEventEmitter } from 'acebase-core';
export interface ThreadSafeLockOptions {
    /** max amount of ms the target is allowed to be locked (and max time to wait to get it), default is 60000 (60s) */
    timeout?: number;
    /** flag that indicates whether this lock does critical work, canceling queued lock requests if this lock is not released in time */
    critical?: boolean;
    /** name of the lock, good for debugging purposes */
    name?: string;
    /**  if this lock is allowed to be shared with others also requesting a shared lock. Requested lock will be exclusive otherwise (default) */
    shared?: boolean;
    /** if you are using a string to uniquely identify the locking target, you can pass the actual object target with this option; lock.target will be set to this value instead. */
    target?: any;
}
interface ThreadSafeLockQueueItem {
    resolve: (lock: ThreadSafeLock) => void;
    reject: (err: Error) => void;
    waitTimeout: NodeJS.Timeout;
    options: ThreadSafeLockOptions;
}
export interface ThreadSafeLock {
    achieved: Date;
    release: () => void;
    target: any;
    name: string;
    _timeout: NodeJS.Timeout;
    _queue: ThreadSafeLockQueueItem[];
    /** If DEBUG_MODE is enabled: contains stack trace of ThreadSafe.lock call */
    stack: string;
}
export declare abstract class ThreadSafe {
    /**
     *
     * @param target Target object to lock. Do not use object references!
     * @param options Locking options
     * @returns returns a lock
     */
    static lock(target: any, options?: ThreadSafeLockOptions): Promise<ThreadSafeLock>;
}
/**
 * New locking mechasnism that supports exclusive or shared locking
 */
export declare class ThreadSafeLock2 extends SimpleEventEmitter {
    readonly target: any;
    readonly achieved: Date;
    private shares;
    private queue;
    private _shared;
    get shared(): boolean;
    constructor(target: any, shared: boolean);
    release(): void;
    request(shared: boolean): Promise<void>;
}
export declare abstract class ThreadSafe2 {
    /**
     *
     * @param target Target to lock. Preferably use unique strings, don't use object references unless you know what you are doing
     * @param options Locking options
     * @returns returns a lock
     */
    static lock(target: any, shared?: boolean): Promise<ThreadSafeLock2>;
}
export {};
//# sourceMappingURL=thread-safe.d.ts.map