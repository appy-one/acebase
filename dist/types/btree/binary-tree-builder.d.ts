import { BinaryBPlusTreeLeafEntry } from './binary-tree-leaf-entry';
import { LeafEntryRecordPointer } from './leaf-entry-recordpointer';
import { LeafEntryMetaData } from './leaf-entry-metadata';
import { NodeEntryKeyType } from './entry-key-type';
export declare const KEY_TYPE: {
    UNDEFINED: number;
    STRING: number;
    NUMBER: number;
    BOOLEAN: number;
    DATE: number;
    BIGINT: number;
};
export declare const FLAGS: {
    UNIQUE_KEYS: number;
    HAS_METADATA: number;
    HAS_FREE_SPACE: number;
    HAS_FILL_FACTOR: number;
    HAS_SMALL_LEAFS: number;
    HAS_LARGE_PTRS: number;
    ENTRY_HAS_EXT_DATA: number;
    IS_LEAF: number;
    LEAF_HAS_EXT_DATA: number;
};
type CreateNodeInfo = {
    index: number;
    gtIndex: number;
    entries: {
        key: any;
        ltIndex: number;
    }[];
};
type CreateNodeOptions = {
    addFreeSpace: boolean;
    maxLength?: number;
    allowMissingChildIndexes?: boolean;
};
type CreateLeafInfo = {
    index: number;
    prevIndex: number;
    nextIndex: number | 'adjacent';
    entries: BinaryBPlusTreeLeafEntry[];
    extData?: {
        length: number;
        freeBytes?: number;
        rebuild?: boolean;
    };
};
type CreateLeafOptions = {
    addFreeSpace: boolean;
    maxLength?: number;
    addExtData?: (pointerIndex: number, data: Uint8Array) => {
        extIndex: number;
    };
};
export declare class BinaryBPlusTreeBuilder {
    uniqueKeys: boolean;
    maxEntriesPerNode: number;
    metadataKeys: string[];
    byteLength: number;
    freeBytes: number;
    smallLeafs: boolean;
    fillFactor: number;
    constructor(options?: Partial<BinaryBPlusTreeBuilder>);
    getHeader(): number[];
    createNode(info: CreateNodeInfo, options?: CreateNodeOptions): number[];
    createLeaf(info: CreateLeafInfo, options?: CreateLeafOptions): Uint8Array;
    getLeafEntryValueBytes(recordPointer: LeafEntryRecordPointer, metadata: LeafEntryMetaData): number[];
    static getKeyBytes(key: NodeEntryKeyType): number[];
}
export {};
//# sourceMappingURL=binary-tree-builder.d.ts.map