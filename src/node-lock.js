const { PathInfo } = require('acebase-core');

const SECOND = 1000;
const MINUTE = 60000;

const DEBUG_MODE = false;
const LOCK_TIMEOUT = DEBUG_MODE ? 15 * MINUTE : 90 * SECOND;

const LOCK_STATE = {
    PENDING: 'pending',
    LOCKED: 'locked',
    EXPIRED: 'expired',
    DONE: 'done'
};

class NodeLocker {
    /**
     * Provides locking mechanism for nodes, ensures no simultanious read and writes happen to overlapping paths
     */
    constructor() {
        /**
         * @type {NodeLock[]}
         */
        this._locks = [];
    }

    _allowLock(path, tid, forWriting) {
        // Can this lock be granted now or do we have to wait?
        const pathInfo = PathInfo.get(path);
        const conflict = this._locks
            .filter(otherLock => otherLock.tid !== tid && otherLock.state === LOCK_STATE.LOCKED)
            .find(otherLock => {
                return (
                    // Other lock clashes with requested lock, if:
                    // One (or both) of them is for writing
                    (forWriting || otherLock.forWriting)

                    // and requested lock is on the same or deeper path
                    && (
                        path === otherLock.path
                        || pathInfo.isDescendantOf(otherLock.path)
                    )
                );
            });

        const clashes = typeof conflict !== 'undefined';
        return { allow: !clashes, conflict };
    }

    _processLockQueue() {
        const pending = this._locks
            .filter(lock => 
                lock.state === LOCK_STATE.PENDING
                && (lock.waitingFor === null || lock.waitingFor.state !== LOCK_STATE.LOCKED)
            )
            .sort((a,b) => {
                // // Writes get higher priority so all reads get the most recent data
                // if (a.forWriting === b.forWriting) { 
                //     if (a.requested < b.requested) { return -1; }
                //     else { return 1; }
                // }
                // else if (a.forWriting) { return -1; }
                if (a.priority && !b.priority) { return -1; }
                else if (!a.priority && b.priority) { return 1; }
                return a.requested < b.requested;
            });
        pending.forEach(lock => {
            const check = this._allowLock(lock.path, lock.tid, lock.forWriting);
            lock.waitingFor = check.conflict || null;
            if (check.allow) {
                this.lock(lock)
                .then(lock.resolve)
                .catch(lock.reject);
            }
        });
    }

    /**
     * Locks a path for writing. While the lock is in place, it's value cannot be changed by other transactions.
     * @param {string} path path being locked
     * @param {string} tid a unique value to identify your transaction
     * @param {boolean} forWriting if the record will be written to. Multiple read locks can be granted access at the same time if there is no write lock. Once a write lock is granted, no others can read from or write to it.
     * @returns {Promise<NodeLock>} returns a promise with the lock object once it is granted. It's .release method can be used as a shortcut to .unlock(path, tid) to release the lock
     */
    lock(path, tid, forWriting = true, comment = '', options = { withPriority: false, noTimeout: false }) {
        let lock, proceed;
        if (path instanceof NodeLock) {
            lock = path;
            lock.comment = `(retry: ${lock.comment})`;
            proceed = true;
        }
        else if (this._locks.findIndex((l => l.tid === tid && l.state === LOCK_STATE.EXPIRED)) >= 0) {
            return Promise.reject(new Error(`lock on tid ${tid} has expired, not allowed to continue`));
        }
        else {

            // // Test the requested lock path
            // let duplicateKeys = getPathKeys(path)
            //     .reduce((r, key) => {
            //         let i = r.findIndex(c => c.key === key);
            //         if (i >= 0) { r[i].count++; }
            //         else { r.push({ key, count: 1 }) }
            //         return r;
            //     }, [])
            //     .filter(c => c.count > 1)
            //     .map(c => c.key);
            // if (duplicateKeys.length > 0) {
            //     console.log(`ALERT: Duplicate keys found in path "/${path}"`.dim.bgRed);
            // }

            lock = new NodeLock(this, path, tid, forWriting, options.withPriority === true);
            lock.comment = comment;
            this._locks.push(lock);
            const check = this._allowLock(path, tid, forWriting);
            lock.waitingFor = check.conflict || null;
            proceed = check.allow;
        }

        if (proceed) {
            lock.state = LOCK_STATE.LOCKED;
            if (typeof lock.granted === "number") {
                //debug.warn(`lock :: ALLOWING ${lock.forWriting ? "write" : "read" } lock on path "/${lock.path}" by tid ${lock.tid}; ${lock.comment}`);
            }
            else {
                lock.granted = Date.now();
                if (options.noTimeout !== true) {
                    lock.expires = Date.now() + LOCK_TIMEOUT;
                    //debug.warn(`lock :: GRANTED ${lock.forWriting ? "write" : "read" } lock on path "/${lock.path}" by tid ${lock.tid}; ${lock.comment}`);
                    lock.timeout = setTimeout(() => {
                        // In the right situation, this timeout never fires. Target: Bugfree code

                        if (lock.state !== LOCK_STATE.LOCKED) { return; }
                        console.error(`lock :: ${lock.forWriting ? "write" : "read" } lock on path "/${lock.path}" by tid ${lock.tid} took too long, ${lock.comment}`);
                        lock.state = LOCK_STATE.EXPIRED;
                        // let allTransactionLocks = _locks.filter(l => l.tid === lock.tid).sort((a,b) => a.requested < b.requested ? -1 : 1);
                        // let transactionsDebug = allTransactionLocks.map(l => `${l.state} ${l.forWriting ? "WRITE" : "read"} ${l.comment}`).join("\n");
                        // debug.error(transactionsDebug);

                        this._processLockQueue();
                    }, LOCK_TIMEOUT);
                }
            }
            return Promise.resolve(lock);
        }
        else {
            // Keep pending until clashing lock(s) is/are removed
            //debug.warn(`lock :: QUEUED ${lock.forWriting ? "write" : "read" } lock on path "/${lock.path}" by tid ${lock.tid}; ${lock.comment}`);
            console.assert(lock.state === LOCK_STATE.PENDING);
            const p = new Promise((resolve, reject) => {
                lock.resolve = resolve;
                lock.reject = reject;
            });
            return p;
        }
    }

