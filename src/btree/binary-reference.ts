import { BPlusTreeLeaf } from './tree-leaf';
import { BPlusTreeNode } from './tree-node';

export type BinaryReference = {
    name: string;
    target: BPlusTreeNode | BPlusTreeLeaf;
    index: number;
}
