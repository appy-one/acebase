"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ThreadSafe2 = exports.ThreadSafeLock2 = exports.ThreadSafe = void 0;
const acebase_core_1 = require("acebase-core");
/** Set to true to add stack traces to achieved locks (performance impact!) */
const DEBUG_MODE = false;
const _lockTimeoutMsg = 'Lock "${name}" timed out! lock.release() was not called in a timely fashion';
const _lockWaitTimeoutMsg = 'Lock "${name}" wait time expired, failed to lock target';
const _threadSafeLocks = new Map();
class ThreadSafe {
    /**
     *
     * @param target Target object to lock. Do not use object references!
     * @param options Locking options
     * @returns returns a lock
     */
    static lock(target, options = { timeout: 60000 * 15, critical: true, name: 'unnamed lock', shared: false }) {
        if (typeof options !== 'object') {
            options = {};
        }
        if (typeof options.timeout !== 'number') {
            options.timeout = 60 * 1000;
        }
        if (typeof options.critical !== 'boolean') {
            options.critical = true;
        }
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
            const copy = Object.assign({}, lock);
            const originalName = lock.name;
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
        };
        const next = () => {
            clearTimeout(lock._timeout);
            if (lock._queue.length === 0) {
                return _threadSafeLocks.delete(target);
            }
            const item = lock._queue.shift();
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
                _queue: [],
            };
            _threadSafeLocks.set(target, lock);
            return Promise.resolve(lock);
        }
        else {
            // Add to queue
            return new Promise((resolve, reject) => {
                const waitTimeout = setTimeout(() => {
                    lock._queue.splice(lock._queue.indexOf(item), 1);
                    if (lock._queue.length === 0) {
                        _threadSafeLocks.delete(target);
                    }
                    reject(_lockWaitTimeoutMsg.replace('${name}', options.name));
                }, options.timeout);
                const item = { resolve, reject, waitTimeout, options };
                lock._queue.push(item);
            });
        }
    }
}
exports.ThreadSafe = ThreadSafe;
/**
 * New locking mechasnism that supports exclusive or shared locking
 */
class ThreadSafeLock2 extends acebase_core_1.SimpleEventEmitter {
    get shared() { return this._shared; }
    constructor(target, shared) {
        super();
        this.target = target;
        this.shares = 0;
        this.queue = [];
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
    async request(shared) {
        if (this.shared && shared) {
            // Grant!
            this.shares++;
        }
        else {
            // Add to queue, wait until granted
            let grant;
            const promise = new Promise(resolve => { grant = resolve; });
            this.queue.push({ shared, grant });
            await promise;
        }
    }
}
exports.ThreadSafeLock2 = ThreadSafeLock2;
const locks2 = new Map();
class ThreadSafe2 {
    /**
     *
     * @param target Target to lock. Preferably use unique strings, don't use object references unless you know what you are doing
     * @param options Locking options
     * @returns returns a lock
     */
    static async lock(target, shared = false) {
        // const timeout = 60 * 1000;
        if (!locks2.has(target)) {
            // New lock
            const lock = new ThreadSafeLock2(target, shared);
            locks2.set(target, lock);
            lock.once('released', () => {
                locks2.delete(target);
            });
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
exports.ThreadSafe2 = ThreadSafe2;
//# sourceMappingURL=thread-safe.js.map