    unlock(lockOrId, comment, processQueue = true) {// (path, tid, comment) {
        let lock, i;
        if (lockOrId instanceof NodeLock) {
            lock = lockOrId;
            i = this._locks.indexOf(lock);
        }
        else {
            let id = lockOrId;
            i = this._locks.findIndex(l => l.id === id);
            lock = this._locks[i];
        }

        if (i < 0) {
            const msg = `lock on "/${lock.path}" for tid ${lock.tid} wasn't found; ${comment}`;
            // debug.error(`unlock :: ${msg}`);
            return Promise.reject(new Error(msg));
        }
        lock.state = LOCK_STATE.DONE;
        clearTimeout(lock.timeout);
        this._locks.splice(i, 1);
        //debug.warn(`unlock :: RELEASED ${lock.forWriting ? "write" : "read" } lock on "/${lock.path}" for tid ${lock.tid}; ${lock.comment}; ${comment}`);
        processQueue && this._processLockQueue();
        return Promise.resolve(lock);
    }

    list() {
        return this._locks || [];
    }

    isAllowed(path, tid, forWriting) {
        return this._allowLock(path, tid, forWriting).allow;
    }
}

let lastid = 0;
class NodeLock {

    static get LOCK_STATE() { return LOCK_STATE; }

    /**
     * Constructor for a record lock
     * @param {NodeLocker} locker
     * @param {string} path 
     * @param {string} tid 
     * @param {boolean} forWriting 
     * @param {boolean} priority
     */
    constructor(locker, path, tid, forWriting, priority = false) {
        this.locker = locker;
        this.path = path;
        this.tid = tid;
        this.forWriting = forWriting;
        this.priority = priority;
        this.state = LOCK_STATE.PENDING;
        this.requested = Date.now();
        this.granted = undefined;
        this.expires = undefined;
        this.comment = "";
        this.waitingFor = null;
        this.id = ++lastid;
    }

    release(comment) {
        //return this.storage.unlock(this.path, this.tid, comment);
        return this.locker.unlock(this, comment || this.comment);
    }

    moveToParent() {
        const parentPath = PathInfo.get(this.path).parentPath; //getPathInfo(this.path).parent;
        const allowed = this.locker.isAllowed(parentPath, this.tid, this.forWriting); //_allowLock(parentPath, this.tid, this.forWriting);
        if (allowed) {
            this.waitingFor = null;
            this.path = parentPath;
            this.comment = `moved to parent: ${this.comment}`;
            return Promise.resolve(this);
        }
        else {
            // Unlock without processing the queue
            this.locker.unlock(this, `moveLockToParent: ${this.comment}`, false);

            // Lock parent node with priority to jump the queue
            return this.locker.lock(parentPath, this.tid, this.forWriting, `moved to parent (queued): ${this.comment}`, { withPriority: true })
            .then(newLock => {
                return newLock;
            });
        }
    }

    moveTo(otherPath, forWriting) {
        //const check = _allowLock(otherPath, this.tid, forWriting);
        const allowed = this.locker.isAllowed(otherPath, this.tid, forWriting);
        if (allowed) {
            this.waitingFor = null;
            this.path = otherPath;
            this.forWriting = forWriting;
            this.comment = `moved to "/${otherPath}": ${this.comment}`;
            return Promise.resolve(this);
        }
        else {
            // Unlock without processing the queue
            this.locker.unlock(this, `moving to "/${otherPath}": ${this.comment}`, false);

            // Lock other node with priority to jump the queue
            return this.locker.lock(otherPath, this.tid, forWriting, `moved to "/${otherPath}" (queued): ${this.comment}`, { withPriority: true })
            .then(newLock => {
                return newLock;
            });
        }
    }

}

module.exports = { NodeLocker, NodeLock };