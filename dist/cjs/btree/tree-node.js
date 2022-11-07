"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BPlusTreeNode = void 0;
const tree_node_entry_1 = require("./tree-node-entry");
const tree_leaf_1 = require("./tree-leaf");
const tree_1 = require("./tree");
const typesafe_compare_1 = require("./typesafe-compare");
const detailed_error_1 = require("../detailed-error");
const binary_1 = require("../binary");
class BPlusTreeNode {
    constructor(tree, parent) {
        this.tree = tree;
        this.parent = parent;
        this.entries = [];
        this.gtChild = null;
    }
    toString() {
        let str = 'Node: [' + this.entries.map(entry => entry.key).join(' | ') + ']';
        str += ' --> ';
        str += this.entries.map(entry => entry.ltChild.toString()).join(', ');
        str += ', ' + this.gtChild.toString();
        return str;
    }
    insertKey(newKey, fromLeaf, newLeaf) {
        // New key is being inserted from splitting leaf node
        if (this.entries.findIndex(entry => (0, typesafe_compare_1._isEqual)(entry.key, newKey)) >= 0) {
            throw new detailed_error_1.DetailedError('node-key-exists', `Key ${newKey} is already present in node`);
        }
        const newNodeEntry = new tree_node_entry_1.BPlusTreeNodeEntry(this, newKey);
        if (this.gtChild === fromLeaf) {
            newNodeEntry.ltChild = fromLeaf;
            this.gtChild = newLeaf;
            this.entries.push(newNodeEntry);
        }
        else {
            const oldNodeEntry = this.entries.find(entry => entry.ltChild === fromLeaf);
            const insertIndex = this.entries.indexOf(oldNodeEntry);
            newNodeEntry.ltChild = fromLeaf;
            oldNodeEntry.ltChild = newLeaf;
            this.entries.splice(insertIndex, 0, newNodeEntry);
        }
        this._checkSize();
    }
    _checkSize() {
        // Check if there are too many entries
        if (this.entries.length > this.tree.maxEntriesPerNode) {
            // Split this node
            // A = [ 10, 20, 30, 40 ] becomes A = [ 10, 20 ], B = [ 40 ], C = 30 moves to parent
            // B's gtChild (-) becomes A's gtChild (>=40)
            // A's gtChild (>=40) becomes C's ltChild (<30)
            // C's ltChild (<30) becomes A
            // C's entry_index+1.ltChild (when inserted, or C's node.gtChild when appended) becomes B
            const splitIndex = Math.ceil(this.tree.maxEntriesPerNode / 2);
            const moveEntries = this.entries.splice(splitIndex);
            const moveUpEntry = moveEntries.shift();
            const ltChild = moveUpEntry.ltChild;
            moveUpEntry.ltChild = this;
            const gtChild = this.gtChild;
            this.gtChild = ltChild;
            if (this.parent === null) {
                // Create new root node
                const newRoot = new BPlusTreeNode(this.tree, null);
                newRoot.entries = [moveUpEntry];
                const newSibling = new BPlusTreeNode(this.tree, newRoot);
                newSibling.entries = moveEntries;
                moveEntries.forEach(entry => entry.ltChild.parent = newSibling);
                newRoot.gtChild = newSibling;
                newSibling.gtChild = gtChild;
                gtChild.parent = newSibling;
                this.parent = newRoot;
                this.tree.root = newRoot;
                this.tree.depth++;
            }
            else {
                const newSibling = new BPlusTreeNode(this.tree, this.parent);
                newSibling.entries = moveEntries;
                moveEntries.forEach(entry => entry.ltChild.parent = newSibling);
                newSibling.gtChild = gtChild;
                gtChild.parent = newSibling;
                // Find where to insert moveUp
                const insertIndex = this.parent.entries.findIndex(entry => (0, typesafe_compare_1._isMore)(entry.key, moveUpEntry.key));
                if (insertIndex < 0) {
                    // Add to the end
                    this.parent.entries.push(moveUpEntry);
                    this.parent.gtChild = newSibling;
                }
                else {
                    // Insert somewhere in between
                    const insertBefore = this.parent.entries[insertIndex];
                    insertBefore.ltChild = newSibling;
                    this.parent.entries.splice(insertIndex, 0, moveUpEntry);
                }
                this.parent._checkSize(); // Let it check its size
            }
        }
    }
    async toBinary(keepFreeSpace, writer) {
        // EBNF layout:
        // data                 = byte_length, index_type, max_node_entries, [fill_factor], [free_byte_length], [metadata_keys], root_node
        // byte_length          = 4 byte number (byte count)
        // data_byte_length     = byte_length: NEVER INCLUDES ITS OWN BYTE SIZE OR OTHER HEADER BYTE SIZES
        // index_type           = 1 byte = [0, 0, has_large_ptrs, has_small_leafs, has_fill_factor, has_free_space, has_metadata, is_unique]
        // max_node_entries     = 1 byte number
        // fill_factor          = 1 byte number (max 100)
        // metadata_keys        = has_metadata?
        //                          1: metadata_length, metadata_key_count, metadata_key, [metadata_key, [metadata_key...]]
        //                          0: not present
        // metadata_length      = byte_length
        // metadata_key_count   = 1 byte number
        // metadata_key         = metadata_key_length, metadata_key_name
        // metadata_key_length  = 1 byte number
        // metadata_key_name    = [metadata_key_length] bytes (TextEncoded char codes)
        // root_node            = node | leaf
        // node*                = byte_length***, is_leaf, free_byte_length, entries_length, entries, gt_child_ptr, free_bytes, children
        // is_leaf              = 1 byte leaf_flags
        //                          >=1: yes, leaf
        //                          0: no, it's a node
        // free_byte_length     = byte_length (how many bytes are free for later additions)
        // entries_length       = 1 byte number (max 255 entries)
        // entries              = entry, [entry, [entry...]]
        // entry                = key, lt_child_ptr
        // key                  = key_type, key_length, key_data
        // key_type             = 1 byte number
        //                          0: UNDEFINED (equiv to sql null values)
        //                          1: STRING
        //                          2: NUMBER
        //                          3: BOOLEAN
        //                          4: DATE
        // key_length           = 1 byte number
        // key_data             = [key_length] bytes (ASCII chars when key is string)
        // lt_child_ptr         = offset_ptr (byte offset to node | leaf)
        // gt_child_ptr         = offset_ptr (byte offset to node | leaf)
        // children             = node, [node, [node...]] | leaf, [leaf, [leaf...]]
        // leaf**               = byte_length***, leaf_flags, free_byte_length, prev_leaf_ptr, next_leaf_ptr, [ext_byte_length, ext_free_byte_length], entries_length, leaf_entries, free_bytes, [ext_data]
        // leaf_flags           = 1 byte = [0, 0, 0, 0, 0, 0, has_ext_data, is_leaf]
        // prev_leaf_ptr        = offset_ptr (byte offset to leaf)
        // next_leaf_ptr        = offset_ptr (byte offset to leaf)
        // leaf_entries         = leaf_entry, [leaf_entry, [leaf_entry...]]
        // leaf_entry           = key, val
        // offset_ptr           = has_large_ptrs?
        //                          0: signed_number
        //                          1: large_signed_number
        // small_offset_ptr     = signed_number
        // signed_number        = 4 bytes, 32 bits = [negative_flag, ...bits]
        // large_signed_number  = 6 bytes, 48 bits = [negative_flag, ...bits]
        // val                  = val_length, val_data
        // val_length           = has_small_leafs?
        //                          1: 1 byte number: [1 bit has_ext_data, 7 bit byte count]
        //                          0: 4 byte number (byte count)
        // val_data             = has_ext_data?
        //                          1: is_unique?
        //                              1: ext_data_ptr
        //                              2: value_list_length, ext_data_ptr
        //                          0: is_unique?
        //                              1: value_list
        //                              0: value
        // ext_data_ptr         = byte_length (byte offset from leaf end to ext_data_block)
        // value_list           = value_list_length, value, [value, [value...]]
        // value_list_length    = 4 byte number
        // value                = value_length, value_data, metadata
        // value_length         = 1 byte number
        // value_data           = [value_length] bytes data
        // metadata             = metadata_value{metadata_key_count}
        // metadata_value       = metadata_value_type, metadata_value_length, metadata_value_data
        // metadata_value_type  = key_type
        // metadata_value_length= key_length
        // metadata_value_data  = key_data
        // ext_data             = ext_data_block, [ext_data_block, [ext_data_block]]
        // ext_data_block       = ext_block_length, ext_block_free_length, data (value | value_list)
        // ext_block_length     = data_byte_length
        // ext_block_free_length= free_byte_length
        //
        // * Written by BPlusTreeNode.toBinary
        // ** Written by BPlusTreeLeaf.toBinary
        // *** including free bytes (BUT excluding size of ext_data blocks for leafs)
        var _a;
        const bytes = [];
        const startIndex = writer.length; //bytes.length;
        // byte_length:
        bytes.push(0, 0, 0, 0);
        // is_leaf:
        bytes.push(0); // (no)
        // free_byte_length:
        bytes.push(0, 0, 0, 0); // Now used!
        // entries_length:
        bytes.push(this.entries.length);
        const pointers = []; // pointers refer to an offset in the binary data where nodes/leafs can be found
        const references = []; // references point to an index in the binary data where pointers are to be stored
        this.entries.forEach(entry => {
            const keyBytes = tree_1.BPlusTree.getBinaryKeyData(entry.key);
            bytes.push(...keyBytes);
            // lt_child_ptr:
            const index = startIndex + bytes.length;
            bytes.push(0, 0, 0, 0, 0, 0);
            references.push({ name: `<${entry.key}`, index, target: entry.ltChild });
        });
        // gt_child_ptr:
        const index = startIndex + bytes.length;
        bytes.push(0, 0, 0, 0, 0, 0);
        references.push({ name: `>${this.entries[this.entries.length - 1].key}`, index, target: this.gtChild });
        let freeBytes = 0;
        if (keepFreeSpace) {
            // Add free space
            const avgEntrySize = Math.ceil(bytes.length / this.entries.length);
            const freeEntries = this.tree.maxEntriesPerNode - this.entries.length;
            freeBytes = freeEntries * avgEntrySize;
            for (let i = 0; i < freeBytes; i++) {
                bytes.push(0);
            }
            // update free_byte_length:
            (0, binary_1.writeByteLength)(bytes, 5, freeBytes);
        }
        // update byte_length:
        (0, binary_1.writeByteLength)(bytes, 0, bytes.length);
        // Flush bytes, continue async
        await writer.append(bytes);
        // Now add children (NOTE: loops to entries.length + 1 to include gtChild!)
        for (let childIndex = 0; childIndex < this.entries.length + 1; childIndex++) {
            const entry = this.entries[childIndex];
            const childNode = entry ? entry.ltChild : this.gtChild;
            const name = entry ? `<${entry.key}` : `>=${this.entries[this.entries.length - 1].key}`;
            const index = writer.length;
            const refIndex = references.findIndex(ref => ref.target === childNode);
            const ref = references.splice(refIndex, 1)[0];
            const offset = index - (ref.index + 5); // index - (ref.index + 3);
            // Update child_ptr
            const child_ptr = (0, binary_1.writeSignedOffset)([], 0, offset, true);
            await writer.write(child_ptr, ref.index); // Update pointer
            const child = await childNode.toBinary(keepFreeSpace, writer); // Write child
            if (childNode instanceof tree_leaf_1.BPlusTreeLeaf) {
                // Remember location we stored this leaf, we need it later
                pointers.push({
                    name,
                    leaf: childNode,
                    index,
                });
            }
            // Add node pointers added by the child
            (_a = child.pointers) === null || _a === void 0 ? void 0 : _a.forEach(pointer => {
                // pointer.index += index; // DISABLED: indexes must already be ok now we're using 1 bytes array
                pointers.push(pointer);
            });
            // Add unresolved references added by the child
            child.references.forEach(ref => {
                // ref.index += index; // DISABLED: indexes must already be ok now we're using 1 bytes array
                references.push(ref);
            });
        }
        // Check if we can resolve any leaf references
        await BPlusTreeNode.resolveBinaryReferences(writer, references, pointers);
        return { references, pointers };
    }
    static async resolveBinaryReferences(writer, references, pointers) {
        for (let pointerIndex = 0; pointerIndex < pointers.length; pointerIndex++) {
            const pointer = pointers[pointerIndex];
            let i;
            while ((i = references.findIndex(ref => ref.target === pointer.leaf)) >= 0) {
                const ref = references.splice(i, 1)[0]; // remove it from the references
                const offset = pointer.index - ref.index;
                const bytes = (0, binary_1.writeSignedOffset)([], 0, offset, true);
                await writer.write(bytes, ref.index);
            }
        }
    }
}
exports.BPlusTreeNode = BPlusTreeNode;
//# sourceMappingURL=tree-node.js.map