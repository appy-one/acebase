"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IPCSocketPeer = exports.NetIPCServer = void 0;
const net_1 = require("net");
const path_1 = require("path");
const child_process_1 = require("child_process");
const ipc_1 = require("./ipc");
const acebase_core_1 = require("acebase-core");
const shared_1 = require("./service/shared");
// import { startServer } from './service';
var net_2 = require("net");
Object.defineProperty(exports, "NetIPCServer", { enumerable: true, get: function () { return net_2.Server; } });
const masterPeerId = '[master]';
/**
 * Socket IPC implementation. Peers will attempt starting up a dedicated service process for the target database,
 * or connect to an already running process. The service acts as the IPC master and governs over locks, space allocation
 * and communication between peers. Communication between the processes is done using (very fast in-memory) Unix sockets.
 * This IPC implementation allows different processes on a single machine to access the same database simultaniously without
 * them having to explicitly configure their IPC settings.
 * Currently can be used by passing `ipc: 'socket'` in AceBase's `storage` settings, will become the default soon.
 */
class IPCSocketPeer extends ipc_1.AceBaseIPCPeer {
    constructor(storage, ipcSettings) {
        const isMaster = storage.settings.ipc instanceof net_1.Server;
        const peerId = isMaster ? masterPeerId : acebase_core_1.ID.generate();
        super(storage, peerId, ipcSettings.ipcName);
        this.server = ipcSettings.server;
        this.masterPeerId = masterPeerId;
        this.ipcType = 'node.socket';
        const dbFile = (0, path_1.resolve)(storage.path, `${storage.settings.type}.db`);
        const socketPath = (0, shared_1.getSocketPath)(dbFile);
        /** Adds an event handler that is automatically removed upon IPC exit */
        const bindEventHandler = (target, event, handler) => {
            var _a;
            ((_a = target.on) !== null && _a !== void 0 ? _a : target.addListener).bind(target)(event, handler);
            this.on('exit', () => { var _a; return ((_a = target.off) !== null && _a !== void 0 ? _a : target.removeListener).bind(target)(event, handler); });
        };
        // Setup process exit handler
        bindEventHandler(process, 'SIGINT', () => {
            this.exit();
        });
        if (!isMaster) {
            // Try starting IPC service if it is not running yet.
            // Use maxIdleTime 0 to allow tests to remove database files when done, make this configurable!
            const service = (0, child_process_1.spawn)('node', [__dirname + '/service/start.js', dbFile, '--loglevel', storage.debug.level, '--maxidletime', '0'], { detached: true, stdio: 'ignore' });
            service.unref(); // Process is detached and allowed to keep running after we exit. Do not keep a reference to it, possibly preventing app exit.
            // For testing:
            // startServer(dbFile, {
            //     maxIdleTime: 0,
            //     logLevel: storage.debug.level,
            //     exit: (code) => {
            //         storage.debug.log(`[IPC ${ipcSettings.ipcName}] service exited with code ${code}`);
            //     },
            // });
        }
        /**
         * Socket connection with master (workers only)
         */
        let socket = null;
        let connected = false;
        const queue = [];
        /**
         * Maps peers to IPC sockets (master only)
         */
        const peerSockets = isMaster ? new Map() : null;
        const handleMessage = (socket, message) => {
            if (typeof message !== 'object') {
                // Ignore non-object IPC messages
                return;
            }
            if (isMaster && message.to !== masterPeerId) {
                // Message is meant for others (or all). Forward it
                this.sendMessage(message);
            }
            if (message.to && message.to !== this.id) {
                // Message is for somebody else. Ignore
                return;
            }
            if (this.isMaster) {
                if (message.type === 'hello') {
                    // Bind peer id to incoming socket
                    peerSockets.set(message.from, socket);
                }
                else if (message.type === 'bye') {
                    // Remove bound socket for peer
                    peerSockets.delete(message.from);
                }
            }
            return super.handleMessage(message);
        };
        if (isMaster) {
            this.server.on('connection', (socket) => {
                // New socket connected. We don't know which peer it is until we get a "hello" message
                let buffer = Buffer.alloc(0); // Buffer to store incomplete messages
                socket.on('data', chunk => {
                    // Received data from a worker
                    buffer = Buffer.concat([buffer, chunk]);
                    while (buffer.length > 0) {
                        const delimiterIndex = buffer.indexOf(shared_1.MSG_DELIMITER);
                        if (delimiterIndex === -1) {
                            break; // wait for more data
                        }
                        // Extract message from buffer
                        const message = buffer.subarray(0, delimiterIndex);
                        buffer = buffer.subarray(delimiterIndex + shared_1.MSG_DELIMITER.length);
                        try {
                            const json = message.toString('utf-8');
                            // storage.debug.log(`[IPC ${ipcSettings.ipcName}] Received socket message: `, json);
                            const serialized = JSON.parse(json);
                            const msg = acebase_core_1.Transport.deserialize2(serialized);
                            handleMessage(socket, msg);
                        }
                        catch (err) {
                            storage.debug.error(`[IPC ${ipcSettings.ipcName}] Error parsing message: ${err}`);
                        }
                    }
                });
                socket.on('close', (hadError) => {
                    // socket has disconnected. Find registered peer
                    for (const [peerId, peerSocket] of peerSockets.entries()) {
                        if (peerSocket === socket) {
                            // Worker apparently did not have time to say goodbye,
                            // remove the peer ourselves
                            this.removePeer(peerId);
                            // Send "bye" message on their behalf
                            this.sayGoodbye(peerId);
                            break;
                        }
                    }
                });
            });
        }
        else {
            const connectSocket = async (path) => {
                const tryConnect = async (tries) => {
                    try {
                        if (this._exiting) {
                            return;
                        }
                        const s = (0, net_1.connect)({ path });
                        await new Promise((resolve, reject) => {
                            s.once('error', reject).unref();
                            s.once('connect', resolve).unref();
                        });
                        storage.debug.log(`[IPC ${ipcSettings.ipcName}] peer ${this.id} successfully established connection to the service`);
                        socket = s;
                        connected = true;
                    }
                    catch (err) {
                        if (tries < 100) {
                            // Retry in 10ms
                            await new Promise(resolve => setTimeout(resolve, 100));
                            return tryConnect(tries + 1);
                        }
                        storage.debug.error(`[IPC ${ipcSettings.ipcName}] peer ${this.id} cannot connect to service: ${err.message}`);
                        throw err;
                    }
                };
                await tryConnect(1);
                this.once('exit', () => {
                    socket === null || socket === void 0 ? void 0 : socket.destroy();
                });
                bindEventHandler(socket, 'close', (hadError) => {
                    // Connection to server closed
                    storage.debug.log(`IPC peer ${this.id} lost its connection to the service${hadError ? ' because of an error' : ''}`);
                });
                let buffer = Buffer.alloc(0); // Buffer to store incomplete messages
                bindEventHandler(socket, 'data', chunk => {
                    // Received data from server
                    buffer = Buffer.concat([buffer, chunk]);
                    while (buffer.length > 0) {
                        const delimiterIndex = buffer.indexOf(shared_1.MSG_DELIMITER);
                        if (delimiterIndex === -1) {
                            break; // wait for more data
                        }
                        // Extract message from buffer
                        const message = buffer.subarray(0, delimiterIndex);
                        buffer = buffer.subarray(delimiterIndex + shared_1.MSG_DELIMITER.length);
                        try {
                            const json = message.toString('utf-8');
                            // storage.debug.log(`Received server message: `, json);
                            const serialized = JSON.parse(json);
                            const msg = acebase_core_1.Transport.deserialize2(serialized);
                            handleMessage(socket, msg);
                        }
                        catch (err) {
                            storage.debug.error(`Error parsing message: ${err}`);
                        }
                    }
                });
                connected = true;
                while (queue.length) {
                    const message = queue.shift();
                    this.sendMessage(message);
                }
            };
            connectSocket(socketPath);
        }
        this.sendMessage = (message) => {
            const serialized = acebase_core_1.Transport.serialize2(message);
            const buffer = Buffer.from(JSON.stringify(serialized) + shared_1.MSG_DELIMITER);
            if (this.isMaster) {
                // We are the master, send the message to the target worker(s)
                this.peers
                    .filter(p => p.id !== message.from && (!message.to || p.id === message.to))
                    .forEach(peer => {
                    const socket = peerSockets.get(peer.id);
                    socket === null || socket === void 0 ? void 0 : socket.write(buffer);
                });
            }
            else if (connected) {
                // Send the message to the master who will forward it to the target worker(s)
                socket.write(buffer);
            }
            else {
                // Not connected yet, queue message
                queue.push(message);
            }
        };
        // Send hello to other peers
        const helloMsg = { type: 'hello', from: this.id, data: undefined };
        this.sendMessage(helloMsg);
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    sendMessage(message) { throw new Error('Must be set by constructor'); }
    async exit(code = 0) {
        await super.exit(code);
    }
}
exports.IPCSocketPeer = IPCSocketPeer;
//# sourceMappingURL=socket.js.map