const { PathInfo, ID } = require('acebase-core');

const DEBUG_MODE = false;
const DEFAULT_LOCK_TIMEOUT = 120; // in seconds

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
    constructor(debug, lockTimeout = DEFAULT_LOCK_TIMEOUT) {
        /**
         * @type {NodeLock[]}
         */
        this._locks = [];
        this._lastTid = 0;
        /**
         * When .quit() is called, will be set to the quit promise's resolve function
         */
        this._quit = undefined;
        this.debug = debug;
        this.timeout = lockTimeout * 1000;
    }

    setTimeout(timeout) {
        this.timeout = timeout * 1000;
    }

    createTid() {
        return DEBUG_MODE ? ++this._lastTid : ID.generate();
    }

    _allowLock(path, tid, forWriting) {
        /**
         * Disabled path locking because of the following issue:
         * 
         * Process 1 requests WRITE lock on "/users/ewout", is GRANTED
         * Process 2 requests READ lock on "", is DENIED (process 1 writing to a descendant)
         * Process 3 requests WRITE lock on "/posts/post1", is GRANTED
         * Process 1 requests READ lock on "/" because of bound events, is DENIED (3 is writing to a descendant)
         * Process 3 requests READ lock on "/" because of bound events, is DENIED (1 is writing to a descendant)
         * 
         * --> DEADLOCK!
         * 
         * Now simply makes sure one transaction has write access at the same time, 
         * might change again in the future...
         */

        const conflict = this._locks
            .find(otherLock => {
                return (
                    otherLock.tid !== tid 
                    && otherLock.state === LOCK_STATE.LOCKED
                    && (forWriting || otherLock.forWriting)
                );
            });
        return { allow: !conflict, conflict };
    }

    quit() {
        return new Promise(resolve => {
            if (this._locks.length === 0) { return resolve(); }
            this._quit = resolve;
        })
    }

    /**
     * Safely reject a pending lock, catching any unhandled promise rejections (that should not happen in the first place, obviously)
     * @param {NodeLock} lock 
     */
    _rejectLock(lock, err) {
        this._locks.splice(this._locks.indexOf(lock), 1); // Remove from queue
        clearTimeout(lock.timeout);
        try {
            lock.reject(err);
        }
        catch(err) {
            console.error(`Unhandled promise rejection:`, err);
        }
    }

    _processLockQueue() {
        if (this._quit) {
            // Reject all pending locks
            const quitError = new Error('Quitting');
            this._locks
                .filter(lock => lock.state === LOCK_STATE.PENDING)
                .forEach(lock => this._rejectLock(lock, quitError));

            // Resolve quit promise if queue is empty:
            if (this._locks.length === 0) {
                this._quit();
            }
        }
        const pending = this._locks
            .filter(lock => 
                lock.state === LOCK_STATE.PENDING
                // && (lock.waitingFor === null || lock.waitingFor.state !== LOCK_STATE.LOCKED)
                // Commented out above, because waitingFor lock might have moved to a different non-conflicting path in the meantime
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
                return a.requested - b.requested;
            });
        pending.forEach(lock => {
            const check = this._allowLock(lock.path, lock.tid, lock.forWriting);
            lock.waitingFor = check.conflict || null;
            if (check.allow) {
                this.lock(lock)
                .then(lock.resolve)
                .catch(err => this._rejectLock(lock, err));
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
    async lock(path, tid, forWriting = true, comment = '', options = { withPriority: false, noTimeout: false }) {
        let lock, proceed;
        if (path instanceof NodeLock) {
            lock = path;
            //lock.comment = `(retry: ${lock.comment})`;
            proceed = true;
        }
        else if (this._locks.findIndex((l => l.tid === tid && l.state === LOCK_STATE.EXPIRED)) >= 0) {
            throw new Error(`lock on tid ${tid} has expired, not allowed to continue`);
        }
        else if (this._quit && !options.withPriority) {
            throw new Error(`Quitting`);
        }
        else {
            DEBUG_MODE && console.error(`${forWriting ? "write" : "read"} lock requested on "${path}" by tid ${tid} (${comment})`);

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
            //     console.log(`ALERT: Duplicate keys found in path "/${path}"`.colorize([ColorStyle.dim, ColorStyle.bgRed]);
            // }

            lock = new NodeLock(this, path, tid, forWriting, options.withPriority === true);
            lock.comment = comment;
            this._locks.push(lock);
            const check = this._allowLock(path, tid, forWriting);
            lock.waitingFor = check.conflict || null;
            proceed = check.allow;
        }

        if (proceed) {
            DEBUG_MODE && console.error(`${lock.forWriting ? "write" : "read"} lock ALLOWED on "${lock.path}" by tid ${lock.tid} (${lock.comment})`);
            lock.state = LOCK_STATE.LOCKED;
            if (typeof lock.granted === "number") {
                //debug.warn(`lock :: ALLOWING ${lock.forWriting ? "write" : "read" } lock on path "/${lock.path}" by tid ${lock.tid}; ${lock.comment}`);
            }
            else {
                lock.granted = Date.now();
                if (options.noTimeout !== true) {
                    lock.expires = Date.now() + this.timeout;
                    //debug.warn(`lock :: GRANTED ${lock.forWriting ? "write" : "read" } lock on path "/${lock.path}" by tid ${lock.tid}; ${lock.comment}`);

                    let timeoutCount = 0;
                    const timeoutHandler = () => {
                        // Autorelease timeouts must only fire when there is something wrong in the 
                        // executing (AceBase) code, eg an unhandled promise rejection causing a lock not
                        // to be released. To guard against programming errors, we will issue 3 warning
                        // messages before releasing the lock.

                        if (lock.state !== LOCK_STATE.LOCKED) { return; }

                        timeoutCount++;
                        if (timeoutCount <= 3) {
                            // Warn first.
                            this.debug.warn(`${lock.forWriting ? "write" : "read" } lock on path "/${lock.path}" by tid ${lock.tid} (${lock.comment}) is taking a long time to complete [${timeoutCount}]`);
                            lock.timeout = setTimeout(timeoutHandler, this.timeout / 4);
                            return;
                        }
                        this.debug.error(`lock :: ${lock.forWriting ? "write" : "read" } lock on path "/${lock.path}" by tid ${lock.tid} (${lock.comment}) took too long`);
                        lock.state = LOCK_STATE.EXPIRED;
                        // let allTransactionLocks = _locks.filter(l => l.tid === lock.tid).sort((a,b) => a.requested < b.requested ? -1 : 1);
                        // let transactionsDebug = allTransactionLocks.map(l => `${l.state} ${l.forWriting ? "WRITE" : "read"} ${l.comment}`).join("\n");
                        // debug.error(transactionsDebug);

                        this._processLockQueue();
                    };

                    lock.timeout = setTimeout(timeoutHandler, this.timeout / 4);
                }
            }
            return lock;
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

    unlock(lockOrId, comment, processQueue = true) {
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
            throw new Error(msg);
        }
        lock.state = LOCK_STATE.DONE;
        clearTimeout(lock.timeout);
        this._locks.splice(i, 1);
        DEBUG_MODE && console.error(`${lock.forWriting ? "write" : "read"} lock RELEASED on "${lock.path}" by tid ${lock.tid}`);
        //debug.warn(`unlock :: RELEASED ${lock.forWriting ? "write" : "read" } lock on "/${lock.path}" for tid ${lock.tid}; ${lock.comment}; ${comment}`);

        processQueue && this._processLockQueue();
        return lock;
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
        this.history = [];
    }

    async release(comment) {
        //return this.storage.unlock(this.path, this.tid, comment);
        this.history.push({ action: 'release', path: this.path, forWriting: this.forWriting, comment })
        return this.locker.unlock(this, comment || this.comment);
    }

    async moveToParent() {
        const parentPath = PathInfo.get(this.path).parentPath; //getPathInfo(this.path).parent;
        const allowed = this.locker.isAllowed(parentPath, this.tid, this.forWriting); //_allowLock(parentPath, this.tid, this.forWriting);
        if (allowed) {
            DEBUG_MODE && console.error(`moveToParent ALLOWED for ${this.forWriting ? 'write' : 'read'} lock on "${this.path}" by tid ${this.tid} (${this.comment})`);
            this.history.push({ path: this.path, forWriting: this.forWriting, action: 'moving to parent' });
            this.waitingFor = null;
            this.path = parentPath;
            // this.comment = `moved to parent: ${this.comment}`;
            return this;
        }
        else {
            // Unlock without processing the queue
            DEBUG_MODE && console.error(`moveToParent QUEUED for ${this.forWriting ? 'write' : 'read'} lock on "${this.path}" by tid ${this.tid} (${this.comment})`);
            this.locker.unlock(this, `moveLockToParent: ${this.comment}`, false);

            // Lock parent node with priority to jump the queue
            const newLock = await this.locker.lock(parentPath, this.tid, this.forWriting, this.comment, { withPriority: true });
            DEBUG_MODE && console.error(`QUEUED moveToParent ALLOWED for ${this.forWriting ? 'write' : 'read'} lock on "${this.path}" by tid ${this.tid} (${this.comment})`);
            newLock.history = this.history;
            newLock.history.push({ path: this.path, forWriting: this.forWriting, action: 'moving to parent through queue (priority)' });
            return newLock;
        }
    }

    /**
     * Not used? Will be removed
     */
    moveTo(otherPath, forWriting) {
        //const check = _allowLock(otherPath, this.tid, forWriting);
        const allowed = this.locker.isAllowed(otherPath, this.tid, forWriting);
        if (allowed) {
            this.history.push({ path: this.path, forWriting: this.forWriting, action: `moving to "${otherPath}"` });
            this.waitingFor = null;
            this.path = otherPath;
            this.forWriting = forWriting;
            // this.comment = `moved to "/${otherPath}": ${this.comment}`;
            return Promise.resolve(this);
        }
        else {
            // Unlock without processing the queue
            this.locker.unlock(this, `moving to "/${otherPath}": ${this.comment}`, false);

            // Lock other node with priority to jump the queue
            return this.locker.lock(otherPath, this.tid, forWriting, this.comment, { withPriority: true }) // `moved to "/${otherPath}" (queued): ${this.comment}`
            .then(newLock => {
                newLock.history = this.history
                newLock.history.push({ path: this.path, forWriting: this.forWriting, action: `moved to "${otherPath}" through queue` });
                return newLock;
            });
        }
    }

}

module.exports = { NodeLocker, NodeLock };