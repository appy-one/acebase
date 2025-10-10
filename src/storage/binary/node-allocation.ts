import { StorageAddressRange } from './binary-storage-address-range.js';

export class StorageAddress {
    constructor(public pageNr: number, public recordNr: number) { }
}
export class NodeChunkTable {
    constructor(public ranges: NodeChunkTableRange[]) { }
}
export class NodeChunkTableRange {
    constructor(public type: number, public pageNr: number, public recordNr: number, public length: number) { }
}

export class NodeAllocation {

    constructor(public ranges: StorageAddressRange[]) { }

    get addresses(): StorageAddress[] {
        const addresses = [] as StorageAddress[];
        for (const range of this.ranges) {
            for (let i = 0; i < range.length; i++) {
                const address = new StorageAddress(range.pageNr, range.recordNr + i);
                addresses.push(address);
            }
        }
        return addresses;
    }
    /**
     * Gets individual record addresses from current allocation
     * @param start index to start
     * @param end index to stop (does not include this record)
     */
    getAddresses(start: number, end: number) {
        const addresses = [] as StorageAddress[];
        let nr = 0;
        for (const range of this.ranges) {
            for (let i = 0; i < range.length && nr < end; i++, nr++) {
                if (nr >= start && nr < end) {
                    const address = new StorageAddress(range.pageNr, range.recordNr + i);
                    addresses.push(address);
                }
            }
            if (nr >= end) { break; }
        }
        return addresses;
    }

    get totalAddresses() {
        return this.ranges.map(range => range.length).reduce((total, nr) => total + nr, 0);
    }

    toChunkTable(): NodeChunkTable {
        const ranges = this.ranges.map(range => new NodeChunkTableRange(0, range.pageNr, range.recordNr, range.length));

        if (ranges.length === 1 && ranges[0].length === 1) {
            ranges[0].type = 0;  // No CT (Chunk Table)
        }
        else {
            ranges.forEach((range,index) => {
                if (index === 0) {
                    range.type = 1;     // 1st range CT record
                }
                else {
                    range.type = 2;     // CT record with pageNr, recordNr, length
                }
                // TODO: Implement type 3 (contigious pages)
            });
        }
        return new NodeChunkTable(ranges);
    }

    static fromAdresses(records: StorageAddress[]): NodeAllocation {
        if (records.length === 0) {
            throw new Error('Cannot create allocation for 0 addresses');
        }
        let range = new StorageAddressRange(records[0].pageNr, records[0].recordNr, 1);
        const ranges = [range];
        for(let i = 1; i < records.length; i++) {
            if (records[i].pageNr !== range.pageNr || records[i].recordNr !== range.recordNr + range.length) {
                range = new StorageAddressRange(records[i].pageNr, records[i].recordNr, 1);
                ranges.push(range);
            }
            else {
                range.length++;
            }
        }
        return new NodeAllocation(ranges);
    }

    toString() {
        // this.normalize();
        return this.ranges.map(range => {
            return `${range.pageNr},${range.recordNr}+${range.length-1}`;
        }).join('; ');
    }

    normalize() {
        // Appends ranges
        const total = this.totalAddresses;
        for(let i = 0; i < this.ranges.length; i++) {
            const range = this.ranges[i];
            let adjRange;
            for (let j = i + 1; j < this.ranges.length; j++) {
                const otherRange = this.ranges[j];
                if (otherRange.pageNr !== range.pageNr) { continue; }
                if (otherRange.recordNr === range.recordNr + range.length) {
                    // This range is right before the other range
                    otherRange.length += range.length;
                    otherRange.recordNr = range.recordNr;
                    adjRange = otherRange;
                    break;
                }
                if (range.recordNr === otherRange.recordNr + otherRange.length) {
                    // This range starts right after the other range
                    otherRange.length += range.length; //otherRange.end = range.end;
                    adjRange = otherRange;
                    break;
                }
            }
            if (adjRange) {
                // range has merged with adjacent one
                this.ranges.splice(i, 1);
                i--;
            }
        }
        console.assert(this.totalAddresses === total, 'the amount of addresses changed during normalization');
    }
}
