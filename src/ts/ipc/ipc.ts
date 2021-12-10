import { ID, SimpleEventEmitter } from 'acebase-core';
import { NodeLocker, NodeLock } from '../node-lock';
import { Storage } from '../storage';

export class AceBaseIPCPeerExitingError extends Error {
    constructor(message: string) { super(`Exiting: ${message}`); }
}

/**
 * Base class for Inter Process Communication, enables vertical scaling: using more CPU's on the same machine to share workload.
 * These processes will have to communicate with eachother because they are reading and writing to the same database file
 */
export abstract class AceBaseIPCPeer extends SimpleEventEmitter {
    protected masterPeerId: string;
    protected ipcType: string = 'ipc';
    public get isMaster() { return this.masterPeerId === this.id }

    protected ourSubscriptions: Array<{ path: string, event: AceBaseEventType, callback: AceBaseSubscribeCallback }> = [];
    protected remoteSubscriptions: Array<{ for?: string, path: string, event: AceBaseEventType, callback: AceBaseSubscribeCallback }> = [];
    protected peers: Array<{ id: string, lastSeen: number }> = [];

    private _nodeLocker: NodeLocker

    constructor(protected storage: Storage, protected id: string, protected dbname: string = storage.name) {
        super();
        this._nodeLocker = new NodeLocker();

        // Setup db event listeners
        storage.on('subscribe', (subscription: { path: string, event: string, callback: AceBaseSubscribeCallback }) => {
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
            const message:ISubscribeMessage = { type: 'subscribe', from: this.id, data: { path: subscription.path, event: subscription.event } };
            this.sendMessage(message);
        });
        
        storage.on('unsubscribe', (subscription: { path: string, event?: string, callback?: AceBaseSubscribeCallback }) => {
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
                const message:IUnsubscribeMessage = { type: 'unsubscribe', from: this.id, data: { path: sub.path, event: sub.event } };
                this.sendMessage(message);                    
            });
        });
    }

    protected _exiting: boolean = false;
    /**
     * Requests the peer to shut down. Resolves once its locks are cleared and 'exit' event has been emitted. 
     * Has to be overridden by the IPC implementation to perform custom shutdown tasks
     * @param code optional exit code (eg one provided by SIGINT event) 
     */
    public async exit(code: number = 0) {
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

    protected sayGoodbye(forPeerId: string) {
        // Send "bye" message on their behalf
        const bye: IByeMessage = { type: 'bye', from: forPeerId, data: undefined };
        this.sendMessage(bye);
    }

    protected addPeer(id: string, sendReply: boolean = true, ignoreDuplicate: boolean = false) {
        if (this._exiting) { return; }
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
            const helloMessage:IHelloMessage = { type: 'hello', from: this.id, to: id, data: undefined };
            this.sendMessage(helloMessage);

            // Send our active subscriptions through
            this.ourSubscriptions.forEach(sub => {
                // Request to keep us updated
                const message:ISubscribeMessage = { type: 'subscribe', from: this.id, to: id, data: { path: sub.path, event: sub.event } };
                this.sendMessage(message);
            });
        }
    }

    protected removePeer(id: string, ignoreUnknown: boolean = false) {
        if (this._exiting) { return; }
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

    protected addRemoteSubscription(peerId: string, details:ISubscriptionData) {
        if (this._exiting) { return; }
        // this.storage.debug.log(`remote subscription being added`);

        if (this.remoteSubscriptions.some(sub => sub.for === peerId && sub.event === details.event && sub.path === details.path)) {
            // We're already serving this event for the other peer. Ignore
            return;
        }

        // Add remote subscription
        const subscribeCallback = (err: Error, path: string, val: any, previous: any, context: any) => {
            // db triggered an event, send notification to remote subscriber
            let eventMessage: IEventMessage = {
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

    protected cancelRemoteSubscription(peerId: string, details:ISubscriptionData) {
        // Other tab requests to remove previously subscribed event
        const sub = this.remoteSubscriptions.find(sub => sub.for === peerId && sub.event === details.event && sub.path === details.event);
        if (!sub) {
            // We don't know this subscription so we weren't notifying in the first place. Ignore
            return;
        }

        // Stop subscription
        this.storage.subscriptions.remove(details.path, details.event, sub.callback);
    }

    protected async handleMessage(message: IMessage) {
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
                const eventMessage = message as IEventMessage;
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

                const request = message as ILockRequestMessage;
                const result: ILockResponseMessage = { type: 'lock-result', id: request.id, from: this.id, to: request.from, ok: true, data: undefined };
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
                catch(err) {
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

                const result = message as ILockResponseMessage;
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

                const request = message as IUnlockRequestMessage;
                const result: IUnlockResponseMessage = { type: 'unlock-result', id: request.id, from: this.id, to: request.from, ok: true, data: { id: request.data.id } };
                try {
                    const lockInfo = this._locks.find(l => l.lock?.id === request.data.id); // this._locks.get(request.data.id);
                    await lockInfo.lock.release(); //this.unlock(request.data.id);
                }
                catch(err) {
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

                const result = message as IUnlockResponseMessage;
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

                const request = message as IMoveLockRequestMessage;
                const result: ILockResponseMessage = { type: 'lock-result', id: request.id, from: this.id, to: request.from, ok: true, data: undefined };
                try {
                    let movedLock: NodeLock;
                    // const lock = this._locks.get(request.data.id);
                    const lockRequest = this._locks.find(r => r.lock?.id === request.data.id);
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
                catch(err) {
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
                const result = message as IResponseMessage;
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

    protected _locks: Array<{ tid: string, granted: boolean, request: ILockRequestData, lock?: IAceBaseIPCLock }> = [];

    /**
     * Acquires a lock. If this peer is a worker, it will request the lock from the master
     * @param details 
     */
     protected async lock(details:ILockRequestData): Promise<IAceBaseIPCLock> { // With methods release(), moveToParent() etc

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
            const lock:NodeLock = await this._nodeLocker.lock(details.path, details.tid, details.write, details.comment);
            lockInfo.tid = lock.tid;
            lockInfo.granted = true;

            const createIPCLock = (lock: NodeLock): IAceBaseIPCLock => {
                return {
                    get id() { return lock.id; },
                    get tid() { return lock.tid },
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

            const createIPCLock = (result: ILockResponseData): IAceBaseIPCLock => {
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
                        const req: IUnlockRequestMessage = { type: 'unlock-request', id: ID.generate(), from: this.id, to: this.masterPeerId, data: { id: lockInfo.lock.id } };
                        const result = await this.request(req);
                        this.storage.debug.verbose(`Worker ${this.id} released lock ${lockInfo.lock.id} (tid ${lockInfo.lock.tid}, ${lockInfo.lock.comment}, "/${lockInfo.lock.path}", ${lockInfo.lock.forWriting ? 'write' : 'read'})`);
                        removeLock(lockInfo);
                    },
                    moveToParent: async () => {
                        const req: IMoveLockRequestMessage = { type: 'move-lock-request', id: ID.generate(), from: this.id, to: this.masterPeerId, data: { id: lockInfo.lock.id, move_to: 'parent' } };
                        let result;
                        try {
                            result = await this.request(req) as ILockResponseData;
                        }
                        catch(err) {
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

            const req: ILockRequestMessage = { type: 'lock-request', id: ID.generate(), from: this.id, to: this.masterPeerId, data: details };
            
            let result:ILockResponseData, err: Error;
            try {
                result = await this.request(req) as ILockResponseData;
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

    private _requests:Map<string, { resolve: (result: any) => void, reject: (err: Error) => void, request: IRequestMessage }> = new Map();
    private async request(req: IRequestMessage): Promise<any> {
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

    protected abstract sendMessage(message: IMessage)

    /**
     * Sends a custom request to the IPC master
     * @param request 
     * @returns 
     */
    public sendRequest(request: any) {
        const req: ICustomRequestMessage = { type: 'request', from: this.id, to: this.masterPeerId, id: ID.generate(), data: request };
        return this.request(req)
        .catch(err => {
            this.storage.debug.error(err);
            throw err;
        });
    }

    public replyRequest(requestMessage:IRequestMessage, result: any) {
        const reply:IResponseMessage = { type: 'result', id: requestMessage.id, ok: true, from: this.id, to: requestMessage.from, data: result };
        this.sendMessage(reply);
    }

    /**
     * Sends a custom notification to all IPC peers
     * @param notification 
     * @returns 
     */
    public sendNotification(notification: any) {
        const msg: ICustomNotificationMessage = { type: 'notification', from: this.id, data: notification };
        this.sendMessage(msg);
    }

    private _eventsEnabled: boolean = true;

    /**
     * If ipc event handling is currently enabled
     */
    get eventsEnabled() { return this._eventsEnabled; }

    /**
     * Enables or disables ipc event handling. When disabled, incoming event messages will be ignored.
     */
    set eventsEnabled(enabled: boolean) {
        this.storage.debug.log(`ipc events ${enabled ? 'enabled' : 'disabled'}`);
        this._eventsEnabled = enabled;
    }
 
}

// interface IAceBasePrivateAPI {
//     api: {
//         subscribe(path: string, event: string, callback: (err: Error, path: string, value: any, previous: any, eventContext: any) => void): Promise<void>
//         unsubscribe(path: string, event?: string, callback?: (err: Error, path: string, value: any, previous: any, eventContext: any) => void): Promise<void>
//     }
// }

export interface IAceBaseIPCLock {
    id: number
    tid: string
    path: string
    forWriting: boolean
    comment: string
    expires: number
    state: string
    release(): Promise<void>
    moveToParent(): Promise<IAceBaseIPCLock>
}

export type AceBaseSubscribeCallback = (error: Error, path: string, newValue: any, oldValue: any, eventContext: any) => void

export interface IMessage {
    /**
     * Message type, determines how to handle data
     */
    type: string
    /**
     * Who sends this message
     */
    from: string
    /**
     * Who is this message for (not present for broadcast messages)
     */
    to?: string
    /**
     * Optional payload
     */
    data?: any
}

export interface IHelloMessage extends IMessage {
    type: 'hello'
    data: void
}

export interface IByeMessage extends IMessage {
    type: 'bye'
    data: void
}

export interface IPulseMessage extends IMessage {
    type: 'pulse'
    data: void
}

export interface ICustomNotificationMessage extends IMessage {
    type: 'notification'
    data: any
}

export type AceBaseEventType = string; //'value' | 'child_added' | 'child_changed' | 'child_removed' | 'mutated' | 'mutations' | 'notify_value' | 'notify_child_added' | 'notify_child_changed' | 'notify_child_removed' | 'notify_mutated' | 'notify_mutations'

export interface ISubscriptionData {
    path: string
    event: AceBaseEventType    
}

export interface ISubscribeMessage extends IMessage {
    type: 'subscribe'
    data: ISubscriptionData
}

export interface IUnsubscribeMessage extends IMessage {
    type: 'unsubscribe',
    data: ISubscriptionData
}

export interface IEventMessage extends IMessage {
    type: 'event'
    event: AceBaseEventType
    /**
     * Path the subscription is on
     */
    path: string
    data: {
        /**
         * The path the event fires on
         */
        path: string
        val?: any
        previous?: any
        context: any
    }
}

export interface IRequestMessage extends IMessage {
    id: string
}

export interface ILockRequestData {
    path: string
    write: boolean
    tid: string
    comment: string
}

export interface ILockRequestMessage extends IRequestMessage {
    type: 'lock-request'
    data: ILockRequestData
}

export interface IUnlockRequestData {
    id: number
}

export interface IUnlockRequestMessage extends IRequestMessage {
    type: 'unlock-request'
    data: IUnlockRequestData
}

export interface IResponseMessage extends IMessage {
    id: string
    ok: boolean
    reason?: string
}

export interface ILockResponseData {
    id: number
    path: string
    write: boolean
    tid: string
    expires: number
    comment: string
}

export interface ILockResponseMessage extends IResponseMessage {
    type: 'lock-result'
    data: ILockResponseData
}

export interface IUnlockResponseData {
    id: number
}

export interface IUnlockResponseMessage extends IResponseMessage {
    type: 'unlock-result'
    data: IUnlockResponseData
}

export interface IMoveLockRequestData {
    id: number
    move_to: 'parent'|'path'
}

export interface IMoveLockRequestMessage extends IRequestMessage {
    type: 'move-lock-request'
    data: IMoveLockRequestData
}

export interface ICustomRequestMessage extends IRequestMessage {
    type: 'request',
    data: any
}