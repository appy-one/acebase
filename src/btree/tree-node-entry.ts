import { BPlusTreeNode } from './tree-node.js';
import { BPlusTreeLeaf } from './tree-leaf.js';
import { NodeEntryKeyType } from './entry-key-type.js';

export class BPlusTreeNodeEntry {
    ltChild: BPlusTreeNode | BPlusTreeLeaf = null;

    constructor(public node: BPlusTreeNode, public key: NodeEntryKeyType) {
    }
}
