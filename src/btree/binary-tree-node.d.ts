import { BinaryBPlusTreeNodeEntry } from './binary-tree-node-entry';
import { BinaryBPlusTreeNodeInfo } from './binary-tree-node-info';
export declare class BinaryBPlusTreeNode extends BinaryBPlusTreeNodeInfo {
    entries: BinaryBPlusTreeNodeEntry[];
    gtChildOffset: number;
    /**
     * Added during port to TS
     */
    gtChildIndex: number;
    constructor(nodeInfo: Partial<BinaryBPlusTreeNodeInfo>);
    getGtChild(): Promise<BinaryBPlusTreeNodeInfo>;
}
//# sourceMappingURL=binary-tree-node.d.ts.map