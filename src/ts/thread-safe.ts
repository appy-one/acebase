import { SimpleEventEmitter } from "acebase-core";

/** Set to true to add stack traces to achieved locks (performance impact!) */
const DEBUG_MODE = false;

const _lockTimeoutMsg = 'Lock "${name}" timed out! lock.release() was not called in a timely fashion';
const _lockWaitTimeoutMsg = 'Lock "${name}" wait time expired, failed to lock target';

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
    target?: any
}

interface ThreadSafeLockQueueItem {
    resolve: (lock: ThreadSafeLock) => void;
    reject: (err: Error) => void;
    waitTimeout: NodeJS.Timeout;
    options: ThreadSafeLockOptions
}

export interface ThreadSafeLock {
    achieved: Date;
    release: () => void;
    target: any;
    name: string;
    _timeout: NodeJS.Timeout;
    _queue: ThreadSafeLockQueueItem[];
    /** If DEBUG_MODE is enabled: contains stack trace of ThreadSafe.lock call */
    stack: string
}

const _threadSafeLocks = new Map<any, ThreadSafeLock>();

export abstract class ThreadSafe {
    /**
     * 
     * @param target Target object to lock. Do not use object references!
     * @param options Locking options
     * @returns returns a lock
     */
    static lock(target: any, options: ThreadSafeLockOptions = { timeout: 60000 * 15, critical: true, name: 'unnamed lock', shared: false }): Promise<ThreadSafeLock> {
        if (typeof options !== 'object') { options = {}; }
        if (typeof options.timeout !== 'number') { options.timeout = 60 * 1000; }
        if (typeof options.critical !== 'boolean') { options.critical = true; }
        if (typeof options.name !== 'string') {
            options.name = typeof target === 'string' ? target : 'unnamed lock'; 
        }
        if (typeof options.shared !== 'boolean') {
            options.shared = false;
        }
        if (options.shared) {
            // TODO: Implement
            // console.warn('shared locking not implemented yet, using exclusive lock');
        }

        let lock = _threadSafeLocks.get(target);

        const timeoutHandler = (critical) => { 
            console.error(_lockTimeoutMsg.replace('${name}', lock.name)); 

            // Copy lock object so we can alter the original's release method to throw an exception
            let copy: ThreadSafeLock = Object.assign({}, lock);
            let originalName = lock.name;
            lock.release = () => {
                throw new Error(`Cannot release lock "${originalName}" because it timed out earlier`);
            };
            lock = copy;
            
            if (critical) {
                // cancel any queued requests
                _threadSafeLocks.delete(target);
                lock._queue.forEach(item => {
                    clearTimeout(item.waitTimeout);
                    item.reject(new Error(`Could not achieve lock because the current lock ("${lock.name}") was not released in time (and lock is flagged critical)`)); 
                });
            }
            else {
                next();
            }
        }

        const next = () => {
            clearTimeout(lock._timeout);
            if (lock._queue.length === 0) {
                return _threadSafeLocks.delete(target);
            }
            let item = lock._queue.shift();
            clearTimeout(item.waitTimeout);
            lock._timeout = setTimeout(timeoutHandler, item.options.timeout, item.options.critical);
            lock.target = item.options.target || target;
            lock.achieved = new Date();
            lock.name = item.options.name;
            lock.stack = DEBUG_MODE ? (new Error()).stack : 'not available';
            item.resolve(lock);
        };

        if (!lock) {
            // Create lock
            lock = {
                target: options.target || target,
                achieved: new Date(),
                release() {
                    next();
                },
                name: options.name,
                stack: DEBUG_MODE ? (new Error()).stack : 'not available',
                _timeout: setTimeout(timeoutHandler, options.timeout, options.critical),
                _queue: []
            };
            _threadSafeLocks.set(target, lock);
            return Promise.resolve(lock);
        }
        else {
            // Add to queue
            return new Promise<ThreadSafeLock>((resolve, reject) => {
                const waitTimeout = setTimeout(() => { 
                    lock._queue.splice(lock._queue.indexOf(item), 1); 
                    if (lock._queue.length === 0) {
                        _threadSafeLocks.delete(target);
                    }
                    reject(_lockWaitTimeoutMsg.replace('${name}', options.name)); 
                }, options.timeout);
                const item: ThreadSafeLockQueueItem = { resolve, reject, waitTimeout, options };
                lock._queue.push(item);
            });
        }

    }
}

/**
 * New locking mechasnism that supports exclusive or shared locking
 */
 export class ThreadSafeLock2 extends SimpleEventEmitter {
    readonly achieved: Date;
    private shares: number = 0;
    private queue: Array<{ shared: boolean; grant(): void }> = [];
    private _shared: boolean;
    public get shared() { return this._shared; }
    constructor(public readonly target: any, shared: boolean) {
        super();
        this._shared = shared;
        this.achieved = new Date();
    }
    release() {
        if (this.shared && this.shares > 0) { 
            this.shares--; 
        }
        else if (this.queue.length > 0) {
            const next = this.queue.shift();
            this._shared = next.shared;
            next.grant();
            if (next.shared) {
                // Also grant other pending shared requests
                while (this.queue.length > 0 && this.queue[0].shared) {
                    this.queue.shift().grant();
                }
            }
        }
        else {
            // No more shares, no queue: this lock can be now be released entirely
            this.emitOnce('released');
        }
    }
    async request(shared: boolean): Promise<void> {
        if (this.shared && shared) {
            // Grant!
            this.shares++;
        }
        else {
            // Add to queue, wait until granted
            let grant: () => void;
            const promise = new Promise<void>(resolve => { grant = resolve; });
            this.queue.push({ shared, grant });
            await promise;
        }
    }
}

const locks2 = new Map<any, ThreadSafeLock2>();

export abstract class ThreadSafe2 {
    /**
     * 
     * @param target Target object to lock. Do not use object references!
     * @param options Locking options
     * @returns returns a lock
     */
     static async lock(target: any, shared: boolean = false): Promise<ThreadSafeLock2> {
        const timeout = 60 * 1000;
        if (!locks2.has(target)) {
            // New lock
            const lock = new ThreadSafeLock2(target, shared);
            locks2.set(target, lock);
            lock.once('released', () => {
                locks2.delete(target);
            })
            return lock;
        }
        else {
            // Existing lock
            const lock = locks2.get(target);
            await lock.request(shared);
            return lock;
        }
    }
}