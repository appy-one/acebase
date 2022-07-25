"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BinaryBPlusTreeNodeInfo = void 0;
class BinaryBPlusTreeNodeInfo {
    constructor(info) {
        this.tree = info.tree;
        this.isLeaf = info.isLeaf;
        this.hasExtData = info.hasExtData || false;
        this.bytes = info.bytes;
        if (typeof info.sourceIndex === 'undefined') {
            info.sourceIndex = info.index;
        }
        this.sourceIndex = info.sourceIndex;
        if (typeof info.dataIndex === 'undefined') {
            info.dataIndex = this.sourceIndex + 9; // node/leaf header is 9 bytes
        }
        this.dataIndex = info.dataIndex;
        this.length = info.length;
        this.free = info.free;
        this.parentNode = info.parentNode;
        this.parentEntry = info.parentEntry;
    }
    get index() {
        return this.sourceIndex;
    }
    set index(value) {
        this.sourceIndex = value;
    }
}
exports.BinaryBPlusTreeNodeInfo = BinaryBPlusTreeNodeInfo;
//# sourceMappingURL=binary-tree-node-info.js.map