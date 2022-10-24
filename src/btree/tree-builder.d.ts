import { NodeEntryKeyType, NodeEntryValueType } from './entry-key-type';
import { LeafEntryMetaData } from './leaf-entry-metadata';
import { LeafEntryRecordPointer } from './leaf-entry-recordpointer';
import { BPlusTree } from './tree';
import { BPlusTreeLeafEntryValue } from './tree-leaf-entry-value';
export declare class BPlusTreeBuilder {
    uniqueKeys: boolean;
    fillFactor: number;
    metadataKeys: string[];
    list: Map<NodeEntryKeyType, BPlusTreeLeafEntryValue | BPlusTreeLeafEntryValue[]>;
    indexedValues: number;
    /**
     * @param {boolean} uniqueKeys
     * @param {number} [fillFactor=100]
     * @param {string[]} [metadataKeys=[]]
     */
    constructor(uniqueKeys: boolean, fillFactor?: number, metadataKeys?: string[]);
    add(key: NodeEntryValueType, recordPointer: LeafEntryRecordPointer, metadata?: LeafEntryMetaData): void;
    /**
     * @param key
     * @param recordPointer specific recordPointer to remove. If the tree has unique keys, this can be omitted
     */
    remove(key: NodeEntryValueType, recordPointer?: LeafEntryRecordPointer): void;
    create(maxEntries?: number): BPlusTree;
    dumpToFile(filename: string): void;
    static fromFile(filename: string): BPlusTreeBuilder;
}
//# sourceMappingURL=tree-builder.d.ts.map