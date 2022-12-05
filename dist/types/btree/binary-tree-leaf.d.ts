import { BinaryBPlusTreeLeafEntry } from './binary-tree-leaf-entry';
import { BinaryBPlusTreeNodeInfo } from './binary-tree-node-info';
import { NodeEntryKeyType } from './entry-key-type';
export declare class BinaryBPlusTreeLeaf extends BinaryBPlusTreeNodeInfo {
    static get prevLeafPtrIndex(): number;
    static get nextLeafPtrIndex(): number;
    static getPrevLeafOffset(leafIndex: number, prevLeafIndex: number): number;
    static getNextLeafOffset(leafIndex: number, nextLeafIndex: number): number;
    prevLeafOffset: number;
    nextLeafOffset: number;
    extData: {
        length: number;
        freeBytes: number;
        loaded: boolean;
        load(): Promise<void>;
    };
    entries: BinaryBPlusTreeLeafEntry[];
    constructor(nodeInfo: Partial<BinaryBPlusTreeNodeInfo>);
    /**
     * only present if there is a previous leaf. Make sure to use ONLY while the tree is locked
     */
    getPrevious?: () => Promise<BinaryBPlusTreeLeaf>;
    /**
      * only present if there is a next leaf. Make sure to use ONLY while the tree is locked
      */
    getNext?: (repairMode?: boolean) => Promise<BinaryBPlusTreeLeaf>;
    get hasPrevious(): boolean;
    get hasNext(): boolean;
    get prevLeafIndex(): number;
    set prevLeafIndex(newIndex: number);
    get nextLeafIndex(): number;
    set nextLeafIndex(newIndex: number);
    findEntryIndex(key: NodeEntryKeyType): number;
    findEntry(key: NodeEntryKeyType): BinaryBPlusTreeLeafEntry;
}
//# sourceMappingURL=binary-tree-leaf.d.ts.map