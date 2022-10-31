/// <reference types="node" />
import { BinaryBPlusTree } from './binary-tree';
import { BinaryBPlusTreeNode } from './binary-tree-node';
import { BinaryBPlusTreeNodeEntry } from './binary-tree-node-entry';
export declare class BinaryBPlusTreeNodeInfo {
    tree?: BinaryBPlusTree;
    parentNode?: BinaryBPlusTreeNode;
    parentEntry?: BinaryBPlusTreeNodeEntry;
    /**
     * whether this is a leaf or node
     */
    isLeaf: boolean;
    /**
     * whether this leaf has some external data
     */
    hasExtData: boolean;
    /**
     * data bytes, excluding header & free bytes
     */
    bytes: Buffer | number[];
    /**
     * index relative to the start of data bytes
     */
    dataIndex: number;
    /**
     * start index of the node/leaf
     */
    sourceIndex: number;
    /**
     * total byte length of the node, including header & free bytes
     */
    length: number;
    /**
     * number of free bytes at the end of the data
     */
    free: number;
    constructor(info: Partial<BinaryBPlusTreeNodeInfo>);
    get index(): number;
    set index(value: number);
}
//# sourceMappingURL=binary-tree-node-info.d.ts.map