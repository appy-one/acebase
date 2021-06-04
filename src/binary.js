"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Uint8ArrayBuilder = void 0;
function _writeByteLength(bytes, index, length) {
    bytes[index] = (length >> 24) & 0xff;
    bytes[index + 1] = (length >> 16) & 0xff;
    bytes[index + 2] = (length >> 8) & 0xff;
    bytes[index + 3] = length & 0xff;
    return bytes;
}
const _maxSignedNumber = Math.pow(2, 31) - 1;
function _writeSignedNumber(bytes, index, offset) {
    const negative = offset < 0;
    if (negative) {
        offset = -offset;
    }
    if (offset > _maxSignedNumber) {
        throw new Error(`reference offset to big to store in 31 bits`);
    }
    bytes[index] = ((offset >> 24) & 0x7f) | (negative ? 0x80 : 0);
    bytes[index + 1] = (offset >> 16) & 0xff;
    bytes[index + 2] = (offset >> 8) & 0xff;
    bytes[index + 3] = offset & 0xff;
    return bytes;
}
const _maxSignedOffset = Math.pow(2, 47) - 1;
// input: 2315765760
// expected output: [0, 0, 138, 7, 200, 0]
function _writeSignedOffset(bytes, index, offset, large = false) {
    if (!large) {
        // throw new Error('DEV: write large offsets only! (remove error later when successfully implemented)');
        return _writeSignedNumber(bytes, index, offset);
    }
    const negative = offset < 0;
    if (negative) {
        offset = -offset;
    }
    if (offset > _maxSignedOffset) {
        throw new Error(`reference offset to big to store in 47 bits`);
    }
    // Bitwise operations in javascript are 32 bits, so they cannot be used on larger numbers
    // Split the large number into 6 8-bit numbers by division instead
    let n = offset;
    for (let i = 0; i < 6; i++) {
        const b = n & 0xff;
        bytes[index + 5 - i] = b;
        n = n <= b ? 0 : (n - b) / 256;
    }
    if (negative) {
        bytes[index] |= 0x80;
    }
    return bytes;
}
class Uint8ArrayBuilder {
    // static get blockSize() { 
    //     return 4096; 
    // }
    constructor(bytes = null, bufferSize = 4096) {
        /** @type {Uint8Array} */
        this._data = new Uint8Array();
        this._length = 0;
        this._bufferSize = bufferSize;
        bytes && this.append(bytes);
    }
    // /**
    //  * grows the buffer
    //  * @param byteCount the amount of bytes
    //  */
    // reserve(byteCount: number) {
    //     const addBytes = Uint8ArrayBuilder.blockSize * Math.ceil(byteCount / Uint8ArrayBuilder.blockSize);
    //     const newLength = this._data.byteLength + addBytes;
    //     const newData = new Uint8Array(newLength);
    //     newData.set(this._data, 0);
    //     this._data = newData;
    // }
    append(bytes) {
        if (bytes instanceof Uint8ArrayBuilder) {
            bytes = bytes.data;
        }
        this.reserve(bytes.length);
        this._data.set(bytes, this._length);
        this._length += bytes.length;
        return this;
    }
    push(...bytes) {
        if (bytes.length === 0) {
            console.warn('WARNING: pushing 0 bytes to Uint8ArrayBuilder!');
        }
        return this.append(bytes);
    }
    static writeUint32(positiveNumber, target, index) {
        if (target) {
            new DataView(target).setUint32(index, positiveNumber, false);
        }
        else {
            const bytes = new Uint8Array(4);
            const view = new DataView(bytes);
            view.setUint32(index, positiveNumber);
            return bytes;
        }
    }
    reserve(length) {
        const freeBytes = this._data.byteLength - this._length;
        if (freeBytes < length) {
            // Won't fit
            const bytesShort = length - freeBytes;
            const addBytes = this._bufferSize * Math.ceil((bytesShort * 1.1) / this._bufferSize);
            const newLength = this._data.byteLength + addBytes;
            // this._data = new Uint8Array(this._data.buffer, 0, newLength);
            const newData = new Uint8Array(newLength);
            newData.set(this._data, 0);
            this._data = newData;
        }
    }
    get dataView() {
        return new DataView(this._data.buffer, this._data.byteOffset, this._data.byteLength);
    }
    write(data, index) {
        if (typeof index !== 'number') {
            throw new Error(`no index passed to write method`);
        }
        let grow = index + data.byteLength - this._length;
        if (grow > 0) {
            this.reserve(grow);
            this._length += grow;
        }
        this._data.set(data, index);
    }
    writeByte(byte, index) {
        if (typeof index !== 'number') {
            // Append
            this.reserve(1);
            index = this._length;
            this._length += 1;
        }
        this.dataView.setUint8(index, byte);
    }
    writeUint16(positiveNumber, index) {
        if (typeof index !== 'number') {
            // Append
            this.reserve(2);
            index = this._length;
            this._length += 2;
        }
        this.dataView.setUint16(index, positiveNumber, false); // Use big-endian, msb first
    }
    writeUint32(positiveNumber, index) {
        if (typeof index !== 'number') {
            // Append
            this.reserve(4);
            index = this._length;
            this._length += 4;
        }
        this.dataView.setUint32(index, positiveNumber, false); // Use big-endian, msb first
    }
    writeUint32_old(positiveNumber, index) {
        let bytes = _writeByteLength([], 0, positiveNumber);
        if (index >= 0) {
            this._data.set(bytes, index);
            return this;
        }
        return this.append(bytes);
    }
    writeInt32(signedNumber, index = undefined) {
        if (typeof index !== 'number') {
            // Append
            this.reserve(4);
            index = this._length;
            this._length += 4;
        }
        if (signedNumber > _maxSignedNumber || signedNumber < -_maxSignedNumber) {
            throw new Error(`number to big to store in uint32`);
        }
        let negative = signedNumber < 0;
        if (negative) {
            // Old method uses "signed magnitude" method for negative numbers
            // setInt32 uses 2's complement instead. So, for negative numbers we have 
            // to do something else to be backward compatible with old code
            let nr = -signedNumber; // Make positive
            let view = this.dataView;
            view.setInt8(index, ((nr >> 24) & 0x7f) | (negative ? 0x80 : 0));
            view.setInt8(index + 1, (nr >> 16) & 0xff);
            view.setInt8(index + 2, (nr >> 8) & 0xff);
            view.setInt8(index + 3, nr & 0xff);
        }
        else {
            this.dataView.setInt32(index, signedNumber, false); // Use big-endian, msb first
        }
        return this;
    }
    writeInt32_old(signedNumber, index = undefined) {
        let bytes = _writeSignedNumber([], 0, signedNumber);
        if (index >= 0) {
            this._data.set(bytes, index);
            return this;
        }
        return this.append(bytes);
    }
    writeInt48(signedNumber, index = undefined) {
        if (typeof index !== 'number') {
            // Append
            this.reserve(6);
            index = this._length;
            this._length += 6;
        }
        if (signedNumber > _maxSignedOffset || signedNumber < -_maxSignedOffset) {
            throw new Error(`number to big to store in int48`);
        }
        const negative = signedNumber < 0;
        // Write ourselves
        let n = negative ? -signedNumber : signedNumber;
        // let view = this.dataView;
        for (let i = 0; i < 6; i++) {
            let b = n & 0xff;
            if (negative && i === 5) {
                b |= 0x80;
            }
            this.data[index + 5 - i] = b; //view.setUint8(index + 5 - i, b);
            n = n <= b ? 0 : (n - b) / 256;
        }
        // else {
        //     // No way to write an Uint48 natively, so we'll write a BigInt64 and chop off 2 bytes
        //     let uint64 = new Uint8Array(8);
        //     new DataView(uint64.buffer).setBigUint64(0, signedNumber, false);
        //     this._data.set(uint64.slice(2), index);
        // }
        return this;
    }
    writeInt48_old(signedNumber, index = undefined) {
        let bytes = _writeSignedOffset([], 0, signedNumber, true);
        if (index >= 0) {
            this._data.set(bytes, index);
            return this;
        }
        return this.append(bytes);
    }
    get data() {
        return this._data.subarray(0, this._length);
    }
    get length() {
        return this._length;
    }
    slice(begin, end) {
        if (begin < 0) {
            return this._data.subarray(this._length + begin, this._length);
        }
        else {
            return this._data.subarray(begin, end || this._length);
        }
    }
    splice(index, remove) {
        if (typeof remove !== 'number') {
            remove = this.length - index;
        }
        let removed = this._data.slice(index, index + remove);
        if (index + remove >= this.length) {
            this._length = index;
        }
        else {
            this._data.copyWithin(index, index + remove, this._length);
            this._length -= remove;
        }
        return removed;
    }
}
exports.Uint8ArrayBuilder = Uint8ArrayBuilder;
//# sourceMappingURL=binary.js.map