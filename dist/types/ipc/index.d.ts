import { AceBaseIPCPeer, IMessage } from './ipc';
import { Storage } from '../storage';
export { RemoteIPCPeer, RemoteIPCServerConfig } from './remote';
export { IPCSocketPeer, NetIPCServer } from './socket';
/**
 * Node cluster functionality - enables vertical scaling with forked processes. AceBase will enable IPC at startup, so
 * any forked process will communicate database changes and events automatically. Locking of resources will be done by
 * the cluster's primary (previously master) process. NOTE: if the master process dies, all peers stop working
 */
export declare class IPCPeer extends AceBaseIPCPeer {
    constructor(storage: Storage, dbname: string);
    sendMessage(msg: IMessage): void;
    exit(code?: number): Promise<void>;
}
//# sourceMappingURL=index.d.ts.map