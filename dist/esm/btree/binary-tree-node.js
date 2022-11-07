import { DetailedError } from '../detailed-error.js';
import { BinaryBPlusTreeNodeInfo } from './binary-tree-node-info.js';
export class BinaryBPlusTreeNode extends BinaryBPlusTreeNodeInfo {
    constructor(nodeInfo) {
        super(nodeInfo);
        this.entries = [];
        this.gtChildOffset = null;
    }
    async getGtChild() {
        throw new DetailedError('method-not-overridden', 'getGtChild must be overridden');
    }
}
//# sourceMappingURL=binary-tree-node.js.map