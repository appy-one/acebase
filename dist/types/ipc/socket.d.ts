/// <reference types="node" />
import { Server } from 'net';
import { AceBaseIPCPeer, IMessage } from './ipc';
import { Storage } from '../storage';
export { Server as NetIPCServer } from 'net';
/**
 * Socket IPC implementation. Peers will attempt starting up a dedicated service process for the target database,
 * or connect to an already running process. The service acts as the IPC master and governs over locks, space allocation
 * and communication between peers. Communication between the processes is done using (very fast in-memory) Unix sockets.
 * This IPC implementation allows different processes on a single machine to access the same database simultaniously without
 * them having to explicitly configure their IPC settings.
 * Currently can be used by passing `ipc: 'socket'` in AceBase's `storage` settings, will become the default soon.
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