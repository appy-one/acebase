const _lockTimeoutMsg = 'Lock "${name}" timed out! lock.release() was not called in a timely fashion';
const _lockWaitTimeoutMsg = 'Lock "${name}" wait time expired, failed to lock target';
const _threadSafeLocks = new Map();
class ThreadSafe {
    /**
     * 
     * @param {any} target 
     * @param {object} [options]
     * @param {number} [options.timeout=60000] max amount of ms the target is allowed to be locked (and max time to wait to get it), default is 60000 (60s) 
     * @param {boolean} [options.critical=true] flag that indicates whether this lock does critical work, canceling queued lock requests if this lock is not released in time
     * @param {string} [options.name='unnamed lock'] name of the lock, good for debugging purposes
     * @param {any} [options.target] if you are using a string to uniquely identify the locking target, you can pass the actual object target with this option; lock.target will be set to this value instead.
     * @returns {Promise<{ achieved: Date, release: () => void, target: any, name: string }}
     */
    static lock(target, options = { timeout: 60000 * 15, critical: true, name: 'unnamed lock' }) {
        if (typeof options !== 'object') { options = {}; }
        if (typeof options.timeout !== 'number') { options.timeout = 60 * 1000; }
        if (typeof options.critical !== 'boolean') { options.critical = true; }
        if (typeof options.name !== 'string') {
            options.name = typeof target === 'string' ? target : 'unnamed lock'; 
        }

        let lock = _threadSafeLocks.get(target);

        const timeoutHandler = (critical) => { 
            console.error(_lockTimeoutMsg.replace('${name}', lock.name)); 

            // Copy lock object so we can alter the original's release method to throw an exception
            let copy = {};
            Object.assign(copy, lock);
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
            lock.stack = (new Error()).stack;
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
                stack: (new Error()).stack,
                _timeout: null,
                _queue: []
            };
            lock._timeout = setTimeout(timeoutHandler, options.timeout, options.critical);
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

module.exports = ThreadSafe;