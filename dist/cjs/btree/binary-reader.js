"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BinaryReader = void 0;
const acebase_core_1 = require("acebase-core");
const binary_1 = require("../binary");
const detailed_error_1 = require("../detailed-error");
const promise_fs_1 = require("../promise-fs");
const assert_1 = require("../assert");
const tree_1 = require("./tree");
const { bytesToNumber } = acebase_core_1.Utils;
class BinaryReader {
    /**
     * BinaryReader is a helper class to make reading binary data easier and faster
     * @param file file name, file descriptor, or an open file, or read function that returns a promise
     * @param chunkSize how many bytes per read. default is 4KB
     */
    constructor(file, chunkSize = 4096) {
        this.chunkSize = chunkSize;
        this.data = null;
        /**
         * offset of loaded data (start index of current chunk in data source)
         */
        this.offset = 0;
        /**
         * current chunk reading index ("cursor" in currently loaded chunk)
         */
        this.index = 0;
        this.chunkSize = chunkSize;
        if (typeof file === 'function') {
            // Use the passed function for reads
            this.read = file;
        }
        else {
            let fd;
            if (typeof file === 'number') {
                // Use the passed file descriptor
                fd = file;
            }
            else if (typeof file === 'string') {
                // Read from passed file name
                // Override this.init to open the file first
                const init = this.init.bind(this);
                this.init = async () => {
                    fd = await promise_fs_1.pfs.open(file, 'r'); // Open file now
                    return init(); // Run original this.init
                };
                this.close = async () => {
                    return promise_fs_1.pfs.close(fd);
                };
            }
            else {
                throw new detailed_error_1.DetailedError('invalid-file-argument', 'invalid file argument');
            }
            this.read = async (index, length) => {
                const buffer = Buffer.alloc(length);
                const { bytesRead } = await promise_fs_1.pfs.read(fd, buffer, 0, length, index);
                if (bytesRead < length) {
                    return buffer.slice(0, bytesRead);
                }
                return buffer;
            };
        }
    }
    async init() {
        const chunk = await this.read(0, this.chunkSize);
        (0, assert_1.assert)(chunk instanceof Buffer, 'read function must return a Buffer');
        this.data = chunk;
        this.offset = 0;
        this.index = 0;
    }
    clone() {
        const clone = Object.assign(new BinaryReader(this.read, this.chunkSize), this);
        clone.offset = 0;
        clone.index = 0;
        clone.data = Buffer.alloc(0);
        return clone;
    }
    async get(byteCount) {
        await this.assert(byteCount);
        // const bytes = this.data.slice(this.index, this.index + byteCount);
        const slice = this.data.slice(this.index, this.index + byteCount); // Buffer.from(this.data.buffer, this.index, byteCount);
        if (slice.byteLength !== byteCount) {
            throw new detailed_error_1.DetailedError('invalid_byte_length', `Expected to read ${byteCount} bytes from tree, got ${slice.byteLength}`);
        }
        this.index += byteCount;
        return slice;
    }
    async getInt32() {
        const buffer = await this.get(4);
        return (0, binary_1.readSignedNumber)(buffer, 0);
    }
    async getUint32() {
        const buffer = await this.get(4);
        return (0, binary_1.readByteLength)(buffer, 0);
    }
    async getValue() {
        const header = await this.get(2);
        const length = header[1];
        await this.seek(-2);
        const buffer = await this.get(length + 2);
        return BinaryReader.readValue(buffer, 0).value;
        // // TODO: Refactor not to convert buffer to array and back to buffer
        // let b = await this.get(2);
        // let bytes = Array.from(b);
        // b = await this.get(bytes[1]);
        // _appendToArray(bytes, Array.from(b));
        // return BinaryReader.readValue(Buffer.from(bytes), 0).value;
    }
    async more(chunks = 1) {
        const length = chunks * this.chunkSize;
        const nextChunk = await this.read(this.offset + this.data.length, length);
        (0, assert_1.assert)(nextChunk instanceof Buffer, 'read function must return a Buffer');
        // Let go of old data before current index:
        this.data = this.data.slice(this.index);
        this.offset += this.index;
        this.index = 0;
        // Append new data
        const newData = Buffer.alloc(this.data.length + nextChunk.length);
        newData.set(this.data, 0);
        newData.set(nextChunk, this.data.length);
        this.data = newData;
    }
    async seek(offset) {
        if (this.index + offset < this.data.length) {
            this.index += offset;
        }
        else {
            const dataIndex = this.offset + this.index + offset;
            const newChunk = await this.read(dataIndex, this.chunkSize);
            this.data = newChunk;
            this.offset = dataIndex;
            this.index = 0;
        }
    }
    async assert(byteCount) {
        if (byteCount < 0) {
            throw new detailed_error_1.DetailedError('invalid_byte_count', `Cannot read ${byteCount} bytes from tree`);
        }
        if (this.index + byteCount > this.data.byteLength) {
            await this.more(Math.ceil(byteCount / this.chunkSize));
            if (this.index + byteCount > this.data.byteLength) {
                throw new detailed_error_1.DetailedError('EOF', 'end of file');
            }
        }
    }
    skip(byteCount) {
        this.index += byteCount;
    }
    rewind(byteCount) {
        this.index -= byteCount;
    }
    async go(index) {
        if (this.offset <= index && this.offset + this.data.byteLength > index) {
            this.index = index - this.offset;
        }
        else {
            const chunk = await this.read(index, this.chunkSize);
            this.data = chunk;
            this.offset = index;
            this.index = 0;
        }
    }
    savePosition(offsetCorrection = 0) {
        const savedIndex = this.offset + this.index + offsetCorrection;
        const go = (offset = 0) => {
            const index = savedIndex + offset;
            return this.go(index);
        };
        return {
            go,
            index: savedIndex,
        };
    }
    get sourceIndex() {
        return this.offset + this.index;
    }
    static readValue(buffer, index) {
        const arr = buffer; // Hack, getKeyFromBinary will work with a Buffer too
        const val = tree_1.BPlusTree.getKeyFromBinary(arr, index);
        return { value: val.key, byteLength: val.byteLength };
    }
    static bytesToNumber(buffer) {
        const arr = buffer; // Hack, bytesToNumber will work with a Buffer too
        return bytesToNumber(arr);
    }
    static readUint32(buffer, index) {
        return (0, binary_1.readSignedNumber)(buffer, index);
    }
    static readInt32(buffer, index) {
        return (0, binary_1.readByteLength)(buffer, index);
    }
}
exports.BinaryReader = BinaryReader;
//# sourceMappingURL=binary-reader.js.map