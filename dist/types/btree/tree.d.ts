/// <reference types="node" />
import { BinaryWriter } from './binary-writer';
import { NodeEntryKeyType, NodeEntryValueType } from './entry-key-type';
import { LeafEntryMetaData } from './leaf-entry-metadata';
import { BPlusTreeLeaf } from './tree-leaf';
import { BPlusTreeLeafEntryValue } from './tree-leaf-entry-value';
import { BPlusTreeNode } from './tree-node';
export declare class BPlusTree {
    maxEntriesPerNode: number;
    uniqueKeys: boolean;
    metadataKeys: string[];
    /**
     * Top tree node, or leaf if this is a single leaf tree
     */
    root: BPlusTreeLeaf | BPlusTreeNode;
    /**
     * Depth of the tree
     */
    depth: number;
    /**
     * Fill factor for the nodes and leafs as a percentage (max is 100)
     */
    fillFactor: number;
    /**
     * @param maxEntriesPerNode max number of entries per tree node. Working with this instead of m for max number of children, because that makes less sense imho
     * @param uniqueKeys whether the keys added must be unique
     * @param metadataKeys (optional) names of metadata keys that will be included in tree
     */
    constructor(maxEntriesPerNode: number, uniqueKeys: boolean, metadataKeys?: string[]);
    /**
     * Adds a key/value pair to the tree
     * @param key
     * @param value data to store with the key, max size is 255
     * @param metadata data to include, must contain all keys used in BPlusTree constructor
     * @returns {BPlusTree} returns reference to this tree
     */
    add(key: NodeEntryKeyType, value: number[] | Uint8Array, metadata?: LeafEntryMetaData): this;
    /**
     * Finds the relevant leaf for a key
     * @param key
     * @returns returns the leaf the key is in, or would be in when present
     */
    findLeaf(key: NodeEntryKeyType): BPlusTreeLeaf;
    find(key: NodeEntryKeyType): BPlusTreeLeafEntryValue | BPlusTreeLeafEntryValue[];
    search(op: string, val: NodeEntryValueType | NodeEntryValueType[]): {
        key: NodeEntryKeyType;
        value?: BPlusTreeLeafEntryValue;
        values?: BPlusTreeLeafEntryValue[];
    }[];
    /**
     * @returns {BPlusTreeLeaf} the first leaf in the tree
     */
    firstLeaf(): BPlusTreeLeaf;
    /**
     * @returns {BPlusTreeLeaf} the last leaf in the tree
     */
    lastLeaf(): BPlusTreeLeaf;
    all(): (string | number | bigint | boolean | Date)[];
    reverseAll(): (string | number | bigint | boolean | Date)[];
    static get debugBinary(): boolean;
    static addBinaryDebugString(str: string, byte: number): number | (string | number)[];
    static getKeyFromBinary(bytes: Buffer | number[], index: number): {
        key: string | number | bigint | boolean | Date;
        length: number;
        byteLength: number;
    };
    static getBinaryKeyData(key: NodeEntryKeyType): number[];
    toBinary(keepFreeSpace: boolean, writer: BinaryWriter): Promise<void>;
    static get typeSafeComparison(): {
        isMore(val1: unknown, val2: unknown): boolean;
        isMoreOrEqual(val1: unknown, val2: unknown): boolean;
        isLess(val1: unknown, val2: unknown): boolean;
        isLessOrEqual(val1: unknown, val2: unknown): boolean;
        isEqual(val1: unknown, val2: unknown): boolean;
        isNotEqual(val1: unknown, val2: unknown): boolean;
    };
}
//# sourceMappingURL=tree.d.ts.map