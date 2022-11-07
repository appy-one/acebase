"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BPlusTreeLeafEntry = void 0;
const tree_leaf_entry_value_1 = require("./tree-leaf-entry-value");
class BPlusTreeLeafEntry {
    constructor(leaf, key, value) {
        this.leaf = leaf;
        this.key = key;
        if (typeof value !== 'undefined' && !(value instanceof tree_leaf_entry_value_1.BPlusTreeLeafEntryValue)) {
            throw new Error('value must be an instance of BPlusTreeLeafEntryValue');
        }
        this.values = typeof value === 'undefined' ? [] : [value];
    }
}
exports.BPlusTreeLeafEntry = BPlusTreeLeafEntry;
//# sourceMappingURL=tree-leaf-entry.js.map