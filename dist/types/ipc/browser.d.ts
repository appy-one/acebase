import { AceBaseIPCPeer, IMessage } from './ipc';
import { Storage } from '../storage';
import { NotSupported } from '../not-supported';
/**
 * Browser tabs IPC. Database changes and events will be synchronized automatically.
 * Locking of resources will be done by the election of a single locking master:
 * the one with the lowest id.
 */
export declare class IPCPeer extends AceBaseIPCPeer {
    private channel;
    constructor(storage: Storage);
    sendMessage(message: IMessage): void;
}
/**
 * Not supported in browser context
 */
export { NotSupported as RemoteIPCPeer, NotSupported as IPCSocketPeer, NotSupported as NetIPCServer, };
//# sourceMappingURL=browser.d.ts.map