import { BinaryBPlusTreeNodeInfo } from './binary-tree-node-info';
import { NodeEntryKeyType } from './entry-key-type';
export declare class BinaryBPlusTreeNodeEntry {
    key: NodeEntryKeyType;
    ltChildOffset: number;
    /**
     * Added during port to TS
     */
    ltChildIndex: number;
    constructor(key: NodeEntryKeyType);
    getLtChild(): Promise<BinaryBPlusTreeNodeInfo>;
}
//# sourceMappingURL=binary-tree-node-entry.d.ts.map