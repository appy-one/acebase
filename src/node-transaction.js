"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Transaction = exports.NodeLock = exports.IPCTransactionManager = exports.TransactionManager = exports.NodeLockInfo = exports.NodeLockIntention = void 0;
const acebase_core_1 = require("acebase-core");
const SECOND = 1000;
const MINUTE = 60000;
const DEBUG_MODE = false;
const LOCK_TIMEOUT_MS = DEBUG_MODE ? 15 * MINUTE : 90 * SECOND;
class NodeLockIntention {
    /**
     * The intention to read a single node for reflection purposes (eg enumerating its children).
     * While lock is granted, this prevents others to write to this node
     */
    static ReadInfo() { return new ReadInfoIntention(); }
    /**
     * The intention to read the value of a node and its children, optionally filtered to include or exclude specific child keys/paths
     * While lock is granted, this prevents others to write to this node and its (optionally filtered) child paths
     * @param filter
     */
    static ReadValue(filter) { return new ReadValueIntention(filter); }
    /**
     * The intention to update specific child values of a node.
     * While lock is granted, this prevents others to read or write to this node and specified child keys
     * @param keys The child keys that will be updated
     */
    static UpdateNode(keys) { return new UpdateNodeIntention(keys); }
    /**
     * The intention to overwrite a node's value.
     * While lock is granted, this prevents others to read or write to this node and its descendants
     */
    static OverwriteNode() { return new OverwriteNodeIntention(); }
}
exports.NodeLockIntention = NodeLockIntention;
class ReadInfoIntention extends NodeLockIntention {
}
class ReadValueIntention extends NodeLockIntention {
    constructor(filter) {
        super();
        this.filter = filter;
    }
}
class UpdateNodeIntention extends NodeLockIntention {
    constructor(keys) {
        super();
        this.keys = keys;
    }
}
class OverwriteNodeIntention extends NodeLockIntention {
}
var NodeLockState;
(function (NodeLockState) {
    NodeLockState[NodeLockState["pending"] = 0] = "pending";
    NodeLockState[NodeLockState["locked"] = 1] = "locked";
    NodeLockState[NodeLockState["released"] = 2] = "released";
    NodeLockState[NodeLockState["expired"] = 3] = "expired";
})(NodeLockState || (NodeLockState = {}));
class NodeLockInfo {
    constructor(id, tid, path, intention) {
        this.id = id;
        this.tid = tid;
        this.path = path;
        this.pathInfo = acebase_core_1.PathInfo.get(path);
        this.intention = intention;
        this.state = NodeLockState.pending;
    }
}
exports.NodeLockInfo = NodeLockInfo;
class TransactionManager {
    constructor() {
        this.lastTid = 0;
        this.lastLid = 0;
        this.queue = [];
        this.locks = [];
        this.blacklisted = [];
    }
    async createTransaction() {
        const tid = ++this.lastTid;
        const transaction = new Transaction(this, tid);
        // this.transactions.push(transaction);
        return transaction;
    }
    async requestLock(request) {
        if (this.blacklisted.includes(request.tid)) {
            throw new Error(`Transaction ${request.tid} not allowed to continue because one or more locks timed out`);
        }
        const lock = new NodeLockInfo(++this.lastLid, request.tid, request.path, request.intention);
        lock.requested = Date.now();
        const grantLock = () => {
            lock.state = NodeLockState.locked;
            lock.granted = Date.now();
            lock.expires = lock.granted + LOCK_TIMEOUT_MS;
            this.locks.push(lock);
        };
        // Check locks held by other transactions for conflicts, then grant lock or queue.
        const allow = this.allowLock(request);
        if (allow.ok) {
            grantLock();
        }
        else {
            // Queue
            let resolve, reject;
            const promise = new Promise((rs, rj) => { resolve = rs; reject = rj; });
            const queuedRequest = {
                lock,
                queued: Date.now(),
                grant() {
                    const i = this.queue.indexOf(this);
                    this.queue.splice(i, 1);
                    grantLock();
                    resolve();
                }
            };
            this.queue.push(queuedRequest);
            // Create timeout
            let timeoutsFired = 0;
            const timeoutHandler = () => {
                timeoutsFired++;
                const lock = queuedRequest.lock, tid = lock.tid, blacklisted = this.blacklisted.includes(tid), terminate = timeoutsFired === 3 || blacklisted;
                console.warn(`${request.intention.constructor.name} lock on "/${request.path}" is taking a long time [${timeoutsFired}]${terminate ? '. terminating.' : ''} (id ${lock.id}, tid ${lock.tid})`);
                if (terminate) {
                    const i = this.queue.indexOf(queuedRequest);
                    this.queue.splice(i, 1);
                    !blacklisted && this.blacklisted.push(tid);
                    return reject(new Error(`Lock timeout`));
                }
                timeout = setTimeout(timeoutHandler, LOCK_TIMEOUT_MS / 3);
            };
            let timeout = setTimeout(timeoutHandler, LOCK_TIMEOUT_MS / 3);
            // Wait until we get lock
            await promise;
            // Disable timeout
            clearTimeout(timeout);
        }
        return lock;
    }
    async releaseLock(id) {
        const index = this.locks.findIndex(l => l.id === id);
        if (index < 0) {
            throw new Error(`Lock ${id} not found`);
        }
        this.locks.splice(index, 1);
        this.processQueue();
    }
    processQueue() {
        this.queue.forEach((item, i, queue) => {
            const allow = this.allowLock(item.lock);
            if (allow) {
                item.grant(); // item will be removed from the queue by grant callback
            }
        });
    }
    allowLock(request) {
        // Get current granted locks in other transactions
        const otherLocks = this.locks.filter(lock => lock.tid !== request.tid && lock.state === NodeLockState.locked);
        // Find clashing lock
        const conflict = otherLocks.find(lock => this.conflicts(request, lock));
        return { ok: !conflict, conflict };
    }
    testConflict(lock, request) {
        const lockInfo = new NodeLockInfo(1, 1, lock.path, lock.intention);
        const lockRequest = { tid: 2, path: request.path, intention: request.intention };
        const conflict = this.conflicts(lockRequest, lockInfo);
        // Also test reverse outcome:
        const revLockInfo = new NodeLockInfo(1, 1, request.path, request.intention);
        const revLockRequest = { tid: 2, path: lock.path, intention: lock.intention };
        const reverse = this.conflicts(revLockRequest, revLockInfo);
        return [conflict, reverse];
    }
    conflictsLegacy(request, lock) {
        // The legacy locking allowed 1 simultanious write, and denies writes while reading.
        // So, a requested write lock always conflicts with any other granted lock
        return request.intention instanceof OverwriteNodeIntention || request.intention instanceof UpdateNodeIntention;
    }
    conflicts(request, lock) {
        // Returns true if the request lock conflicts with given existing lock
        if (!request.pathInfo) {
            request.pathInfo = acebase_core_1.PathInfo.get(request.path);
        }
        const requestPath = request.pathInfo;
        const lockPath = lock.pathInfo;
        if (request.intention instanceof ReadInfoIntention) {
            // Requested lock is to read info for a specific node and/or its children for reflection purposes
            if (lock.intention instanceof OverwriteNodeIntention) {
                // overwrite lock on "users/ewout/address"
                //      deny info requests for "users/ewout"
                //      deny info requests for "users/ewout/address(/*)"
                return requestPath.isParentOf(lockPath) || lock.path === request.path || requestPath.isDescendantOf(lockPath);
            }
            else if (lock.intention instanceof UpdateNodeIntention) {
                // update lock on "users/ewout/address" (keys "street", "nr"): 
                //      deny info requests for "users/ewout/address", "users/ewout/address/street(/*)", "users/ewout/address/nr(/*)"
                //      allow info requests for all else, eg "users/ewout/address/city"
                return request.path === lock.path || (requestPath.isDescendantOf(lockPath) && lock.intention.keys.some(key => requestPath.isOnTrailOf(lockPath.child(key))));
            }
            // Other lock is read lock, allowed
            return false;
        }
        else if (request.intention instanceof ReadValueIntention) {
            // Requested lock is to read the value of a specific node, optionally filtering the children
            if (lock.intention instanceof ReadValueIntention || lock.intention instanceof ReadInfoIntention) {
                // existing lock is for reading. No conflict
                return false;
            }
            const checkPath = (checkPath) => {
                if (lock.intention instanceof UpdateNodeIntention) {
                    // update lock on "users/ewout/address" (keys "street", "nr"):
                    //      deny value request for paths "", "users", "users/ewout", "users/ewout/address", "users/ewout/address", "users/ewout/address/street(/*)", "users/ewout/address/nr(/*)"
                    //      allow value requests for all else
                    return checkPath.isOnTrailOf(lockPath) || lock.intention.keys.some(key => checkPath.isOnTrailOf(lockPath.child(key)));
                }
                else if (lock.intention instanceof OverwriteNodeIntention) {
                    // overwrite lock on "users/ewout/address":
                    //      deny value request for anything on that trail
                    return checkPath.isOnTrailOf(lockPath);
                }
                return false;
            };
            let conflict = checkPath(requestPath);
            if (!request.intention.filter) {
                // Requested lock is unfiltered - all data will be read
            }
            if (conflict && request.intention.filter && !requestPath.isDescendantOf(lockPath)) {
                // Requested lock is filtered - only selected data will be read
                conflict = false;
                if (request.intention.filter.include instanceof Array) {
                    // The intention has an include filter to read only specified child keys/paths
                    conflict = requestPath.equals(lockPath) || request.intention.filter.include.some(key => checkPath(requestPath.child(key)));
                }
                if (!conflict && request.intention.filter.exclude instanceof Array) {
                    // request intention excludes 1 or more child keys/paths. If the lock is not on any of the excluded children, it is a conflict
                    conflict = requestPath.equals(lockPath) || !request.intention.filter.exclude.some(key => checkPath(requestPath.child(key)));
                }
                if (!conflict && request.intention.filter.child_objects === false) {
                    // child objects will not be loaded, so if the lock is writing to requestPath/obj/... that is no problem.
                    const allow = lockPath.isDescendantOf(requestPath.child('*'))
                        || (lock.intention instanceof UpdateNodeIntention && lockPath.equals(requestPath.child('*')));
                    conflict = !allow;
                }
            }
            return conflict;
        }
        else if (request.intention instanceof OverwriteNodeIntention) {
            // Requested lock is to overwrite a specific node
            if (lock.intention instanceof UpdateNodeIntention) {
                // update of "users/ewout/address" (keys "street", "nr"):
                //      deny overwrites on "", "users", "users/ewout", "users/ewout/address", "users/ewout/address/street(/*)", "users/ewout/address/nr(/*)"
                //      allow overwrite on "users/ewout/address/city"
                return requestPath.equals(lockPath) || requestPath.isAncestorOf(lockPath) || lock.intention.keys.some(key => requestPath.equals(lockPath.child(key)) || requestPath.isAncestorOf(lockPath.child(key)));
            }
            else if (lock.intention instanceof ReadInfoIntention) {
                // read info of "users/ewout/address"
                //      deny overwrites on "", "users", "users/ewout", "users/ewout/address(/*)"
                //      allow overwrites on "users/ewout/address/*/*"
                return requestPath.equals(lockPath) || requestPath.isAncestorOf(lockPath) || requestPath.isChildOf(lockPath);
            }
            else if (lock.intention instanceof ReadValueIntention) {
                // lock is read value of "users/ewout/address"
                //      deny requested overwrites on "", "users", "users/ewout", "users/ewout/address(/*)"
                //  BUT:
                //      allow requested overwrite on "users/ewout/address/nr" if read does NOT have "nr" in filter.include
                //      allow requested overwrite on "users/ewout/address/collection/key" if read does NOT have "collection", "collection/*" or "*/key" etc in filter.include
                //      allow requested overwrite on "users/ewout/address/street" if read has "street" in filter.exclude
                //      allow requested overwrite on "users/ewout/address/*/*" if read filter.child_objects === false
                let conflict = requestPath.isOnTrailOf(lockPath);
                if (conflict && lock.intention.filter && requestPath.isDescendantOf(lockPath)) {
                    conflict = false;
                    if (lock.intention.filter.include instanceof Array) {
                        conflict = lock.intention.filter.include.some(key => {
                            // read lock on "users/ewout/address", include ["street", "nr"]
                            // conflict if overwrite request equals or is descendant of "users/ewout/address/street" or "users/ewout/address/nr"
                            const childLockPath = lockPath.child(key);
                            return requestPath.equals(childLockPath) || requestPath.isDescendantOf(childLockPath);
                        });
                    }
                    if (!conflict && lock.intention.filter.exclude instanceof Array) {
                        conflict = !lock.intention.filter.exclude.some(key => {
                            // read lock on "users/ewout/address", exclude ["street", "nr"]
                            // conflict if overwrite request equals or is descendant of "users/ewout/address/street" or "users/ewout/address/nr"
                            const childLockPath = lockPath.child(key);
                            return requestPath.equals(childLockPath) || requestPath.isDescendantOf(childLockPath);
                        });
                    }
                    if (!conflict && lock.intention.filter.child_objects === false) {
                        // read lock on "users/ewout", no child_objects
                        // conflict if overwrite request is a child of "users/ewout", eg "users/ewout/address"
                        conflict = requestPath.isChildOf(lockPath);
                    }
                }
                return conflict;
            }
            else if (lock.intention instanceof OverwriteNodeIntention) {
                // overwrite of "users/ewout/address"
                //      deny overwrites on "", "users", "users/ewout", "users/ewout/address(/*)"
                return requestPath.isOnTrailOf(lockPath);
            }
        }
        else if (request.intention instanceof UpdateNodeIntention) {
            // Requested lock is to update a specific node
            if (lock.intention instanceof UpdateNodeIntention) {
                // update of "users/ewout/address" (keys "street", "nr"):
                //      deny updates on "" (key "users"), "users" (key "ewout"), "users/ewout" (key "address"), "users/ewout/address" (keys "street", "nr")
                const lockedPaths = lock.intention.keys.map(key => lockPath.child(key));
                // eg: ["users/ewout/address/street", "users/ewout/address/nr"]
                const overwritePaths = request.intention.keys.map(key => requestPath.child(key));
                // eg: ["users/ewout/address/city" (allow), "users/ewout/address/street" (deny)]
                // or: ["users/ewout" (deny)]
                return lockedPaths.some(lockPath => overwritePaths.some(overwritePath => overwritePath.isOnTrailOf(lockPath)));
            }
            else if (lock.intention instanceof OverwriteNodeIntention) {
                // overwrite of "users/ewout/address"
                //      deny updates on "" (key "users"), "users" (key "ewout"), "users/ewout" (key "address"), "users/ewout/address(/*)" (any key)
                const overwritePaths = request.intention.keys.map(key => requestPath.child(key));
                // eg: ["users/ewout/address/city" (deny), "users/ewout/address/street" (deny)]
                // or: ["users/ewout/last_login" (allow), "users/ewout/address" (deny)]
                // or: "users/ewout" (deny)
                return overwritePaths.some(path => path.isOnTrailOf(lockPath));
            }
            else if (lock.intention instanceof ReadInfoIntention) {
                // read info of "users/ewout/address":
                //      deny updates on "" (key "users"), "users" (key "ewout"), "users/ewout" (key "address"), "users/ewout/address" (any key)
                //      allow updates on "users/ewout/address/*/*"
                const overwritePaths = request.intention.keys.map(key => requestPath.child(key));
                return overwritePaths.some(path => path.equals(lockPath) || path.isAncestorOf(lockPath) || path.isChildOf(lockPath));
            }
            else if (lock.intention instanceof ReadValueIntention) {
                // read value lock on "users/ewout/address":
                // when unfiltered:
                //      deny requested updates on "" (key "users"), "users" (key "ewout"), "users/ewout" (key "address"), "users/ewout/address(/*)" (any key)
                const overwritePaths = request.intention.keys.map(key => requestPath.child(key));
                // eg: ["users/ewout/address/city" (deny), "users/ewout/address/street" (deny)]
                // or: ["users/ewout/last_login" (allow), "users/ewout/address" (deny)]
                // or: ["users/ewout"] (deny)
                let conflict = overwritePaths.some(path => path.isOnTrailOf(lockPath));
                if (conflict && lock.intention.filter && !requestPath.isAncestorOf(lockPath)) {
                    conflict = false;
                    if (lock.intention.filter.include instanceof Array) {
                        // include ["street", "nr"]:
                        // deny writes on "users/ewout/address/street" and "users/ewout/address/nr"
                        const readPaths = lock.intention.filter.include.map(key => lockPath.child(key));
                        conflict = overwritePaths.some(writePath => readPaths.some(readPath => writePath.isOnTrailOf(readPath)));
                    }
                    if (!conflict && lock.intention.filter.exclude instanceof Array) {
                        // exclude ["street", "nr"]:
                        // deny writes on "users/ewout/address/(not street or nr)"
                        const unreadPaths = lock.intention.filter.include.map(key => lockPath.child(key));
                        conflict = !overwritePaths.every(writePath => unreadPaths.some(readPath => writePath.isOnTrailOf(readPath)));
                    }
                    if (!conflict && lock.intention.filter.child_objects === false) {
                        // deny writes on direct children of lockPath
                        conflict = !overwritePaths.every(writePath => lockPath.child('*').isAncestorOf(writePath));
                    }
                }
                return conflict;
            }
        }
        return false; // Should not be able to get here?
    }
}
exports.TransactionManager = TransactionManager;
class IPCTransactionManager extends TransactionManager {
    constructor(ipc) {
        super();
        this.ipc = ipc;
        this.init();
    }
    init() {
        if (!this.ipc.isMaster) {
            return;
        }
        this.ipc.on('request', async (request) => {
            try {
                if (request.type === 'transaction.create') {
                    const transaction = await this.createTransaction();
                    const tx = { id: transaction.id };
                    this.ipc.replyRequest(request, { ok: true, transaction });
                }
                else if (request.type === 'transaction.lock') {
                    const lock = await this.requestLock(request.lock);
                    this.ipc.replyRequest(request, { ok: true, lock });
                }
                else if (request.type === 'transaction.release') {
                    await this.releaseLock(request.id);
                    this.ipc.replyRequest(request, { ok: true });
                }
            }
            catch (err) {
                this.ipc.replyRequest(request, { ok: false, error: err.message });
            }
        });
    }
    async createTransaction() {
        if (this.ipc.isMaster) {
            return super.createTransaction();
        }
        else {
            const result = await this.ipc.sendRequest({ type: 'transaction.create' });
            if (!result.ok) {
                throw new Error(result.error);
            }
            const transaction = new Transaction(this, result.transaction.id);
            return transaction;
        }
    }
    async requestLock(request) {
        if (this.ipc.isMaster) {
            return super.requestLock(request);
        }
        const result = await this.ipc.sendRequest({ type: 'transaction.lock', lock: request });
        if (!result.ok) {
            throw new Error(result.error);
        }
        return result.lock;
    }
    async releaseLock(id) {
        if (this.ipc.isMaster) {
            return super.releaseLock(id);
        }
        const result = await this.ipc.sendRequest({ type: 'transaction.release', id });
        if (!result.ok) {
            throw new Error(result.error);
        }
    }
}
exports.IPCTransactionManager = IPCTransactionManager;
class NodeLock extends NodeLockInfo {
    constructor(transaction, lockInfo) {
        super(lockInfo.id, transaction.id, lockInfo.path, lockInfo.intention);
        this.transaction = transaction;
    }
    async release() {
        return this.transaction.manager.releaseLock(this.id);
    }
}
exports.NodeLock = NodeLock;
class Transaction {
    constructor(manager, id) {
        this.manager = manager;
        this.id = id;
        this.locks = [];
    }
    async lock(path, intention) {
        const lockInfo = await this.manager.requestLock({ tid: this.id, path, intention });
        this.locks.push(lockInfo);
        return new NodeLock(this, lockInfo);
    }
}
exports.Transaction = Transaction;
//# sourceMappingURL=node-transaction.js.map