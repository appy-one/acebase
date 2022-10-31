import { BinaryReference } from './binary-reference';
import { BinaryWriter } from './binary-writer';
import { NodeEntryKeyType } from './entry-key-type';
import { LeafEntryMetaData } from './leaf-entry-metadata';
import { BPlusTree } from './tree';
import { BPlusTreeLeafEntry } from './tree-leaf-entry';
import { BPlusTreeNode } from './tree-node';
export declare class BPlusTreeLeaf {
    parent: BPlusTree | BPlusTreeNode;
    entries: BPlusTreeLeafEntry[];
    prevLeaf: BPlusTreeLeaf;
    nextLeaf: BPlusTreeLeaf;
    constructor(parent: BPlusTree | BPlusTreeNode);
    /**
     * The BPlusTree this leaf is in
     */
    get tree(): BPlusTree;
    /**
     * Adds an entry to this leaf
     * @param key
     * @param recordPointer data to store with the key, max size is 255
     * @param {object} [metadata] data to include, must contain all keys used in BPlusTree constructor
     * @returns {BPlusTreeLeafEntry} returns the added leaf entry
     */
    add(key: NodeEntryKeyType, recordPointer: number[] | Uint8Array | string, metadata?: LeafEntryMetaData): BPlusTreeLeafEntry;
    toString(): string;
    toBinary(keepFreeSpace: boolean, writer: BinaryWriter): Promise<{
        references: BinaryReference[];
    }>;
}
//# sourceMappingURL=tree-leaf.d.ts.map