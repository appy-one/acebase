/// <reference types="node" />
export type BufferLike = number[] | Uint8Array | Buffer;
export declare function writeByteLength<T extends BufferLike>(bytes: T, index: number, length: number): T;
export declare function readByteLength(bytes: BufferLike, index: number): number;
export declare function writeSignedNumber<T extends BufferLike>(bytes: T, index: number, offset: number): T;
export declare function readSignedNumber(bytes: BufferLike, index: number): number;
export declare function writeSignedOffset<T extends BufferLike>(bytes: T, index: number, offset: number, large?: boolean): T;
export declare function readSignedOffset(bytes: BufferLike, index: number, large?: boolean): number;
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
    writeInt32(signedNumber: number, index?: number): this;
    writeInt32_old(signedNumber: number, index?: number): this;
    writeInt48(signedNumber: number, index?: number): this;
    writeInt48_old(signedNumber: number, index?: number): this;
    get data(): Uint8Array;
    get length(): number;
    slice(begin: number, end?: number): Uint8Array;
    splice(index: number, remove?: number): Uint8Array;
}
//# sourceMappingURL=binary.d.ts.map