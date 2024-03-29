import { BPlusTreeLeaf } from './tree-leaf';

export type BinaryPointer = {
    name: string;
    leaf: BPlusTreeLeaf,
    index: number
}
