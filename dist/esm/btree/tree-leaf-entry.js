import { BPlusTreeLeafEntryValue } from './tree-leaf-entry-value.js';
export class BPlusTreeLeafEntry {
    constructor(leaf, key, value) {
        this.leaf = leaf;
        this.key = key;
        if (typeof value !== 'undefined' && !(value instanceof BPlusTreeLeafEntryValue)) {
            throw new Error('value must be an instance of BPlusTreeLeafEntryValue');
        }
        this.values = typeof value === 'undefined' ? [] : [value];
    }
}
//# sourceMappingURL=tree-leaf-entry.js.map