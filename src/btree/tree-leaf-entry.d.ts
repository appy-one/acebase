import { NodeEntryKeyType } from './entry-key-type';
import { BPlusTreeLeaf } from './tree-leaf';
import { BPlusTreeLeafEntryValue } from './tree-leaf-entry-value';
export declare class BPlusTreeLeafEntry {
    leaf: BPlusTreeLeaf;
    key: NodeEntryKeyType;
    values: BPlusTreeLeafEntryValue[];
    constructor(leaf: BPlusTreeLeaf, key: NodeEntryKeyType, value?: BPlusTreeLeafEntryValue);
}
//# sourceMappingURL=tree-leaf-entry.d.ts.map