import { DetailedError } from '../detailed-error.js';
export class BinaryBPlusTreeNodeEntry {
    constructor(key) {
        this.key = key;
        this.ltChildOffset = null;
    }
    async getLtChild() {
        throw new DetailedError('method not overridden', 'getLtChild must be overridden');
    }
}
//# sourceMappingURL=binary-tree-node-entry.js.map