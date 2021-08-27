import { ID, Transport } from "acebase-core";
import { AceBaseIPCPeer, IAceBaseIPCLock, IHelloMessage, IMessage } from './ipc';
import { Storage } from '../storage';

type MessageEventCallback = (event: MessageEvent) => any;

/**
 * Browser tabs IPC. Database changes and events will be synchronized automatically. 
 * Locking of resources will be done by the election of a single locking master: 
 * the one with the lowest id.
 */
 export class IPCPeer extends AceBaseIPCPeer {
    
    private channel: BroadcastChannel;

    constructor(storage: Storage) {
        super(storage, ID.generate());

        this.masterPeerId = this.id; // We don't know who the master is yet...
        this.ipcType = 'browser.bcc';

        // Setup process exit handler
        // Monitor onbeforeunload event to say goodbye when the window is closed
        window.addEventListener('beforeunload', () => {
            this.exit();
        });

        // Create BroadcastChannel to allow multi-tab communication
        // This allows other tabs to make changes to the database, notifying us of those changes.
        if (typeof window.BroadcastChannel !== 'undefined') {
            this.channel = new BroadcastChannel(`acebase:${storage.name}`);
        }
        else {
            // Use localStorage as polyfill for Safari & iOS WebKit
            const listeners:MessageEventCallback[] = [null]; // first callback reserved for onmessage handler
            const notImplemented = () => { throw new Error('Not implemented'); };
            this.channel = {
                name: `acebase:${storage.name}`,
                postMessage: (message: any) => {
                    const messageId = ID.generate(), 
                        key = `acebase:${storage.name}:${this.id}:${messageId}`,
                        payload = JSON.stringify(Transport.serialize(message));
                    
                    // Store message, triggers 'storage' event in other tabs
                    localStorage.setItem(key, payload);
                    
                    // Remove after 10ms
                    setTimeout(() => localStorage.removeItem(key), 10);
                },
                set onmessage(handler: MessageEventCallback) { listeners[0] = handler; },
                set onmessageerror(handler: MessageEventCallback) { notImplemented(); },
                close() { notImplemented(); },
                addEventListener(event: 'message', callback: MessageEventCallback) {
                    if (event !== 'message') { notImplemented(); }
                    listeners.push(callback);
                },
                removeEventListener(event: 'message', callback: MessageEventCallback) {
                    const i = listeners.indexOf(callback);
                    i >= 1 && listeners.splice(i, 1);
                },
                dispatchEvent(event: MessageEvent) {
                    listeners.forEach(callback => {
                        try {
                            callback && callback(event);
                        }
                        catch(err) {
                            console.error(err);
                        }
                    });
                    return true;                   
                 }
            } as BroadcastChannel;

            // Listen for storage events to intercept possible messages
            window.addEventListener('storage', event => {
                const [ acebase, dbname, peerId, messageId ] = event.key.split(':');
                if (acebase !== 'acebase' || dbname !== storage.name || peerId === this.id || event.newValue === null) {
                    return;
                }
                const message = Transport.deserialize(JSON.parse(event.newValue));
                this.channel.dispatchEvent({ data: message } as MessageEvent);
            });
        }

        // Monitor incoming messages
        this.channel.addEventListener('message', async event => {
            const message:IMessage = event.data;

            if (message.to && message.to !== this.id) {
                // Message is for somebody else. Ignore
                return;
            }

            storage.debug.verbose(`[BroadcastChannel] received: `, message);

            if (message.type === 'hello' && message.from < this.masterPeerId) {
                // This peer was created before other peer we thought was the master
                this.masterPeerId = message.from;
                storage.debug.log(`[BroadcastChannel] Tab ${this.masterPeerId} is the master.`);
            }
            else if (message.type === 'bye' && message.from === this.masterPeerId) {
                // The master tab is leaving
                storage.debug.log(`[BroadcastChannel] Master tab ${this.masterPeerId} is leaving`);

                // Elect new master
                const allPeerIds = this.peers.map(peer => peer.id).concat(this.id).filter(id => id !== this.masterPeerId); // All peers, including us, excluding the leaving master peer
                this.masterPeerId = allPeerIds.sort()[0];

                storage.debug.log(`[BroadcastChannel] ${this.masterPeerId === this.id ? 'We are' : `tab ${this.masterPeerId} is`} the new master. Requesting ${this._locks.length} locks (${this._locks.filter(r => !r.granted).length} pending)`);

                // Let the new master take over any locks and lock requests.
                const requests =  this._locks.splice(0); // Copy and clear current lock requests before granted locks are requested again.
                
                // Request previously granted locks again
                await Promise.all(requests.filter(req => req.granted).map(async req => {
                    // Prevent race conditions: if the existing lock is released or moved to parent before it was
                    // moved to the new master peer, we'll resolve their promises after releasing/moving the new lock
                    let released:(none?: any) => void, movedToParent:(lock: IAceBaseIPCLock) => void;
                    req.lock.release = () => { return new Promise(resolve => released = resolve); };
                    req.lock.moveToParent = () => { return new Promise(resolve => movedToParent = resolve); }

                    // Request lock again:
                    const lock = await this.lock({ path: req.lock.path, write: req.lock.forWriting, tid: req.lock.tid, comment: req.lock.comment })
                    if (movedToParent) {
                        const newLock = await lock.moveToParent();
                        movedToParent(newLock);
                    }
                    if (released) {
                        await lock.release();
                        released();
                    }
                }));

                // Now request pending locks again
                await Promise.all(requests.filter(req => !req.granted).map(async req => {
                    await this.lock(req.request);
                }));
            }

            return this.handleMessage(message);
        });

        // // Schedule periodic "pulse" to let others know we're still around
        // setInterval(() => {
        //     sendMessage(<IPulseMessage>{ from: tabId, type: 'pulse' });
        // }, 30000);

        // Send hello to other peers
        const helloMsg:IHelloMessage = { type: 'hello', from: this.id, data: undefined };
        this.sendMessage(helloMsg);
    }

    sendMessage(message: IMessage) {
        this.storage.debug.verbose(`[BroadcastChannel] sending: `, message);
        this.channel.postMessage(message);
    }

}