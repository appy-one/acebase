"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BPlusTreeNodeEntry = void 0;
class BPlusTreeNodeEntry {
    constructor(node, key) {
        this.node = node;
        this.key = key;
        this.ltChild = null;
    }
}
exports.BPlusTreeNodeEntry = BPlusTreeNodeEntry;
//# sourceMappingURL=tree-node-entry.js.map