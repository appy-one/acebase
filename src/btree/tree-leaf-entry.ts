import { NodeEntryKeyType } from './entry-key-type';
import { BPlusTreeLeaf } from './tree-leaf';
import { BPlusTreeLeafEntryValue } from './tree-leaf-entry-value';

export class BPlusTreeLeafEntry {
    values: BPlusTreeLeafEntryValue[];

    constructor(public leaf: BPlusTreeLeaf, public key: NodeEntryKeyType, value?: BPlusTreeLeafEntryValue) {
        if (typeof value !== 'undefined' && !(value instanceof BPlusTreeLeafEntryValue)) {
            throw new Error('value must be an instance of BPlusTreeLeafEntryValue');
        }
        this.values = typeof value === 'undefined' ? [] : [value];
    }
}
