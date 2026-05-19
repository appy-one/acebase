import { BinaryNodeAddress } from './node-address.js';

// TODO @appy-one consider converting to interface
export class SerializedKeyValue {
    key?: string;
    index?: number;
    type: number;
    bool?: boolean;
    ref?: any; // number | Array | Object;
    binary?: Uint8Array;
    record?: BinaryNodeAddress;
    bytes?: number[] | ArrayBuffer;

    constructor(info: SerializedKeyValue) {
        this.key = info.key;
        this.index = info.index;
        this.type = info.type;
        this.bool = info.bool;
        this.ref = info.ref;
        this.binary = info.binary;
        this.record = info.record; // TODO @appy-one RENAME to address
        this.bytes = info.bytes;
    }
}
