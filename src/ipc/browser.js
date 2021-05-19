"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IPCPeer = void 0;
const acebase_core_1 = require("acebase-core");
const ipc_1 = require("./ipc");
/**
 * Browser tabs IPC. Database changes and events will be synchronized automatically.
 * Locking of resources will be done by the election of a single locking master:
 * the one with the lowest id.
 */
class IPCPeer extends ipc_1.AceBaseIPCPeer {
    constructor(storage) {
        super(storage, acebase_core_1.ID.generate());
        this.masterPeerId = this.id; // We don't know who the master is yet...
        this.ipcType = 'browser.bcc';
        // Setup process exit handler
        // Monitor onbeforeunload event to say goodbye when the window is closed
        window.addEventListener('beforeunload', () => {
            this.exit();
        });
        // Create BroadcastChannel to allow multi-tab communication
        // This allows other tabs to make changes to the database, notifying us of those changes.
        if (typeof window.BroadcastChannel === 'undefined') {
            storage.debug.warn(`BroadCastChannel not available, browser tabs IPC not possible yet`);
            return;
        }
        this.channel = new BroadcastChannel(`acebase:${storage.name}`); // TODO: polyfill for Safari
        // Monitor incoming messages
        this.channel.addEventListener('message', async (event) => {
            const message = event.data;
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
                const requests = this._locks.splice(0); // Copy and clear current lock requests before granted locks are requested again.
                // Request previously granted locks again
                await Promise.all(requests.filter(req => req.granted).map(async (req) => {
                    // Prevent race conditions: if the existing lock is released or moved to parent before it was
                    // moved to the new master peer, we'll resolve their promises after releasing/moving the new lock
                    let released, movedToParent;
                    req.lock.release = () => { return new Promise(resolve => released = resolve); };
                    req.lock.moveToParent = () => { return new Promise(resolve => movedToParent = resolve); };
                    // Request lock again:
                    const lock = await this.lock({ path: req.lock.path, write: req.lock.forWriting, tid: req.lock.tid, comment: req.lock.comment });
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
                await Promise.all(requests.filter(req => !req.granted).map(async (req) => {
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
        const helloMsg = { type: 'hello', from: this.id, data: undefined };
        this.sendMessage(helloMsg);
    }
    sendMessage(message) {
        this.storage.debug.verbose(`[BroadcastChannel] sending: `, message);
        this.channel.postMessage(message);
    }
}
exports.IPCPeer = IPCPeer;
//# sourceMappingURL=browser.js.map