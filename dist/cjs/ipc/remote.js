"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RemoteIPCPeer = void 0;
const acebase_core_1 = require("acebase-core");
const ipc_1 = require("./ipc");
const http = require("http");
const masterPeerId = '[master]';
const WS_CLOSE_PING_TIMEOUT = 1;
const WS_CLOSE_PROCESS_EXIT = 2;
// const WS_CLOSE_UNAUTHORIZED = 3;
// const WS_CLOSE_WRONG_CLIENT = 4;
// const WS_CLOSE_SERVER_ERROR = 5;
/**
 * Remote IPC using an external server. Database changes and events will be synchronized automatically.
 * Locking of resources will be done by a single master that needs to be known up front. Preferably, the master
 * is a process that handles no database updates itself and only manages data locking and allocation for workers.
 *
 * To use Remote IPC, you have to start the following processes:
 *  - 1 AceBase IPC Server process
 *  - 1 AceBase database master process (optional, used in example 1)
 *  - 1+ AceBase server worker processes
 *
 * NOTE if your IPC server will be running on a public host (not `localhost`), make sure to use `ssl` and a secret
 * `token` in your IPC configuration.
 *
 * @example
 * // IPC server process (start-ipc-server.js)
 * const { AceBaseIPCServer } = require('acebase-ipc-server');
 * const server = new AceBaseIPCServer({ host: 'localhost', port: 9163 })
 *
 * // Dedicated db master process (start-db-master.js)
 * const { AceBase } = require('acebase');
 * const db = new AceBase('mydb', { storage: { ipc: { host: 'localhost', port: 9163, ssl: false, role: 'master' } } });
 *
 * // Server worker processes (start-db-server.js)
 * const { AceBaseServer } = require('acebase-server');
 * const server = new AceBaseServer('mydb', { host: 'localhost', port: 5757, storage: { ipc: { host: 'localhost', port: 9163, ssl: false, role: 'worker' } } });
 *
 * // PM2 ecosystem.config.js:
 * module.exports = {
 *  apps: [{
 *      name: "AceBase IPC Server",
 *      script: "./start-ipc-server.js"
 *  }, {
 *      name: "AceBase database master",
 *      script: "./start-db-master.js"
 *  }, {
 *      name: "AceBase database server",
 *      script: "./start-db-server.js",
 *      instances: "-2",        // Uses all CPUs minus 2
 *      exec_mode: "cluster"    // Enables PM2 load balancing, see https://pm2.keymetrics.io/docs/usage/cluster-mode/
 *  }]
 * }
 *
 * @description
 * Instead of starting a dedicated db master process, you can also start 1 `AceBaseServer` with `role: "master"` manually.
 * Note that the db master will also handle http requests for clients in this case, which might not be desirable because it
 * also has to handle IPC master tasks for other clients. See the following example:
 *
 * @example
 * // Another example using only 2 startup apps:
 *  - 1 instance: AceBase IPC server
 *  - Multiple instances of your app
 *
 * // IPC server process (start-ipc-server.js)
 * const { AceBaseIPCServer } = require('acebase-ipc-server');
 * const server = new AceBaseIPCServer({ host: 'localhost', port: 9163 })
 *
 * // Server worker processes (start-db-server.js)
 * const { AceBaseServer } = require('acebase-server');
 * const role = process.env.NODE_APP_INSTANCE === '0' ? 'master' : 'worker';
 * const server = new AceBaseServer('mydb', { host: 'localhost', port: 5757, storage: { ipc: { host: 'localhost', port: 9163, ssl: false, role } } });
 *
 * // PM2 ecosystem.config.js:
 * module.exports = {
 *  apps: [{
 *      name: "AceBase IPC Server",
 *      script: "./start-ipc-server.js",
 *      instances: 1
 *  }, {
 *      name: "AceBase database server",
 *      script: "./start-db-server.js",
 *      instances: "-1",        // Uses all CPUs minus 1
 *      exec_mode: "cluster"    // Enables PM2 load balancing
 *  }]
 * }
 */
