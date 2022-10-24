import { BPlusTreeNode } from './tree-node';
import { BPlusTreeLeaf } from './tree-leaf';
import { NodeEntryKeyType } from './entry-key-type';
export declare class BPlusTreeNodeEntry {
    node: BPlusTreeNode;
    key: NodeEntryKeyType;
    ltChild: BPlusTreeNode | BPlusTreeLeaf;
    constructor(node: BPlusTreeNode, key: NodeEntryKeyType);
}
//# sourceMappingURL=tree-node-entry.d.ts.map