import { DetailedError } from '../detailed-error';
import { BinaryBPlusTreeLeafEntry } from './binary-tree-leaf-entry';
import { BinaryBPlusTreeNodeInfo } from './binary-tree-node-info';
import { NodeEntryKeyType } from './entry-key-type';
import { _isEqual } from './typesafe-compare';

export class BinaryBPlusTreeLeaf extends BinaryBPlusTreeNodeInfo {

    static get prevLeafPtrIndex() { return 9; }
    static get nextLeafPtrIndex() { return 15; }

    static getPrevLeafOffset(leafIndex: number, prevLeafIndex: number) {
        return prevLeafIndex > 0
            ? prevLeafIndex - leafIndex - 9
            : 0;
    }

    static getNextLeafOffset(leafIndex: number, nextLeafIndex: number) {
        return nextLeafIndex > 0
            ? nextLeafIndex - leafIndex - 15
            : 0;
    }

    public prevLeafOffset = 0;
    public nextLeafOffset = 0;

    public extData = {
        length: 0,
        freeBytes: 0,
        loaded: false,
        async load(): Promise<void> {
            // Make sure all extData blocks are read. Needed when eg rebuilding
            throw new DetailedError('method-not-overridden', 'BinaryBPlusTreeLeaf.extData.load must be overriden');
        },
    };

    public entries: BinaryBPlusTreeLeafEntry[] = [];

    constructor(nodeInfo: Partial<BinaryBPlusTreeNodeInfo>) {
        console.assert(typeof nodeInfo.hasExtData === 'boolean', 'nodeInfo.hasExtData must be specified');
        super(nodeInfo);
    }

    /**
     * only present if there is a previous leaf. Make sure to use ONLY while the tree is locked
     */
    getPrevious?: () => Promise<BinaryBPlusTreeLeaf>;


    /**
      * only present if there is a next leaf. Make sure to use ONLY while the tree is locked
      */
    getNext?: () => Promise<BinaryBPlusTreeLeaf>;

    get hasPrevious() { return typeof this.getPrevious === 'function'; }
    get hasNext() { return typeof this.getNext === 'function'; }

    get prevLeafIndex() {
        return this.prevLeafOffset !== 0
            ? this.index + 9 + this.prevLeafOffset
            : 0;
    }
    set prevLeafIndex(newIndex) {
        this.prevLeafOffset = newIndex > 0
            ? newIndex - this.index  - 9
            : 0;
    }

    get nextLeafIndex() {
        return this.nextLeafOffset !== 0
            ? this.index + (this.tree.info.hasLargePtrs ? 15 : 13) + this.nextLeafOffset
            : 0;
    }
    set nextLeafIndex(newIndex) {
        this.nextLeafOffset = newIndex > 0
            ? newIndex - this.index - (this.tree.info.hasLargePtrs ? 15 : 13)
            : 0;
    }

    findEntryIndex(key: NodeEntryKeyType) {
        return this.entries.findIndex(entry => _isEqual(entry.key, key));
    }

    findEntry(key: NodeEntryKeyType) {
        return this.entries[this.findEntryIndex(key)];
    }
}
