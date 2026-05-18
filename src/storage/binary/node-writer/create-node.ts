import { ColorStyle } from 'acebase-core';
import { IAceBaseIPCLock } from '../../../ipc/ipc.js';
import { NodeAllocation } from '../node-allocation.js';
import { BinaryNodeInfo } from '../node-info.js';
import { NodeReader } from '../node-reader.js';
import { AceBaseStorage } from '../binary-storage.js';
import { _writeNode } from './write-node.js';

/**
 * Creates or overwrites a node
 */
export async function _createNode(storage: AceBaseStorage, nodeInfo: BinaryNodeInfo, newValue: any, lock: IAceBaseIPCLock, invalidateCache = true) {
    storage.logger.info(`Node "/${nodeInfo.path}" is being ${nodeInfo.exists ? 'overwritten' : 'created'}`.colorize(ColorStyle.cyan));

    let currentAllocation: NodeAllocation = null;
    if (nodeInfo.exists && nodeInfo.address) {
        // Current value occupies 1 or more records we can probably reuse.
        // For now, we'll allocate new records though, then free the old allocation
        const nodeReader = new NodeReader(storage, nodeInfo.address, lock, false); //Node.getReader(storage, nodeInfo.address, lock);
        currentAllocation = await nodeReader.getAllocation(true);
    }

    if (invalidateCache) {
        storage.invalidateCache(false, nodeInfo.path, nodeInfo.exists, 'createNode'); // remove cache
    }
    const recordInfo = await _writeNode(storage, nodeInfo.path, newValue, lock);
    return { recordMoved: true, recordInfo, deallocate: currentAllocation };
}
