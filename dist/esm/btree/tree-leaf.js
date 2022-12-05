import { assert } from '../assert.js';
import { writeByteLength } from '../binary.js';
import { DetailedError } from '../detailed-error.js';
import { FLAGS } from './binary-tree-builder.js';
import { MAX_LEAF_ENTRY_VALUES, MAX_SMALL_LEAF_VALUE_LENGTH, WRITE_SMALL_LEAFS } from './config.js';
import { BPlusTree } from './tree.js';
import { BPlusTreeLeafEntry } from './tree-leaf-entry.js';
import { BPlusTreeLeafEntryValue } from './tree-leaf-entry-value.js';
import { BPlusTreeNode } from './tree-node.js';
import { BPlusTreeNodeEntry } from './tree-node-entry.js';
import { _isEqual, _isMore } from './typesafe-compare.js';
import { _appendToArray, _checkNewEntryArgs } from './utils.js';
export class BPlusTreeLeaf {
    constructor(parent) {
        this.parent = parent;
        this.entries = [];
        this.prevLeaf = null;
        this.nextLeaf = null;
    }
    /**
     * The BPlusTree this leaf is in
     */
    get tree() {
        return this.parent instanceof BPlusTree ? this.parent : this.parent.tree;
    }
    /**
     * Adds an entry to this leaf
     * @param key
     * @param recordPointer data to store with the key, max size is 255
     * @param {object} [metadata] data to include, must contain all keys used in BPlusTree constructor
     * @returns {BPlusTreeLeafEntry} returns the added leaf entry
     */
    add(key, recordPointer, metadata) {
        // key = _normalizeKey(key); // if (_isIntString(key)) { key = parseInt(key); }
        if (typeof recordPointer === 'string') {
            // For now, allow this. Convert to byte array
            console.warn(`WARNING: converting recordPointer "${recordPointer}" to byte array. This is deprecated, will fail in the future`);
            const bytes = [];
            for (let i = 0; i < recordPointer.length; i++) {
                bytes.push(recordPointer.charCodeAt(i));
            }
            recordPointer = bytes;
        }
        const err = _checkNewEntryArgs(key, recordPointer, this.tree.metadataKeys, metadata);
        if (err) {
            throw err;
        }
        const entryValue = new BPlusTreeLeafEntryValue(recordPointer, metadata);
        // First. check if we already have an entry with this key
        const entryIndex = this.entries.findIndex(entry => _isEqual(entry.key, key));
        if (entryIndex >= 0) {
            if (this.tree.uniqueKeys) {
                throw new DetailedError('duplicate-node-key', `Cannot insert duplicate key ${key}`);
            }
            const entry = this.entries[entryIndex];
            entry.values.push(entryValue);
            return entry;
        }
        // New key, create entry
        const entry = new BPlusTreeLeafEntry(this, key, entryValue);
        if (this.entries.length === 0) {
            this.entries.push(entry);
        }
        else {
            // Find where to insert sorted
            const insertIndex = this.entries.findIndex(otherEntry => _isMore(otherEntry.key, entry.key));
            if (insertIndex < 0) {
                this.entries.push(entry);
            }
            else {
                this.entries.splice(insertIndex, 0, entry);
            }
            // FInd out if there are too many entries
            if (this.entries.length > this.tree.maxEntriesPerNode) {
                // Split the leaf
                const splitIndex = Math.ceil(this.tree.maxEntriesPerNode / 2);
                const moveEntries = this.entries.splice(splitIndex);
                const copyUpKey = moveEntries[0].key;
                if (this.parent instanceof BPlusTree) {
                    // We have to create the first parent node
                    const tree = this.parent;
                    this.parent = new BPlusTreeNode(tree, null);
                    tree.root = this.parent;
                    tree.depth = 2;
                    const newLeaf = new BPlusTreeLeaf(this.parent);
                    newLeaf.entries = moveEntries;
                    const newEntry = new BPlusTreeNodeEntry(this.parent, copyUpKey);
                    newEntry.ltChild = this;
                    this.parent.gtChild = newLeaf;
                    this.parent.entries = [newEntry];
                    // Update linked list pointers
                    newLeaf.prevLeaf = this;
                    if (this.nextLeaf) {
                        newLeaf.nextLeaf = this.nextLeaf;
                        newLeaf.nextLeaf.prevLeaf = newLeaf;
                    }
                    this.nextLeaf = newLeaf;
                }
                else {
                    const newLeaf = new BPlusTreeLeaf(this.parent);
                    newLeaf.entries = moveEntries;
                    this.parent.insertKey(copyUpKey, this, newLeaf);
                    // Update linked list pointers
                    newLeaf.prevLeaf = this;
                    if (this.nextLeaf) {
                        newLeaf.nextLeaf = this.nextLeaf;
                        newLeaf.nextLeaf.prevLeaf = newLeaf;
                    }
                    this.nextLeaf = newLeaf;
                }
            }
        }
        return entry;
    }
    toString() {
        const str = 'Leaf: [' + this.entries.map(entry => entry.key).join(' | ') + ']';
        return str;
    }
    async toBinary(keepFreeSpace = false, writer) {
        // See BPlusTreeNode.toBinary() for data layout
        assert(this.entries.every((entry, index, arr) => index === 0 || _isMore(entry.key, arr[index - 1].key)), 'Leaf entries are not sorted ok');
        const bytes = [];
        const startIndex = writer.length;
        // byte_length:
        bytes.push(0, 0, 0, 0);
        // leaf_flags:
        const leafFlagsIndex = bytes.length;
        bytes.push(FLAGS.IS_LEAF);
        // free_byte_length:
        bytes.push(0, 0, 0, 0);
        const references = [];
        // prev_leaf_ptr:
        this.prevLeaf && references.push({ name: `<${this.entries[0].key}`, target: this.prevLeaf, index: startIndex + bytes.length });
        bytes.push(0, 0, 0, 0, 0, 0);
        // next_leaf_ptr:
        this.nextLeaf && references.push({ name: `>${this.entries[this.entries.length - 1].key}`, target: this.nextLeaf, index: startIndex + bytes.length });
        bytes.push(0, 0, 0, 0, 0, 0);
        // ext_byte_length, ext_free_byte_length: (will be removed when no ext_data is written)
        const extDataHeaderIndex = bytes.length;
        bytes.push(0, 0, 0, 0, // ext_byte_length
        0, 0, 0, 0);
        // entries_length:
        bytes.push(this.entries.length);
        const entriesStartIndex = bytes.length;
        const moreDataBlocks = [];
        this.entries.forEach(entry => {
            assert(entry.values.length <= MAX_LEAF_ENTRY_VALUES, 'too many leaf entry values to store in binary');
            const keyBytes = BPlusTree.getBinaryKeyData(entry.key);
            bytes.push(...keyBytes);
            // val_length:
            const valLengthIndex = bytes.length;
            if (WRITE_SMALL_LEAFS) {
                bytes.push(0);
            }
            else {
                bytes.push(0, 0, 0, 0);
            }
            const valueBytes = [];
            const writeValue = (entryValue) => {
                const { recordPointer, metadata } = entryValue;
                // const startIndex = bytes.length;
                // const target = valueBytes;
                // value_length:
                valueBytes.push(recordPointer.length);
                // value_data:
                valueBytes.push(...recordPointer);
                // metadata:
                this.tree.metadataKeys.forEach(key => {
                    const metadataValue = metadata[key];
                    const mdBytes = BPlusTree.getBinaryKeyData(metadataValue); // metadata_value has same structure as key, so getBinaryKeyData comes in handy here
                    valueBytes.push(...mdBytes);
                });
            };
            if (this.tree.uniqueKeys) {
                // value:
                writeValue(entry.values[0]);
            }
            else {
                entry.values.forEach(entryValue => {
                    // value:
                    writeValue(entryValue);
                });
            }
            if (WRITE_SMALL_LEAFS && valueBytes.length > MAX_SMALL_LEAF_VALUE_LENGTH) {
                // Values too big for small leafs
                // Store value bytes in ext_data block
                if (!this.tree.uniqueKeys) {
                    // value_list_length:
                    writeByteLength(bytes, bytes.length, entry.values.length);
                }
                // ext_data_ptr:
                const extPointerIndex = bytes.length;
                bytes.push(0, 0, 0, 0);
                // update val_length:
                bytes[valLengthIndex] = FLAGS.ENTRY_HAS_EXT_DATA;
                // add
                moreDataBlocks.push({
                    pointerIndex: extPointerIndex,
                    bytes: valueBytes,
                });
            }
            else {
                // update val_length:
                const valLength = valueBytes.length + (this.tree.uniqueKeys ? 0 : 4); // +4 to include value_list_length bytes //bytes.length - valLengthIndex - 4;
                if (WRITE_SMALL_LEAFS) {
                    bytes[valLengthIndex] = valLength;
                }
                else {
                    writeByteLength(bytes, valLengthIndex, valLength);
                }
                if (!this.tree.uniqueKeys) {
                    // value_list_length:
                    writeByteLength(bytes, bytes.length, entry.values.length);
                }
                // add value bytes:
                _appendToArray(bytes, valueBytes);
            }
        });
        // Add free space
        const entriesDataSize = bytes.length - entriesStartIndex;
        const avgBytesPerEntry = this.entries.length === 0 ? 25 : Math.ceil(entriesDataSize / this.entries.length);
        const availableEntries = this.tree.maxEntriesPerNode - this.entries.length;
        const freeBytesLength = keepFreeSpace
            ? Math.ceil(availableEntries * avgBytesPerEntry * 1.1) // + 10%
            : 0;
        for (let i = 0; i < freeBytesLength; i++) {
            bytes.push(0);
        }
        const hasExtData = moreDataBlocks.length > 0;
        if (hasExtData) {
            // update leaf_flags:
            bytes[leafFlagsIndex] |= FLAGS.LEAF_HAS_EXT_DATA;
        }
        else {
            // remove ext_byte_length, ext_free_byte_length
            bytes.splice(extDataHeaderIndex, 8);
        }
        // update byte_length:
        const totalLeafSize = bytes.length;
        writeByteLength(bytes, 0, totalLeafSize);
        // update free_byte_length
        writeByteLength(bytes, 5, freeBytesLength);
        // Now, add any ext_data blocks
        if (hasExtData) {
            const leafEndIndex = bytes.length;
            moreDataBlocks.forEach(block => {
                const offset = bytes.length - leafEndIndex; // offset from leaf end index
                writeByteLength(bytes, block.pointerIndex, offset); // update ext_data_ptr
                // Calculate free space
                const free = keepFreeSpace ? Math.ceil(block.bytes.length * 0.1) : 0;
                const blockLength = block.bytes.length + free;
                // ext_block_length:
                writeByteLength(bytes, bytes.length, blockLength);
                // ext_block_free_length:
                writeByteLength(bytes, bytes.length, free);
                // ext_data_ptr: (not implemented yet)
                bytes.push(0, 0, 0, 0);
                // data:
                _appendToArray(bytes, block.bytes);
                // Add free space:
                for (let i = 0; i < free; i++) {
                    bytes.push(0);
                }
            });
            const extByteLength = bytes.length - leafEndIndex;
            const extFreeByteLength = keepFreeSpace ? Math.ceil(extByteLength * 0.1) : 0;
            // update ext_byte_length:
            writeByteLength(bytes, extDataHeaderIndex, extByteLength + extFreeByteLength);
            // update ext_free_byte_length:
            writeByteLength(bytes, extDataHeaderIndex + 4, extFreeByteLength);
            // Add free space:
            for (let i = 0; i < extFreeByteLength; i++) {
                bytes.push(0);
            }
        }
        await writer.append(bytes);
        return { references };
    }
}
//# sourceMappingURL=tree-leaf.js.map