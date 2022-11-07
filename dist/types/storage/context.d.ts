import { DebugLogger } from 'acebase-core';
import { Storage } from '.';
import { DataIndex } from '../data-index';
import { AceBaseIPCPeer } from '../ipc/ipc';
export interface IndexesContext {
    storage: Storage;
    debug: DebugLogger;
    ipc: AceBaseIPCPeer;
    indexes: DataIndex[];
}
//# sourceMappingURL=context.d.ts.map