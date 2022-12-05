"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BinaryBPlusTreeBuilder = exports.FLAGS = exports.KEY_TYPE = void 0;
const binary_1 = require("../binary");
const detailed_error_1 = require("../detailed-error");
const config_1 = require("./config");
const tree_1 = require("./tree");
const acebase_core_1 = require("acebase-core");
const assert_1 = require("../assert");
const { bigintToBytes, encodeString, numberToBytes } = acebase_core_1.Utils;
exports.KEY_TYPE = {
    UNDEFINED: 0,
    STRING: 1,
    NUMBER: 2,
    BOOLEAN: 3,
    DATE: 4,
    BIGINT: 5,
};
exports.FLAGS = {
    UNIQUE_KEYS: 1,
    HAS_METADATA: 2,
    HAS_FREE_SPACE: 4,
    HAS_FILL_FACTOR: 8,
    HAS_SMALL_LEAFS: 16,
    HAS_LARGE_PTRS: 32,
    ENTRY_HAS_EXT_DATA: 128,
    IS_LEAF: 1,
    LEAF_HAS_EXT_DATA: 2,
};
class BinaryBPlusTreeBuilder {
    constructor(options = { uniqueKeys: true, smallLeafs: config_1.WRITE_SMALL_LEAFS, maxEntriesPerNode: 3, fillFactor: 95, metadataKeys: [], byteLength: 0, freeBytes: 0 }) {
        this.uniqueKeys = options.uniqueKeys;
        this.maxEntriesPerNode = options.maxEntriesPerNode;
        this.metadataKeys = options.metadataKeys;
        this.byteLength = options.byteLength;
        this.freeBytes = options.freeBytes;
        this.smallLeafs = options.smallLeafs;
        this.fillFactor = options.fillFactor;
    }
    getHeader() {
        const indexTypeFlags = (this.uniqueKeys ? exports.FLAGS.UNIQUE_KEYS : 0)
            | (this.metadataKeys.length > 0 ? exports.FLAGS.HAS_METADATA : 0)
            | (this.freeBytes > 0 ? exports.FLAGS.HAS_FREE_SPACE : 0)
            | (typeof this.fillFactor === 'number' && this.fillFactor > 0 && this.fillFactor <= 100 ? exports.FLAGS.HAS_FILL_FACTOR : 0)
            | (this.smallLeafs === true ? exports.FLAGS.HAS_SMALL_LEAFS : 0)
            | exports.FLAGS.HAS_LARGE_PTRS;
        const bytes = [
            // byte_length:
            0, 0, 0, 0,
            // index_type:
            indexTypeFlags,
            // max_node_entries:
            this.maxEntriesPerNode,
        ];
        // update byte_length:
        (0, binary_1.writeByteLength)(bytes, 0, this.byteLength);
        if (this.fillFactor > 0 && this.fillFactor <= 100) {
            // fill_factor:
            bytes.push(this.fillFactor);
        }
        if (this.freeBytes > 0) {
            // free_byte_length:
            (0, binary_1.writeByteLength)(bytes, bytes.length, this.freeBytes);
        }
        if (this.metadataKeys.length > 0) {
            // metadata_keys:
            const index = bytes.length;
            bytes.push(0, 0, 0, 0); // metadata_length
            // metadata_key_count:
            bytes.push(this.metadataKeys.length);
            this.metadataKeys.forEach(key => {
                // metadata_key:
                bytes.push(key.length); // metadata_key_length
                // metadata_key_name:
                for (let i = 0; i < key.length; i++) {
                    bytes.push(key.charCodeAt(i));
                }
            });
            // update metadata_length:
            const length = bytes.length - index - 4;
            (0, binary_1.writeByteLength)(bytes, index, length);
        }
        return bytes;
    }
    createNode(info, options = { addFreeSpace: true, maxLength: 0 }) {
        (0, assert_1.assert)(info.entries.length > 0, 'node has no entries!');
        const bytes = [
            // byte_length:
            0, 0, 0, 0,
            0,
            // free_byte_length:
            0, 0, 0, 0,
        ];
        // entries_length:
        bytes.push(info.entries.length);
        // entries:
        info.entries.forEach(entry => {
            const keyBytes = BinaryBPlusTreeBuilder.getKeyBytes(entry.key);
            bytes.push(...keyBytes);
            // lt_child_ptr: recalculate offset
            (0, assert_1.assert)(entry.ltIndex >= 0, `node entry "${entry.key}" has ltIndex < 0: ${entry.ltIndex}`);
            const ltChildOffset = entry.ltIndex === 0 ? 0 : entry.ltIndex - 5 - (info.index + bytes.length);
            (0, assert_1.assert)(options.allowMissingChildIndexes || ltChildOffset !== 0, 'A node entry\'s ltChildOffset must ALWAYS be set!');
            (0, binary_1.writeSignedOffset)(bytes, bytes.length, ltChildOffset, true);
        });
        // gt_child_ptr: calculate offset
        const gtChildOffset = info.gtIndex === 0 ? 0 : info.gtIndex - 5 - (info.index + bytes.length);
        (0, assert_1.assert)(options.allowMissingChildIndexes || gtChildOffset !== 0, 'A node\'s gtChildOffset must ALWAYS be set!');
        (0, binary_1.writeSignedOffset)(bytes, bytes.length, gtChildOffset, true);
        let byteLength = bytes.length;
        if (options.maxLength > 0 && byteLength > options.maxLength) {
            throw new detailed_error_1.DetailedError('max-node-size-reached', `Node byte size (${byteLength}) grew above maximum of ${options.maxLength}`);
        }
        if (options.addFreeSpace) {
            let freeSpace = 0;
            if (options.maxLength > 0) {
                freeSpace = options.maxLength - byteLength;
                byteLength = options.maxLength;
            }
            else {
                const freeEntries = this.maxEntriesPerNode - info.entries.length;
                const avgEntrySize = Math.ceil((byteLength - 14) / info.entries.length);
                // freeSpace = freeEntries * avgEntrySize;
                freeSpace = Math.ceil(freeEntries * avgEntrySize * 1.1); // + 10%
                byteLength += freeSpace;
            }
            // Add free space zero bytes
            for (let i = 0; i < freeSpace; i++) {
                bytes.push(0);
            }
            // update free_byte_length:
            (0, binary_1.writeByteLength)(bytes, 5, freeSpace);
        }
        // update byte_length:
        (0, binary_1.writeByteLength)(bytes, 0, byteLength);
        return bytes;
    }
    createLeaf(info, options = { addFreeSpace: true }) {
        // console.log(`Creating leaf for entries "${info.entries[0].key}" to "${info.entries.slice(-1)[0].key}" (${info.entries.length} entries, ${info.entries.reduce((total, entry) => total + entry.values.length, 0)} values)`);
        // const tree = new BPlusTree(this.maxEntriesPerNode, this.uniqueKeys, this.metadataKeys);
        // const leaf = new BPlusTreeLeaf(tree);
        // info.entries.forEach(entry => {
        //     const leafEntry = new BPlusTreeLeafEntry(leaf, entry.key);
        //     leafEntry.values = entry.values;
        //     leaf.entries.push(leafEntry);
        //     // leaf.entries.push(entry); // // Changed to code above during TS port
        // });
        let hasExtData = typeof info.extData === 'object' && info.extData.length > 0;
        const bytes = new binary_1.Uint8ArrayBuilder([
            0, 0, 0, 0,
            exports.FLAGS.IS_LEAF | (hasExtData ? exports.FLAGS.LEAF_HAS_EXT_DATA : 0),
            0, 0, 0, 0, // free_byte_length
        ]);
        const leafFlagsIndex = 4;
        // prev_leaf_ptr:
        const prevLeafOffset = info.prevIndex === 0 ? 0 : info.prevIndex - (info.index + 9);
        bytes.writeInt48(prevLeafOffset);
        // next_leaf_ptr:
        let nextLeafOffset = info.nextIndex === 0 ? 0 : info.nextIndex === 'adjacent' ? 0 : info.nextIndex - (info.index + 15);
        bytes.writeInt48(nextLeafOffset);
        const extDataHeaderIndex = bytes.length;
        bytes.push(0, 0, 0, 0, // ext_byte_length
        0, 0, 0, 0);
        // entries_length:
        bytes.push(info.entries.length);
        const moreDataBlocks = [];
        // entries:
        info.entries.forEach(entry => {
            const keyBytes = BinaryBPlusTreeBuilder.getKeyBytes(entry.key);
            bytes.push(...keyBytes);
            // val_length:
            const valLengthIndex = bytes.length;
            if (hasExtData && info.extData.rebuild && entry.extData && !entry.extData.loaded) {
                throw new detailed_error_1.DetailedError('ext-data-not-loaded', 'extData cannot be rebuilt if an entry\'s extData isn\'t loaded');
            }
            if (hasExtData && entry.extData && !info.extData.rebuild) {
                // this entry has external value data (leaf is being overwritten),
                // use existing details
                // val_length:
                bytes.push(exports.FLAGS.ENTRY_HAS_EXT_DATA);
                if (!this.uniqueKeys) {
                    // value_list_length:
                    bytes.writeUint32(entry.extData.totalValues); // _writeByteLength(bytes, bytes.length, entry.extData.totalValues);
                }
                // ext_data_ptr:
                bytes.writeUint32(entry.extData.leafOffset); // _writeByteLength(bytes, bytes.length, entry.extData.leafOffset);
                return; // next!
            }
            else if (this.smallLeafs) {
                // val_length: (small)
                bytes.push(0);
            }
            else {
                // val_length: (large)
                bytes.push(0, 0, 0, 0);
            }
            const valueBytes = new binary_1.Uint8ArrayBuilder([]);
            const addValue = (entryValue) => {
                const { recordPointer, metadata } = entryValue;
                // value_length:
                valueBytes.push(recordPointer.length);
                // value_data:
                valueBytes.append(recordPointer);
                // metadata:
                this.metadataKeys.forEach(key => {
                    const metadataValue = metadata[key];
                    const mdBytes = BinaryBPlusTreeBuilder.getKeyBytes(metadataValue); // metadata_value has same structure as key, so getBinaryKeyData comes in handy here
                    valueBytes.append(mdBytes);
                });
            };
            if (this.uniqueKeys) {
                // value:
                addValue(entry.values[0]);
            }
            else {
                entry.values.forEach(entryValue => {
                    // value:
                    addValue(entryValue);
                });
            }
            if (this.smallLeafs && valueBytes.length > config_1.MAX_SMALL_LEAF_VALUE_LENGTH) {
                // Values too big for small leafs
                // Store value bytes in ext_data block
                if (!this.uniqueKeys) {
                    // value_list_length:
                    bytes.writeUint32(entry.values.length); // _writeByteLength(bytes, bytes.length, entry.values.length);
                }
                // ext_data_ptr:
                const extPointerIndex = bytes.length;
                bytes.push(0, 0, 0, 0);
                // update val_length:
                bytes.data[valLengthIndex] = exports.FLAGS.ENTRY_HAS_EXT_DATA;
                // add the data
                if (hasExtData && !info.extData.rebuild) {
                    // adding ext_data_block to existing leaf is impossible here,
                    // because we don't have existing ext_data
                    // addExtData function must be supplied to handle writing
                    (0, assert_1.assert)(typeof options.addExtData === 'function', 'to add ext_data to existing leaf, provide addExtData function to options');
                    const { extIndex } = options.addExtData(extPointerIndex, valueBytes.data);
                    bytes.writeUint32(extIndex, extPointerIndex);
                }
                else {
                    // add to in-memory block, leaf output will include ext_data
                    moreDataBlocks.push({
                        pointerIndex: extPointerIndex,
                        bytes: valueBytes,
                    });
                }
            }
            else {
                // update val_length:
                const valLength = valueBytes.length + (this.uniqueKeys ? 0 : 4); // +4 to include value_list_length bytes //bytes.length - valLengthIndex - 4;
                if (this.smallLeafs) {
                    bytes.data[valLengthIndex] = valLength;
                }
                else {
                    bytes.writeUint32(valLength, valLengthIndex); // _writeByteLength(bytes, valLengthIndex, valLength);
                }
                if (!this.uniqueKeys) {
                    // value_list_length:
                    bytes.writeUint32(entry.values.length); // _writeByteLength(bytes, bytes.length, entry.values.length);
                }
                // add value bytes:
                bytes.append(valueBytes); // _appendToArray(bytes, valueBytes);
            }
        });
        if (moreDataBlocks.length > 0) {
            // additional ext_data block will be written
            if (!hasExtData && typeof options.maxLength === 'number' && options.maxLength > 0) {
                // Try if ext_data_block can be added to the leaf by shrinking the leaf size
                // (using its free space for ext_data block)
                const minExtDataLength = options.addFreeSpace
                    ? Math.ceil(moreDataBlocks.reduce((length, block) => length + 8 + Math.ceil(block.bytes.length * 1.1), 0) * 1.1)
                    : moreDataBlocks.reduce((length, block) => length + 8 + block.bytes.length, 0);
                const freeBytes = options.maxLength - bytes.length;
                if (freeBytes < minExtDataLength) {
                    throw new detailed_error_1.DetailedError('leaf-too-small-for-extdata', 'leaf needs rebuild: not enough free space to extend leaf with ext_data');
                }
                // Move free space to ext_data:
                options.maxLength -= minExtDataLength;
                info.extData = {
                    length: minExtDataLength,
                };
            }
            hasExtData = true;
            // update leaf_flags:
            bytes.data[leafFlagsIndex] |= exports.FLAGS.LEAF_HAS_EXT_DATA;
        }
        if (!hasExtData) {
            // update leaf_flags:
            bytes.data[leafFlagsIndex] &= ~exports.FLAGS.LEAF_HAS_EXT_DATA; // if ((bytes[leafFlagsIndex] & FLAGS.LEAF_HAS_EXT_DATA) > 0) { bytes[leafFlagsIndex] ^= FLAGS.LEAF_HAS_EXT_DATA }; // has_ext_data (no)
            // remove ext_byte_length, ext_free_byte_length
            bytes.splice(extDataHeaderIndex, 8);
        }
        let byteLength = bytes.length;
        if (options.maxLength > 0 && byteLength > options.maxLength) {
            throw new detailed_error_1.DetailedError('max-leaf-size-reached', `leaf byte size grew above maximum of ${options.maxLength}`);
        }
        let freeSpace = 0;
        if (options.addFreeSpace) {
            if (options.maxLength > 0) {
                freeSpace = options.maxLength - byteLength;
                byteLength = options.maxLength;
            }
            else {
                const freeEntries = this.maxEntriesPerNode - info.entries.length;
                const avgEntrySize = info.entries.length === 0 ? 1 : Math.ceil((byteLength - 18) / info.entries.length);
                // freeSpace = (freeEntries * avgEntrySize) + (avgEntrySize * 2);
                freeSpace = Math.ceil(freeEntries * avgEntrySize * 1.1); // + 10%
                byteLength += freeSpace;
            }
            // Add free space zero bytes
            bytes.append(new Uint8Array(freeSpace)); // Uint8Array is initialized with 0's
            // update free_byte_length:
            bytes.writeUint32(freeSpace, 5);
        }
        // update byte_length:
        bytes.writeUint32(byteLength, 0);
        // Now, add any ext_data blocks
        if (moreDataBlocks.length > 0) {
            // Can only happen when this is a new leaf, or when it's being rebuilt
            const fbm = options.addFreeSpace ? 0.1 : 0; // fmb -> free bytes multiplier
            const maxEntries = this.maxEntriesPerNode;
            const extDataSize = {
                // minimum size: all ext_data blocks with 10% free space
                minimum: moreDataBlocks.reduce((total, block) => total + 8 + block.bytes.length + Math.ceil(block.bytes.length * fbm), 0),
                // average size: minimum + 10% free bytes for growth
                get average() { return Math.ceil(this.minimum * (1 + fbm)); },
                // ideal size: minimum size + room for more entries percentagewise
                get ideal() {
                    const avgExtBlockSize = Math.ceil(this.minimum / moreDataBlocks.length);
                    const extDataValueRatio = moreDataBlocks.length / info.entries.length;
                    // if 5 out of 200 entries have extData: ratio === 0.025 (2.5%)
                    // with total current extData size of 800 bytes, that means it should
                    // allow growth for another 2.5% of remaining entries. With a max of
                    // 255 entries, that means leaving room for 2.5% of 55 more entries.
                    // So, max_entries * ratio * avg_block_size gives us that number!
                    const idealSize = Math.ceil(maxEntries * extDataValueRatio) * avgExtBlockSize;
                    return idealSize;
                },
                used: 0,
            };
            extDataSize.used = info.extData
                ? info.extData.length
                : extDataSize.ideal; // default
            if (info.extData && info.extData.length < extDataSize.minimum) { //  && info.extData.rebuild
                // ext_data becomes too large
                // Try to steal free bytes from leaf
                let bytesShort = extDataSize.ideal - info.extData.length; // first try getting space for free ext_data bytes as well
                extDataSize.used = extDataSize.ideal;
                if (freeSpace < bytesShort) {
                    // Not enough free space for the ideal size. Try again with only 10% free bytes
                    bytesShort = extDataSize.average - info.extData.length;
                    extDataSize.used = extDataSize.average;
                }
                if (freeSpace < bytesShort) {
                    // Not enough free space to include ext_data free bytes. Try again without ext_data free bytes
                    bytesShort = extDataSize.minimum - info.extData.length;
                    extDataSize.used = extDataSize.minimum;
                }
                if (freeSpace >= bytesShort) {
                    // steal free bytes from leaf
                    byteLength -= bytesShort;
                    freeSpace -= bytesShort;
                    // update byte_length:
                    bytes.writeUint32(byteLength, 0);
                    // update free_byte_length:
                    bytes.writeUint32(freeSpace, 5);
                    // remove trailing free bytes from leaf buffer:
                    bytes.splice(bytes.length - bytesShort);
                    // Add bytes to ext_data
                    info.extData.length += bytesShort;
                }
                else {
                    throw new detailed_error_1.DetailedError('max-leaf-extdata-size-reached', `leaf extdata grows larger than the ${info.extData.length} bytes available to it`);
                }
            }
            const leafEndIndex = bytes.length;
            bytes.reserve(extDataSize.used);
            // const blocksDebugging = [];
            // let addedExtBytes = 0;
            while (moreDataBlocks.length > 0) { // moreDataBlocks.forEach(block => {
                const block = moreDataBlocks.shift();
                const offset = bytes.length - leafEndIndex; // offset from leaf end index
                bytes.writeUint32(offset, block.pointerIndex); // update ext_data_ptr
                // Calculate 10% free space per block
                const free = options.addFreeSpace ? Math.ceil(block.bytes.length * fbm) : 0;
                const blockLength = block.bytes.length + free;
                // blocksDebugging.push({
                //     index: bytes.length,
                //     length: blockLength,
                //     free: {
                //         length: free,
                //         index: bytes.length + block.bytes.data.length,
                //         end: bytes.length + block.bytes.data.length + free
                //     }
                // });
                // const debugStartIndex = bytes.length;
                // ext_block_length:
                bytes.writeUint32(blockLength);
                // ext_block_free_length:
                bytes.writeUint32(free);
                // data:
                bytes.append(block.bytes.data);
                // Add free space:
                bytes.append(new Uint8Array(free));
                // addedExtBytes += bytes.length - debugStartIndex;
            } //);
            const extByteLength = bytes.length - leafEndIndex;
            // assert(extByteLength === extDataSize.minimum, 'These must be equal by now!');
            // assert(addedExtBytes === extByteLength, 'Why are these not the same?');
            const extFreeByteLength = info.extData // && info.extData.rebuild
                ? info.extData.length - extByteLength
                : options.addFreeSpace
                    ? extDataSize.used - extByteLength //  Math.ceil(extByteLength * 0.1)
                    : 0;
            // // Debug free space:
            // const freeSpaceStartIndex = bytes.length; // - extFreeByteLength;
            // blocksDebugging.forEach(block => {
            //     if (block.free.end > freeSpaceStartIndex) {
            //         debugger; // This is the problem
            //     }
            // });
            // update extData info
            hasExtData = true;
            if (info.extData) {
                info.extData.freeBytes = extFreeByteLength;
            }
            else {
                info.extData = {
                    length: extByteLength + extFreeByteLength,
                    freeBytes: extFreeByteLength,
                };
            }
            // Add free space:
            bytes.append(new Uint8Array(extFreeByteLength));
            // adjust byteLength
            byteLength = bytes.length;
        }
        else if (hasExtData) {
            byteLength += info.extData.length;
        }
        if (hasExtData) {
            // update leaf_flags:
            bytes.data[leafFlagsIndex] |= exports.FLAGS.LEAF_HAS_EXT_DATA; // has_ext_data (yes)
            // update ext_byte_length:
            bytes.writeUint32(info.extData.length, extDataHeaderIndex); // _writeByteLength(bytes, extDataHeaderIndex, info.extData.length);
            // update ext_free_byte_length:
            bytes.writeUint32(info.extData.freeBytes, extDataHeaderIndex + 4); // _writeByteLength(bytes, extDataHeaderIndex + 4, info.extData.freeBytes);
        }
        if (info.nextIndex === 'adjacent') {
            // update next_leaf_ptr
            nextLeafOffset = byteLength - 15;
            bytes.writeInt48(nextLeafOffset, 15); //_writeSignedOffset(bytes, 15, nextLeafOffset, true);
        }
        // console.log(`Created leaf, ${bytes.length} bytes generated`);
        return bytes.data;
    }
    getLeafEntryValueBytes(recordPointer, metadata) {
        const bytes = [];
        // value_length:
        bytes.push(recordPointer.length);
        // value_data:
        bytes.push(...recordPointer);
        // metadata:
        this.metadataKeys.forEach(key => {
            const metadataValue = metadata[key];
            const valueBytes = tree_1.BPlusTree.getBinaryKeyData(metadataValue); // metadata_value has same structure as key, so getBinaryKeyData comes in handy here
            bytes.push(...valueBytes);
        });
        return bytes;
    }
    static getKeyBytes(key) {
        let keyBytes = [];
        let keyType = exports.KEY_TYPE.UNDEFINED;
        switch (typeof key) {
            case 'undefined': {
                keyType = exports.KEY_TYPE.UNDEFINED;
                break;
            }
            case 'string': {
                keyType = exports.KEY_TYPE.STRING;
                keyBytes = Array.from(encodeString(key)); // textEncoder.encode(key)
                (0, assert_1.assert)(keyBytes.length < 256, `key byte size for "${key}" is too large, max is 255`);
                break;
            }
            case 'number': {
                keyType = exports.KEY_TYPE.NUMBER;
                keyBytes = numberToBytes(key);
                // Remove trailing 0's to reduce size for smaller and integer values
                while (keyBytes[keyBytes.length - 1] === 0) {
                    keyBytes.pop();
                }
                break;
            }
            case 'bigint': {
                keyType = exports.KEY_TYPE.BIGINT;
                keyBytes = bigintToBytes(key);
                break;
            }
            case 'boolean': {
                keyType = exports.KEY_TYPE.BOOLEAN;
                keyBytes = [key ? 1 : 0];
                break;
            }
            case 'object': {
                if (key instanceof Date) {
                    keyType = exports.KEY_TYPE.DATE;
                    keyBytes = numberToBytes(key.getTime());
                }
                else if (key === null) {
                    keyType = exports.KEY_TYPE.UNDEFINED;
                }
                else {
                    throw new detailed_error_1.DetailedError('invalid-object-key-type', `Unsupported object key type: ${key}`);
                }
                break;
            }
            default: {
                throw new detailed_error_1.DetailedError('invalid-key-type', `Unsupported key type: ${typeof key}`);
            }
        }
        const bytes = [];
        // key_type:
        bytes.push(keyType);
        // key_length:
        bytes.push(keyBytes.length);
        // key_data:
        bytes.push(...keyBytes);
        return bytes;
    }
}
exports.BinaryBPlusTreeBuilder = BinaryBPlusTreeBuilder;
//# sourceMappingURL=binary-tree-builder.js.map