import { Utils } from 'acebase-core';
import { readByteLength, readSignedOffset, Uint8ArrayBuilder, writeByteLength, writeSignedOffset } from '../binary.js';
import { DetailedError } from '../detailed-error.js';
import { ThreadSafe } from '../thread-safe.js';
import { assert } from '../assert.js';
import { BinaryReader } from './binary-reader.js';
import { BinaryBPlusTreeBuilder, FLAGS } from './binary-tree-builder.js';
import { BinaryBPlusTreeLeaf } from './binary-tree-leaf.js';
import { BinaryBPlusTreeLeafEntry } from './binary-tree-leaf-entry.js';
import { BinaryBPlusTreeLeafEntryValue } from './binary-tree-leaf-entry-value.js';
import { BinaryBPlusTreeNode } from './binary-tree-node.js';
import { BinaryBPlusTreeNodeEntry } from './binary-tree-node-entry.js';
import { BinaryBPlusTreeNodeInfo } from './binary-tree-node-info.js';
import { BinaryBPlusTreeTransactionOperation } from './binary-tree-transaction-operation.js';
import { BinaryWriter } from './binary-writer.js';
import { WRITE_SMALL_LEAFS } from './config.js';
import { BPlusTree } from './tree.js';
import { BPlusTreeBuilder } from './tree-builder.js';
import { BPlusTreeLeafEntryValue } from './tree-leaf-entry-value.js';
import { TX } from './tx.js';
import { _compareBinary, _isEqual, _isLess, _isLessOrEqual, _isMore, _isMoreOrEqual, _isNotEqual } from './typesafe-compare.js';
import { _appendToArray, _checkNewEntryArgs } from './utils.js';
const { bigintToBytes } = Utils;
export class BlacklistingSearchOperator {
    /**
     * @param callback callback that runs for each entry, must return an array of the entry values to be blacklisted
     */
    constructor(callback) {
        this.check = callback;
    }
}
class NoTreeInfoError extends Error {
    constructor() { super('Tree info has not been read'); }
}
// eslint-disable-next-line @typescript-eslint/no-empty-function
async function noop() { }
class BinaryBPlusTree {
    /**
     * Provides functionality to read and search in a B+tree from a binary data source
     */
    constructor(init) {
        this._chunkSize = init.chunkSize ?? 1024;
        this._autoGrow = false;
        this.id = init.id;
        this.debug = init.debug;
        if (init.readFn instanceof Array) {
            let data = init.readFn;
            if (BPlusTree.debugBinary) {
                this.debugData = data;
                data = this.debugData.map(entry => entry instanceof Array ? entry[1] : entry);
            }
            this._readFn = async (i, length) => {
                const slice = data.slice(i, i + length);
                return Buffer.from(slice);
            };
        }
        else if (typeof init.readFn === 'function') {
            this._readFn = init.readFn;
        }
        else {
            throw new TypeError('readFn must be a byte array or function that reads from a data source');
        }
        if (typeof init.writeFn === 'function') {
            this._writeFn = init.writeFn;
        }
        else if (typeof init.writeFn === 'undefined' && init.readFn instanceof Array) {
            const sourceData = init.readFn;
            this._writeFn = (data, index) => {
                for (let i = 0; i < data.length; i++) {
                    sourceData[index + i] = data[i];
                }
            };
        }
        else {
            this._writeFn = () => {
                throw new Error('Cannot write data, no writeFn was supplied');
            };
        }
    }
    static async test(data, debug) {
        const tree = new BinaryBPlusTree({ readFn: data, debug });
        let leaf = await tree.getFirstLeaf();
        while (leaf) {
            for (let i = 0; i < leaf.entries.length; i++) {
                const entry = leaf.entries[i];
                const found = await tree.find(entry.key);
                if (found === null) {
                    throw new Error(`Tree entry ${entry.key} could not be found using tree.find`);
                }
            }
            leaf = leaf.getNext ? await leaf.getNext() : null;
        }
    }
    get autoGrow() {
        return this._autoGrow;
    }
    set autoGrow(grow) {
        this._autoGrow = grow === true;
        // if (this._autoGrow) {
        //     this.debug.warn('autoGrow enabled for binary tree');
        // }
    }
    async _loadInfo() {
        // Quick and dirty way to trigger info to be loaded. TODO: refactored later
        await this._getReader();
    }
    async _getReader() {
        const reader = new BinaryReader(this._readFn, this._chunkSize); // new ChunkReader(this._chunkSize, this._readFn);
        await reader.init();
        const header = await reader.get(6);
        const originalByteLength = (header[0] << 24) | (header[1] << 16) | (header[2] << 8) | header[3];
        if (!this._originalByteLength) {
            this._originalByteLength = originalByteLength;
        }
        this.info = {
            headerLength: 6,
            byteLength: originalByteLength,
            isUnique: (header[4] & FLAGS.UNIQUE_KEYS) > 0,
            hasMetadata: (header[4] & FLAGS.HAS_METADATA) > 0,
            hasFreeSpace: (header[4] & FLAGS.HAS_FREE_SPACE) > 0,
            hasFillFactor: (header[4] & FLAGS.HAS_FILL_FACTOR) > 0,
            hasSmallLeafs: (header[4] & FLAGS.HAS_SMALL_LEAFS) > 0,
            hasLargePtrs: (header[4] & FLAGS.HAS_LARGE_PTRS) > 0,
            freeSpace: 0,
            get freeSpaceIndex() { return this.hasFillFactor ? 7 : 6; },
            entriesPerNode: header[5],
            fillFactor: 100,
            metadataKeys: [],
        };
        // if (!this.info.hasLargePtrs) {
        //     this.debug.warn(`Warning: tree "${this.id}" is read-only because it contains small ptrs. it needs to be rebuilt`);
        // }
        let additionalHeaderBytes = 0;
        if (this.info.hasFillFactor) {
            additionalHeaderBytes += 1;
        }
        if (this.info.hasFreeSpace) {
            additionalHeaderBytes += 4;
        }
        if (this.info.hasMetadata) {
            additionalHeaderBytes += 4;
        }
        if (additionalHeaderBytes > 0) {
            // The tree has fill factor, free space, and/or metadata keys, read them
            this.info.headerLength += additionalHeaderBytes;
            const ahbBuffer = await reader.get(additionalHeaderBytes);
            let i = 0;
            if (this.info.hasFillFactor) {
                this.info.fillFactor = ahbBuffer[i];
                i++;
            }
            if (this.info.hasFreeSpace) {
                this.info.freeSpace = (ahbBuffer[i] << 24) | (ahbBuffer[i + 1] << 16) | (ahbBuffer[i + 2] << 8) | ahbBuffer[i + 3];
                i += 4;
            }
            if (this.info.hasMetadata) {
                const length = (ahbBuffer[i] << 24) | (ahbBuffer[i + 1] << 16) | (ahbBuffer[i + 2] << 8) | ahbBuffer[i + 3];
                this.info.headerLength += length;
                // Read metadata
                const mdBuffer = await reader.get(length);
                const keyCount = mdBuffer[0];
                let index = 1;
                for (let i = 0; i < keyCount; i++) {
                    const keyLength = mdBuffer[index];
                    index++;
                    let key = '';
                    for (let j = 0; j < keyLength; j++) {
                        key += String.fromCharCode(mdBuffer[index + j]);
                    }
                    index += keyLength;
                    this.info.metadataKeys.push(key);
                }
            }
        }
        // Done reading header
        return reader;
    }
    async _readChild(reader) {
        const index = reader.sourceIndex; //reader.savePosition().index;
        const headerLength = 9;
        const header = await reader.get(headerLength); // byte_length, is_leaf, free_byte_length
        const byteLength = (header[0] << 24) | (header[1] << 16) | (header[2] << 8) | header[3]; // byte_length
        const isLeaf = (header[4] & FLAGS.IS_LEAF) > 0; // is_leaf
        const hasExtData = (header[4] & FLAGS.LEAF_HAS_EXT_DATA) > 0; // has_ext_data
        const freeBytesLength = (header[5] << 24) | (header[6] << 16) | (header[7] << 8) | header[8];
        // load whole node/leaf for easy processing
        const dataLength = byteLength - headerLength - freeBytesLength;
        const bytes = await reader.get(dataLength);
        assert(bytes.length === dataLength, 'less bytes read than requested?');
        const childInfo = new BinaryBPlusTreeNodeInfo({
            tree: this,
            isLeaf,
            hasExtData,
            bytes,
            sourceIndex: index,
            dataIndex: index + headerLength,
            length: byteLength,
            free: freeBytesLength,
        });
        return childInfo;
    }
    _getLeaf(leafInfo, reader, options) {
        if (!this.info) {
            throw new Error('Tree info has not been read');
        }
        const leaf = new BinaryBPlusTreeLeaf(leafInfo);
        const bytes = leaf.bytes;
        // const savedPosition = reader.savePosition(-bytes.length);
        const prevLeafOffset = readSignedOffset(bytes, 0, this.info.hasLargePtrs); // prev_leaf_ptr
        let index = this.info.hasLargePtrs ? 6 : 4;
        const nextLeafOffset = readSignedOffset(bytes, index, this.info.hasLargePtrs); // next_leaf_ptr
        index += this.info.hasLargePtrs ? 6 : 4;
        leaf.prevLeafOffset = prevLeafOffset;
        leaf.nextLeafOffset = nextLeafOffset;
        if (leafInfo.hasExtData) {
            leaf.extData.length = readByteLength(bytes, index);
            leaf.extData.freeBytes = readByteLength(bytes, index + 4);
            index += 8;
            leaf.extData.load = async () => {
                // Load all extData blocks. Needed when eg rebuilding
                if (leaf.extData.loaded) {
                    return;
                }
                const index = leaf.sourceIndex + leaf.length;
                const length = leaf.extData.length - leaf.extData.freeBytes;
                const r = reader.clone();
                r.chunkSize = length; // So it will be 1 read
                await r.go(index);
                const bytes = await r.get(length);
                leaf.entries.forEach(entry => {
                    if (entry.extData) {
                        entry.extData.loadFromExtData(bytes);
                    }
                });
                leaf.extData.loaded = true;
            };
        }
        const entriesLength = bytes[index]; // entries_length
        index++;
        const readValue = () => {
            const result = readEntryValue(bytes, index);
            index += result.byteLength;
            return result.entryValue;
        };
        const readEntryValue = (bytes, index) => {
            assert(index < bytes.length, 'invalid data');
            if (index >= bytes.length) {
                throw new Error('invalid data');
            }
            const startIndex = index;
            const valueLength = bytes[index]; // value_length
            // assert(index + valueLength <= bytes.length, 'not enough data!');
            if (index + valueLength > bytes.length) {
                const bytesShort = index + valueLength - bytes.length;
                throw new Error(`DEV ERROR: Cannot read entry value past the end of the read buffer (${bytesShort} bytes short)`);
            }
            index++;
            const value = [];
            // value_data:
            for (let j = 0; j < valueLength; j++) {
                value[j] = bytes[index + j];
            }
            index += valueLength;
            // metadata:
            const metadata = this.info.hasMetadata ? {} : undefined;
            this.info.metadataKeys.forEach(key => {
                // metadata_value:
                // NOTE: it seems strange to use getKeyFromBinary to read a value, but metadata_value is stored in the same way as a key, so this comes in handy
                const valueInfo = BPlusTree.getKeyFromBinary(bytes, index);
                metadata[key] = valueInfo.key;
                index += valueInfo.byteLength;
            });
            return {
                entryValue: new BinaryBPlusTreeLeafEntryValue(value, metadata),
                byteLength: index - startIndex,
            };
        };
        for (let i = 0; i < entriesLength; i++) {
            const keyInfo = BPlusTree.getKeyFromBinary(bytes, index);
            const key = keyInfo.key;
            index += keyInfo.byteLength;
            // Read value(s) and return
            const hasExtData = this.info.hasSmallLeafs && (bytes[index] & FLAGS.ENTRY_HAS_EXT_DATA) > 0;
            const valLength = this.info.hasSmallLeafs
                ? hasExtData ? 0 : bytes[index]
                : (bytes[index] << 24) | (bytes[index + 1] << 16) | (bytes[index + 2] << 8) | bytes[index + 3]; // val_length
            index += this.info.hasSmallLeafs
                ? 1
                : 4;
            if (options && options.stats) {
                // Skip values, only load value count
                const entry = new BinaryBPlusTreeLeafEntry(key, null);
                if (this.info.isUnique) {
                    entry.totalValues = 1;
                }
                else {
                    entry.totalValues = (bytes[index] << 24) | (bytes[index + 1] << 16) | (bytes[index + 2] << 8) | bytes[index + 3]; // value_list_length
                }
                leaf.entries.push(entry);
                if (hasExtData) {
                    index += this.info.isUnique ? 4 : 8; // skip ext_data_ptr (and value_list_length if not unique)
                }
                else {
                    index += valLength; // skip value
                }
            }
            else if (this.info.isUnique) {
                // Read single value
                const entryValue = readValue();
                leaf.entries.push(new BinaryBPlusTreeLeafEntry(key, [entryValue]));
            }
            else {
                // Read value_list_length
                const valuesListLengthIndex = leafInfo.dataIndex + index;
                let valuesLength = (bytes[index] << 24) | (bytes[index + 1] << 16) | (bytes[index + 2] << 8) | bytes[index + 3]; // value_list_length
                index += 4;
                if (hasExtData) {
                    // additional data will have to be loaded upon request
                    // ext_data_ptr:
                    let extDataOffset = readByteLength(bytes, index);
                    index += 4;
                    const extDataBlockIndex = leafInfo.sourceIndex + leafInfo.length + extDataOffset;
                    const entry = new BinaryBPlusTreeLeafEntry(key, new Array(valuesLength));
                    // eslint-disable-next-line @typescript-eslint/no-this-alias
                    const tree = this;
                    Object.defineProperties(entry, {
                        values: {
                            get() {
                                return this.extData.values;
                            },
                            set(values) {
                                this.extData.values = values;
                            },
                        },
                    });
                    entry.extData = {
                        _headerLoaded: false,
                        _length: -1,
                        _freeBytes: -1,
                        _values: null,
                        _listLengthIndex: valuesListLengthIndex,
                        get length() {
                            if (this._headerLoaded) {
                                return this._length;
                            }
                            throw new Error('ext_data header not read yet');
                        },
                        get freeBytes() {
                            if (this._headerLoaded) {
                                return this._freeBytes;
                            }
                            throw new Error('ext_data header not read yet');
                        },
                        get values() {
                            if (this._values !== null) {
                                return this._values;
                            }
                            throw new Error('ext_data values were not read yet. use entry.extData.loadValues() first');
                        },
                        set values(values) {
                            this._values = values;
                        },
                        leafOffset: extDataOffset,
                        index: extDataBlockIndex,
                        get totalValues() { return valuesLength; },
                        set totalValues(n) { valuesLength = n; },
                        get loaded() { return this._values !== null; },
                        get _headerLength() { return 8; },
                        async loadValues(existingLock = null) {
                            // load all values
                            // reader = reader.clone();
                            const self = this;
                            const lock = await self.loadHeader(existingLock || true);
                            await reader.go(self.index + self._headerLength);
                            const extData = await reader.get(self._length - self._freeBytes);
                            self._values = [];
                            let index = 0;
                            for (let i = 0; i < valuesLength; i++) {
                                const result = readEntryValue(extData, index);
                                index += result.byteLength;
                                self._values.push(result.entryValue);
                            }
                            self.totalValues = valuesLength;
                            if (!existingLock) {
                                lock.release();
                            }
                            if (index !== self._length - self._freeBytes) {
                                throw new Error('DEV ERROR: index should now be at the known end of the data');
                            }
                            return self._values;
                        },
                        async loadHeader(lockOptions) {
                            const self = this;
                            const keepLock = lockOptions === true;
                            const existingLock = typeof lockOptions === 'object' ? lockOptions : null;
                            // if (self._headerLoaded) {
                            //     return keepLock ? ThreadSafe.lock(leaf) : Promise.resolve(null);
                            // }
                            reader = reader.clone();
                            // load header
                            const lock = existingLock || await ThreadSafe.lock(leaf);
                            await reader.go(self.index);
                            const extHeader = await reader.get(self._headerLength); // ext_block_length, ext_block_free_length
                            self._headerLoaded = true;
                            self._length = readByteLength(extHeader, 0);
                            self._freeBytes = readByteLength(extHeader, 4);
                            assert(self._length >= 0 && self._freeBytes >= 0 && self._freeBytes < self._length, 'invalid data');
                            if (keepLock || existingLock) {
                                return lock;
                            }
                            else {
                                return lock.release();
                            }
                        },
                        loadFromExtData(allExtData) {
                            const self = this;
                            let index = extDataOffset;
                            self._headerLoaded = true;
                            self._length = readByteLength(allExtData, index);
                            self._freeBytes = readByteLength(allExtData, index + 4);
                            index += self._headerLength; // 8
                            self._values = [];
                            for (let i = 0; i < valuesLength; i++) {
                                const result = readEntryValue(allExtData, index);
                                index += result.byteLength;
                                self._values.push(result.entryValue);
                            }
                            self.totalValues = valuesLength;
                        },
                        async addValue(recordPointer, metadata) {
                            // add value to this entry's extData block.
                            const self = this;
                            const lock = await self.loadHeader(true);
                            // await tree._testTree(); // Check tree when debugging
                            // We have to add it to ext_data, and update leaf's value_list_length
                            // no checking for existing recordPointer
                            const builder = new BinaryBPlusTreeBuilder({ metadataKeys: tree.info.metadataKeys });
                            const extValueData = builder.getLeafEntryValueBytes(recordPointer, metadata);
                            let extBlockMoves = false;
                            let newValueIndex = -1;
                            if (extValueData.length > self._freeBytes) {
                                // NEW: check if parent ext_data block has free space, maybe we can use that space
                                const requiredSpace = (() => {
                                    const grossNewLength = entry.extData.length - entry.extData.freeBytes + extValueData.length;
                                    const newValues = Math.ceil((entry.totalValues + 1) * 1.1); // 10% more values than will have now
                                    const avgValueLength = Math.ceil((entry.extData.length - entry.extData.freeBytes) / entry.extData.totalValues);
                                    const netNewLength = avgValueLength * newValues;
                                    const newFreeBytes = netNewLength - grossNewLength;
                                    return {
                                        bytes: netNewLength + self._headerLength,
                                        length: netNewLength,
                                        freeBytes: newFreeBytes,
                                    };
                                })();
                                if (requiredSpace.bytes > leaf.extData.freeBytes) {
                                    lock.release();
                                    throw new DetailedError('max-extdata-size-reached', 'No space left to add value to leaf ext_data_block');
                                }
                                else {
                                    // leaf has enough free space in its ext_data to add a new ext_data_block
                                    // store extData there and move the leaf entry's pointer
                                    // Load existing values now before adjusting indexes etc
                                    await entry.extData.loadValues(lock);
                                    // const oldIndex = entry.extData.index;
                                    const oldOffset = extDataOffset;
                                    const newOffset = leaf.extData.length - leaf.extData.freeBytes;
                                    // if (newOffset === oldOffset + self._length) {
                                    //     // This is the last ext_data_block in ext_data, it can stay at the same spot
                                    //     newOffset = oldOffset;
                                    // }
                                    extDataOffset = newOffset;
                                    entry.extData.index += (newOffset - oldOffset);
                                    entry.extData._length = requiredSpace.length;
                                    entry.extData._freeBytes = requiredSpace.freeBytes;
                                    // // Let's check now if the ext_data_free_bytes in the file is the same as we have in memory
                                    // const leafExtFreeBytesIndex =
                                    //     leaf.dataIndex
                                    //     + ((tree.info.hasLargePtrs ? 6 : 4) * 2) // prev_leaf_ptr, next_leaf_ptr
                                    //     + 4; // ext_byte_length
                                    // const check = await tree._readFn(leafExtFreeBytesIndex, 4);
                                    // const nr = _readByteLength(check, 0);
                                    // assert(nr === leaf.extData.freeBytes, 'ext free bytes in file is different');
                                    // const oldLeafExtFreeBytes = leaf.extData.freeBytes;
                                    leaf.extData.freeBytes -= requiredSpace.bytes; // leaf.extData.length - (newOffset + requiredSpace.length);
                                    // this.debug.log(`addValue :: moving ext_block from index ${oldIndex} to ${entry.extData.index}, leaf's ext_data_free_bytes reduces from ${oldLeafExtFreeBytes} to ${leaf.extData.freeBytes} bytes`)
                                    extBlockMoves = true;
                                }
                            }
                            else {
                                // Before adjusting freeBytes, calc new value storage index
                                newValueIndex = self.index + self._headerLength + self._length - self._freeBytes;
                                // Reduce free space in ext_data_block
                                entry.extData._freeBytes -= extValueData.length;
                            }
                            const extDataBlock = [
                                0, 0, 0, 0,
                                0, 0, 0, 0, // ext_block_free_length
                            ];
                            // update ext_block_length:
                            writeByteLength(extDataBlock, 0, entry.extData.length);
                            // update ext_block_free_length:
                            writeByteLength(extDataBlock, 4, entry.extData.freeBytes);
                            if (extBlockMoves) {
                                // If the ext_data_block moves, it has to be rewritten entirely
                                // Add all existing values first
                                const builder = new BinaryBPlusTreeBuilder({ metadataKeys: tree.info.metadataKeys });
                                entry.extData.values.forEach(val => {
                                    const valData = builder.getLeafEntryValueBytes(val.recordPointer, val.metadata);
                                    _appendToArray(extDataBlock, valData);
                                });
                                // Now add new value
                                _appendToArray(extDataBlock, extValueData);
                                // Check if the new size is indeed what we calculated
                                if (extDataBlock.length - 8 + entry.extData.freeBytes !== entry.extData.length) {
                                    throw new Error('DEV ERROR: new ext_block size is not equal to calculated size');
                                }
                            }
                            const valueListLengthData = [0, 0, 0, 0];
                            writeByteLength(valueListLengthData, 0, self.totalValues + 1);
                            // const displayIndex = index => (index + 4096).toString(16).toUpperCase();
                            // const displayBytes = bytes => '[' + bytes.map(b => b.toString(16)).join(',').toUpperCase() + ']';
                            try {
                                // this.debug.log(`TreeWrite:ext_block_length(${entry.extData.length}), ext_block_free_length(${entry.extData.freeBytes})${extBlockMoves ? ', value_list' : ''} :: ${extDataBlock.length} bytes at index ${displayIndex(self.index)}: ${displayBytes(extDataBlock.slice(0,4))}, ${displayBytes(extDataBlock.slice(4,8))}${extBlockMoves ? ', [...]' : ''}`);
                                // this.debug.log(`TreeWrite:value_list_length(${self.totalValues + 1}) :: ${valueListLengthData.length} bytes at index ${displayIndex(self._listLengthIndex)}: ${displayBytes(valueListLengthData)}`);
                                const promises = [
                                    // Write header (ext_block_length, ext_block_free_length) or entire ext_data_block to its index:
                                    tree._writeFn(extDataBlock, self.index),
                                    // update value_list_length
                                    tree._writeFn(valueListLengthData, self._listLengthIndex),
                                ];
                                if (extBlockMoves) {
                                    // Write new ext_data_ptr in leaf entry's val_data
                                    let writeBytes = [0, 0, 0, 0];
                                    writeByteLength(writeBytes, 0, extDataOffset);
                                    // this.debug.log(`TreeWrite:ext_data_ptr(${extDataOffset}) :: ${writeBytes.length} bytes at index ${displayIndex(self._listLengthIndex + 4)}: ${displayBytes(writeBytes)}`);
                                    let p = tree._writeFn(writeBytes, self._listLengthIndex + 4);
                                    promises.push(p);
                                    // Update leaf's ext_free_byte_length
                                    const leafExtFreeBytesIndex = leaf.dataIndex
                                        + ((tree.info.hasLargePtrs ? 6 : 4) * 2) // prev_leaf_ptr, next_leaf_ptr
                                        + 4; // ext_byte_length
                                    writeBytes = [0, 0, 0, 0];
                                    writeByteLength(writeBytes, 0, leaf.extData.freeBytes);
                                    // this.debug.log(`TreeWrite:ext_free_byte_length(${leaf.extData.freeBytes}) :: ${writeBytes.length} bytes at index ${displayIndex(leafExtFreeBytesIndex)}: ${displayBytes(writeBytes)}`);
                                    p = tree._writeFn(writeBytes, leafExtFreeBytesIndex);
                                    promises.push(p);
                                }
                                else {
                                    // write new value:
                                    // this.debug.log(`TreeWrite:value :: ${extValueData.length} bytes at index ${displayIndex(newValueIndex)}: ${displayBytes(extValueData)}`);
                                    const p = tree._writeFn(extValueData, newValueIndex);
                                    promises.push(p);
                                }
                                await Promise.all(promises);
                                // self._freeBytes -= extValueData.length;
                                self.totalValues++;
                                // TEST
                                // try {
                                //     this.debug.log(`Values for entry '${entry.key}' updated: ${self.totalValues} values`);
                                //     await tree._testTree();
                                //     this.debug.log(`Successfully added value to entry '${entry.key}'`);
                                // }
                                // catch (err) {
                                //     this.debug.error(`Tree is broken after updating entry '${entry.key}': ${err.message}`);
                                // }
                            }
                            finally {
                                await lock.release();
                            }
                            // TEST
                            // try {
                            //     await self.loadValues();
                            // }
                            // catch (err) {
                            //     this.debug.error(`Values are broken after updating entry '${entry.key}': ${err.message}`);
                            // }
                        },
                        async removeValue(recordPointer) {
                            // remove value
                            // load the whole value, then rewrite it
                            const self = this;
                            const values = await self.loadValues();
                            // LOCK?
                            const index = values.findIndex(val => _compareBinary(val.recordPointer, recordPointer));
                            if (!~index) {
                                return;
                            }
                            values.splice(index, 1);
                            // rebuild ext_data_block
                            const bytes = [
                                0, 0, 0, 0,
                                0, 0, 0, 0, // ext_block_free_length
                            ];
                            // ext_block_length:
                            writeByteLength(bytes, 0, self._length);
                            // Add all values
                            const builder = new BinaryBPlusTreeBuilder({ metadataKeys: tree.info.metadataKeys });
                            values.forEach(val => {
                                const valData = builder.getLeafEntryValueBytes(val.recordPointer, val.metadata);
                                _appendToArray(bytes, valData);
                            });
                            // update ext_block_free_length:
                            const freeBytes = self._length - bytes.length + 8; // Do not count 8 header bytes
                            writeByteLength(bytes, 4, freeBytes);
                            const valueListLengthData = writeByteLength([], 0, self.totalValues - 1);
                            await Promise.all([
                                // write ext_data_block
                                tree._writeFn(bytes, self.index),
                                // update value_list_length
                                tree._writeFn(valueListLengthData, self._listLengthIndex),
                            ]);
                            self.totalValues--;
                            self._freeBytes = freeBytes;
                        },
                    };
                    entry.loadValues = async function loadValues() {
                        const lock = await ThreadSafe.lock(leaf);
                        await reader.go(extDataBlockIndex);
                        const extHeader = await reader.get(8); // ext_data_length, ext_free_byte_length
                        const length = readByteLength(extHeader, 0);
                        const freeBytes = readByteLength(extHeader, 4);
                        const data = await reader.get(length - freeBytes);
                        entry._values = [];
                        let index = 0;
                        for (let i = 0; i < this.totalValues; i++) {
                            const result = readEntryValue(data, index);
                            index += result.byteLength;
                            entry._values.push(result.entryValue);
                        }
                        lock.release();
                        return entry._values;
                    };
                    leaf.entries.push(entry);
                }
                else {
                    const entryValues = [];
                    for (let j = 0; j < valuesLength; j++) {
                        const entryValue = readValue();
                        entryValues.push(entryValue);
                    }
                    leaf.entries.push(new BinaryBPlusTreeLeafEntry(key, entryValues));
                }
            }
        }
        if (prevLeafOffset !== 0) {
            leaf.getPrevious = async () => {
                const freshReader = reader.clone();
                await freshReader.go(leaf.prevLeafIndex);
                const childInfo = await this._readChild(freshReader);
                assert(childInfo.isLeaf, `previous leaf is *not* a leaf. Current leaf index: ${leaf.sourceIndex}, next leaf offset: ${prevLeafOffset}, target index: ${leaf.dataIndex + prevLeafOffset}`);
                const prevLeaf = await this._getLeaf(childInfo, freshReader, options);
                return prevLeaf;
            };
        }
        if (nextLeafOffset !== 0) {
            leaf.getNext = async (repairMode = false) => {
                const freshReader = reader.clone();
                await freshReader.go(leaf.nextLeafIndex);
                let childInfo;
                try {
                    childInfo = await this._readChild(freshReader);
                }
                catch (err) {
                    if (repairMode) {
                        // Could not read next leaf using current leaf's next pointer. In repair mode, try getting it using the tree pointers.
                        // If that fails too, move on to the next leaf until we get a succesful read. Using this strategy, data referenced from
                        // broken leaf(s) will be skipped, following data will be able to be read again.
                        const lastKey = leaf.entries.slice(-1)[0].key;
                        this.debug.warn(`B+Tree repair caught error: ${err.message}`);
                        this.debug.warn(`B+Tree repair starting at key >= "${lastKey}"`);
                        const currentLeaf = await (async () => {
                            if (leaf.parentNode) {
                                return leaf;
                            }
                            try {
                                return await this._findLeaf(lastKey);
                            }
                            catch (err) {
                                throw new DetailedError('tree-repair', `Cannot repair B+Tree: unable to find current leaf using its last key`, err);
                            }
                        })();
                        if (currentLeaf.index !== leaf.index) {
                            // This is a different leaf.
                            throw new DetailedError('tree-repair', `Cannot repair B+Tree: loaded current leaf at index ${currentLeaf.index} is not the same as start leaf @${leaf.index}`, err);
                        }
                        // Try getting next leaf using parent node's next entry
                        const currentEntryIndex = currentLeaf.parentNode.entries.indexOf(currentLeaf.parentEntry);
                        if (currentEntryIndex === -1) {
                            // current leaf is the gtChild of parent node, there is no next entry.
                            if (currentLeaf.parentNode.gtChildIndex !== currentLeaf.index) {
                                throw new DetailedError('tree-repair', `Cannot repair B+Tree: leaf's parent node entry points to the wrong index ${currentLeaf.parentNode.gtChildIndex} of current leaf ${currentLeaf.index}`);
                            }
                            if (!currentLeaf.parentNode.parentNode) {
                                // parent node has no parent itself, there is no next leaf
                                this.debug.warn(`B+Tree repair: no more leafs in tree`);
                                return null;
                            }
                        }
                        const getNextNode = async (currentNode) => {
                            const entryIndex = currentNode.parentNode.entries.indexOf(currentNode.parentEntry);
                            if (entryIndex === -1) {
                                // currentNode is gtChild of parent node
                                if (currentNode.parentNode) {
                                    // TODO: assert gtChildIndex
                                    const nextParent = await getNextNode(currentNode.parentNode);
                                    const nextNodeInfo = await nextParent.entries[0].getLtChild();
                                    const nextNode = new BinaryBPlusTreeNode(nextNodeInfo);
                                    return nextNode;
                                }
                                return null;
                            }
                            const nextEntry = currentNode.parentNode.entries[entryIndex + 1];
                            const nextNodeInfo = nextEntry ? await nextEntry.getLtChild() : await currentNode.parentNode.getGtChild();
                            const nextNode = new BinaryBPlusTreeNode(nextNodeInfo);
                            return nextNode;
                        };
                        const getNextNodeEntry = async (currentNode, currentIndex) => {
                            if (currentIndex > currentNode.entries.length) {
                                const nextNode = await getNextNode(currentNode.parentNode);
                                if (!nextNode) {
                                    return null;
                                }
                                return { node: nextNode, entry: nextNode.entries[0], index: 0 };
                            }
                            return { node: currentNode, entry: currentNode.entries[currentIndex + 1] ?? null, index: currentIndex + 1 };
                        };
                        // Iterate the tree's node entries on the deepest level until we get a first succesful leaf read
                        let { node: currentNode, entry: currentNodeEntry, index: currentNodeEntryIndex } = await getNextNodeEntry(currentLeaf.parentNode, currentEntryIndex);
                        while (currentNode) {
                            // try loading leaf in this entry
                            const entryKey = `${currentNodeEntry ? '<' : '>='} "${currentNodeEntry?.key ?? currentNode.entries.slice(-1)[0].key}"`;
                            try {
                                const nodeInfo = currentNodeEntry ? await currentNodeEntry.getLtChild() : await currentNode.getGtChild();
                                assert(nodeInfo.isLeaf, 'not a leaf!');
                                const nextLeaf = new BinaryBPlusTreeLeaf(nodeInfo);
                                this.debug.warn(`B+Tree repair: using leaf for key ${entryKey} at index ${nextLeaf.index}`);
                                return nextLeaf;
                            }
                            catch (err) {
                                this.debug.warn(`B+Tree repair: failed to load leaf for key ${entryKey} at index ${currentNodeEntry?.ltChildIndex ?? currentNode.gtChildIndex}: ${err.message}. ` +
                                    `Proceeding with next node entry.`);
                                // proceed with next node entry
                                ({ node: currentNode, entry: currentNodeEntry, index: currentNodeEntryIndex } = await getNextNodeEntry(currentNode, currentNodeEntryIndex));
                            }
                        }
                        // no more nodes
                        this.debug.warn(`B+Tree repair: there are no more leafs to load`);
                        return null;
                    }
                    throw err;
                }
                assert(childInfo.isLeaf, `next leaf is *not* a leaf. Current leaf index: ${leaf.sourceIndex}, next leaf offset: ${nextLeafOffset}, target index: ${leaf.dataIndex + 4 + nextLeafOffset}`);
                const nextLeaf = await this._getLeaf(childInfo, freshReader, options);
                assert(nextLeaf.entries.length === 0 || leaf.entries.length === 0 || _isMore(nextLeaf.entries[0].key, leaf.entries[leaf.entries.length - 1].key), 'next leaf has lower keys than previous leaf?!');
                return nextLeaf;
            };
        }
        assert(leaf.entries.every((entry, index, arr) => index === 0 || _isMore(entry.key, arr[index - 1].key)), 'Invalid B+Tree: leaf entries are not sorted ok');
        return leaf;
    }
    async _writeNode(nodeInfo) {
        // Rewrite the node.
        // NOTE: not using BPlusTreeNode.toBinary for this, because
        // that function writes children too, we don't want that
        assert(nodeInfo.entries.length > 0, 'node has no entries!');
        assert(nodeInfo.entries.every((entry, index, arr) => index === 0 || _isMore(entry.key, arr[index - 1].key)), 'Node entries are not sorted ok');
        try {
            const builder = new BinaryBPlusTreeBuilder({
                uniqueKeys: this.info.isUnique,
                maxEntriesPerNode: this.info.entriesPerNode,
                metadataKeys: this.info.metadataKeys,
                // Not needed:
                byteLength: this.info.byteLength,
                freeBytes: this.info.freeSpace,
            });
            const bytes = builder.createNode({
                index: nodeInfo.index,
                entries: nodeInfo.entries.map(entry => ({ key: entry.key, ltIndex: entry.ltChildIndex })),
                gtIndex: nodeInfo.gtChildIndex,
            }, {
                addFreeSpace: true,
                maxLength: nodeInfo.length,
            });
            assert(bytes.length <= nodeInfo.length, 'too many bytes allocated for node');
            return await this._writeFn(bytes, nodeInfo.index);
        }
        catch (err) {
            throw new DetailedError('write-node-fail', `Failed to write node: ${err.message}`, err);
        }
    }
    async _writeLeaf(leafInfo, options = { addFreeSpace: true }) {
        assert(leafInfo.entries.every((entry, index, arr) => index === 0 || _isMore(entry.key, arr[index - 1].key)), 'Leaf entries are not sorted ok');
        try {
            const builder = new BinaryBPlusTreeBuilder({
                uniqueKeys: this.info.isUnique,
                maxEntriesPerNode: this.info.entriesPerNode,
                metadataKeys: this.info.metadataKeys,
                smallLeafs: this.info.hasSmallLeafs,
                // Not needed:
                byteLength: this.info.byteLength,
                freeBytes: this.info.freeSpace,
                fillFactor: this.info.fillFactor,
            });
            const extData = leafInfo.extData
                ? {
                    length: leafInfo.extData.length,
                    freeBytes: leafInfo.extData.freeBytes,
                    rebuild: leafInfo.extData.loaded,
                }
                : null;
            const addFreeSpace = options.addFreeSpace !== false;
            const writes = [];
            const bytes = builder.createLeaf({
                index: leafInfo.index,
                prevIndex: leafInfo.prevLeafIndex,
                nextIndex: leafInfo.nextLeafIndex,
                entries: leafInfo.entries,
                extData,
            }, {
                addFreeSpace,
                maxLength: leafInfo.length,
                addExtData: (pointerIndex, data) => {
                    // Write additional ext_data_block
                    const extIndex = extData.length - extData.freeBytes;
                    const fileIndex = leafInfo.sourceIndex + leafInfo.length + extIndex;
                    const bytes = new Uint8ArrayBuilder();
                    const minRequired = data.length + 8;
                    if (extData.freeBytes < minRequired) {
                        throw new DetailedError('max-extdata-size-reached', 'Not enough free space in ext_data');
                    }
                    // Calculate free space
                    const maxFree = extData.freeBytes - minRequired; // Max available free space for new block
                    const free = addFreeSpace ? Math.min(maxFree, Math.ceil(data.length * 0.1)) : 0;
                    const length = data.length + free;
                    // ext_block_length:
                    bytes.writeUint32(length);
                    // ext_block_free_length:
                    bytes.writeUint32(free);
                    // data:
                    bytes.append(data);
                    // Add free space:
                    bytes.append(new Uint8Array(free));
                    // Adjust extData
                    extData.freeBytes -= bytes.length;
                    const writePromise = this._writeFn(bytes.data, fileIndex);
                    writes.push(writePromise);
                    return { extIndex };
                },
            });
            const maxLength = leafInfo.length + (leafInfo.extData && leafInfo.extData.loaded ? leafInfo.extData.length : 0);
            assert(bytes.length <= maxLength, 'more bytes needed than allocated for leaf');
            // write leaf:
            const promise = this._writeFn(bytes, leafInfo.index);
            writes.push(promise);
            // // Check ext_free_byte_length
            // if (leafInfo.hasExtData) {
            //     const extDataLength =  _writeByteLength([], 0, extData.length);
            //     const extDataFreeBytes =  _writeByteLength([], 0, extData.freeBytes);
            //     // Check ext_free_byte_length
            //     bytes.slice(21, 25).forEach((b, i) => {
            //         assert(b === extDataLength[i], 'Not the same');
            //     });
            //     // Check ext_free_byte_length
            //     bytes.slice(25, 29).forEach((b, i) => {
            //         assert(b === extDataFreeBytes[i], 'Not the same');
            //     });
            // }
            const result = await Promise.all(writes);
            // await this._testTree();
            return result;
        }
        catch (err) {
            throw new DetailedError('write-leaf-fail', `Failed to write leaf: ${err.message}`, err);
        }
    }
    /**
     * TODO: rename to `parseNode` or something
     */
    _getNode(nodeInfo, reader) {
        // const node = {
        //     entries: []
        // };
        const node = new BinaryBPlusTreeNode(nodeInfo);
        const bytes = node.bytes;
        const entriesLength = bytes[0];
        assert(entriesLength > 0, 'Node read failure: no entries');
        let index = 1;
        for (let i = 0; i < entriesLength; i++) {
            const keyInfo = BPlusTree.getKeyFromBinary(bytes, index);
            const key = keyInfo.key;
            index += keyInfo.byteLength;
            const entry = new BinaryBPlusTreeNodeEntry(key);
            node.entries.push(entry);
            // read lt_child_ptr:
            entry.ltChildOffset = readSignedOffset(bytes, index, this.info.hasLargePtrs); // lt_child_ptr
            assert(entry.ltChildOffset !== 0, 'Node read failure: invalid ltChildOffset 0');
            entry.ltChildIndex = node.index + index + 9 + entry.ltChildOffset + (this.info.hasLargePtrs ? 5 : 3); // index + 9 header bytes, +5 because offset is from first byte
            entry.getLtChild = async () => {
                // return savedPosition.go(entry.ltChildOffset)
                await reader.go(entry.ltChildIndex);
                const childNodeInfo = await this._readChild(reader);
                childNodeInfo.parentNode = node;
                childNodeInfo.parentEntry = entry;
                return childNodeInfo;
            };
            index += this.info.hasLargePtrs ? 6 : 4;
        }
        // read gt_child_ptr:
        node.gtChildOffset = readSignedOffset(bytes, index, this.info.hasLargePtrs); // gt_child_ptr
        assert(node.gtChildOffset !== 0, 'Node read failure: invalid gtChildOffset 0');
        node.gtChildIndex = node.index + index + 9 + node.gtChildOffset + (this.info.hasLargePtrs ? 5 : 3); // index + 9 header bytes, +5 because offset is from first byte
        node.getGtChild = async () => {
            await reader.go(node.gtChildIndex);
            const childNodeInfo = await this._readChild(reader);
            childNodeInfo.parentNode = node;
            childNodeInfo.parentEntry = null;
            return childNodeInfo;
        };
        return node;
    }
    /**
     *
     * @param mode If the requested lock is shared (reads) or exclusive (writes)
     * @param fn function to execute with lock in place
     * @returns
     */
    async _threadSafe(mode, fn) {
        if (!this.id) {
            throw new DetailedError('tree-id-not-set', 'Set tree.id property to something unique for locking purposes');
        }
        const lock = await ThreadSafe.lock(this.id, { timeout: 15 * 60 * 1000, shared: mode === 'shared' }); // 15 minutes for debugging:
        try {
            let result = fn();
            if (result instanceof Promise) {
                result = await result;
            }
            return result;
        }
        finally {
            lock.release();
        }
    }
    async getFirstLeaf(options) {
        return this._threadSafe('shared', () => this._getFirstLeaf(options));
    }
    async _getFirstLeaf(options) {
        const reader = await this._getReader();
        let nodeInfo = await this._readChild(reader);
        while (!nodeInfo.isLeaf) {
            const node = this._getNode(nodeInfo, reader);
            const firstEntry = node.entries[0];
            assert(firstEntry, 'node has no entries!');
            nodeInfo = await firstEntry.getLtChild();
        }
        const leaf = this._getLeaf(nodeInfo, reader, options);
        return leaf;
    }
    async getLastLeaf(options) {
        return this._threadSafe('shared', () => this._getLastLeaf(options));
    }
    async _getLastLeaf(options) {
        const reader = await this._getReader();
        let nodeInfo = await this._readChild(reader);
        while (!nodeInfo.isLeaf) {
            const node = this._getNode(nodeInfo, reader);
            nodeInfo = await node.getGtChild();
        }
        const leaf = this._getLeaf(nodeInfo, reader, options);
        return leaf;
    }
    async findLeaf(searchKey, options) {
        return this._threadSafe('shared', () => this._findLeaf(searchKey, options));
    }
    async _findLeaf(searchKey, options) {
        // searchKey = _normalizeKey(searchKey); // if (_isIntString(searchKey)) { searchKey = parseInt(searchKey); }
        const reader = await this._getReader();
        let nodeInfo = await this._readChild(reader);
        while (!nodeInfo.isLeaf) {
            const node = this._getNode(nodeInfo, reader);
            if (node.entries.length === 0) {
                throw new Error('read node has no entries!');
            }
            const targetEntry = node.entries.find(entry => _isLess(searchKey, entry.key));
            if (targetEntry) {
                nodeInfo = await targetEntry.getLtChild();
            }
            else {
                nodeInfo = await node.getGtChild();
            }
        }
        const leaf = this._getLeaf(nodeInfo, reader, options);
        return leaf;
    }
    /**
     * Searches the tree
     * @param op operator to use for key comparison, can be single value operators "<", "<=", "==", "!=", ">", ">=", "matches", "!matches", double value operators "between", "!between", and multiple value operators "in", "!in"
     * @param param single value or array for double/multiple value operators
     * @param include what data to include in results. `filter`: recordPointers to filter upon
     * @returns {Promise<{ entries?: BinaryBPlusTreeLeafEntry[], keys?: Array, keyCount?: number, valueCount?: number, values?: BinaryBPlusTreeLeafEntryValue[] }}
     */
    search(op, param, include = { entries: true, values: false, keys: false, count: false }) {
        return this._threadSafe('shared', () => this._search(op, param, include));
    }
    /**
     * Searches the tree
     * @param op operator to use for key comparison, can be single value operators "<", "<=", "==", "!=", ">", ">=", "matches", "!matches", double value operators "between", "!between", and multiple value operators "in", "!in"
     * @param param single value or array for double/multiple value operators
     * @param include what data to include in results. `filter`: recordPointers to filter upon
     * @returns {Promise<{ entries?: BinaryBPlusTreeLeafEntry[]; keys?: Array; keyCount?: number; valueCount?: number; values?: BinaryBPlusTreeLeafEntryValue[] }>}
     */
    _search(op, param, include = { entries: true, values: false, keys: false, count: false }) {
        // TODO: async'ify
        if (typeof op === 'string' && ['in', '!in', 'between', '!between'].includes(op) && !(param instanceof Array)) {
            // param must be an array
            throw new TypeError(`param must be an array when using operator ${op}`);
        }
        if (typeof op === 'string' && ['exists', '!exists'].includes(op)) {
            // These operators are a bit strange: they return results for key [undefined] (op === "!exists"), or all other keys (op === "exists")
            // search("exists", ..) executes ("!=", undefined)
            // search("!exists", ..) executes ("==", undefined)
            op = op === 'exists' ? '!=' : '==';
            param = undefined;
        }
        if (param === null) {
            param = undefined;
        }
        const getLeafOptions = { stats: !(include.entries || include.values) };
        const results = {
            entries: [],
            keys: [],
            keyCount: 0,
            valueCount: 0,
            values: [], // was not implemented? is include.values used anywhere?
        };
        let blacklistRpTree;
        if (op instanceof BlacklistingSearchOperator) {
            blacklistRpTree = new BPlusTree(255, true);
        }
        // const binaryCompare = (a, b) => {
        //     if (a.length < b.length) { return -1; }
        //     if (a.length > b.length) { return 1; }
        //     for (let i = 0; i < a.length; i++) {
        //         if (a[i] < b[i]) { return -1; }
        //         if (a[i] > b[i]) { return 1; }
        //     }
        //     return 0;
        // }
        const filterRecordPointers = include.filter
            // Using string comparison:
            ? include.filter.reduce((arr, entry) => {
                arr = arr.concat(entry.values.map(val => String.fromCharCode(...val.recordPointer)));
                return arr;
            }, [])
            // // Using binary comparison:
            // ? include.filter.reduce((arr, entry) => {
            //     arr = arr.concat(entry.values.map(val => val.recordPointer));
            //     return arr;
            // }, []).sort(binaryCompare)
            : null;
        let totalMatches = 0;
        let totalAdded = 0;
        const valuePromises = [];
        const emptyValue = [];
        const add = (entry) => {
            totalMatches += entry.totalValues;
            const requireValues = filterRecordPointers || include.entries || include.values || op instanceof BlacklistingSearchOperator;
            if (requireValues && typeof entry.extData === 'object' && !entry.extData.loaded) {
                // We haven't got its values yet
                const p = entry.extData.loadValues().then(() => {
                    return add(entry); // Do it now
                });
                valuePromises.push(p);
                return p;
            }
            if (filterRecordPointers || op instanceof BlacklistingSearchOperator) {
                // Generate rp's for each value
                entry.values.forEach(val => {
                    val.rp = String.fromCharCode(...val.recordPointer);
                });
            }
            if (filterRecordPointers) {
                // Apply filter first, only use what remains
                // String comparison method seem to have slightly better performance than binary
                // Using string comparison:
                const values = entry.values.filter(val => filterRecordPointers.includes(val.rp));
                // const recordPointers = entry.values.map(val => String.fromCharCode(...val.recordPointer));
                // const values = [];
                // for (let i = 0; i < recordPointers.length; i++) {
                //     let a = recordPointers[i];
                //     if (~filterRecordPointers.indexOf(a)) {
                //         values.push(entry.values[i]);
                //     }
                // }
                // // Using binary comparison:
                // const recordPointers = entry.values.map(val => val.recordPointer).sort(binaryCompare);
                // const values = [];
                // for (let i = 0; i < recordPointers.length; i++) {
                //     let a = recordPointers[i];
                //     for (let j = 0; j < filterRecordPointers.length; j++) {
                //         let b = filterRecordPointers[j];
                //         let diff = binaryCompare(a, b);
                //         if (diff === 0) {
                //             let index = entry.values.findIndex(val => val.recordPointer === a);
                //             values.push(entry.values[index]);
                //             break;
                //         }
                //         else if (diff === -1) {
                //             // stop searching for this recordpointer
                //             break;
                //         }
                //     }
                // }
                if (values.length === 0) {
                    return;
                }
                entry.values = values;
                entry.totalValues = values.length;
            }
            if (op instanceof BlacklistingSearchOperator) {
                // // Generate rp's for each value
                // entry.values.forEach(val => {
                //     val.rp = val.rp || String.fromCharCode(...val.recordPointer);
                // });
                // Check which values were previously blacklisted
                entry.values = entry.values.filter(val => {
                    return blacklistRpTree.find(val.rp) === null;
                });
                if (entry.values.length === 0) {
                    return;
                }
                // Check which values should be blacklisted
                const blacklistValues = op.check(entry);
                if (blacklistValues instanceof Array) {
                    // Add to blacklist tree
                    blacklistValues.forEach(val => {
                        blacklistRpTree.add(val.rp, emptyValue);
                    });
                    // Remove from current results
                    entry.values = blacklistValues === entry.values
                        ? [] // Same array, so all values were blacklisted
                        : entry.values.filter(value => blacklistValues.indexOf(value) < 0);
                    const removed = { values: 0, entries: 0 };
                    if (include.values) {
                        // Remove from previous results (values)
                        for (let i = 0; i < results.values.length; i++) {
                            const val = results.values[i];
                            // if (!val.rp) { val.rp = String.fromCharCode(...val.recordPointer); }
                            if (blacklistRpTree.find(val.rp)) {
                                results.values.splice(i, 1);
                                i--;
                                removed.values++;
                            }
                        }
                    }
                    if (include.entries) {
                        // Remove from previous results (entries, keys)
                        for (let i = 0; i < results.entries.length; i++) {
                            const entry = results.entries[i];
                            for (let j = 0; j < entry.values.length; j++) {
                                const val = entry.values[j];
                                // if (!val.rp) { val.rp = String.fromCharCode(...val.recordPointer); }
                                if (blacklistRpTree.find(val.rp)) {
                                    entry.values.splice(j, 1);
                                    j--;
                                    if (!include.values) {
                                        removed.values++;
                                    }
                                    if (entry.values.length === 0) {
                                        results.entries.splice(i, 1);
                                        i--;
                                        removed.entries++;
                                        if (include.keys) {
                                            results.keys.splice(results.keys.indexOf(entry.key), 1);
                                        }
                                    }
                                }
                            }
                        }
                    }
                    results.valueCount -= removed.values;
                    results.keyCount -= removed.entries;
                    if (entry.values.length === 0) {
                        return;
                    }
                }
                // The way BlacklistingSearchOperator is currently used (including ALL values
                // in the index besides the ones that are blacklisted along the way), we only
                // want unique "non-blacklisted" recordpointers in the results. So, we want to
                // remove all values that are already present in the current results:
                for (let i = 0; i < entry.values.length; i++) {
                    const currentValue = entry.values[i];
                    let remove = false;
                    if (include.values) {
                        // TODO: change to: remove = results.values.includes
                        const index = results.values.findIndex(val => val.rp === currentValue.rp);
                        remove = index >= 0;
                    }
                    else if (include.entries) {
                        // Check result entries
                        for (let j = 0; j < results.entries.length; j++) {
                            const entry = results.entries[j];
                            // TODO: change to: remove = entry.values.includes
                            const index = entry.values.findIndex(val => val.rp === currentValue.rp);
                            remove = index >= 0;
                            if (remove) {
                                break;
                            }
                        }
                    }
                    if (remove) {
                        entry.values.splice(i, 1);
                        i--;
                    }
                }
                if (entry.values.length === 0) {
                    return;
                }
            }
            if (include.entries) {
                results.entries.push(entry);
            }
            if (include.keys) {
                results.keys.push(entry.key);
            }
            if (include.values) {
                entry.values.forEach(val => results.values.push(val));
            }
            if (include.count) {
                results.keyCount++;
                results.valueCount += entry.totalValues;
            }
            totalAdded += entry.totalValues;
        };
        // const t1 = Date.now();
        // const ret = () => {
        //     const t2 = Date.now();
        //     this.debug.log(`tree.search [${op} ${param}] took ${t2-t1}ms, matched ${totalMatches} values, returning ${totalAdded} values in ${results.entries.length} entries`);
        //     return results;
        // };
        const ret = () => {
            if (valuePromises.length > 0) {
                return Promise.all(valuePromises)
                    .then(() => results);
            }
            else {
                return results;
            }
        };
        if (op instanceof BlacklistingSearchOperator) {
            // NEW: custom callback methods to check match
            // Full index scan needed
            const processLeaf = (leaf) => {
                for (let i = 0; i < leaf.entries.length; i++) {
                    const entry = leaf.entries[i];
                    // const keyMatch = typeof op.keyCheck === 'function' ? op.keyCheck(entry.key) : true;
                    // if (!keyMatch) { continue; }
                    add(entry); // check will be done by add
                }
                if (leaf.hasNext) {
                    return leaf.getNext()
                        .then(processLeaf);
                }
                else {
                    return ret(); // results; //ret(results);
                }
            };
            return this._getFirstLeaf(getLeafOptions)
                .then(processLeaf);
        }
        else if (['<', '<='].indexOf(op) >= 0) {
            const processLeaf = (leaf) => {
                let stop = false;
                for (let i = 0; i < leaf.entries.length; i++) {
                    const entry = leaf.entries[i];
                    if (op === '<=' && _isLessOrEqual(entry.key, param)) {
                        add(entry);
                    }
                    else if (op === '<' && _isLess(entry.key, param)) {
                        add(entry);
                    }
                    else {
                        stop = true;
                        break;
                    }
                }
                if (!stop && leaf.getNext) {
                    return leaf.getNext()
                        .then(processLeaf);
                }
                else {
                    return ret(); //results; //ret(results);
                }
            };
            return this._getFirstLeaf(getLeafOptions)
                .then(processLeaf);
        }
        else if (['>', '>='].indexOf(op) >= 0) {
            const processLeaf = (leaf) => {
                for (let i = 0; i < leaf.entries.length; i++) {
                    const entry = leaf.entries[i];
                    if (op === '>=' && _isMoreOrEqual(entry.key, param)) {
                        add(entry);
                    }
                    else if (op === '>' && _isMore(entry.key, param)) {
                        add(entry);
                    }
                }
                if (leaf.hasNext) {
                    return leaf.getNext()
                        .then(processLeaf);
                }
                else {
                    return ret(); //results; //ret(results);
                }
            };
            return this._findLeaf(param, getLeafOptions)
                .then(processLeaf);
        }
        else if (op === '==') {
            return this._findLeaf(param, getLeafOptions)
                .then(leaf => {
                const entry = leaf.entries.find(entry => _isEqual(entry.key, param)); //entry.key === param
                if (entry) {
                    add(entry);
                }
                return ret(); // results; //ret(results);
            });
        }
        else if (op === '!=') {
            // Full index scan needed
            const processLeaf = (leaf) => {
                for (let i = 0; i < leaf.entries.length; i++) {
                    const entry = leaf.entries[i];
                    if (_isNotEqual(entry.key, param)) {
                        add(entry);
                    } //entry.key !== param
                }
                if (leaf.hasNext) {
                    return leaf.getNext()
                        .then(processLeaf);
                }
                else {
                    return ret(); // results; //ret(results);
                }
            };
            return this._getFirstLeaf(getLeafOptions)
                .then(processLeaf);
        }
        else if (op === 'like') {
            if (typeof param !== 'string') {
                throw new TypeError(`search param value must be a string for operator 'like'`);
            }
            const wildcardIndex = ~(~param.indexOf('*') || ~param.indexOf('?')); // TODO: make less cryptic
            const startSearch = wildcardIndex > 0 ? param.slice(0, wildcardIndex) : '';
            const pattern = '^' + param.replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
            const re = new RegExp(pattern, 'i');
            const processLeaf = (leaf) => {
                for (let i = 0; i < leaf.entries.length; i++) {
                    const entry = leaf.entries[i];
                    if (re.test(entry.key.toString())) {
                        add(entry);
                    }
                }
                let stop = false;
                if (wildcardIndex > 0 && leaf.entries.length > 0) {
                    // Check if we can stop. If the last entry does not start with the first part of the string.
                    // Eg: like 'Al*', we can stop if the last entry starts with 'Am'
                    const lastEntry = leaf.entries[leaf.entries.length - 1];
                    stop = lastEntry.key.toString().slice(0, wildcardIndex) > startSearch;
                }
                if (!stop && leaf.getNext) {
                    return leaf.getNext()
                        .then(processLeaf);
                }
                else {
                    return ret();
                }
            };
            if (wildcardIndex === 0) {
                return this._getFirstLeaf(getLeafOptions)
                    .then(processLeaf);
            }
            else {
                return this._findLeaf(startSearch, getLeafOptions)
                    .then(processLeaf);
            }
        }
        else if (op === '!like') {
            // Full index scan needed
            if (typeof param !== 'string') {
                throw new TypeError(`search param value must be a string for operator '!like'`);
            }
            const pattern = '^' + param.replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
            const re = new RegExp(pattern, 'i');
            const processLeaf = (leaf) => {
                for (let i = 0; i < leaf.entries.length; i++) {
                    const entry = leaf.entries[i];
                    if (!re.test(entry.key.toString())) {
                        add(entry);
                    }
                }
                if (leaf.hasNext) {
                    return leaf.getNext()
                        .then(processLeaf);
                }
                else {
                    return ret(); // results; //ret(results);
                }
            };
            return this._getFirstLeaf(getLeafOptions)
                .then(processLeaf);
        }
        else if (op === 'in') {
            if (!(param instanceof Array)) {
                throw new TypeError(`search param value must be an array for operator 'in'`);
            }
            const sorted = param.slice().sort();
            let searchKey = sorted.shift();
            const processLeaf = (leaf) => {
                while (true) {
                    const entry = leaf.entries.find(entry => _isEqual(entry.key, searchKey)); //entry.key === searchKey
                    if (entry) {
                        add(entry);
                    }
                    searchKey = sorted.shift();
                    if (!searchKey) {
                        return ret(); // results; //ret(results);
                    }
                    else if (_isMore(searchKey, leaf.entries[leaf.entries.length - 1].key)) {
                        return this._findLeaf(searchKey).then(processLeaf);
                    }
                    // Stay in the loop trying more keys on the same leaf
                }
            };
            return this._findLeaf(searchKey, getLeafOptions)
                .then(processLeaf);
        }
        else if (op === '!in') {
            // Full index scan needed
            if (!(param instanceof Array)) {
                throw new TypeError(`search param value must be an array for operator '!in'`);
            }
            const keys = param;
            const processLeaf = (leaf) => {
                for (let i = 0; i < leaf.entries.length; i++) {
                    const entry = leaf.entries[i];
                    if (keys.findIndex(key => _isEqual(key, entry.key)) < 0) {
                        add(entry);
                    } //if (keys.indexOf(entry.key) < 0)
                }
                if (leaf.hasNext) {
                    return leaf.getNext()
                        .then(processLeaf);
                }
                else {
                    return ret(); //results; //ret(results);
                }
            };
            return this._getFirstLeaf(getLeafOptions)
                .then(processLeaf);
        }
        else if (op === 'between') {
            if (!(param instanceof Array)) {
                throw new TypeError(`search param value must be an array for operator 'between'`);
            }
            let bottom = param[0], top = param[1];
            if (top < bottom) {
                const swap = top;
                top = bottom;
                bottom = swap;
            }
            return this._findLeaf(bottom, getLeafOptions)
                .then(leaf => {
                let stop = false;
                const processLeaf = (leaf) => {
                    for (let i = 0; i < leaf.entries.length; i++) {
                        const entry = leaf.entries[i];
                        if (_isMoreOrEqual(entry.key, bottom) && _isLessOrEqual(entry.key, top)) {
                            add(entry);
                        }
                        if (_isMore(entry.key, top)) {
                            stop = true;
                            break;
                        }
                    }
                    if (stop || !leaf.getNext) {
                        return ret(); // results; //ret(results);
                    }
                    else {
                        return leaf.getNext().then(processLeaf);
                    }
                };
                return processLeaf(leaf);
            });
        }
        else if (op === '!between') {
            // Equal to key < bottom || key > top
            if (!(param instanceof Array)) {
                throw new TypeError(`search param value must be an array for operator '!between'`);
            }
            let bottom = param[0], top = param[1];
            if (top < bottom) {
                const swap = top;
                top = bottom;
                bottom = swap;
            }
            // Add lower range first, lowest value < val < bottom
            return this._getFirstLeaf(getLeafOptions)
                .then(leaf => {
                let stop = false;
                const processLeaf = (leaf) => {
                    for (let i = 0; i < leaf.entries.length; i++) {
                        const entry = leaf.entries[i];
                        if (_isLess(entry.key, bottom)) {
                            add(entry);
                        }
                        else {
                            stop = true;
                            break;
                        }
                    }
                    if (!stop && leaf.getNext) {
                        return leaf.getNext().then(processLeaf);
                    }
                };
                return processLeaf(leaf);
            })
                .then(() => {
                // Now add upper range, top < val < highest value
                return this._findLeaf(top, getLeafOptions);
            })
                .then(leaf => {
                const processLeaf = (leaf) => {
                    for (let i = 0; i < leaf.entries.length; i++) {
                        const entry = leaf.entries[i];
                        if (_isMore(entry.key, top)) {
                            add(entry);
                        }
                    }
                    if (!leaf.getNext) {
                        return ret(); // results; //ret(results);
                    }
                    else {
                        return leaf.getNext().then(processLeaf);
                    }
                };
                return processLeaf(leaf);
            });
        }
        else if (op === 'matches' || op === '!matches') {
            // Full index scan needed
            if (!(param instanceof RegExp)) {
                throw new TypeError(`search param value must be a RegExp for operator 'matches' and '!matches'`);
            }
            const re = param;
            const processLeaf = (leaf) => {
                for (let i = 0; i < leaf.entries.length; i++) {
                    const entry = leaf.entries[i];
                    const isMatch = re.test(entry.key.toString());
                    if ((isMatch && op === 'matches') || (!isMatch && op === '!matches')) {
                        add(entry);
                    }
                }
                if (leaf.hasNext) {
                    return leaf.getNext()
                        .then(processLeaf);
                }
                else {
                    return ret(); // results; //ret(results);
                }
            };
            return this._getFirstLeaf(getLeafOptions)
                .then(processLeaf);
        }
        else {
            throw new Error(`Unknown search operator "${op}"`);
        }
    }
    /**
     * @returns returns a promise that resolves with 1 value (unique keys), a values array or the number of values (options.stats === true)
     */
    async find(searchKey, options) {
        return this._threadSafe('shared', () => this._find(searchKey, options));
    }
    /**
     * @returns returns a promise that resolves with 1 value (unique keys), a values array or the number of values (options.stats === true)
     */
    async _find(searchKey, options) {
        // searchKey = _normalizeKey(searchKey); //if (_isIntString(searchKey)) { searchKey = parseInt(searchKey); }
        const leaf = options?.leaf ?? await this._findLeaf(searchKey, options);
        const entry = leaf.entries.find(entry => _isEqual(searchKey, entry.key));
        if (!this.info) {
            throw new NoTreeInfoError();
        }
        if (options && options.stats) {
            return entry?.totalValues ?? 0;
        }
        else if (entry) {
            if (entry.extData) {
                await entry.extData.loadValues();
            }
            return this.info.isUnique
                ? entry.values[0]
                : entry.values;
        }
        else {
            return null;
        }
    }
    /**
     * @param options `existingOnly`: Whether to only return lookup results for keys that were actually found
     */
    async findAll(keys, options) {
        return this._threadSafe('shared', () => this._findAll(keys, options));
    }
    async _findAll(keys, options = { existingOnly: true, stats: false }) {
        options.stats = options.stats === true;
        if (keys.length <= 2) {
            const promises = keys.map(async (key) => {
                const result = await this._find(key, { stats: options.stats });
                const value = options.stats ? null : result;
                const totalValues = options.stats ? result : value === null ? 0 : value instanceof Array ? value.length : 1;
                return { key, value, totalValues };
            });
            const results = await Promise.all(promises);
            return options.existingOnly
                ? results.filter(r => options.stats ? r.totalValues > 0 : r.value !== null)
                : results;
        }
        // Get upperbound
        const lastLeaf = await this._getLastLeaf();
        const lastEntry = lastLeaf.entries.slice(-1)[0];
        const lastKey = lastEntry.key;
        // Sort the keys
        keys = keys.slice().sort();
        if (_isMore(keys[0], lastKey)) {
            // First key to lookup is > lastKey, no need to lookup anything!
            return options.existingOnly ? [] : keys.map(key => ({ key, value: null, totalValues: 0 }));
        }
        // Get lowerbound
        const firstLeaf = await this._getFirstLeaf();
        const firstEntry = firstLeaf.entries[0];
        const firstKey = firstEntry.key;
        if (_isLess(keys.slice(-1)[0], firstKey)) {
            // Last key to lookup is < firstKey, no need to lookup anything!
            return options.existingOnly ? [] : keys.map(key => ({ key, value: null, totalValues: 0 }));
        }
        // Some keys might be out of bounds, others must be looked up
        const results = [], lookups = [];
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            if (_isLess(key, firstKey) || _isMore(key, lastKey)) {
                // Out of bounds, no need to lookup
                options.existingOnly || results.push({ key, value: null, totalValues: 0 });
            }
            else {
                // Lookup
                lookups.push(key);
            }
        }
        lookups.sort((a, b) => _isLess(a, b) ? -1 : 1);
        for (let i = 0; i < lookups.length;) {
            let key = lookups[i];
            const leaf = await this._findLeaf(key);
            const lastKey = leaf.entries.slice(-1)[0]?.key;
            const expectedKeysInLeaf = lookups.slice(i).filter(key => _isLessOrEqual(key, lastKey));
            if (!options.stats && leaf.hasExtData && !leaf.extData.loaded && expectedKeysInLeaf.length > 1) {
                // Prevent many (small, locking) ext_data reads by _find -> perform 1 whole ext_data read now
                await leaf.extData.load();
            }
            const promises = [];
            do {
                const lookupKey = key;
                const p = this._find(lookupKey, { leaf, stats: options.stats }).then(result => {
                    const value = options.stats ? null : result;
                    const totalValues = options.stats ? result : value === null ? 0 : value instanceof Array ? value.length : 1;
                    const exists = options.stats ? totalValues > 0 : value !== null;
                    if (exists || !options.existingOnly) {
                        results.push({ key: lookupKey, value, totalValues });
                    }
                });
                promises.push(p);
                key = lookups[++i];
            } while (lastKey && i < lookups.length && _isLessOrEqual(key, lastKey));
            await Promise.all(promises);
        }
        return results;
    }
    async _growTree(bytesNeeded) {
        if (!this.info) {
            throw new NoTreeInfoError();
        }
        if (!this._autoGrow) {
            throw new Error('Cannot grow tree - autoGrow not enabled');
        }
        const grow = bytesNeeded - this.info.freeSpace;
        this.info.byteLength += grow;
        this.info.freeSpace += grow;
        await this._writeAllocationBytes(); // write
    }
    async writeAllocationBytes() {
        return this._threadSafe('exclusive', () => this._writeAllocationBytes());
    }
    async _writeAllocationBytes() {
        if (!this.info) {
            throw new NoTreeInfoError();
        }
        await Promise.all([
            // byte_length:
            this._writeFn(writeByteLength([], 0, this.info.byteLength), 0),
            // free_byte_length:
            this._writeFn(writeByteLength([], 0, this.info.freeSpace), this.info.freeSpaceIndex),
        ]);
    }
    /**
     * Sets allocation bytes in provided buffer, useful when growing the tree while rewriting
     * @param buffer target buffer
     * @param byteLength new tree byte length
     * @param freeSpace new free space length
     */
    async setAllocationBytes(buffer, byteLength, freeSpace) {
        // byte_length:
        buffer.set(writeByteLength([], 0, byteLength), 0);
        // free_byte_length:
        buffer.set(writeByteLength([], 0, freeSpace), this.info.freeSpaceIndex);
    }
    async _registerFreeSpace(index, length) {
        if (!this.info) {
            throw new NoTreeInfoError();
        }
        if (!this._fst) {
            this._fst = [];
        }
        if (index + length === this.info.byteLength - this.info.freeSpace) {
            // Cancel free space allocated at the end of the file
            // this.debug.log(`Freeing ${length} bytes from index ${index} (at end of file)`);
            this.info.freeSpace += length;
            await this._writeFn(writeByteLength([], 0, this.info.freeSpace), this.info.freeSpaceIndex); // free_byte_length
        }
        else {
            // this.debug.log(`Freeing ${length} bytes from index ${index} to ${index+length}`);
            this._fst.push({ index, length });
            // Normalize fst by joining adjacent blocks
            this._fst.sort((a, b) => a.index < b.index ? -1 : 1);
            let i = 0;
            while (i + 1 < this._fst.length) {
                const block = this._fst[i];
                const next = this._fst[i + 1];
                if (next.index === block.index + block.length) {
                    // Adjacent!
                    block.length += next.length; // Add space to this item
                    this._fst.splice(i + 1, 1); // Remove next
                }
                else {
                    i++;
                }
            }
        }
    }
    async _claimFreeSpace(bytesRequired) {
        if (!this.info) {
            throw new NoTreeInfoError();
        }
        // if (bytesRequired === 0) { return Promise.reject(new Error('Claiming 0 bytes')); } // ALLOW this!
        if (bytesRequired > this.info.freeSpace) {
            throw new Error('Attempt to claim more bytes than available in trailing free space');
        }
        this.info.freeSpace -= bytesRequired;
        await this._writeFn(writeByteLength([], 0, this.info.freeSpace), this.info.freeSpaceIndex);
    }
    async _requestFreeSpace(bytesRequired) {
        if (!this.info) {
            throw new NoTreeInfoError();
        }
        if (bytesRequired === 0) {
            throw new Error('Requesting 0 bytes');
        }
        if (!this._fst) {
            this._fst = [];
        }
        const available = this._fst.filter(block => block.length >= bytesRequired);
        if (available.length > 0) {
            const best = available.sort((a, b) => a.length - b.length)[0];
            this._fst.splice(this._fst.indexOf(best), 1);
            return best;
        }
        else {
            // Check if there is not too much wasted space
            const wastedSpace = this._fst.reduce((total, block) => total + block.length, 0);
            const maxWaste = Math.round(this._originalByteLength * 0.5); // max 50% waste
            if (wastedSpace > maxWaste) {
                throw new Error('too much space being wasted. tree rebuild is needed');
            }
            if (this.info.freeSpace < bytesRequired) {
                if (this.autoGrow) {
                    await this._growTree(bytesRequired);
                }
                else {
                    throw new DetailedError('tree-full-no-autogrow', `tree doesn't have ${bytesRequired} free bytes and autoGrow is not enabled`);
                }
            }
            const index = this.info.byteLength - this.info.freeSpace;
            this.info.freeSpace -= bytesRequired;
            await this._writeFn(writeByteLength([], 0, this.info.freeSpace), this.info.freeSpaceIndex);
            return { index, length: bytesRequired };
        }
    }
    /**
     *
     * @param {BinaryBPlusTreeLeaf} leaf
     * @param {object} options
     * @param {boolean} [options.growData=false]
     * @param {boolean} [options.growExtData=false]
     * @param {(leaf: BinaryBPlusTreeLeaf) => any} [options.applyChanges] callback function to apply changes to leaf before writing
     * @param {boolean} [options.rollbackOnFailure=true] Whether to rewrite the original leaf on failure (only done if this is a one leaf tree) - disable if this rebuild is called because of a failure to write an updated leaf (rollback will fail too!)
     */
    async _rebuildLeaf(leaf, options = {
        growData: false,
        growExtData: false,
        rollbackOnFailure: true,
        prevLeaf: null,
        nextLeaf: null,
    }) {
        // rebuild the leaf
        // await this._testTree();
        const newLeafExtDataLength = options.growExtData ? Math.ceil(leaf.extData.length * 1.1) : leaf.extData.length;
        const extDataGrowth = newLeafExtDataLength - leaf.extData.length;
        const newLeafLength = options.growData ? Math.ceil(leaf.length * 1.1) : leaf.length;
        const leafGrows = options.growData || options.growExtData;
        const bytesNeeded = newLeafLength + newLeafExtDataLength; //leafGrows ? newLeafLength + newLeafExtDataLength : 0;
        if (!this.info) {
            throw new NoTreeInfoError();
        }
        if (this.info.freeSpace < bytesNeeded && !options.growData && options.growExtData && leaf.free >= extDataGrowth) {
            // ext_data must grow but can't because there is not enough free space to create a new leaf
            // the leaf however has enough free space to shrink a bit for the ext_data
            if (!leaf.extData.loaded) {
                await leaf.extData.load();
            }
            leaf.length -= extDataGrowth;
            leaf.free -= extDataGrowth;
            leaf.extData.length += extDataGrowth;
            leaf.extData.freeBytes += extDataGrowth;
            // options.growExtData = false; // already done by stealing from leaf
            // return this._rebuildLeaf(leaf, options);
            options.applyChanges && options.applyChanges(leaf);
            return this._writeLeaf(leaf);
        }
        // Read additional data needed to rebuild this leaf
        const reads = [];
        if (leaf.hasExtData) {
            if (!leaf.extData.loaded) {
                // Load all ext_data
                reads.push(leaf.extData.load());
            }
            else if (!leafGrows) {
                // We're done after rewriting this leaf
                options.applyChanges && options.applyChanges(leaf);
                return this._writeLeaf(leaf);
            }
        }
        if (reads.length > 0) {
            // Continue after all additional data has been loaded
            await Promise.all(reads);
        }
        const oneLeafTree = !leaf.parentNode;
        try {
            let allocated;
            if (oneLeafTree) {
                const available = leaf.length + leaf.extData.length + this.info.freeSpace;
                if (bytesNeeded < available) {
                    await this._claimFreeSpace(bytesNeeded - leaf.length - leaf.extData.length);
                    allocated = { index: leaf.index, length: bytesNeeded }; // overwrite leaf at same index
                }
                else if (this.autoGrow) {
                    const growBytes = bytesNeeded - available;
                    await this._growTree(growBytes);
                    allocated = { index: leaf.index, length: bytesNeeded };
                }
                else {
                    throw new Error('Not enough space to overwrite one leaf tree'); // not possible to overwrite
                }
            }
            else {
                allocated = await this._requestFreeSpace(bytesNeeded); // request free space
            }
            // Create new leaf
            const newLeaf = new BinaryBPlusTreeLeaf({
                isLeaf: true,
                index: allocated.index,
                length: allocated.length - newLeafExtDataLength,
                hasExtData: leaf.hasExtData,
                tree: leaf.tree,
            });
            newLeaf.prevLeafIndex = leaf.prevLeafIndex;
            newLeaf.nextLeafIndex = leaf.nextLeafIndex;
            newLeaf.entries = leaf.entries.map(entry => new BinaryBPlusTreeLeafEntry(entry.key, entry.values.slice()));
            if (leaf.hasExtData) {
                newLeaf.extData = {
                    loaded: true,
                    length: newLeafExtDataLength,
                    freeBytes: leaf.extData.freeBytes + (newLeafExtDataLength - leaf.extData.length),
                    load: noop,
                };
            }
            // Update indexes pointing to this leaf
            if (leaf.parentEntry) {
                leaf.parentEntry.ltChildIndex = newLeaf.index;
            }
            else if (leaf.parentNode) {
                leaf.parentNode.gtChildIndex = newLeaf.index;
            }
            const freedBytes = leaf.length + leaf.extData.length;
            // this.debug.log(`Rebuilding leaf for entries "${leaf.entries[0].key}" to "${leaf.entries[leaf.entries.length-1].key}"`);
            options.applyChanges && options.applyChanges(newLeaf);
            // Start transaction
            const tx = new TX();
            // Write new leaf:
            tx.queue({
                name: 'new leaf',
                action: async () => {
                    const result = await this._writeLeaf(newLeaf);
                    // this.debug.log(`new leaf for entries "${newLeaf.entries[0].key}" to "${newLeaf.entries.slice(-1)[0].key}" was written successfully at index ${newLeaf.index} (used to be at ${leaf.index})`);
                    // // TEST leaf
                    // const leaf = await this._findLeaf(newLeaf.entries[0].key);
                    // const promises = leaf.entries.filter(entry => entry.extData).map(entry => entry.extData.loadValues());
                    // await Promise.all(promises);
                    return `${result.length} leaf writes`;
                },
                rollback: async () => {
                    // release allocated space again
                    if (oneLeafTree) {
                        if (options.rollbackOnFailure === false) {
                            return;
                        }
                        return this._writeLeaf(leaf, { addFreeSpace: false });
                    }
                    else {
                        return this._registerFreeSpace(allocated.index, allocated.length);
                    }
                },
            });
            // Adjust previous leaf's next_leaf_ptr:
            if (leaf.hasPrevious) {
                const prevLeaf = {
                    nextPointerIndex: leaf.prevLeafIndex + BinaryBPlusTreeLeaf.nextLeafPtrIndex,
                    oldOffset: BinaryBPlusTreeLeaf.getNextLeafOffset(leaf.prevLeafIndex, leaf.index),
                    newOffset: BinaryBPlusTreeLeaf.getNextLeafOffset(leaf.prevLeafIndex, newLeaf.index),
                };
                tx.queue({
                    name: 'prev leaf next_leaf_ptr',
                    action: async () => {
                        const bytes = writeSignedOffset([], 0, prevLeaf.newOffset, true);
                        return this._writeFn(bytes, prevLeaf.nextPointerIndex);
                    },
                    rollback: async () => {
                        const bytes = writeSignedOffset([], 0, prevLeaf.oldOffset, true);
                        return this._writeFn(bytes, prevLeaf.nextPointerIndex);
                    },
                });
            }
            // Adjust next leaf's prev_leaf_ptr:
            if (leaf.hasNext) {
                const nextLeaf = {
                    prevPointerIndex: leaf.nextLeafIndex + BinaryBPlusTreeLeaf.prevLeafPtrIndex,
                    oldOffset: BinaryBPlusTreeLeaf.getPrevLeafOffset(leaf.nextLeafIndex, leaf.index),
                    newOffset: BinaryBPlusTreeLeaf.getPrevLeafOffset(leaf.nextLeafIndex, newLeaf.index),
                };
                tx.queue({
                    name: 'next leaf prev_leaf_ptr',
                    action: async () => {
                        const bytes = writeSignedOffset([], 0, nextLeaf.newOffset, true);
                        return this._writeFn(bytes, nextLeaf.prevPointerIndex);
                    },
                    rollback: async () => {
                        const bytes = writeSignedOffset([], 0, nextLeaf.oldOffset, true);
                        return this._writeFn(bytes, nextLeaf.prevPointerIndex);
                    },
                });
            }
            // Rewrite parent node
            if (leaf.parentNode) {
                tx.queue({
                    name: 'parent node',
                    action: async () => {
                        return this._writeNode(leaf.parentNode);
                    },
                    rollback: async () => {
                        // Set the target leaf indexes back to the originals
                        if (leaf.parentEntry) {
                            leaf.parentEntry.ltChildIndex = leaf.index;
                        }
                        else {
                            leaf.parentNode.gtChildIndex = leaf.index;
                        }
                        if (options.nextLeaf.parentNode === leaf.parentNode) {
                            if (options.nextLeaf.parentEntry) {
                                options.nextLeaf.parentEntry.ltChildIndex = options.nextLeaf.index;
                            }
                            else {
                                options.nextLeaf.parentNode.gtChildIndex = options.nextLeaf.index;
                            }
                        }
                        return this._writeNode(leaf.parentNode);
                    },
                });
            }
            const results = await tx.execute(true);
            if (!oneLeafTree) {
                await this._registerFreeSpace(leaf.index, freedBytes);
            }
            // await this._testTree();
            return results;
        }
        catch (err) {
            throw new DetailedError('rebuild-leaf-failed', `Failed to rebuild leaf: ${err.message}`, err);
        }
    }
    async _splitNode(node, options = { keepEntries: 0, cancelCallback: null }) {
        // split node if it could not be written.
        // There needs to be enough free space to store another leaf the size of current node,
        // and the parent node must not be full.
        if (typeof options.cancelCallback !== 'function') {
            throw new Error('specify options.cancelCallback to undo any changes when a rollback needs to be performed');
        }
        try {
            if (!node.parentNode) {
                throw new DetailedError('cannot-split-top-level-node', 'Cannot split top-level node, tree rebuild is needed');
            }
            if (node.parentNode.entries.length >= this.info.entriesPerNode) {
                // Split parent node before continuing
                const { node1, node2 } = await this._splitNode(node.parentNode, { cancelCallback: noop });
                // find out if this node is now a child of node1 or node2, update properties accordingly
                const parentEntry1 = node1.entries.find(e => e.ltChildIndex === node.index);
                const parentEntry2 = node2.entries.find(e => e.ltChildIndex === node.index);
                if (parentEntry1) {
                    node.parentNode = node1;
                    node.parentEntry = parentEntry1;
                }
                else if (parentEntry2) {
                    node.parentNode = node2;
                    node.parentEntry = parentEntry2;
                }
                else if (node1.gtChildIndex === node.index) {
                    node.parentNode = node1;
                    node.parentEntry = null;
                }
                else if (node2.gtChildIndex === node.index) {
                    node.parentNode = node2;
                    node.parentEntry = null;
                }
                else {
                    throw new Error('DEV ERROR: new parent nodes do not reference this node');
                }
            }
            if (typeof options.keepEntries !== 'number' || options.keepEntries === 0) {
                options.keepEntries = Math.floor(node.entries.length / 2);
            }
            if (options.keepEntries > this.info.entriesPerNode - 2) {
                options.keepEntries = this.info.entriesPerNode - 2; // 1 entry will move to the next node, 1 entry is removed as it becomes this node's gtChild
            }
            const newNodeLength = node.length; // Use same length as current node
            const allocated = await this._requestFreeSpace(newNodeLength);
            // this.debug.log(`Splitting node "${node.entries[0].key}" to "${node.entries.slice(-1)[0].key}", cutting at "${movingEntries[0].key}"`);
            // Create new node
            const newNode = new BinaryBPlusTreeNode({
                isLeaf: false,
                length: newNodeLength,
                index: allocated.index,
                tree: node.tree,
            });
            // current node's gtChild becomes new node's gtChild
            newNode.gtChildIndex = node.gtChildIndex;
            // move entries
            const movingEntries = node.entries.splice(options.keepEntries);
            // First entry is not moving, it becomes original node's gtChild and new parent node entry key
            const disappearingEntry = movingEntries.shift();
            node.gtChildIndex = disappearingEntry.ltChildIndex;
            // Add all other entries to new node
            newNode.entries.push(...movingEntries);
            // movingEntries.forEach(entry => {
            //     const childIndex = node.index + entry.ltChildOffset;
            //     const newEntry = new BinaryBPlusTreeNodeEntry(entry.key);
            //     newEntry.ltChildIndex = childIndex - newNode.index;
            //     newNode.entries.push(newEntry);
            // });
            // this.debug.log(`Creating new node for ${movingEntries.length} entries`);
            // Update parent node entry pointing to this node
            const oldParentNode = new BinaryBPlusTreeNode({
                isLeaf: false,
                index: node.parentNode.index,
                length: node.parentNode.length,
                free: node.parentNode.free,
            });
            oldParentNode.gtChildIndex = node.parentNode.gtChildIndex;
            oldParentNode.entries = node.parentNode.entries.map(entry => {
                const newEntry = new BinaryBPlusTreeNodeEntry(entry.key);
                newEntry.ltChildIndex = entry.ltChildIndex;
                return newEntry;
            });
            if (node.parentEntry !== null) {
                // Current node is a parent node entry's ltChild
                // eg: current node [10,11,12, ... ,18,19] is parent node [10,20,30] second entry's (20) ltChild.
                // When splitting to [10, ..., 14] and [15, ..., 19], we have to add key 15 to parent: [10,15,20,30]
                const newEntryKey = node.parentEntry.key; // (20 in above example)
                node.parentEntry.key = disappearingEntry.key; // movingEntries[0].key;    // (15 in above example)
                // Add new node entry for created node
                const insertIndex = node.parentNode.entries.indexOf(node.parentEntry) + 1;
                const newNodeEntry = new BinaryBPlusTreeNodeEntry(newEntryKey);
                newNodeEntry.ltChildIndex = newNode.index; // Set the target index, so _writeNode knows it must calculate the target offset
                node.parentNode.entries.splice(insertIndex, 0, newNodeEntry);
            }
            else {
                // Current node is parent node's gtChild
                const newNodeEntry = new BinaryBPlusTreeNodeEntry(disappearingEntry.key); //new BinaryBPlusTreeNodeEntry(movingEntries[0].key);
                newNodeEntry.ltChildIndex = node.index;
                node.parentNode.entries.push(newNodeEntry);
                node.parentNode.gtChildIndex = newNode.index;
            }
            // Start transaction
            const tx = new TX();
            // Write new node:
            tx.queue({
                name: 'write new node',
                action: async () => {
                    return this._writeNode(newNode);
                },
                rollback: async () => {
                    // Release allocated space again
                    return this._registerFreeSpace(allocated.index, allocated.length);
                },
                // No need to add rollback step to remove new node. It'll be overwritten later
            });
            // Rewrite this node:
            tx.queue({
                name: 'rewrite current node',
                action: async () => {
                    return this._writeNode(node);
                },
                rollback: async () => {
                    node.entries.push(...movingEntries);
                    const p = options.cancelCallback();
                    if (p instanceof Promise) {
                        return p.then(() => {
                            return this._writeNode(node);
                        });
                    }
                    return this._writeNode(node);
                },
            });
            // Rewrite parent node:
            tx.queue({
                name: 'rewrite parent node',
                action: async () => {
                    return this._writeNode(node.parentNode);
                },
                rollback: async () => {
                    // this is the last step, we don't need to rollback if we are running the tx sequentially.
                    // Because we run parallel, we need rollback code here:
                    return this._writeNode(oldParentNode);
                },
            });
            await tx.execute(true); // run parallel
            // await this._testTree();
            return { node1: node, node2: newNode };
        }
        catch (err) {
            throw new DetailedError('split-node-failed', `Unable to split node: ${err.message}`, err);
        }
    }
    async _splitLeaf(leaf, options = { nextLeaf: null, keepEntries: 0, cancelCallback: null }) {
        // split leaf if it could not be written.
        // this.debug.log('splitLeaf');
        // There needs to be enough free space to store another leaf the size of current leaf
        if (typeof options.cancelCallback !== 'function') {
            throw new Error('specify options.cancelCallback to undo any changes when a rollback needs to be performed');
        }
        if (leaf.parentNode.entries.length >= this.info.entriesPerNode) {
            // TODO: TEST splitting node
            // throw new DetailedError('parent-node-full', `Cannot split leaf because parent node is full`);
            // NEW: split parent node!
            const { node1, node2 } = await this._splitNode(leaf.parentNode, { keepEntries: options.keepEntries, cancelCallback: noop });
            // find out if leaf is now a child of node1 or node2, update properties and try again
            const parentEntry1 = node1.entries.find(e => e.ltChildIndex === leaf.index); // node1.entries.find(e => node1.index + e.ltChildOffset === leaf.index); //node1.entries.find(entry => entry === node.parentEntry); //
            const parentEntry2 = node2.entries.find(e => e.ltChildIndex === leaf.index); // node1.entries.find(e => node1.index + e.ltChildOffset === leaf.index); //node1.entries.find(entry => entry === node.parentEntry); //
            if (parentEntry1) {
                leaf.parentNode = node1;
                leaf.parentEntry = parentEntry1;
            }
            else if (parentEntry2) {
                leaf.parentNode = node2;
                leaf.parentEntry = parentEntry2;
            }
            else if (node1.gtChildIndex === leaf.index) {
                leaf.parentNode = node1;
                leaf.parentEntry = null;
            }
            else if (node2.gtChildIndex === leaf.index) {
                leaf.parentNode = node2;
                leaf.parentEntry = null;
            }
            else {
                throw new Error('DEV ERROR: new parent nodes have no reference this leaf');
                // if (leaf.entries[0].key <= node2.entries[node2.entries.length-1].key) {
                //     throw new Error(`DEV ERROR: Leaf's first entry key (${leaf.entries[0].key}) <= node2's last entry key ${node2.entries[node2.entries.length-1].key}`);
                // }
            }
        }
        if (typeof options.keepEntries !== 'number' || options.keepEntries === 0) {
            options.keepEntries = leaf.hasNext
                ? Math.floor(leaf.entries.length / 2) // Split leaf entries into 2 equal parts
                : Math.floor(this.info.entriesPerNode * (this.info.fillFactor / 100)); // No next leaf, split at fill factor
        }
        // Check if additional data has to be loaded before proceeding
        const reads = [];
        if (!options.nextLeaf && leaf.hasNext) {
            // Load next leaf first
            reads.push(leaf.getNext()
                .then(nextLeaf => {
                options.nextLeaf = nextLeaf;
            }));
        }
        if (leaf.hasExtData && !leaf.extData.loaded) {
            // load all ext_data before proceeding with split
            reads.push(leaf.extData.load());
        }
        if (reads.length > 0) {
            await Promise.all(reads);
        }
        try {
            const movingEntries = leaf.entries.slice(options.keepEntries);
            // const movingExtDataLength =  movingEntry.extData ? Math.ceil((movingEntry.extData.length - movingEntry.extData.freeBytes) * 1.1) : 0;
            // const movingExtDataLength = Math.ceil(movingEntries.reduce((length, entry) => {
            //     return length + (entry.extData ? entry.extData.length + 8 - entry.extData.freeBytes : 0);
            // }, 0)  / movingEntries.length * this.info.entriesPerNode);
            const extDataLengths = leaf.entries
                .filter(entry => entry.extData)
                .map(entry => entry.extData.length + 8 - entry.extData.freeBytes);
            const avgExtDataLength = extDataLengths.length === 0 ? 0 : extDataLengths.reduce((total, length) => total + length, 0) / extDataLengths.length;
            //const movingExtDataLength = Math.ceil(avgExtDataLength * movingEntries.length);
            const movingExtDataLength = movingEntries.reduce((total, entry) => total + (entry.extData ? entry.extData.length + 8 - entry.extData.freeBytes : 0), 0);
            const newLeafExtDataLength = Math.ceil(avgExtDataLength * this.info.entriesPerNode); //Math.ceil(movingExtDataLength * 1.1);
            const newLeafLength = leaf.length; // Use same length as current leaf
            const allocated = await this._requestFreeSpace(newLeafLength + newLeafExtDataLength);
            // this.debug.log(`Splitting leaf "${leaf.entries[0].key}" to "${leaf.entries.slice(-1)[0].key}", cutting at "${movingEntries[0].key}"`);
            const nextLeaf = options.nextLeaf;
            // Create new leaf
            const newLeaf = new BinaryBPlusTreeLeaf({
                isLeaf: true,
                length: newLeafLength,
                index: allocated.index,
                tree: leaf.tree,
                hasExtData: newLeafExtDataLength > 0,
            });
            if (newLeafExtDataLength > 0) {
                newLeaf.extData = {
                    loaded: true,
                    length: newLeafExtDataLength,
                    freeBytes: newLeafExtDataLength - movingExtDataLength,
                    load: noop,
                };
            }
            // Adjust free space length and prev & next offsets
            // this.info.freeSpace -= newLeafLength + newLeafExtDataLength;
            newLeaf.prevLeafIndex = leaf.index;
            newLeaf.nextLeafIndex = nextLeaf ? nextLeaf.index : 0;
            leaf.nextLeafIndex = newLeaf.index;
            if (nextLeaf) {
                nextLeaf.prevLeafIndex = newLeaf.index;
            }
            // move entries
            leaf.entries.splice(-movingEntries.length);
            newLeaf.entries.push(...movingEntries);
            // this.debug.log(`Creating new leaf for ${movingEntries.length} entries`);
            // Update parent node entry pointing to this leaf
            const oldParentNode = new BinaryBPlusTreeNode({
                isLeaf: false,
                index: leaf.parentNode.index,
                length: leaf.parentNode.length,
                free: leaf.parentNode.free,
            });
            oldParentNode.gtChildIndex = leaf.parentNode.gtChildIndex;
            oldParentNode.entries = leaf.parentNode.entries.map(entry => {
                const newEntry = new BinaryBPlusTreeNodeEntry(entry.key);
                newEntry.ltChildIndex = entry.ltChildIndex;
                return newEntry;
            });
            if (leaf.parentEntry !== null) {
                // Current leaf is a parent node entry's ltChild
                // eg: current leaf [10,11,12, ... ,18,19] is parent node [10,20,30] second entry's (20) ltChild.
                // When splitting to [10, ..., 14] and [15, ..., 19], we have to add key 15 to parent: [10,15,20,30]
                const newEntryKey = leaf.parentEntry.key; // (20 in above example)
                leaf.parentEntry.key = movingEntries[0].key; // (15 in above example)
                // Add new node entry for created leaf
                const insertIndex = leaf.parentNode.entries.indexOf(leaf.parentEntry) + 1;
                const newNodeEntry = new BinaryBPlusTreeNodeEntry(newEntryKey);
                newNodeEntry.ltChildIndex = newLeaf.index; // Set the target index, so _writeNode knows it must calculate the target offset
                leaf.parentNode.entries.splice(insertIndex, 0, newNodeEntry);
            }
            else {
                // Current leaf is parent node's gtChild
                const newNodeEntry = new BinaryBPlusTreeNodeEntry(movingEntries[0].key);
                newNodeEntry.ltChildIndex = leaf.index;
                leaf.parentNode.entries.push(newNodeEntry);
                leaf.parentNode.gtChildIndex = newLeaf.index;
            }
            // Start transaction
            const tx = new TX();
            // Write new leaf:
            tx.queue({
                name: 'write new leaf',
                action: async () => {
                    return this._writeLeaf(newLeaf);
                },
                rollback: async () => {
                    // Release allocated space again
                    return this._registerFreeSpace(allocated.index, allocated.length);
                },
                // No need to add rollback step to remove new leaf. It'll be overwritten later
            });
            // Rewrite next leaf:
            nextLeaf && tx.queue({
                name: 'rewrite next leaf',
                action: async () => {
                    return this._writeLeaf(nextLeaf);
                },
                rollback: async () => {
                    nextLeaf.prevLeafIndex = leaf.index;
                    return this._writeLeaf(nextLeaf);
                },
            });
            // Rewrite this leaf:
            tx.queue({
                name: 'rewrite current leaf',
                action: async () => {
                    return this._writeLeaf(leaf);
                },
                rollback: async () => {
                    leaf.entries.push(...movingEntries);
                    leaf.nextLeafIndex = nextLeaf ? nextLeaf.index : 0;
                    await options.cancelCallback(); // await in case cancelCallback returns a promise
                    return this._writeLeaf(leaf);
                },
            });
            // Rewrite parent node:
            tx.queue({
                name: 'rewrite parent node',
                action: async () => {
                    return this._writeNode(leaf.parentNode);
                    // TODO: If node grew larger than allocated size, try rebuilding it.
                },
                rollback: async () => {
                    // this is the last step, we don't need to rollback if we are running the tx sequentially.
                    // Because we run parallel, we need rollback code here:
                    return this._writeNode(oldParentNode);
                },
            });
            const results = await tx.execute(true); // run parallel
            // await this._testTree();
            return results;
        }
        catch (err) {
            throw new DetailedError('split-leaf-failed', `Unable to split leaf: ${err.message}`, err);
        }
    }
    // async _testTree() {
    //     // Test tree by looking up all entries individually
    //     let leaf = await this._getFirstLeaf();
    //     const keys = leaf.entries.map(e => e.key);
    //     while (leaf.hasNext) {
    //         leaf = await leaf.getNext();
    //         keys.push(...leaf.entries.map(e => e.key));
    //     }
    //     this.debug.warn(`TREE TEST: testing ${keys.length} keys`);
    //     // this.debug.warn(keys);
    //     for (let i = 0; i < keys.length - 1; i++) {
    //         const key1 = keys[i], key2 = keys[i + 1];
    //         assert(_isLess(key1, key2), `Key "${key1}" must be smaller than "${key2}"`);
    //     }
    //     for (let i = 0; i < keys.length; i++) {
    //         const key = keys[i];
    //         leaf = await this._findLeaf(key);
    //         const entry = leaf?.entries.find(e => e.key === key)
    //         assert(entry, `Key "${key}" must be in leaf`);
    //     }
    //     this.debug.warn(`TREE TEST: testing ext_data`);
    //     leaf = await this._getFirstLeaf();
    //     while (leaf) {
    //         if (leaf.hasExtData) {
    //             const leafExtDataIndex = leaf.sourceIndex + leaf.length;
    //             const endIndex = leafExtDataIndex + leaf.extData.length - leaf.extData.freeBytes;
    //             const testEntries = leaf.entries.filter(entry => entry.extData);
    //             for (const entry of testEntries) {
    //                 // if (!entry.extData.loaded) {}
    //                 await entry.extData.loadHeader();
    //                 if (entry.extData.index + entry.extData.length > endIndex) {
    //                     throw new Error(`TREE TEST FAILED: ext_block is larger than allowed (in ext_data free space that starts at index ${endIndex})`);
    //                 }
    //             }
    //             try {
    //                 await leaf.extData.load();
    //             }
    //             catch (err) {
    //                 throw new Error(`TREE TEST FAILED: could not load leaf extData. ext_data free space starts at index ${endIndex}`, err.message);
    //             }
    //         }
    //         leaf = leaf.hasNext ? await leaf.getNext() : null;
    //     }
    //     this.debug.warn(`TREE TEST SUCCESSFUL`);
    // }
    async add(key, recordPointer, metadata) {
        return this._threadSafe('exclusive', () => this._add(key, recordPointer, metadata));
    }
    async _add(key, recordPointer, metadata) {
        if (!this.info) {
            await this._loadInfo();
        }
        const err = _checkNewEntryArgs(key, recordPointer, this.info.metadataKeys, metadata);
        if (err) {
            throw err;
        }
        const entryValue = new BinaryBPlusTreeLeafEntryValue(recordPointer, metadata);
        if (!this.id) {
            throw new DetailedError('tree-id-not-set', 'To edit tree, set the id property to something unique for locking purposes');
        }
        try {
            const leaf = await this._findLeaf(key);
            if (!this.info.hasLargePtrs) {
                throw new DetailedError('small-ptrs-deprecated', 'small ptrs have deprecated, tree will have to be rebuilt');
            }
            const entryIndex = leaf.entries.findIndex(entry => _isEqual(key, entry.key));
            let addNew = false;
            if (this.info.isUnique) {
                // Make sure key doesn't exist yet
                if (entryIndex >= 0) {
                    throw new DetailedError('unique-key-violation', `Cannot add duplicate key "${key}": tree expects unique keys`);
                }
                addNew = true;
            }
            else {
                if (entryIndex >= 0) {
                    const entry = leaf.entries[entryIndex];
                    if (entry.extData) {
                        try {
                            return await entry.extData.addValue(recordPointer, metadata);
                        }
                        catch (err) {
                            // Something went wrong adding the value. ext_data_block is probably full
                            // and needs to grow
                            // this.debug.log(`Leaf rebuild necessary - unable to add value to key "${key}": ${err.message}`);
                            if (err.code !== 'max-extdata-size-reached') {
                                throw err;
                            }
                            const rebuildOptions = {
                                growData: false,
                                growExtData: true,
                                applyChanges: (leaf) => {
                                    const entry = leaf.entries.find(entry => _isEqual(entry.key, key)); //[entryIndex];
                                    entry.values.push(new BinaryBPlusTreeLeafEntryValue(recordPointer, metadata));
                                },
                            };
                            return await this._rebuildLeaf(leaf, rebuildOptions);
                        }
                    }
                    entry.values.push(entryValue);
                }
                else {
                    addNew = true;
                }
            }
            if (!addNew) {
                try {
                    return await this._writeLeaf(leaf);
                }
                catch (err) {
                    // Leaf got too small? Try rebuilding it
                    const extDataError = DetailedError.hasErrorCode(err, 'max-extdata-size-reached'); //leaf.hasExtData && err.message.match(/ext_data/) !== null;
                    try {
                        return await this._rebuildLeaf(leaf, {
                            growData: !extDataError,
                            growExtData: extDataError,
                            rollbackOnFailure: false, // Disable original leaf rewriting on failure
                        });
                    }
                    catch (err) {
                        throw new DetailedError('add-value-failed', `Can't add value to key '${key}': ${err.message}`, err);
                    }
                }
            }
            // If we get here, we have to add a new leaf entry
            const entry = new BinaryBPlusTreeLeafEntry(key, [entryValue]);
            // Insert it
            const insertBeforeIndex = leaf.entries.findIndex(entry => _isMore(entry.key, key));
            const isLastEntry = insertBeforeIndex === -1;
            if (isLastEntry) {
                leaf.entries.push(entry);
            }
            else {
                leaf.entries.splice(insertBeforeIndex, 0, entry);
            }
            if (leaf.entries.length <= this.info.entriesPerNode) {
                try {
                    return await this._writeLeaf(leaf);
                }
                catch (err) {
                    if (!DetailedError.hasErrorCode(err, 'max-leaf-size-reached')) {
                        throw err;
                    }
                    // Leaf had no space left, try rebuilding it
                    return await this._rebuildLeaf(leaf, {
                        growData: true,
                        growExtData: leaf.hasExtData,
                        rollbackOnFailure: false, // Don't try rewriting updated leaf on failure
                    });
                }
            }
            // If we get here, our leaf has too many entries
            const undoAdd = () => {
                const index = leaf.entries.indexOf(entry);
                index >= 0 && leaf.entries.splice(index, 1);
            };
            if (!leaf.parentNode) {
                // No parent, so this is a 1 leaf "tree"
                undoAdd();
                throw new DetailedError('slt-no-space-available', `Cannot add key "${key}", no space left in single leaf tree`);
            }
            // Split leaf
            return await this._splitLeaf(leaf, { cancelCallback: undoAdd, keepEntries: isLastEntry ? this.info.entriesPerNode : 0 });
        }
        catch (err) {
            throw new DetailedError('add-key-failed', `Can't add key '${key}': ${err.message}`, err);
        }
        // .then(() => {
        //     // TEST the tree adjustments by getting the leaf with the added key,
        //     // and then previous and next leafs!
        //     this.debug.warn(`TESTING leaf adjustment after adding "${key}". Remove code when all is well!`);
        //     return this._findLeaf(key);
        // })
        // .then(leaf => {
        //     let promises = leaf.entries.map(entry => {
        //         if (entry.extData) {
        //             return entry.extData.loadValues();
        //         }
        //         return null;
        //     })
        //     .filter(p => p !== null);
        //     return Promise.all(promises);
        //     // return leaf.hasExtData && leaf.extData.load();
        // });
        // .then(leaf => {
        //     let prev = leaf.getPrevious ? leaf.getPrevious() : null;
        //     let next = leaf.getNext ? leaf.getNext() : null;
        //     return Promise.all([leaf, prev, next]);
        // })
        // .then(results => {
        //     let leaf = results[0];
        //     let prev = results[1];
        //     let next = results[2];
        // });
    }
    // /**
    //  * @param  {BinaryBPlusTreeTransactionOperation[]} operations
    //  */
    // async process(operations) {
    //     return this._threadSafe('exclusive', () => this._process(operations));
    // }
    async _process(operations) {
        if (!this.info) {
            await this._loadInfo();
        }
        if (!this.info.isUnique) {
            throw new DetailedError('non-unique-tree', 'DEV ERROR: process() should not be called on non-unique trees because of ext_data complexity, cannot handle that yet. Use old "transaction" logic instead');
        }
        if (operations.length === 0) {
            return;
        }
        operations.filter(op => op.type === 'add').forEach(({ key, recordPointer, metadata }) => {
            const err = _checkNewEntryArgs(key, recordPointer, this.info.metadataKeys, metadata); // Fixed this.metadataKeys issue during TS port
            if (err) {
                throw err;
            }
        });
        operations.filter(op => op.type === 'update').forEach(({ key, newValue }) => {
            const err = _checkNewEntryArgs(key, newValue.recordPointer, this.info.metadataKeys, newValue.metadata); // Fixed this.metadataKeys issue during TS port
            if (err) {
                throw err;
            }
        });
        if (!this.info.hasLargePtrs) {
            throw new DetailedError('small-ptrs-deprecated', 'small ptrs have deprecated, tree will have to be rebuilt');
        }
        let batchedOps = [];
        // const debugRemoved = [];
        // let debugThrownError;
        try {
            // Sort the entries
            operations.sort((a, b) => _isLess(a.key, b.key) ? -1 : 1);
            // Get first leaf to edit
            let leaf = await this._findLeaf(operations[0].key);
            let undo = [];
            const saveLeaf = async () => {
                // debugRemoved.forEach(r => {
                //     if (leaf.entries.find(e => e.key === r.key)) {
                //         debugger;
                //     }
                // });
                if (leaf.entries.length > this.info.entriesPerNode) {
                    // Leaf too large to save, must split
                    const cancelCallback = () => undo.splice(0).reverse().forEach(fn => fn());
                    const keepEntries = leaf.hasNext ? 0 : this.info.entriesPerNode;
                    // this.debug.log('*process _splitLeaf');
                    await this._splitLeaf(leaf, { cancelCallback, keepEntries });
                }
                else if (leaf.entries.length > 0 || !leaf.parentNode) {
                    // Leaf has entries or is a single-leaf tree
                    try {
                        // this.debug.log('*process _writeLeaf');
                        await this._writeLeaf(leaf);
                    }
                    catch (err) {
                        // Leaf had no space left, try rebuilding it with more space
                        // this.debug.log('*process _rebuildLeaf');
                        await this._rebuildLeaf(leaf, {
                            growData: true,
                            growExtData: true,
                            rollbackOnFailure: false, // Don't try rewriting updated leaf on failure
                        });
                    }
                }
                else if (leaf.parentNode.entries.length > 1) {
                    // Remove leaf
                    // this.debug.log('*process _removeLeaf');
                    await this._removeLeaf(leaf);
                }
                else {
                    // Parent node has only 1 entry, removing it would also make parent node empty...
                    // throw new DetailedError('leaf-empty', 'leaf is now empty and parent node has only 1 entry, tree will have to be rebuilt');
                    // Write the empty leaf anyway, will be removed automatically upon a future tree rebuild.
                    await this._writeLeaf(leaf);
                }
            };
            while (operations.length > 0) {
                const op = operations.shift();
                // tx.queue({
                //     name: 'start',
                //     action() { operations.shift(); },
                //     rollback() {operations.unshift(op); }
                // })
                const { type, key, recordPointer, metadata, newValue, currentValue } = op;
                // Should this entry be added to this leaf?
                const applyToThisLeaf = (() => {
                    if (leaf.entries.length > this.info.entriesPerNode) {
                        return false;
                    }
                    // Check if the "roadsigns" in parent nodes will point to this leaf for the new key
                    const pointsThisDirection = (node) => {
                        if (node.parentEntry) {
                            // Parent node's entry has a less than connection to this node/leaf
                            return _isLess(key, node.parentEntry.key);
                        }
                        else if (node.parentNode) {
                            // Parent node's "greater than" pointer goes to this node/leaf.
                            if (!_isMoreOrEqual(key, node.parentNode.entries.slice(-1)[0].key)) {
                                return false; // Does this ever happen?
                            }
                            // Check resursively
                            return pointsThisDirection(node.parentNode);
                        }
                        else {
                            // There is no parent, this is the gtChild
                            if (!_isMoreOrEqual(key, node.entries.slice(-1)[0].key)) {
                                throw new Error('DEV ERROR: this tree is not right..');
                            }
                            return true;
                        }
                    };
                    return pointsThisDirection(leaf);
                })();
                if (!applyToThisLeaf) {
                    // No. Save leaf edits and load a new one
                    // try {
                    await saveLeaf();
                    // }
                    // catch (err) {
                    //     failedOps.push(...batchedOps);
                    // }
                    // Load new leaf
                    batchedOps = [];
                    undo = [];
                    leaf = await this._findLeaf(key);
                }
                batchedOps.push(op);
                // Make adjustment to leaf
                const entryIndex = leaf.entries.findIndex(entry => _isEqual(key, entry.key));
                const entry = leaf.entries[entryIndex];
                if (type === 'remove') {
                    // Remove an entry
                    if (!entry) {
                        throw new DetailedError('key-not-found', `Cannot remove key "${key}" because it is not present in the tree`);
                        // continue; // Entry not in leaf, nothing changes
                    }
                    else {
                        // debugRemoved.push(entry);
                        leaf.entries.splice(entryIndex, 1);
                        undo.push(() => {
                            // this.debug.log(`Undo remove ${entry.key}`);
                            leaf.entries.splice(entryIndex, 0, entry);
                        });
                        // if (entryIndex === 0 && !leaf.parentEntry) {
                        //     // Somehow the entry is not removed in this case. DEBUG!
                        //     const checkEntry = leaf.entries.find(e => _isEqual(key, e.key));
                        //     debugger;
                        // }
                    }
                }
                else if (type === 'add') {
                    if (entry) {
                        throw new DetailedError('unique-key-violation', `Cannot add duplicate key "${key}": tree expects unique keys`);
                    }
                    else {
                        // Add new entry
                        const value = new BinaryBPlusTreeLeafEntryValue(recordPointer, metadata);
                        const entry = new BinaryBPlusTreeLeafEntry(key, [value]);
                        const insertBeforeIndex = leaf.entries.findIndex(entry => _isMore(entry.key, key));
                        const isLastEntry = insertBeforeIndex === -1;
                        if (isLastEntry) {
                            leaf.entries.push(entry);
                        }
                        else {
                            leaf.entries.splice(insertBeforeIndex, 0, entry);
                        }
                        undo.push(() => leaf.entries.splice(leaf.entries.indexOf(entry), 1));
                    }
                }
                else if (type === 'update') {
                    if (!entry) {
                        throw new DetailedError('key-not-found', `Cannot update key "${key}" because it is not present in the tree`);
                    }
                    else {
                        // const currentValue = entry.values[0];
                        // const newValue = new BinaryBPlusTreeLeafEntryValue(recordPointer, metadata);
                        entry.values[0] = newValue;
                        undo.push(() => entry.values[0] = currentValue);
                    }
                }
            }
            if (batchedOps.length > 0) {
                await saveLeaf();
            }
            // batchedOps = [];
        }
        catch (err) {
            operations.push(...batchedOps);
            // debugThrownError = err;
            throw err; //new DetailedError('process-error', 'Could not process all requested operations', err);
        }
        // finally {
        //     // await this._testTree();
        //     for (let removedEntry of debugRemoved) {
        //         const leaf = await this._findLeaf(removedEntry.key);
        //         if (leaf.entries.find(e => _isEqual(e.key, removedEntry.key))) {
        //             this.debug.log(debugThrownError);
        //             debugger;
        //         }
        //     }
        // }
    }
    async remove(key, recordPointer) {
        return this._threadSafe('exclusive', () => this._remove(key, recordPointer));
    }
    async _remove(key, recordPointer) {
        // key = _normalizeKey(key); //if (_isIntString(key)) { key = parseInt(key); }
        try {
            const leaf = await this._findLeaf(key);
            // This is the leaf the key should be in
            if (!this.info.hasLargePtrs) {
                throw new DetailedError('small-ptrs-deprecated', 'small ptrs have deprecated, tree will have to be rebuilt');
            }
            const entryIndex = leaf.entries.findIndex(entry => _isEqual(key, entry.key));
            if (!~entryIndex) {
                return;
            }
            if (this.info.isUnique || typeof recordPointer === 'undefined' || leaf.entries[entryIndex].totalValues === 1) {
                leaf.entries.splice(entryIndex, 1);
            }
            else if (leaf.entries[entryIndex].extData) {
                return leaf.entries[entryIndex].extData.removeValue(recordPointer);
            }
            else {
                const valueIndex = leaf.entries[entryIndex].values.findIndex(val => _compareBinary(val.recordPointer, recordPointer));
                if (!~valueIndex) {
                    return;
                }
                leaf.entries[entryIndex].values.splice(valueIndex, 1);
            }
            if (leaf.parentNode && leaf.entries.length === 0) {
                // This is not a single leaf tree, and the leaf is now empty. Remove it
                if (leaf.parentNode.entries.length === 1) {
                    // Parent node has only 1 entry, removing it would also make parent node empty...
                    throw new DetailedError('leaf-empty', 'leaf is now empty and parent node has only 1 entry, tree will have to be rebuilt');
                }
                return await this._removeLeaf(leaf);
            }
            return await this._writeLeaf(leaf);
        }
        catch (err) {
            throw new DetailedError('remove-key-failed', `Can't remove key '${key}': ${err.message}`, err);
        }
    }
    /**
     * Removes an empty leaf
     */
    async _removeLeaf(leaf) {
        try {
            assert(leaf.parentNode && leaf.parentNode.entries.length >= 2, 'Leaf to remove must have a parent node with at least 2 entries'); // TODO: implement _removeNode
            assert(leaf.entries.length === 0, 'Leaf to remove must be empty');
            const freedBytes = leaf.length + leaf.extData.length;
            // Start transaction
            const tx = new TX();
            // Adjust previous leaf's next_leaf_ptr: (point it to leaf's next leaf)
            if (leaf.hasPrevious) {
                const prevLeaf = {
                    nextPointerIndex: leaf.prevLeafIndex + BinaryBPlusTreeLeaf.nextLeafPtrIndex,
                    oldOffset: BinaryBPlusTreeLeaf.getNextLeafOffset(leaf.prevLeafIndex, leaf.index),
                    newOffset: BinaryBPlusTreeLeaf.getNextLeafOffset(leaf.prevLeafIndex, leaf.nextLeafIndex),
                };
                tx.queue({
                    name: 'prev leaf next_leaf_ptr',
                    action: async () => {
                        const bytes = writeSignedOffset([], 0, prevLeaf.newOffset, true);
                        return this._writeFn(bytes, prevLeaf.nextPointerIndex);
                    },
                    rollback: async () => {
                        const bytes = writeSignedOffset([], 0, prevLeaf.oldOffset, true);
                        return this._writeFn(bytes, prevLeaf.nextPointerIndex);
                    },
                });
            }
            // Adjust next leaf's prev_leaf_ptr: (point it to leaf's previous leaf)
            if (leaf.hasNext) {
                const nextLeaf = {
                    prevPointerIndex: leaf.nextLeafIndex + BinaryBPlusTreeLeaf.prevLeafPtrIndex,
                    oldOffset: BinaryBPlusTreeLeaf.getPrevLeafOffset(leaf.nextLeafIndex, leaf.index),
                    newOffset: BinaryBPlusTreeLeaf.getPrevLeafOffset(leaf.nextLeafIndex, leaf.prevLeafIndex),
                };
                tx.queue({
                    name: 'next leaf prev_leaf_ptr',
                    action: async () => {
                        const bytes = writeSignedOffset([], 0, nextLeaf.newOffset, true);
                        return this._writeFn(bytes, nextLeaf.prevPointerIndex);
                    },
                    rollback: async () => {
                        const bytes = writeSignedOffset([], 0, nextLeaf.oldOffset, true);
                        return this._writeFn(bytes, nextLeaf.prevPointerIndex);
                    },
                });
            }
            // Rewrite parent node
            const parentNodeInfo = {
                entries: leaf.parentNode.entries.slice(),
                gtChildIndex: leaf.parentNode.gtChildIndex,
            };
            // Remove parent node entry or change gtChildOffset
            if (leaf.parentEntry) {
                const removeEntryIndex = leaf.parentNode.entries.indexOf(leaf.parentEntry);
                leaf.parentNode.entries.splice(removeEntryIndex, 1);
            }
            else {
                // Change gtChildOffset to last entry's offset
                const lastEntry = leaf.parentNode.entries.splice(-1)[0];
                leaf.parentNode.gtChildIndex = lastEntry.ltChildIndex;
            }
            tx.queue({
                name: 'parent node',
                action: async () => {
                    return this._writeNode(leaf.parentNode);
                },
                rollback: async () => {
                    // Set the target leaf indexes back to the originals
                    leaf.parentNode.entries = parentNodeInfo.entries;
                    leaf.parentNode.gtChildIndex = parentNodeInfo.gtChildIndex;
                    return this._writeNode(leaf.parentNode);
                },
            });
            await tx.execute(true);
            await this._registerFreeSpace(leaf.index, freedBytes);
            // await this._testTree();
        }
        catch (err) {
            throw new DetailedError('remove-leaf-failed', `Failed to remove leaf: ${err.message}`, err);
        }
    }
    async update(key, newRecordPointer, currentRecordPointer, newMetadata) {
        return this._threadSafe('exclusive', () => this._update(key, newRecordPointer, currentRecordPointer, newMetadata));
    }
    async _update(key, newRecordPointer, currentRecordPointer, newMetadata) {
        try {
            // key = _normalizeKey(key); // if (_isIntString(key)) { key = parseInt(key); }
            if (currentRecordPointer === null) {
                currentRecordPointer = undefined;
            }
            const newEntryValue = new BPlusTreeLeafEntryValue(newRecordPointer, newMetadata);
            const leaf = await this._findLeaf(key);
            // This is the leaf the key should be in
            const entryIndex = leaf.entries.findIndex(entry => _isEqual(entry.key, key));
            if (!~entryIndex) {
                throw new DetailedError('key-not-found', `Key to update ("${key}") not found`);
            }
            const entry = leaf.entries[entryIndex];
            if (this.info.isUnique) {
                entry.values = [newEntryValue];
            }
            else if (typeof currentRecordPointer === 'undefined') {
                throw new DetailedError('current-value-not-given', 'To update a non-unique key, the current value must be passed as parameter');
            }
            else {
                const valueIndex = entry.values.findIndex(val => _compareBinary(val.recordPointer, currentRecordPointer));
                if (!~valueIndex) {
                    throw new DetailedError('key-value-pair-not-found', `Key/value combination to update not found (key: "${key}") `);
                }
                entry.values[valueIndex] = newEntryValue;
            }
            return await this._writeLeaf(leaf);
        }
        catch (err) {
            throw new DetailedError('update-value-failed', `Could not update value for key '${key}': ${err.message}`, err);
        }
    }
    /**
     * Executes all operations until execution fails: remaining operations are left in passed array
     */
    async transaction(operations) {
        return this._threadSafe('exclusive', () => this._transaction(operations));
    }
    async _transaction(operations) {
        if (!this.info) {
            // Populate info for this tree
            const reader = await this._getReader();
            if (typeof reader.close === 'function') {
                reader.close();
            }
        }
        if (this.info.isUnique) {
            return this._process(operations);
        }
        while (operations.length > 0) {
            const op = operations.shift();
            try {
                switch (op.type) {
                    case 'add': {
                        await this._add(op.key, op.recordPointer, op.metadata);
                        break;
                    }
                    case 'remove': {
                        await this._remove(op.key, op.recordPointer);
                        break;
                    }
                    case 'update': {
                        await this._update(op.key, op.newValue.recordPointer, op.currentValue.recordPointer, op.newValue.metadata);
                        break;
                    }
                }
            }
            catch (err) {
                operations.unshift(op);
                throw err;
            }
        }
    }
    async toTree(fillFactor = 100) {
        const builder = await this.toTreeBuilder(fillFactor);
        return builder.create();
    }
    /**
     * @returns Promise that resolves with a BPlusTreeBuilder
     */
    async toTreeBuilder(fillFactor) {
        return this._threadSafe('shared', () => this._toTreeBuilder(fillFactor));
    }
    /**
     * @returns Promise that resolves with a BPlusTreeBuilder
     */
    async _toTreeBuilder(fillFactor) {
        const treeBuilder = new BPlusTreeBuilder(this.info.isUnique, fillFactor, this.info.metadataKeys);
        let leaf = await this._getFirstLeaf();
        while (leaf) {
            leaf.entries.forEach(entry => {
                entry.values.forEach(entryValue => treeBuilder.add(entry.key, entryValue.value, entryValue.metadata));
            });
            leaf = leaf.getNext ? await leaf.getNext() : null;
        }
        return treeBuilder;
    }
    async rebuild(writer, options) {
        return this._threadSafe('exclusive', () => this._rebuild(writer, options));
    }
    async _rebuild(writer, options = {
        allocatedBytes: 0,
        fillFactor: 95,
        keepFreeSpace: true,
        increaseMaxEntries: true,
        reserveSpaceForNewEntries: 0,
        repairMode: false,
    }) {
        const perf = {};
        const mark = (name) => {
            const keys = name.split('.');
            const key = keys.pop();
            const target = keys.reduce((t, key) => key in t ? t[key] : (t[key] = {}), perf);
            target[key] = Date.now(); // performance.mark(name);
        };
        const measure = (mark1, mark2) => {
            const getMark = (name) => {
                const keys = name.split('.');
                const key = keys.pop();
                const target = keys.reduce((t, key) => key in t ? t[key] : (t[key] = {}), perf);
                return target[key];
            };
            return getMark(mark2) - getMark(mark1);
        };
        mark('start');
        if (!(writer instanceof BinaryWriter)) {
            throw new DetailedError('invalid-argument', 'writer argument must be an instance of BinaryWriter');
        }
        if (!this.info) {
            // Hasn't been initialized yet.
            await this._getReader(); // _getReader populates the info
        }
        const originalChunkSize = this._chunkSize;
        // this._chunkSize = 1024 * 1024; // Read 1MB at a time to speed up IO
        options = options || {};
        options.fillFactor = options.fillFactor || this.info.fillFactor || 95;
        options.keepFreeSpace = options.keepFreeSpace !== false;
        options.increaseMaxEntries = options.increaseMaxEntries !== false;
        options.treeStatistics = options.treeStatistics || { byteLength: 0, totalEntries: 0, totalValues: 0, totalLeafs: 0, depth: 0, entriesPerNode: 0 };
        if (typeof options.allocatedBytes === 'number') {
            options.treeStatistics.byteLength = options.allocatedBytes;
        }
        let maxEntriesPerNode = this.info.entriesPerNode;
        if (options.increaseMaxEntries && maxEntriesPerNode < 255) {
            // Increase nr of entries per node with 10%
            maxEntriesPerNode = Math.min(255, Math.round(maxEntriesPerNode * 1.1));
        }
        options.treeStatistics.entriesPerNode = maxEntriesPerNode;
        // let entriesPerLeaf = Math.round(maxEntriesPerNode * (options.fillFactor / 100));
        // let entriesPerNode = entriesPerLeaf;
        // How many entries does the tree have in total?
        // TODO: store this in this.info.totalEntries (and in binary file)
        const leafStats = {
            // debugEntries: [],
            totalEntries: 0,
            totalValues: 0,
            totalEntryBytes: 0,
            totalKeyBytes: 0,
            readLeafs: 0,
            readEntries: 0,
            writtenLeafs: 0,
            writtenEntries: 0,
            get averageEntryLength() {
                return Math.ceil(this.totalEntryBytes / this.totalEntries);
            },
            get averageKeyLength() {
                return Math.ceil(this.totalKeyBytes / this.totalEntries);
            },
        };
        const getKeySize = (key) => {
            if (typeof key === 'number' || key instanceof Date) {
                return 4;
            }
            if (typeof key === 'string') {
                return key.length;
            }
            if (typeof key === 'boolean') {
                return 1;
            }
            if (typeof key === 'bigint') {
                // bigint has variable length
                return bigintToBytes(key).length;
            }
        };
        // let leafsSeen = 0;
        // this.debug.log(`[${Date.toString()}] Starting tree rebuild`);
        try {
            const getLeafStartKeys = async (entriesPerLeaf) => {
                mark('getLeafStartKeys.start');
                const leafStartKeys = [];
                let entriesFromLastLeafStart = 0;
                // TODO: add repairMode to _getFirstLeaf
                let leaf = await this._getFirstLeaf();
                let loop = 1;
                while (leaf) {
                    mark(`getLeafStartKeys.loop${loop++}`);
                    // leafsSeen++;
                    // this.debug.log(`Processing leaf with ${leaf.entries.length} entries, total=${totalEntries}`);
                    // leafStats.debugEntries.push(...leaf.entries);
                    if (leaf.entries.length === 0) {
                        // For leafs that were previously left empty (are now removed, see issue #5)
                        leaf = leaf.getNext ? await leaf.getNext(options.repairMode) : null;
                        continue;
                    }
                    leafStats.totalEntries += leaf.entries.length;
                    leafStats.totalValues += leaf.entries.reduce((total, entry) => total + entry.totalValues, 0);
                    leafStats.totalEntryBytes += leaf.length;
                    leafStats.totalKeyBytes += leaf.entries.reduce((total, entry) => total + getKeySize(entry.key), 0);
                    if (leafStartKeys.length === 0 || entriesFromLastLeafStart === entriesPerLeaf) {
                        // This is the first leaf being processed, or last leaf entries filled whole new leaf
                        leafStartKeys.push(leaf.entries[0].key);
                        entriesFromLastLeafStart = 0;
                    }
                    if (entriesFromLastLeafStart + leaf.entries.length <= entriesPerLeaf) {
                        // All entries fit into current leaf
                        entriesFromLastLeafStart += leaf.entries.length;
                    }
                    else {
                        // some of the entries fit in current leaf
                        let cutIndex = entriesPerLeaf - entriesFromLastLeafStart;
                        // new leaf starts at cutIndex
                        let firstLeafEntry = leaf.entries[cutIndex];
                        leafStartKeys.push(firstLeafEntry.key);
                        // How many entries for the new leaf do we have already?
                        entriesFromLastLeafStart = leaf.entries.length - cutIndex;
                        while (entriesFromLastLeafStart > entriesPerLeaf) {
                            // Too many for 1 leaf
                            cutIndex += entriesPerLeaf;
                            firstLeafEntry = leaf.entries[cutIndex];
                            leafStartKeys.push(firstLeafEntry.key);
                            entriesFromLastLeafStart = leaf.entries.length - cutIndex;
                        }
                    }
                    // this.debug.log(`Processed ${leafsSeen} leafs in source tree`);
                    leaf = leaf.getNext ? await leaf.getNext(options.repairMode) : null;
                }
                mark('getLeafStartKeys.end');
                return leafStartKeys;
            };
            let lastLeaf = null;
            let getEntryCalls = 1;
            /**
             * Gets next leaf's entries
             * @param n unused
             */
            const getEntries = async (n) => {
                // TODO: refactor to while(leaf) loop instead of recursive
                if (getEntryCalls === 1) {
                    mark('getEntries.first');
                }
                mark(`getEntries.start${getEntryCalls}`);
                try {
                    const leaf = lastLeaf
                        ? lastLeaf.getNext ? await lastLeaf.getNext(options.repairMode) : null
                        : await this._getFirstLeaf();
                    if (leaf) {
                        // If leaf has extData, load it first
                        if (leaf.hasExtData && !leaf.extData.loaded) {
                            await leaf.extData.load();
                        }
                        lastLeaf = leaf;
                        leafStats.readLeafs++;
                        leafStats.readEntries += leaf.entries.length;
                        if (leaf.entries.length === 0 && leaf.getNext) {
                            // For leafs that were previously left empty (are now removed, see issue #5)
                            return getEntries(n); // processes next leaf
                        }
                        return leaf.entries;
                    }
                    else {
                        return [];
                    }
                }
                finally {
                    mark(`getEntries.end${getEntryCalls++}`);
                    mark('getEntries.last'); // overwrites 'last' each loop
                }
            };
            mark('tree.createStart');
            await BinaryBPlusTree.create({
                getLeafStartKeys,
                getEntries,
                writer,
                treeStatistics: options.treeStatistics,
                fillFactor: options.fillFactor,
                maxEntriesPerNode,
                isUnique: this.info.isUnique,
                metadataKeys: this.info.metadataKeys,
                allocatedBytes: options.allocatedBytes,
                keepFreeSpace: options.keepFreeSpace,
                reserveSpaceForNewEntries: options.reserveSpaceForNewEntries,
                debug: this.debug,
            });
            mark('tree.createEnd');
            options.treeStatistics.totalLeafs = leafStats.writtenLeafs;
            options.treeStatistics.totalEntries = leafStats.totalEntries;
            options.treeStatistics.totalValues = leafStats.totalValues;
            this._chunkSize = originalChunkSize; // Reset chunk size to original
            // await this._testTree();
        }
        catch (err) {
            throw new DetailedError('tree_rebuild_error', 'Failed to rebuild tree', err);
        }
        finally {
            mark('end');
            // if (perf) {
            //     // inspect perf here
            //     this.debug.log(`[perf] tree rebuild took ${measure('start', 'end')}ms`);
            //     this.debug.log(`[perf] getLeafStartKeys: ${measure('getLeafStartKeys.start', 'getLeafStartKeys.end')}ms`);
            //     this.debug.log(`[perf] getEntries: ${measure('getEntries.first', 'getEntries.last')}ms`);
            //     this.debug.log(`[perf] tree.create: ${measure('tree.createStart', 'tree.createEnd')}ms`);
            // }
        }
    }
    static async create(options) {
        const { writer, debug } = options;
        if (typeof options.maxEntriesPerNode !== 'number') {
            options.maxEntriesPerNode = 255;
        }
        if (typeof options.fillFactor !== 'number') {
            options.fillFactor = 100;
        }
        const entriesPerLeaf = Math.round(options.maxEntriesPerNode * (options.fillFactor / 100));
        const entriesPerNode = entriesPerLeaf;
        try {
            const leafStartKeys = await options.getLeafStartKeys(entriesPerLeaf);
            // Now we know how many leafs we will be building and what their first key values are
            const createLeafs = leafStartKeys.length;
            options.treeStatistics.totalLeafs = createLeafs;
            let childLevelNodes = leafStartKeys;
            const levels = [];
            while (childLevelNodes.length > 1) {
                // Create another level
                childLevelNodes = childLevelNodes.reduce((nodes, child, index, arr) => {
                    const entriesLeft = arr.length - index;
                    let currentNode = nodes[nodes.length - 1];
                    const isLast = index === arr.length - 1 // Literally the last child
                        || currentNode.entries.length === entriesPerNode // gt connection of this node
                        || (entriesLeft === 3 && currentNode.entries.length + entriesLeft > entriesPerNode); // early chop off gt connection to save entries for next node
                    if (isLast) {
                        // gt connection
                        const key = typeof child === 'object' && 'gtMaxKey' in child
                            ? child.gtMaxKey // child is node
                            : arr[index + 1]; // child is leaf start key
                        currentNode.gtMaxKey = key;
                        currentNode.gtChildIndex = index;
                        if (index < arr.length - 1) {
                            // More to come..
                            currentNode = { entries: [], gtChildIndex: -1, gtMaxKey: null };
                            nodes.push(currentNode);
                        }
                        // connections = 0;
                    }
                    else {
                        // lt connection
                        const key = typeof child === 'object' && 'gtMaxKey' in child
                            ? child.gtMaxKey // child is node
                            : arr[index + 1]; // child is leaf start key
                        currentNode.entries.push({ key, ltChildIndex: index });
                        // connections++;
                    }
                    return nodes;
                }, [{ entries: [], gtChildIndex: -1, gtMaxKey: null }]);
                levels.push(childLevelNodes);
            }
            options.treeStatistics.depth = levels.length;
            options.treeStatistics.writtenLeafs = 0;
            options.treeStatistics.writtenEntries = 0;
            // Now that we have the keys for each node level, we can start building the actual tree
            // Do this efficiently by reusing the level keys array, reducing them in size as we go
            // Write in this order:
            // 1) header
            // 2) all nodes,
            // 3) all leafs,
            // 4) all nodes again with the right child pointers (or just the pointers),
            // 5) overwrite header with real data
            const builder = new BinaryBPlusTreeBuilder({
                uniqueKeys: options.isUnique,
                byteLength: options.allocatedBytes,
                maxEntriesPerNode: options.maxEntriesPerNode,
                freeBytes: options.keepFreeSpace ? 1 : 0,
                metadataKeys: options.metadataKeys,
                smallLeafs: WRITE_SMALL_LEAFS,
                fillFactor: options.fillFactor,
            });
            // Create header
            let header = builder.getHeader();
            let index = header.length;
            // const rootNodeIndex = index;
            const leafIndexes = [];
            let largestLeafLength = 0;
            await writer.append(header);
            // Write all node levels for the first time
            // (lt/gt child index pointers won't make sense yet)
            let l = levels.length;
            while (l > 0) {
                l--;
                const nodes = levels[l];
                const writes = [];
                nodes.forEach(node => {
                    node.index = index; //writer.length;
                    const bytes = builder.createNode({
                        index: node.index,
                        entries: node.entries.map(entry => ({ key: entry.key, ltIndex: 0 })),
                        gtIndex: 0,
                    }, { addFreeSpace: options.keepFreeSpace, allowMissingChildIndexes: true });
                    node.byteLength = bytes.length;
                    index += bytes.length;
                    const p = writer.append(bytes);
                    writes.push(p);
                });
                await Promise.all(writes);
            }
            // Write all leafs
            const newLeafEntries = [];
            let prevIndex = 0;
            let currentLeafIndex = 0;
            let totalWrittenEntries = 0;
            const writeLeaf = async (entries) => {
                let emptyLeaf = false;
                if (entries.length === 0 && leafStartKeys.length === 0) {
                    // Write an empty leaf
                    emptyLeaf = true;
                }
                // debug.log(`Writing leaf with ${entries.length} entries at index ${index}, keys range: ["${entries[0].key}", "${entries[entries.length-1].key}"]`)
                // assert(entries.every((entry, index, arr) => index === 0 || _isMoreOrEqual(entry.key, arr[index-1].key)), 'Leaf entries are not sorted ok');
                const i = leafIndexes.length;
                // assert(emptyLeaf || _isEqual(leafStartKeys[i], entries[0].key), `first entry for leaf has wrong key, must be ${leafStartKeys[i]}!`);
                leafIndexes.push(index);
                const isLastLeaf = emptyLeaf || leafIndexes.length === leafStartKeys.length;
                const newLeaf = builder.createLeaf({ index, prevIndex, nextIndex: isLastLeaf ? 0 : 'adjacent', entries }, { addFreeSpace: options.keepFreeSpace });
                largestLeafLength = Math.max(largestLeafLength, newLeaf.length);
                prevIndex = index;
                index += newLeaf.length;
                totalWrittenEntries += entries.length;
                return writer.append(newLeaf);
            };
            const flush = async (flushAll = false) => {
                const cutEntryKey = leafStartKeys[currentLeafIndex + 1];
                let entries;
                if (typeof cutEntryKey === 'undefined') {
                    // Last batch
                    if (flushAll) {
                        // assert(newLeafEntries.length <= entriesPerLeaf, 'check logic');
                        entries = newLeafEntries.splice(0);
                    }
                    else {
                        return; // Wait for remaining entries
                    }
                }
                else {
                    const cutEntryIndex = newLeafEntries.findIndex(entry => _isEqual(entry.key, cutEntryKey));
                    if (cutEntryIndex === -1) {
                        // Not enough entries yet
                        // assert(!flushAll, 'check logic');
                        // assert(newLeafEntries.length <= entriesPerLeaf, 'check logic!');
                        return;
                    }
                    entries = newLeafEntries.splice(0, cutEntryIndex);
                }
                options.treeStatistics.writtenLeafs++;
                options.treeStatistics.writtenEntries += entries.length;
                currentLeafIndex++;
                await writeLeaf(entries);
                // Write more?
                if (newLeafEntries.length >= entriesPerLeaf || (flushAll && newLeafEntries.length > 0)) {
                    await flush(flushAll);
                }
            };
            const processEntries = async (entries) => {
                if (entries.length === 0) {
                    return flush(true); // done!
                }
                // options.treeStatistics.readEntries += entries.length;
                // assert(entries.every((entry, index, arr) => index === 0 || _isMoreOrEqual(entry.key, arr[index-1].key)), 'Leaf entries are not sorted ok');
                // assert(newLeafEntries.length === 0 || _isMore(entries[0].key, newLeafEntries[newLeafEntries.length-1].key), 'adding entries will corrupt sort order');
                newLeafEntries.push(...entries);
                const writePromise = flush(false);
                const readNextPromise = options.getEntries(options.maxEntriesPerNode);
                const [moreEntries] = await Promise.all([readNextPromise, writePromise]);
                await processEntries(moreEntries);
            };
            const entries = await options.getEntries(options.maxEntriesPerNode);
            await processEntries(entries);
            // .then(() => {
            //     // // DEbug tree writing
            //     // let debugTree = levels.map(nodes => nodes.slice()); // copy
            //     // debugTree.forEach((nodes, levelIndex) => {
            //     //     debugTree[levelIndex] = nodes.map(node => {
            //     //         return {
            //     //             node,
            //     //             gtChild: levelIndex === 0
            //     //                 ? leafStartKeys[node.gtChildIndex]
            //     //                 : debugTree[levelIndex-1][node.gtChildIndex],
            //     //             entries: node.entries.map(entry => {
            //     //                 return {
            //     //                     key: entry.key,
            //     //                     ltChild: levelIndex === 0
            //     //                         ? leafStartKeys[entry.ltChildIndex]
            //     //                         : debugTree[levelIndex-1][entry.ltChildIndex]
            //     //                 };
            //     //             })
            //     //         };
            //     //     });
            //     // });
            //     // debugTree.reverse(); // Now top-down
            //     // debug.error(debugTree);
            //     // debugTree.forEach((nodes, levelIndex) => {
            //     //     let allEntries = nodes.map(node => `[${node.entries.map(entry => entry.key).join(',')}]`).join(' | ')
            //     //     debug.error(`node level ${levelIndex}: ${allEntries}`);
            //     // });
            //     // debug.error(`leafs: [${leafStartKeys.join(`..] | [`)}]`);
            // })
            // Now adjust the header data & write free bytes
            let byteLength = index;
            let freeBytes = 0;
            if (options.allocatedBytes > 0) {
                freeBytes = options.allocatedBytes - byteLength;
                byteLength = options.allocatedBytes;
            }
            else {
                // Use 10% free space, or the largest leaf length + 10%, or requested free leaf space, whichever is the largest
                freeBytes = Math.max(Math.ceil(byteLength * 0.1), Math.ceil(largestLeafLength * 1.1), Math.ceil(Math.ceil((options.reserveSpaceForNewEntries || 0) / entriesPerLeaf) * largestLeafLength * 1.1));
                // debug.log(`new tree gets ${freeBytes} free bytes`);
                byteLength += freeBytes;
            }
            // Rebuild header
            builder.byteLength = byteLength; // - header.length;
            builder.freeBytes = freeBytes;
            header = builder.getHeader();
            options.treeStatistics.byteLength = byteLength;
            options.treeStatistics.freeBytes = freeBytes;
            // Append free space bytes
            const bytesPerWrite = 1024 * 100; // 100KB per write seems fair?
            const writeBatches = Math.ceil(builder.freeBytes / bytesPerWrite);
            for (let i = 0; i < writeBatches; i++) {
                const length = i + 1 < writeBatches
                    ? bytesPerWrite
                    : builder.freeBytes % bytesPerWrite;
                const zeroes = new Uint8Array(length);
                await writer.append(zeroes);
            }
            // Done appending data, close stream
            await writer.end();
            // Overwrite header
            const writePromises = [
                writer.write(header, 0),
            ];
            // Assign all nodes' child indexes to the real file indexes
            levels.forEach((nodes, index) => {
                nodes.forEach(node => {
                    if (index === 0) {
                        // first level references leafs
                        node.gtChildIndex = leafIndexes[node.gtChildIndex];
                        node.entries.forEach(entry => {
                            entry.ltChildIndex = leafIndexes[entry.ltChildIndex];
                        });
                    }
                    else {
                        // use node index on next (lower) level
                        node.gtChildIndex = levels[index - 1][node.gtChildIndex].index;
                        node.entries.forEach(entry => {
                            entry.ltChildIndex = levels[index - 1][entry.ltChildIndex].index;
                        });
                    }
                    // Regenerate bytes
                    const bytes = builder.createNode({
                        index: node.index,
                        entries: node.entries.map(entry => ({ key: entry.key, ltIndex: entry.ltChildIndex })),
                        gtIndex: node.gtChildIndex,
                    }, { addFreeSpace: options.keepFreeSpace, maxLength: node.byteLength });
                    // And overwrite them in the file
                    const p = writer.write(bytes, node.index);
                    writePromises.push(p);
                });
            });
            await Promise.all(writePromises);
        }
        catch (err) {
            throw new DetailedError('tree_create_error', 'Failed to create BinaryBlusTree', err);
        }
    }
    /**
     * Creates a binary tree from a stream of entries.
     * An entry stream must be a binary data stream containing only leaf entries
     * a leaf entry can be created using BinaryBPlusTree.createStreamEntry(key, values)
     */
    static createFromEntryStream(reader, writer, options) {
        // Steps:
        // 1 - loop through all entries to calculate leaf start keys
        // 2 - create nodes
        // 3 - create leafs
        // const entriesPerLeaf = Math.round(options.maxEntriesPerNode * (options.fillFactor / 100));
        const { debug } = options;
        const getLeafStartKeys = async (entriesPerLeaf) => {
            options.treeStatistics.totalEntries = 0;
            await reader.init();
            const leafStartKeys = [];
            while (true) {
                options.treeStatistics.totalEntries++;
                const entryIndex = reader.sourceIndex;
                try {
                    const entryLength = await reader.getUint32();
                    if (options.treeStatistics.totalEntries % entriesPerLeaf === 1) {
                        const key = await reader.getValue();
                        // debug.log(key);
                        leafStartKeys.push(key);
                        await reader.go(entryIndex + entryLength);
                    }
                    else {
                        // skip reading this entry's key
                        await reader.go(entryIndex + entryLength);
                    }
                }
                catch (err) {
                    if (err.code === 'EOF') {
                        break;
                    }
                    throw err;
                }
            }
            await reader.go(0); // Reset
            return leafStartKeys;
        };
        const getEntries = async (n) => {
            // read n entries
            const entries = [];
            reader.chunkSize = 1024 * 1024; // 1MB chunks
            while (true) {
                try {
                    // read entry_length:
                    const entryLength = await reader.getUint32();
                    const buffer = await reader.get(entryLength - 4); // -4 because entry_length is 4 bytes
                    // read key:
                    const k = BinaryReader.readValue(buffer, 0);
                    const entry = new BinaryBPlusTreeLeafEntry(k.value, []);
                    let index = k.byteLength;
                    // read values_length
                    const totalValues = BinaryReader.readUint32(buffer, index);
                    index += 4;
                    for (let i = 0; i < totalValues; i++) {
                        // read value_length
                        const valueLength = BinaryReader.readUint32(buffer, index);
                        index += 4;
                        const val = buffer.slice(index, index + valueLength);
                        index += valueLength;
                        // val contains rp_length, rp_data, metadata
                        const rpLength = val[0]; // rp_length
                        const recordPointer = val.slice(1, 1 + rpLength); // rp_data
                        // metadata:
                        let valIndex = 1 + rpLength;
                        const metadata = {};
                        for (let j = 0; j < options.metadataKeys.length; j++) {
                            const mdKey = options.metadataKeys[j];
                            const mdValue = BinaryReader.readValue(val, valIndex);
                            metadata[mdKey] = mdValue.value;
                            valIndex += mdValue.byteLength;
                        }
                        const value = new BinaryBPlusTreeLeafEntryValue(recordPointer, metadata);
                        entry.values.push(value);
                    }
                    entries.push(entry);
                    if (entries.length >= n) {
                        break;
                    }
                }
                catch (err) {
                    // EOF?
                    if (err.code === 'EOF') {
                        break;
                    }
                    throw err;
                }
            }
            return entries;
        };
        return BinaryBPlusTree.create({
            getLeafStartKeys,
            getEntries,
            writer,
            treeStatistics: options.treeStatistics,
            fillFactor: options.fillFactor,
            allocatedBytes: options.allocatedBytes,
            isUnique: options.isUnique,
            keepFreeSpace: options.keepFreeSpace,
            maxEntriesPerNode: options.maxEntriesPerNode,
            metadataKeys: options.metadataKeys,
            debug,
        });
    }
}
BinaryBPlusTree.EntryValue = BinaryBPlusTreeLeafEntryValue;
BinaryBPlusTree.TransactionOperation = BinaryBPlusTreeTransactionOperation;
export { BinaryBPlusTree };
//# sourceMappingURL=binary-tree.js.map