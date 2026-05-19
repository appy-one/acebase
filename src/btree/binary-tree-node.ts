import { DetailedError } from '../detailed-error.js';
import { BinaryBPlusTreeNodeEntry } from './binary-tree-node-entry.js';
import { BinaryBPlusTreeNodeInfo } from './binary-tree-node-info.js';

export class BinaryBPlusTreeNode extends BinaryBPlusTreeNodeInfo {

    entries: BinaryBPlusTreeNodeEntry[] = [];

    gtChildOffset: number = null;

    /**
     * Added during port to TS
     */
    gtChildIndex: number;

    constructor(nodeInfo: Partial<BinaryBPlusTreeNodeInfo>) {
        super(nodeInfo);
    }

    async getGtChild(): Promise<BinaryBPlusTreeNodeInfo> {
        throw new DetailedError('method-not-overridden', 'getGtChild must be overridden');
    }
}
