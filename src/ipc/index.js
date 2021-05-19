"use strict";
// export { NodeClusterIPCPeer as IPCPeer } from './node-cluster';
Object.defineProperty(exports, "__esModule", { value: true });
exports.IPCPeer = void 0;
const ipc_1 = require("./ipc");
const cluster = require("cluster");
const masterPeerId = '[master]';
/**
 * Node cluster functionality - enables vertical scaling with forked processes. AceBase will enable IPC at startup, so
 * any forked process will communicate database changes and events automatically. Locking of resources will be done by
 * the election of a single locking master: the one with the lowest id.
 */
class IPCPeer extends ipc_1.AceBaseIPCPeer {
    constructor(storage) {
        const peerId = cluster.isMaster ? masterPeerId : cluster.worker.id.toString();
        super(storage, peerId);
        this.masterPeerId = masterPeerId;
        this.ipcType = 'node.cluster';
        // Setup process exit handler
        process.on('SIGINT', () => {
            this.exit();
        });
        if (cluster.isMaster) {
            cluster.on('online', worker => {
                // A new worker is started
                // Do not add yet, wait for "hello" message - a forked process might not use the same db
                worker.on('error', err => {
                    storage.debug.error(`Caught worker error:`, err);
                });
            });
            cluster.on('exit', worker => {
                // A worker has shut down
                if (this.peers.find(peer => peer.id === worker.id.toString())) {
                    // Worker apparently did not have time to say goodbye, 
                    // remove the peer ourselves
                    this.removePeer(worker.id.toString());
                    // Send "bye" message on their behalf           
                    this.sayGoodbye(worker.id.toString());
                }
            });
        }
        const handleMessage = (message) => {
            if (message.dbname !== this.storage.name) {
                // Ignore, message not meant for this database
                return;
            }
            if (cluster.isMaster && message.to !== masterPeerId) {
                // Message is meant for others. Forward it
                this.sendMessage(message);
            }
            if (message.to && message.to !== this.id) {
                // Message is for somebody else. Ignore
                return;
            }
            return super.handleMessage(message);
        };
        if (cluster.isMaster) {
            cluster.on('message', (worker, message) => handleMessage(message));
        }
        else {
            cluster.worker.on('message', handleMessage);
        }
        // if (!cluster.isMaster) {
        //     // Add master peer. Do we have to?
        //     this.addPeer(masterPeerId, false, false);
        // }
        // Send hello to other peers
        const helloMsg = { type: 'hello', from: this.id, data: undefined };
        this.sendMessage(helloMsg);
    }
    sendMessage(msg) {
        const message = msg;
        message.dbname = this.storage.name;
        if (cluster.isMaster) {
            // If we are the master, send the message to the target worker(s)
            this.peers
                .filter(p => p.id !== message.from && (!message.to || p.id === message.to))
                .forEach(peer => {
                const worker = cluster.workers[peer.id];
                worker && worker.send(message); // When debugging, worker might have stopped in the meantime
            });
        }
        else {
            // Send the message to the master who will forward it to the target worker(s)
            process.send(message);
        }
    }
    async exit(code = 0) {
        await super.exit();
        // process.exit(code);
        // this.storage.debug.warn(`${this.isMaster ? 'Master' : 'Worker ' + this.id} exits`);
    }
}
exports.IPCPeer = IPCPeer;
//# sourceMappingURL=index.js.map