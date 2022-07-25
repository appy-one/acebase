"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BinaryBPlusTreeNode = void 0;
const detailed_error_1 = require("../detailed-error");
const binary_tree_node_info_1 = require("./binary-tree-node-info");
class BinaryBPlusTreeNode extends binary_tree_node_info_1.BinaryBPlusTreeNodeInfo {
    constructor(nodeInfo) {
        super(nodeInfo);
        this.entries = [];
        this.gtChildOffset = null;
    }
    async getGtChild() {
        throw new detailed_error_1.DetailedError('method-not-overridden', 'getGtChild must be overridden');
    }
}
exports.BinaryBPlusTreeNode = BinaryBPlusTreeNode;
//# sourceMappingURL=binary-tree-node.js.map