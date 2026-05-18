import { NodeValueType } from '../../node-value-types.js';
import { BinaryNodeAddress } from './node-address.js';
import { NodeAllocation } from './node-allocation.js';

export class RecordInfo {
    lastChunkSize = -1;
    fileIndex = -1;
    timestamp = -1;

    constructor(
        public path: string,
        public hasKeyIndex: boolean,
        public valueType: NodeValueType,
        public allocation: NodeAllocation,
        public headerLength: number,
        public lastRecordLength: number,
        public bytesPerRecord: number,
        public startData?: Uint8Array,
    ) { }

    get totalByteLength() {
        if (this.allocation.ranges.length === 1 && this.allocation.ranges[0].length === 1) {
            // Only 1 record used for storage
            return this.lastRecordLength;
        }

        const byteLength = (((this.allocation.totalAddresses-1) * this.bytesPerRecord) + this.lastRecordLength) - this.headerLength;
        return byteLength;
    }

    get address() {
        const firstRange = this.allocation.ranges[0];
        return new BinaryNodeAddress(this.path, firstRange.pageNr, firstRange.recordNr);
    }
}
