"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AceBaseIPCPeer = exports.AceBaseIPCPeerExitingError = void 0;
const acebase_core_1 = require("acebase-core");
const node_lock_1 = require("../node-lock");
class AceBaseIPCPeerExitingError extends Error {
    constructor(message) { super(`Exiting: ${message}`); }
}
exports.AceBaseIPCPeerExitingError = AceBaseIPCPeerExitingError;
/**
 * Base class for Inter Process Communication, enables vertical scaling: using more CPU's on the same machine to share workload.
 * These processes will have to communicate with eachother because they are reading and writing to the same database file
 */
class AceBaseIPCPeer extends acebase_core_1.SimpleEventEmitter {
    constructor(storage, id, dbname = storage.name) {
        super();
        this.storage = storage;
        this.id = id;
        this.dbname = dbname;
        this.ipcType = 'ipc';
        this.ourSubscriptions = [];
        this.remoteSubscriptions = [];
        this.peers = [];
        this._exiting = false;
        this._locks = [];
        this._requests = new Map();
        this._eventsEnabled = true;
        this._nodeLocker = new node_lock_1.NodeLocker(storage.debug, storage.settings.lockTimeout);
        // Setup db event listeners
        storage.on('subscribe', (subscription) => {
            // Subscription was added to db
            storage.debug.verbose(`database subscription being added on peer ${this.id}`);
            const remoteSubscription = this.remoteSubscriptions.find(sub => sub.callback === subscription.callback);
            if (remoteSubscription) {
                // Send ack
                // return sendMessage({ type: 'subscribe_ack', from: tabId, to: remoteSubscription.for, data: { path: subscription.path, event: subscription.event } });
                return;
            }
            const othersAlreadyNotifying = this.ourSubscriptions.some(sub => sub.event === subscription.event && sub.path === subscription.path);
            // Add subscription
            this.ourSubscriptions.push(subscription);
            if (othersAlreadyNotifying) {
                // Same subscription as other previously added. Others already know we want to be notified
                return;
            }
            // Request other tabs to keep us updated of this event
            const message = { type: 'subscribe', from: this.id, data: { path: subscription.path, event: subscription.event } };
            this.sendMessage(message);
        });
        storage.on('unsubscribe', (subscription) => {
            // Subscription was removed from db
            const remoteSubscription = this.remoteSubscriptions.find(sub => sub.callback === subscription.callback);
            if (remoteSubscription) {
                // Remove
                this.remoteSubscriptions.splice(this.remoteSubscriptions.indexOf(remoteSubscription), 1);
                // Send ack
                // return sendMessage({ type: 'unsubscribe_ack', from: tabId, to: remoteSubscription.for, data: { path: subscription.path, event: subscription.event } });
                return;
            }
            this.ourSubscriptions
                .filter(sub => sub.path === subscription.path && (!subscription.event || sub.event === subscription.event) && (!subscription.callback || sub.callback === subscription.callback))
                .forEach(sub => {
                // Remove from our subscriptions
                this.ourSubscriptions.splice(this.ourSubscriptions.indexOf(sub), 1);
                // Request other tabs to stop notifying
                const message = { type: 'unsubscribe', from: this.id, data: { path: sub.path, event: sub.event } };
                this.sendMessage(message);
            });
        });
    }
    get isMaster() { return this.masterPeerId === this.id; }
    /**
     * Requests the peer to shut down. Resolves once its locks are cleared and 'exit' event has been emitted.
     * Has to be overridden by the IPC implementation to perform custom shutdown tasks
     * @param code optional exit code (eg one provided by SIGINT event)
     */
    async exit(code = 0) {
        if (this._exiting) {
            // Already exiting...
            return this.once('exit');
        }
        this._exiting = true;
        this.storage.debug.warn(`Received ${this.isMaster ? 'master' : 'worker ' + this.id} process exit request`);
        if (this._locks.length > 0) {
            this.storage.debug.warn(`Waiting for ${this.isMaster ? 'master' : 'worker'} ${this.id} locks to clear`);
            await this.once('locks-cleared');
        }
        // Send "bye"
        this.sayGoodbye(this.id);
        this.storage.debug.warn(`${this.isMaster ? 'Master' : 'Worker ' + this.id} will now exit`);
        this.emitOnce('exit', code);
    }
    sayGoodbye(forPeerId) {
        // Send "bye" message on their behalf
        const bye = { type: 'bye', from: forPeerId, data: undefined };
        this.sendMessage(bye);
    }
    addPeer(id, sendReply = true, ignoreDuplicate = false) {
        if (this._exiting) {
            return;
        }
        const peer = this.peers.find(w => w.id === id);
        // if (peer) {
        //     if (!ignoreDuplicate) {
        //         throw new Error(`We're not supposed to know this peer!`);
        //     }
        //     return;
        // }
        if (!peer) {
            this.peers.push({ id, lastSeen: Date.now() });
        }
        if (sendReply) {
            // Send hello back to sender
            const helloMessage = { type: 'hello', from: this.id, to: id, data: undefined };
            this.sendMessage(helloMessage);
            // Send our active subscriptions through
            this.ourSubscriptions.forEach(sub => {
                // Request to keep us updated
                const message = { type: 'subscribe', from: this.id, to: id, data: { path: sub.path, event: sub.event } };
                this.sendMessage(message);
            });
        }
    }
    removePeer(id, ignoreUnknown = false) {
        if (this._exiting) {
            return;
        }
        const peer = this.peers.find(peer => peer.id === id);
        if (!peer) {
            if (!ignoreUnknown) {
                throw new Error(`We are supposed to know this peer!`);
            }
            return;
        }
        this.peers.splice(this.peers.indexOf(peer), 1);
        // Remove their subscriptions
        const subscriptions = this.remoteSubscriptions.filter(sub => sub.for === id);
        subscriptions.forEach(sub => {
            // Remove & stop their subscription
            this.remoteSubscriptions.splice(this.remoteSubscriptions.indexOf(sub), 1);
            this.storage.subscriptions.remove(sub.path, sub.event, sub.callback);
        });
    }
    addRemoteSubscription(peerId, details) {
        if (this._exiting) {
            return;
        }
        // this.storage.debug.log(`remote subscription being added`);
        if (this.remoteSubscriptions.some(sub => sub.for === peerId && sub.event === details.event && sub.path === details.path)) {
            // We're already serving this event for the other peer. Ignore
            return;
        }
        // Add remote subscription
        const subscribeCallback = (err, path, val, previous, context) => {
            // db triggered an event, send notification to remote subscriber
            let eventMessage = {
                type: 'event',
                from: this.id,
                to: peerId,
                path: details.path,
                event: details.event,
                data: {
                    path,
                    val,
                    previous,
                    context
                }
            };
            this.sendMessage(eventMessage);
        };
        this.remoteSubscriptions.push({ for: peerId, event: details.event, path: details.path, callback: subscribeCallback });
        this.storage.subscriptions.add(details.path, details.event, subscribeCallback);
    }
    cancelRemoteSubscription(peerId, details) {
        // Other tab requests to remove previously subscribed event
        const sub = this.remoteSubscriptions.find(sub => sub.for === peerId && sub.event === details.event && sub.path === details.event);
        if (!sub) {
            // We don't know this subscription so we weren't notifying in the first place. Ignore
            return;
        }
        // Stop subscription
        this.storage.subscriptions.remove(details.path, details.event, sub.callback);
    }
    async handleMessage(message) {
        switch (message.type) {
            case 'hello': return this.addPeer(message.from, message.to !== this.id, false);
            case 'bye': return this.removePeer(message.from, true);
            case 'subscribe': return this.addRemoteSubscription(message.from, message.data);
            case 'unsubscribe': return this.cancelRemoteSubscription(message.from, message.data);
            case 'event': {
                if (!this._eventsEnabled) {
                    // IPC event handling is disabled for this client. Ignore message.
                    break;
                }
                const eventMessage = message;
                const context = eventMessage.data.context || {};
                context.acebase_ipc = { type: this.ipcType, origin: eventMessage.from }; // Add IPC details
                // Other peer raised an event we are monitoring
                const subscriptions = this.ourSubscriptions.filter(sub => sub.event === eventMessage.event && sub.path === eventMessage.path);
                subscriptions.forEach(sub => {
                    sub.callback(null, eventMessage.data.path, eventMessage.data.val, eventMessage.data.previous, context);
                });
                break;
            }
            case 'lock-request': {
                // Lock request sent by worker to master
                if (!this.isMaster) {
                    throw new Error(`Workers are not supposed to receive lock requests!`);
                }
                const request = message;
                const result = { type: 'lock-result', id: request.id, from: this.id, to: request.from, ok: true, data: undefined };
                try {
                    const lock = await this.lock(request.data);
                    result.data = {
                        id: lock.id,
                        path: lock.path,
                        tid: lock.tid,
                        write: lock.forWriting,
                        expires: lock.expires,
                        comment: lock.comment
                    };
                }
                catch (err) {
                    result.ok = false;
                    result.reason = err.stack || err.message || err;
                }
                return this.sendMessage(result);
            }
            case 'lock-result': {
                // Lock result sent from master to worker
                if (this.isMaster) {
                    throw new Error(`Masters are not supposed to receive results for lock requests!`);
                }
                const result = message;
                const request = this._requests.get(result.id);
                if (typeof request !== 'object') {
                    throw new Error(`The request must be known to us!`);
                }
                if (result.ok) {
                    request.resolve(result.data);
                }
                else {
                    request.reject(new Error(result.reason));
                }
                return;
            }
            case 'unlock-request': {
                // lock release request sent from worker to master
                if (!this.isMaster) {
                    throw new Error(`Workers are not supposed to receive unlock requests!`);
                }
                const request = message;
                const result = { type: 'unlock-result', id: request.id, from: this.id, to: request.from, ok: true, data: { id: request.data.id } };
                try {
                    const lockInfo = this._locks.find(l => { var _a; return ((_a = l.lock) === null || _a === void 0 ? void 0 : _a.id) === request.data.id; }); // this._locks.get(request.data.id);
                    await lockInfo.lock.release(); //this.unlock(request.data.id);
                }
                catch (err) {
                    result.ok = false;
                    result.reason = err.stack || err.message || err;
                }
                return this.sendMessage(result);
            }
            case 'unlock-result': {
                // lock release result sent from master to worker
                if (this.isMaster) {
                    throw new Error(`Masters are not supposed to receive results for unlock requests!`);
                }
                const result = message;
                const request = this._requests.get(result.id);
                if (typeof request !== 'object') {
                    throw new Error(`The request must be known to us!`);
                }
                if (result.ok) {
                    request.resolve(result.data);
                }
                else {
                    request.reject(new Error(result.reason));
                }
                return;
            }
            case 'move-lock-request': {
                // move lock request sent from worker to master
                if (!this.isMaster) {
                    throw new Error(`Workers are not supposed to receive move lock requests!`);
                }
                const request = message;
                const result = { type: 'lock-result', id: request.id, from: this.id, to: request.from, ok: true, data: undefined };
                try {
                    let movedLock;
                    // const lock = this._locks.get(request.data.id);
                    const lockRequest = this._locks.find(r => { var _a; return ((_a = r.lock) === null || _a === void 0 ? void 0 : _a.id) === request.data.id; });
                    if (request.data.move_to === 'parent') {
                        movedLock = await lockRequest.lock.moveToParent();
                    }
                    else {
                        throw new Error(`Unknown lock move_to "${request.data.move_to}"`);
                    }
                    // this._locks.delete(request.data.id);
                    // this._locks.set(movedLock.id, movedLock);
                    lockRequest.lock = movedLock;
                    result.data = {
                        id: movedLock.id,
                        path: movedLock.path,
                        tid: movedLock.tid,
                        write: movedLock.forWriting,
                        expires: movedLock.expires,
                        comment: movedLock.comment
                    };
                }
                catch (err) {
                    result.ok = false;
                    result.reason = err.stack || err.message || err;
                }
                return this.sendMessage(result);
            }
            case 'notification': {
                // Custom notification received - raise event
                return this.emit('notification', message);
            }
            case 'request': {
                // Custom message received - raise event
                return this.emit('request', message);
            }
            case 'result': {
                // Result of custom request received - raise event
                const result = message;
                const request = this._requests.get(result.id);
                if (typeof request !== 'object') {
                    throw new Error(`Result of unknown request received`);
                }
                if (result.ok) {
                    request.resolve(result.data);
                }
                else {
                    request.reject(new Error(result.reason));
                }
            }
        }
    }
    /**
     * Acquires a lock. If this peer is a worker, it will request the lock from the master
     * @param details
     */
    async lock(details) {
        if (this._exiting) {
            // Peer is exiting. Do we have an existing lock with requested tid? If not, deny request.
            const tidApproved = this._locks.find(l => l.tid === details.tid && l.granted);
            if (!tidApproved) {
                // We have no previously granted locks for this transaction. Deny.
                throw new AceBaseIPCPeerExitingError('new transaction lock denied because the IPC peer is exiting');
            }
        }
        const removeLock = lockDetails => {
            this._locks.splice(this._locks.indexOf(lockDetails), 1);
            if (this._locks.length === 0) {
                // this.storage.debug.log(`No more locks in worker ${this.id}`);
                this.emit('locks-cleared');
            }
        };
        if (this.isMaster) {
            // Master
            const lockInfo = { tid: details.tid, granted: false, request: details, lock: null };
            this._locks.push(lockInfo);
            const lock = await this._nodeLocker.lock(details.path, details.tid, details.write, details.comment);
            lockInfo.tid = lock.tid;
            lockInfo.granted = true;
            const createIPCLock = (lock) => {
                return {
                    get id() { return lock.id; },
                    get tid() { return lock.tid; },
                    get path() { return lock.path; },
                    get forWriting() { return lock.forWriting; },
                    get expires() { return lock.expires; },
                    get comment() { return lock.comment; },
                    get state() { return lock.state; },
                    release: async () => {
                        await lock.release();
                        removeLock(lockInfo);
                    },
                    moveToParent: async () => {
                        const parentLock = await lock.moveToParent();
                        lockInfo.lock = createIPCLock(parentLock);
                        return lockInfo.lock;
                    }
                };
            };
            lockInfo.lock = createIPCLock(lock);
            return lockInfo.lock;
        }
        else {
            // Worker
            const lockInfo = { tid: details.tid, granted: false, request: details, lock: null };
            this._locks.push(lockInfo);
            const createIPCLock = (result) => {
                lockInfo.granted = true;
                lockInfo.tid = result.tid;
                lockInfo.lock = {
                    id: result.id,
                    tid: result.tid,
                    path: result.path,
                    forWriting: result.write,
                    expires: result.expires,
                    comment: result.comment,
                    release: async () => {
                        const req = { type: 'unlock-request', id: acebase_core_1.ID.generate(), from: this.id, to: this.masterPeerId, data: { id: lockInfo.lock.id } };
                        const result = await this.request(req);
                        this.storage.debug.verbose(`Worker ${this.id} released lock ${lockInfo.lock.id} (tid ${lockInfo.lock.tid}, ${lockInfo.lock.comment}, "/${lockInfo.lock.path}", ${lockInfo.lock.forWriting ? 'write' : 'read'})`);
                        removeLock(lockInfo);
                    },
                    moveToParent: async () => {
                        const req = { type: 'move-lock-request', id: acebase_core_1.ID.generate(), from: this.id, to: this.masterPeerId, data: { id: lockInfo.lock.id, move_to: 'parent' } };
                        let result;
                        try {
                            result = await this.request(req);
                        }
                        catch (err) {
                            // We didn't get new lock?!
                            removeLock(lockInfo);
                            throw err;
                        }
                        lockInfo.lock = createIPCLock(result);
                        return lockInfo.lock;
                    }
                };
                // this.storage.debug.log(`Worker ${this.id} received lock ${lock.id} (tid ${lock.tid}, ${lock.comment}, "/${lock.path}", ${lock.forWriting ? 'write' : 'read'})`);
                return lockInfo.lock;
            };
            const req = { type: 'lock-request', id: acebase_core_1.ID.generate(), from: this.id, to: this.masterPeerId, data: details };
            let result, err;
            try {
                result = await this.request(req);
            }
            catch (e) {
                err = e;
                result = null;
            }
            if (err) {
                removeLock(lockInfo);
                throw err;
            }
            return createIPCLock(result);
        }
    }
    async request(req) {
        // Send request, return result promise
        let resolve, reject;
        const promise = new Promise((rs, rj) => {
            resolve = result => {
                this._requests.delete(req.id);
                rs(result);
            };
            reject = err => {
                this._requests.delete(req.id);
                rj(err);
            };
        });
        this._requests.set(req.id, { resolve, reject, request: req });
        this.sendMessage(req);
        return promise;
    }
    /**
     * Sends a custom request to the IPC master
     * @param request
     * @returns
     */
    sendRequest(request) {
        const req = { type: 'request', from: this.id, to: this.masterPeerId, id: acebase_core_1.ID.generate(), data: request };
        return this.request(req)
            .catch(err => {
            this.storage.debug.error(err);
            throw err;
        });
    }
    replyRequest(requestMessage, result) {
        const reply = { type: 'result', id: requestMessage.id, ok: true, from: this.id, to: requestMessage.from, data: result };
        this.sendMessage(reply);
    }
    /**
     * Sends a custom notification to all IPC peers
     * @param notification
     * @returns
     */
    sendNotification(notification) {
        const msg = { type: 'notification', from: this.id, data: notification };
        this.sendMessage(msg);
    }
    /**
     * If ipc event handling is currently enabled
     */
    get eventsEnabled() { return this._eventsEnabled; }
    /**
     * Enables or disables ipc event handling. When disabled, incoming event messages will be ignored.
     */
    set eventsEnabled(enabled) {
        this.storage.debug.log(`ipc events ${enabled ? 'enabled' : 'disabled'}`);
        this._eventsEnabled = enabled;
    }
}
exports.AceBaseIPCPeer = AceBaseIPCPeer;
//# sourceMappingURL=ipc.js.map