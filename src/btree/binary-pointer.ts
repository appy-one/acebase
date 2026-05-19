import { BPlusTreeLeaf } from './tree-leaf.js';

export type BinaryPointer = {
    name: string;
    leaf: BPlusTreeLeaf,
    index: number
}
