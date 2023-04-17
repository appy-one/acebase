/// <reference types="node" />
import { Server } from 'net';
import { AceBaseIPCPeer, IMessage } from './ipc';
import { Storage } from '../storage';
export { Server as NetIPCServer } from 'net';
/**
 * Node cluster functionality - enables vertical scaling with forked processes. AceBase will enable IPC at startup, so
 * any forked process will communicate database changes and events automatically. Locking of resources will be done by
 * the cluster's primary (previously master) process. NOTE: if the master process dies, all peers stop working
 */
export declare class IPCSocketPeer extends AceBaseIPCPeer {
    server?: Server;
    constructor(storage: Storage, ipcSettings: {
        ipcName: string;
        server: Server | null;
    });
    sendMessage(message: IMessage): void;
    exit(code?: number): Promise<void>;
}
//# sourceMappingURL=socket.d.ts.map