import { DetailedError } from '../detailed-error';
import { BinaryBPlusTreeNodeInfo } from './binary-tree-node-info';
import { NodeEntryKeyType } from './entry-key-type';

export class BinaryBPlusTreeNodeEntry {
    ltChildOffset: number = null;

    /**
     * Added during port to TS
     */
    ltChildIndex: number;

    constructor(public key: NodeEntryKeyType) {
    }

    async getLtChild(): Promise<BinaryBPlusTreeNodeInfo> {
        throw new DetailedError('method not overridden', 'getLtChild must be overridden');
    }
}