class RemoteIPCPeer extends ipc_1.AceBaseIPCPeer {
    get version() { return '1.0.0'; }
    constructor(storage, config) {
        super(storage, config.role === 'master' ? masterPeerId : acebase_core_1.ID.generate(), config.dbname);
        this.config = config;
        this.queue = true;
        this.pending = { in: [], out: [] };
        this.maxPayload = 100; // Initial setting, will be overridden by server config once connected
        this.masterPeerId = masterPeerId;
        this.connect().catch(err => {
            storage.debug.error(err.message);
            this.exit();
        });
    }
    async connect(options) {
        const ws = await (async () => {
            try {
                return Promise.resolve().then(() => require('ws'));
            }
            catch (_a) {
                throw new Error(`ws package is not installed. To fix this, run: npm install ws`);
            }
        })();
        return new Promise((resolve, reject) => {
            var _a;
            let connected = false;
            this.ws = new ws.WebSocket(`ws${this.config.ssl ? 's' : ''}://${this.config.host || 'localhost'}:${this.config.port}/${this.config.dbname}/connect?v=${this.version}&id=${this.id}&t=${this.config.token}`); // &role=${this.config.role}
            // Handle connection success
            this.ws.addEventListener('open', async ( /*event*/) => {
                connected = true;
                // Send any pending messages
                this.pending.out.forEach(msg => {
                    this.ws.send(msg);
                });
                this.pending.out = [];
                this.queue = false;
                resolve();
            });
            // // Handle unexpected response (is documented at https://github.com/websockets/ws/blob/master/doc/ws.md#event-unexpected-response but doesn't appear to be working)
            // (this.ws as any).addEventListener('unexpected-response', (req: http.ClientRequest, res: http.IncomingMessage) => {
            //     console.error(`Invalid response: ${res.statusCode} ${res.statusMessage}`);
            //     let closeCode;
            //     switch (res.statusCode) {
            //         case 401: closeCode = WS_CLOSE_UNAUTHORIZED; break;
            //         case 409: closeCode = WS_CLOSE_WRONG_CLIENT; break;
            //         case 500: closeCode = WS_CLOSE_SERVER_ERROR; break;
            //     }
            //     reject(new Error(`${res.statusCode} ${res.statusMessage}`));
            // });
            // Handle connection error
            this.ws.addEventListener('error', event => {
                var _a;
                if (!connected) {
                    // We had no connection yet
                    if (event.message.includes('403')) {
                        reject(new Error('Cannot connect to IPC server: unauthorized'));
                    }
                    else if (event.message.includes('409')) {
                        reject(new Error('Cannot connect to IPC server: unsupported client version (too new or old)'));
                    }
                    else if (event.message.includes('500')) {
                        reject(new Error('Cannot connect to IPC server: server error'));
                    }
                    else if (typeof (options === null || options === void 0 ? void 0 : options.maxRetries) === 'undefined' || typeof (options === null || options === void 0 ? void 0 : options.maxRetries) === 'number' && (options === null || options === void 0 ? void 0 : options.maxRetries) > 0) {
                        const retryMs = 1000; // ms
                        this.storage.debug.error(`Unable to connect to remote IPC server (${event.message}). Trying again in ${retryMs}ms`);
                        const retryOptions = {};
                        if (typeof typeof (options === null || options === void 0 ? void 0 : options.maxRetries) === 'number') {
                            retryOptions.maxRetries = options.maxRetries - 1;
                        }
                        const timeout = setTimeout(() => { this.connect(retryOptions); }, retryMs);
                        (_a = timeout.unref) === null || _a === void 0 ? void 0 : _a.call(timeout);
                    }
                    else {
                        reject(event);
                    }
                }
            });
            // Send pings if connection is idle to actively monitor connectivity
            let lastMessageReceived = Date.now();
            const pingInterval = setInterval(() => {
                if (this._exiting) {
                    return;
                }
                const ms = Date.now() - lastMessageReceived;
                if (ms > 10000) {
                    // Timeout if we didn't get response within 10 seconds
                    this.ws.close(WS_CLOSE_PING_TIMEOUT); // close event that follows will reconnect
                }
                else if (ms > 5000) {
                    // No messages received for 5s. Sending ping to trigger pong response
                    this.ws.send('ping');
                }
            }, 500);
            (_a = pingInterval.unref) === null || _a === void 0 ? void 0 : _a.call(pingInterval);
            // Close connection if we're exiting
            process.once('exit', () => {
                this.ws.close(WS_CLOSE_PROCESS_EXIT);
            });
            // Handle disconnect
            this.ws.addEventListener('close', ( /*event*/) => {
                var _a, _b;
                // Disconnected. Try reconnecting immediately
                if (!connected) {
                    return;
                } // We weren't connected yet. Don't reconnect here, retries will be executed automatically
                if (this._exiting) {
                    return;
                }
                this.storage.debug.error(`Connection to remote IPC server was lost. Trying to reconnect`);
                clearInterval(pingInterval);
                (_b = (_a = this.storage).invalidateCache) === null || _b === void 0 ? void 0 : _b.call(_a, true, '', true, 'ipc_ws_disconnect'); // Make sure the entire cache is invalidated (AceBase storage has such cache)
                this.connect();
            });
            // Handle incoming messages
            this.ws.addEventListener('message', async (event) => {
                lastMessageReceived = Date.now();
                let str = event.data.toString();
                console.log(str);
                if (str === 'pong') {
                    // We got a ping reply from the server
                    return;
                }
                else if (str.startsWith('welcome:')) {
                    // Welcome message with config
                    const config = JSON.parse(str.slice(8));
                    this.maxPayload = config.maxPayload;
                }
                else if (str.startsWith('connect:')) {
                    // A new peer connected to the IPC server
                    // Do not add yet, wait for our own "hello" message
                }
                else if (str.startsWith('disconnect:')) {
                    // A peer has disconnected from the IPC server
                    const id = str.slice(11);
                    if (this.peers.find(peer => peer.id === id)) {
                        // Peer apparently did not have time to say goodbye,
                        // remove the peer ourselves
                        this.removePeer(id);
                        // Send "bye" message on their behalf
                        this.sayGoodbye(id);
                    }
                }
                else if (str.startsWith('get:')) {
                    // Large message we have to fetch
                    const msgId = str.slice(4);
                    try {
                        str = await this.fetch('GET', `/${this.config.dbname}/receive?id=${this.id}&msg=${msgId}&t=${this.config.token}`);
                        const msg = JSON.parse(str);
                        super.handleMessage(msg);
                    }
                    catch (err) {
                        this.storage.debug.error(`Failed to receive message ${msgId}:`, err);
                    }
                }
                else if (str.startsWith('{')) {
                    // Normal message
                    const msg = JSON.parse(str);
                    super.handleMessage(msg);
                }
                else {
                    // Unknown event
                    console.warn(`Received unknown IPC message: "${str}"`);
                }
            });
        });
    }
    sendMessage(message) {
        this.storage.debug.verbose(`[RemoteIPC] sending: `, message);
        let json = JSON.stringify(message);
        if (typeof message.to === 'string') {
            // Send to specific peer only
            json = `to:${message.to};${json}`;
        }
        if (this.queue) {
            this.pending.out.push(json);
        }
        else if (json.length > this.maxPayload) {
            this.fetch('POST', `/${this.dbname}/send?id=${this.id}&t=${this.config.token}`, json);
        }
        else {
            this.ws.send(json);
        }
    }
    async fetch(method, path, postData) {
        const options = {
            hostname: this.config.host || 'localhost',
            port: this.config.port,
            path,
            method,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData || ''),
            },
        };
        return await new Promise((resolve, reject) => {
            const req = http.request(options, (res) => {
                // console.log(`STATUS: ${res.statusCode}`);
                // console.log(`HEADERS: ${JSON.stringify(res.headers)}`);
                res.setEncoding('utf8');
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    resolve(data);
                });
            });
            req.on('error', reject);
            // Write data to request body
            req.write(postData);
            req.end();
        });
    }
}
exports.RemoteIPCPeer = RemoteIPCPeer;
//# sourceMappingURL=remote.js.map