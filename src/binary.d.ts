export declare class Uint8ArrayBuilder {
    private _data;
    private _length;
    private _bufferSize;
    constructor(bytes?: number[] | Uint8Array, bufferSize?: number);
    append(bytes: number[] | Uint8Array | Uint8ArrayBuilder): this;
    push(...bytes: number[]): this;
    static writeUint32(positiveNumber: number, target?: Uint8Array, index?: number): Uint8Array;
    reserve(length: number): void;
    get dataView(): DataView;
    write(data: Uint8Array, index: number): void;
    writeByte(byte: number, index?: number): void;
    writeUint16(positiveNumber: number, index?: number): void;
    writeUint32(positiveNumber: number, index?: number): void;
    writeUint32_old(positiveNumber: number, index?: number): this;
    writeInt32(signedNumber: number, index?: any): this;
    writeInt32_old(signedNumber: number, index?: any): this;
    writeInt48(signedNumber: any, index?: any): this;
    writeInt48_old(signedNumber: any, index?: any): this;
    get data(): Uint8Array;
    get length(): number;
    slice(begin: number, end?: number): Uint8Array;
    splice(index: number, remove?: number): Uint8Array;
}
