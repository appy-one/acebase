/// <reference types="node" />
/// <reference types="node" />
import type { WriteStream } from 'fs';
import { Uint8ArrayBuilder, BufferLike } from '../binary';
import { NodeEntryKeyType } from './entry-key-type';
type WriteStreamLike = Pick<WriteStream, 'write' | 'end' | 'once' | 'bytesWritten'>;
type WriteFunction = (data: Uint8Array, position: number) => Promise<void>;
export declare class BinaryWriter {
    private _stream;
    private _write;
    private _written;
    constructor(stream: WriteStreamLike, writeFn: WriteFunction);
    static forArray(bytes: number[]): BinaryWriter;
    static forUint8ArrayBuilder(builder: Uint8ArrayBuilder): BinaryWriter;
    static forFunction(writeFn: WriteFunction): BinaryWriter;
    get length(): number;
    get queued(): number;
    append(data: number[] | Uint8Array | Buffer): Promise<void>;
    write(data: number[] | Uint8Array | Buffer, position: number): Promise<void>;
    end(): Promise<unknown>;
    static getBytes(value: NodeEntryKeyType): number[];
    static numberToBytes(number: number): number[];
    static bytesToNumber(bytes: number[]): number;
    static writeUint32<T extends BufferLike>(number: number, bytes: T, index: number): T;
    static writeInt32<T extends BufferLike>(signedNumber: number, bytes: T, index: number): T;
}
export {};
//# sourceMappingURL=binary-writer.d.ts.map