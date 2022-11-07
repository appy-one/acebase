import { AceBaseIPCPeer, IMessage } from './ipc';
import { Storage } from '../storage';
export interface RemoteIPCServerConfig {
    dbname: string;
    host?: string;
    port: number;
    ssl?: boolean;
    token?: string;
    role: 'master' | 'worker';
}
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
export declare class RemoteIPCPeer extends AceBaseIPCPeer {
    private config;
    private get version();
    private ws;
    private queue;
    private pending;
    private maxPayload;
    constructor(storage: Storage, config: RemoteIPCServerConfig);
    private connect;
    sendMessage(message: IMessage): void;
    fetch(method: 'GET' | 'POST', path: string, postData?: string): Promise<string>;
}
//# sourceMappingURL=remote.d.ts.map