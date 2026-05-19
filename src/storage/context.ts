import type { LoggerPlugin } from 'acebase-core';
import type { Storage } from './index.js';
import type { DataIndex } from '../data-index/index.js';
import type { AceBaseIPCPeer } from '../ipc/ipc.js';

export interface IndexesContext {
    storage: Storage,
    logger: LoggerPlugin,
    ipc: AceBaseIPCPeer,
    indexes: DataIndex[],
}
