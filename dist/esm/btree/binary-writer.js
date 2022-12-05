import { writeByteLength, writeSignedNumber } from '../binary.js';
import { BinaryBPlusTreeBuilder } from './binary-tree-builder.js';
import { Utils } from 'acebase-core';
import { assert } from '../assert.js';
const { numberToBytes, bytesToNumber } = Utils;
export class BinaryWriter {
    constructor(stream, writeFn) {
        this._stream = stream;
        this._write = writeFn;
        this._written = 0;
    }
    static forArray(bytes) {
        let bytesWritten = 0;
        const stream = {
            get bytesWritten() {
                return bytesWritten;
            },
            write(data) {
                for (let i = 0; i < data.byteLength; i++) {
                    bytes.push(data[i]);
                }
                bytesWritten += data.byteLength;
                return true; // let caller know its ok to continue writing
            },
            end(callback) {
                callback();
                return this;
            },
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            once(event, callback) {
                if (event === 'drain') {
                    callback();
                }
                return this;
            },
        };
        const writer = new BinaryWriter(stream, async (data, position) => {
            for (let i = bytes.length; i < position; i++) {
                bytes[i] = 0; // prevent "undefined" bytes when writing to a position greater than current array length
            }
            for (let i = 0; i < data.byteLength; i++) {
                bytes[position + i] = data[i];
            }
        });
        return writer;
    }
    static forUint8ArrayBuilder(builder) {
        let bytesWritten = 0;
        const stream = {
            get bytesWritten() {
                return bytesWritten;
            },
            write(data) {
                builder.append(data);
                bytesWritten += data.byteLength;
                return true; // let caller know its ok to continue writing
            },
            end(callback) {
                callback();
                return this;
            },
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            once(event, callback) {
                if (event === 'drain') {
                    callback();
                }
                return this;
            },
        };
        const writer = new BinaryWriter(stream, async (data, position) => {
            builder.write(data, position);
        });
        return writer;
    }
    static forFunction(writeFn) {
        const maxSimultaniousWrites = 50;
        let currentPosition = 0;
        let bytesWritten = 0;
        let pendingWrites = 0;
        const drainCallbacks = [];
        let endCallback = null;
        let ended = false;
        const stream = {
            get bytesWritten() {
                return bytesWritten;
            },
            write(data) {
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
                const fail = (err) => {
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
            end(callback) {
                if (ended) {
                    throw new Error('end can only be called once');
                }
                ended = true;
                endCallback = callback;
                if (pendingWrites === 0) {
                    callback();
                }
                return this;
            },
            once(event, callback) {
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
    append(data) {
        const buffer = data instanceof Array
            ? Uint8Array.from(data)
            : data;
        return new Promise(resolve => {
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
    write(data, position) {
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
    static getBytes(value) {
        return BinaryBPlusTreeBuilder.getKeyBytes(value);
    }
    static numberToBytes(number) {
        return numberToBytes(number);
    }
    static bytesToNumber(bytes) {
        return bytesToNumber(bytes);
    }
    static writeUint32(number, bytes, index) {
        return writeByteLength(bytes, index, number);
    }
    static writeInt32(signedNumber, bytes, index) {
        return writeSignedNumber(bytes, index, signedNumber);
    }
}
//# sourceMappingURL=binary-writer.js.map