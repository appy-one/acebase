import { BPlusTreeNode } from './tree-node';
import { BPlusTreeLeaf } from './tree-leaf';
import { NodeEntryKeyType } from './entry-key-type';

export class BPlusTreeNodeEntry {
    ltChild: BPlusTreeNode | BPlusTreeLeaf = null;

    constructor(public node: BPlusTreeNode, public key: NodeEntryKeyType) {
    }
}
