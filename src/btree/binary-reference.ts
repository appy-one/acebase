import { BPlusTreeLeaf } from './tree-leaf.js';
import { BPlusTreeNode } from './tree-node.js';

export type BinaryReference = {
    name: string;
    target: BPlusTreeNode | BPlusTreeLeaf;
    index: number;
}
