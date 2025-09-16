import type { LoggerPlugin } from 'acebase-core';
import type { Storage } from '.';
import type { DataIndex } from '../data-index';
import type { AceBaseIPCPeer } from '../ipc/ipc';

export interface IndexesContext {
    storage: Storage,
    logger: LoggerPlugin,
    ipc: AceBaseIPCPeer,
    indexes: DataIndex[],
}
