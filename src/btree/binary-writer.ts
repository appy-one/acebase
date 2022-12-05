import type { WriteStream } from 'fs';
import { Uint8ArrayBuilder, writeByteLength, writeSignedNumber, BufferLike } from '../binary';
import { BinaryBPlusTreeBuilder } from './binary-tree-builder';
import { Utils } from 'acebase-core';
import { NodeEntryKeyType } from './entry-key-type';
import { assert } from '../assert';
const { numberToBytes, bytesToNumber } = Utils;

type WriteStreamLike = Pick<WriteStream, 'write' | 'end' | 'once' | 'bytesWritten'>;
type WriteFunction = (data: Uint8Array, position: number) => Promise<void>;

export class BinaryWriter {

    private _stream: WriteStreamLike;
    private _write: WriteFunction;
    private _written: number;

    constructor(stream: WriteStreamLike, writeFn: WriteFunction) {
        this._stream = stream;
        this._write = writeFn;
        this._written = 0;
    }

    static forArray(bytes: number[]) {
        let bytesWritten = 0;
        const stream = {
            get bytesWritten() {
                return bytesWritten;
            },
            write(data: Uint8Array) {
                for (let i = 0; i < data.byteLength; i++) {
                    bytes.push(data[i]);
                }
                bytesWritten += data.byteLength;
                return true; // let caller know its ok to continue writing
            },
            end(callback: () => unknown) {
                callback();
                return this;
            },
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            once(event: string, callback: (...args: any[]) => void) {
                if (event === 'drain') { callback(); }
                return this;
            },
        };
        const writer = new BinaryWriter(stream, async (data, position) => {
            for(let i = bytes.length; i < position; i++) {
                bytes[i] = 0; // prevent "undefined" bytes when writing to a position greater than current array length
            }
            for(let i = 0; i < data.byteLength; i++) {
                bytes[position + i] = data[i];
            }
        });
        return writer;
    }

    static forUint8ArrayBuilder(builder: Uint8ArrayBuilder) {
        let bytesWritten = 0;
        const stream = {
            get bytesWritten() {
                return bytesWritten;
            },
            write(data: Uint8Array) {
                builder.append(data);
                bytesWritten += data.byteLength;
                return true; // let caller know its ok to continue writing
            },
            end(callback: () => unknown) {
                callback();
                return this;
            },
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            once(event: string, callback: (...args: any[]) => void) {
                if (event === 'drain') { callback(); }
                return this;
            },
        };
        const writer = new BinaryWriter(stream, async (data, position) => {
            builder.write(data, position);
        });
        return writer;
    }

    static forFunction(writeFn: WriteFunction) {
        const maxSimultaniousWrites = 50;
        let currentPosition = 0;
        let bytesWritten = 0;
        let pendingWrites = 0;
        const drainCallbacks: Array<() => unknown> = [];
        let endCallback: () => unknown = null;
        let ended = false;

        const stream = {
            get bytesWritten() {
                return bytesWritten;
            },
            write(data: Uint8Array) {
                assert(!ended, 'streaming was ended already!');
                if (pendingWrites === maxSimultaniousWrites) {
                    console.warn('Warning: you should wait for "drain" event before writing new data!');
                }
                // assert(_pendingWrites < _maxSimultaniousWrites, 'Wait for "drain" event before writing new data!');
                pendingWrites++;
                const success = () => {
                    bytesWritten += data.byteLength;
                    pendingWrites--;
                    if (ended && pendingWrites === 0) {
                        endCallback();
                    }
                    const drainCallback = drainCallbacks.shift();
                    drainCallback && drainCallback();
                };
                const fail = (err: Error) => {
                    console.error(`Failed to write to stream: ${err.message}`);
                    success();
                };

                writeFn(data, currentPosition)
                    .then(success)
                    .catch(fail);

                currentPosition += data.byteLength;
                const ok = pendingWrites < maxSimultaniousWrites;
                return ok; // let caller know if its ok to continue writing
            },
            end(callback: () => unknown) {
                if (ended) { throw new Error('end can only be called once'); }
                ended = true;
                endCallback = callback;
                if (pendingWrites === 0) {
                    callback();
                }
                return this;
            },
            once(event: string, callback: (...args: any[]) => void) {
                assert(event === 'drain', 'Custom stream can only handle "drain" event');
                drainCallbacks.push(callback);
                return this;
            },
        };
        const writer = new BinaryWriter(stream, (data, position) => {
            return writeFn(data, position);
        });
        return writer;
    }

    get length() { return this._written; }
    get queued() { return this._written - this._stream.bytesWritten; }

    append(data: number[] | Uint8Array | Buffer) {
        const buffer = data instanceof Array
            ? Uint8Array.from(data)
            : data;
        return new Promise<void>(resolve => {
            const ok = this._stream.write(buffer);
            this._written += buffer.byteLength;
            if (!ok) {
                this._stream.once('drain', resolve);
            }
            else {
                resolve();
            }
        });
    }

    write(data: number[] | Uint8Array | Buffer, position: number) {
        const buffer = data instanceof Array
            ? Uint8Array.from(data)
            : data;
        return this._write(buffer, position);
    }

    end() {
        return new Promise(resolve => {
            this._stream.end(resolve);
            // writer.stream.on('finish', resolve);
        });
    }

    static getBytes(value: NodeEntryKeyType) {
        return BinaryBPlusTreeBuilder.getKeyBytes(value);
    }
    static numberToBytes(number: number) {
        return numberToBytes(number);
    }
    static bytesToNumber(bytes: number[]) {
        return bytesToNumber(bytes);
    }
    static writeUint32<T extends BufferLike>(number: number, bytes: T, index: number): T {
        return writeByteLength(bytes, index, number);
    }
    static writeInt32<T extends BufferLike>(signedNumber: number, bytes: T, index: number): T {
        return writeSignedNumber(bytes, index, signedNumber);
    }
}
