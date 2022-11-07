import { BinaryBPlusTree } from './binary-tree';
import { BinaryBPlusTreeNode } from './binary-tree-node';
import { BinaryBPlusTreeNodeEntry } from './binary-tree-node-entry';

export class BinaryBPlusTreeNodeInfo {
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

    // /**
    //  * @deprecated use sourceIndex instead
    //  */
    // index?: number;

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

    constructor(info: Partial<BinaryBPlusTreeNodeInfo>) { //  & Required<Pick<BinaryBPlusTreeNodeInfo, 'tree' | 'isLeaf' | 'bytes' | 'length' | 'free'>>
        this.tree = info.tree;
        this.isLeaf = info.isLeaf;
        this.hasExtData = info.hasExtData || false;
        this.bytes = info.bytes;
        if (typeof info.sourceIndex === 'undefined') {
            info.sourceIndex = info.index;
        }
        this.sourceIndex = info.sourceIndex;
        if (typeof info.dataIndex === 'undefined') {
            info.dataIndex = this.sourceIndex + 9; // node/leaf header is 9 bytes
        }
        this.dataIndex = info.dataIndex;
        this.length = info.length;
        this.free = info.free;
        this.parentNode = info.parentNode;
        this.parentEntry = info.parentEntry;
    }

    get index() {
        return this.sourceIndex;
    }

    set index(value) {
        this.sourceIndex = value;
    }
}
