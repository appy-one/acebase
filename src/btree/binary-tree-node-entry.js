"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BinaryBPlusTreeNodeEntry = void 0;
const detailed_error_1 = require("../detailed-error");
class BinaryBPlusTreeNodeEntry {
    constructor(key) {
        this.key = key;
        this.ltChildOffset = null;
    }
    async getLtChild() {
        throw new detailed_error_1.DetailedError('method not overridden', 'getLtChild must be overridden');
    }
}
exports.BinaryBPlusTreeNodeEntry = BinaryBPlusTreeNodeEntry;
//# sourceMappingURL=binary-tree-node-entry.js.map