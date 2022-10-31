import { BPlusTreeNodeEntry } from './tree-node-entry';
import { BPlusTreeLeaf } from './tree-leaf';
import { BPlusTree } from './tree';
import { NodeEntryKeyType } from './entry-key-type';
import { BinaryWriter } from './binary-writer';
import { BinaryPointer } from './binary-pointer';
import { BinaryReference } from './binary-reference';
export declare class BPlusTreeNode {
    tree: BPlusTree;
    parent: BPlusTreeNode;
    entries: BPlusTreeNodeEntry[];
    gtChild: BPlusTreeNode | BPlusTreeLeaf;
    constructor(tree: BPlusTree, parent: BPlusTreeNode);
    toString(): string;
    insertKey(newKey: NodeEntryKeyType, fromLeaf: BPlusTreeLeaf, newLeaf: BPlusTreeLeaf): void;
    private _checkSize;
    toBinary(keepFreeSpace: boolean, writer: BinaryWriter): Promise<{
        references: BinaryReference[];
        pointers: BinaryPointer[];
    }>;
    static resolveBinaryReferences(writer: BinaryWriter, references: BinaryReference[], pointers: BinaryPointer[]): Promise<void>;
}
//# sourceMappingURL=tree-node.d.ts.map