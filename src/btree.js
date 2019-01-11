const { Utils } = require('acebase-core');
const { numberToBytes, bytesToNumber } = Utils;
const { TextEncoder, TextDecoder } = require('text-encoding');
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const KEY_TYPE = {
    UNDEFINED: 0,
    STRING: 1,
    NUMBER: 2,
    BOOLEAN: 3,
    DATE: 4
};

// const safeCompare = function(val) {
//     return {
//         lt: (val2) => { 
//             if (typeof val === 'undefined') { return typeof val2 !== 'undefined'; }
//             return val < val2;
//         },
//         lte: (val2) => {
//             if (typeof val === 'undefined') { return true; }
//             return val <= val2;
//         },
//         gt: (val2) => {
//             if (typeof val === 'undefined') { return false; }
//             return val > val2;
//         },
//         gte: (val2) => {
//             if (typeof val === 'undefined') { return typeof val2 === 'undefined'; }
//             return val >= val2;
//         },
//         eq: (val2) => {
//             return val == val2;
//         }
//     }
// };

function _getComparibleValue(val) {
    if (typeof val === 'undefined') { val = null; }
    if (val instanceof Date) { val = val.getTime(); }
    return val;
}

// Typeless comparison methods
function _isEqual(val1, val2) {
    val1 = _getComparibleValue(val1);
    val2 = _getComparibleValue(val2);
    return val1 == val2;
}
function _isNotEqual(val1, val2) {
    val1 = _getComparibleValue(val1);
    val2 = _getComparibleValue(val2);
    return val1 != val2;
}
function _isLess(val1, val2) {
    val1 = _getComparibleValue(val1);
    val2 = _getComparibleValue(val2);
    if (val2 === null) { return false; }
    if (val1 === null) { return val2 !== null; }
    return val1 < val2;
}
function _isLessOrEqual(val1, val2) {
    val1 = _getComparibleValue(val1);
    val2 = _getComparibleValue(val2);
    if (val1 === null) { return true; }
    else if (val2 === null) { return false; }
    return val1 <= val2;
}
function _isMore(val1, val2) {
    val1 = _getComparibleValue(val1);
    val2 = _getComparibleValue(val2);
    if (val1 === null) { return false; }
    else if (val2 === null) { return true; }
    return val1 > val2;
}
function _isMoreOrEqual(val1, val2) {
    val1 = _getComparibleValue(val1);
    val2 = _getComparibleValue(val2);
    if (val1 === null) { return val2 === null; }
    else if (val2 === null) { return true; }
    return val1 >= val2;
}
function _sortCompare(val1, val2) {
    val1 = _getComparibleValue(val1);
    val2 = _getComparibleValue(val2);
    if (val1 === null && val2 !== null) { return -1; }
    if (val1 !== null && val2 === null) { return 1; }
    if (val1 < val2) { return -1; }
    if (val1 > val2) { return 1; }
    return 0;
}

/**
 * 
 * @param {number[]} val1 
 * @param {number[]} val2 
 */
function _compareBinary(val1, val2) {
    return val1.length === val2.length && val1.every((byte, index) => val2[index] === byte);
}

class BPlusTreeNodeEntry {
    /**
     * 
     * @param {BPlusTreeNode} node 
     * @param {string|number|boolean|Date} key 
     */
    constructor(node, key) {
        this.node = node;
        this.key = key;
        /**
         * @type {BPlusTreeNode|BPlusTreeLeaf}
         */
        this.ltChild = null;
    }
}

class BPlusTreeNode {
    /**
     * 
     * @param {BPlusTree} tree 
     * @param {BPlusTreeNode} parent 
     */
    constructor(tree, parent) {
        this.tree = tree;
        this.parent = parent;
        /**
         * @type {BPlusTreeNodeEntry[]}
         */
        this.entries = [];

        /**
         * @type {BPlusTreeNode|BPlusTreeLeaf}
         */
        this.gtChild = null;
    }

    toString() {
        let str = "Node: [" + this.entries.map(entry => entry.key).join(" | ") + "]";
        str += " --> ";
        str += this.entries.map(entry => entry.ltChild.toString()).join(", ");
        str += ", " + this.gtChild.toString();
        return str;
    }    

    /**
     * 
     * @param {string|number|boolean|Date|undefined} newKey 
     * @param {BPlusTreeLeaf} fromLeaf 
     * @param {BPlusTreeLeaf} newLeaf 
     */
    insertKey(newKey, fromLeaf, newLeaf) {
        // New key is being inserted from splitting leaf node
        if(this.entries.findIndex(entry => _isEqual(entry.key, newKey)) >= 0) {
            throw new Error(`Key ${newKey} is already present in node`);
        }

        const newNodeEntry = new BPlusTreeNodeEntry(this, newKey);
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
                const insertIndex = this.parent.entries.findIndex(entry => _isMore(entry.key, moveUpEntry.key));
                if (insertIndex < 0) {
                    // Add to the end
                    this.parent.entries.push(moveUpEntry);
                    this.parent.gtChild = newSibling;
                }
                else {
                    // Insert somewhere in between
                    let insertBefore = this.parent.entries[insertIndex];
                    insertBefore.ltChild = newSibling;
                    this.parent.entries.splice(insertIndex, 0, moveUpEntry);
                }

                this.parent._checkSize(); // Let it check its size
            }
        }
    }

    /**
     * BPlusTreeNode.toBinary
     * @param {boolean} keepFreeSpace 
     * @param {BinaryWriter} writer
     */
    toBinary(keepFreeSpace, writer) {
        // EBNF layout:
        // data                 = byte_length, index_type, max_node_entries, [metadata_keys], root_node
        // byte_length          = 4 byte number (byte count)
        // index_type           = 1 byte = [0,0,0,0,0,0, has_metadata, is_unique]
        // max_node_entries     = 1 byte number
        // metadata_keys        = has_metadata?
        //                          0: not present
        //                          1: metadata_length, metadata_key_count, metadata_key, [metadata_key, [metadata_key...]]
        // metadata_length      = byte_length
        // metadata_key_count   = 1 byte number
        // metadata_key         = metadata_key_length, metadata_key_name
        // metadata_key_length  = 1 byte number
        // metadata_key_name    = [metadata_key_length] bytes (TextEncoded char codes)
        // root_node            = node | leaf
        // node*                = byte_length, is_leaf, free_byte_length, entries_length, entries, gt_child_ptr, children
        // is_leaf              = 1 byte
        //                          0: no, it's a node
        //                          1: yes, leaf
        // free_byte_length     = byte_length (how many bytes are free for later additions)
        // entries_length       = 1 byte number
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
        // lt_child_ptr         = 4 byte number (byte offset to node | leaf)
        // gt_child_ptr         = 4 byte number (byte offset to node | leaf)
        // children             = node, [node, [node...]] | leaf, [leaf, [leaf...]]
        // leaf**               = byte_length, is_leaf, free_byte_length, prev_leaf_ptr, next_leaf_ptr, entries_length, leaf_entries
        // prev_leaf_ptr        = 4 byte signed_number (byte offset to leaf)
        // next_leaf_ptr        = 4 byte signed_number (byte offset to leaf)
        // leaf_entries         = leaf_entry, [leaf_entry, [leaf_entry...]]
        // leaf_entry           = key, val
        // signed_number        = 32 bits = [negative_flag, bit{31}]
        // val                  = val_length, val_data
        // val_length           = 4 byte number (byte count)
        // val_data             = is_unique?
        //                          0: value_list
        //                          1: value
        // value_list           = value_list_length, value, [value, [value...]]
        // value_list_length    = 4 byte number
        // value                = value_length, value_data, metadata
        // value_length         = 1 byte number
        // value_data           = [value_length] bytes data
        // metadata             = metadata_value[metadata_key_count]
        // metadata_value       = metadata_value_type, metadata_value_length, metadata_value_data
        // metadata_value_type  = key_type
        // metadata_value_length= key_length
        // metadata_value_data  = key_data
        // 
        //
        // * Written by BPlusTreeNode.toBinary
        // ** Written by BPlusTreeLeaf.toBinary

        let bytes = [];
        const startIndex = writer.length; //bytes.length;

        // byte_length:
        bytes.push(0, 0, 0, 0);

        // is_leaf:
        bytes.push(0); // (no)

        // free_byte_length:
        bytes.push(0, 0, 0, 0); // Not used for nodes at this time, reserved for future use

        // entries_length:
        bytes.push(this.entries.length);

        let pointers = [],      // pointers refer to an offset in the binary data where nodes/leafs can be found
            references = [];    // references point to an index in the binary data where pointers are to be stored
        
        this.entries.forEach(entry => {
            let keyBytes = BPlusTree.getBinaryKeyData(entry.key);
            bytes.push(...keyBytes);

            // lt_child_ptr:
            let index = startIndex + bytes.length;
            bytes.push(0, 0, 0, 0);
            references.push({ name: `<${entry.key}`, index, node: entry.ltChild });
        });

        // gt_child_ptr:
        let index = startIndex + bytes.length;
        bytes.push(0, 0, 0, 0);
        references.push({ name: `>${this.entries[this.entries.length - 1].key}`, index, node: this.gtChild });

        // update byte_length:
        bytes[0] = (bytes.length >> 24) & 0xff;
        bytes[1] = (bytes.length >> 16) & 0xff;
        bytes[2] = (bytes.length >> 8) & 0xff;
        bytes[3] = bytes.length & 0xff;

        // Flush bytes, continue async
        return writer.append(bytes)
        .then(() => {

            // Now add children
            const addChild = (childNode, name) => {
                let index = writer.length;
                const refIndex = references.findIndex(ref => ref.node === childNode);
                const ref = references.splice(refIndex, 1)[0];
                const offset = index - (ref.index + 3);
                
                // Update child_ptr
                const child_ptr = [
                    (offset >> 24) & 0xff, // BPlusTree.addBinaryDebugString(`child_ptr ${name}`, (offset >> 24) & 0xff),
                    (offset >> 16) & 0xff,
                    (offset >> 8) & 0xff,
                    offset & 0xff
                ];

                return writer.write(child_ptr, ref.index)  // Update pointer
                .then(() => {
                    return childNode.toBinary(keepFreeSpace, writer) // Add child                    
                })
                .then(child => {
                    if (childNode instanceof BPlusTreeLeaf) {
                        // Remember location we stored this leaf, we need it later
                        pointers.push({ 
                            name, 
                            leaf: childNode, 
                            index
                        });
                    }
                    // Add node pointers added by the child
                    child.pointers && child.pointers.forEach(pointer => {
                        // pointer.index += index; // DISABLED: indexes must already be ok now we're using 1 bytes array
                        pointers.push(pointer);
                    });
                    // Add unresolved references added by the child
                    child.references.forEach(ref => {
                        // ref.index += index; // DISABLED: indexes must already be ok now we're using 1 bytes array
                        references.push(ref);
                    });
                });
            };

            let childIndex = 0;
            const nextChild = () => {
                let entry = this.entries[childIndex];
                let isLast = !entry;
                let child = entry ? entry.ltChild : this.gtChild;
                let name = entry ? `<${entry.key}` : `>=${this.entries[this.entries.length-1].key}`;
                if (child === null) {
                    throw new Error(`This is not right. Right?`);
                }
                return addChild(child, name)
                .then(() => {
                    if (!isLast) {
                        childIndex++;
                        return nextChild();
                    }
                })
                .then(() => {
                    // Check if we can resolve any leaf references
                    return BPlusTreeNode.resolveBinaryReferences(writer, references, pointers);
                })
                .then(() => {
                    return { references, pointers };
                });
            }
            return nextChild();
        });
    }

    static resolveBinaryReferences(writer, references, pointers) {
        let maxOffset = Math.pow(2, 31) - 1;
        // Make async
        let pointerIndex = 0;
        function nextPointer() {
            const pointer = pointers[pointerIndex];
            if (!pointer) { return Promise.resolve(); }
            const nextReference = () => {
                const i = references.findIndex(ref => ref.target === pointer.leaf);
                if (i < 0) { return Promise.resolve(); }
                let ref = references.splice(i, 1)[0]; // remove it from the references
                let offset = pointer.index - ref.index;
                const negative = (offset < 0);
                if (negative) { offset = -offset; }
                if (offset > maxOffset) {
                    throw new Error(`reference offset to big to store in 31 bits`);
                }
                const bytes = [
                    ((offset >> 24) & 0x7f) | (negative ? 0x80 : 0),
                    (offset >> 16) & 0xff,
                    (offset >> 8) & 0xff,
                    offset & 0xff
                ];
                return writer.write(bytes, ref.index)
                .then(() => {
                    return nextReference();
                });
            }
            return nextReference()
            .then(() => {
                pointerIndex++;
                return nextPointer();
            });
        }
        return nextPointer();
    }

}

class BPlusTreeLeafEntryValue {
    /**
     * @param {number[]|Uint8Array} recordPointer used to be called "value", renamed to prevent confusion
     * @param {object} [metadata] 
     */
    constructor(recordPointer, metadata) {
        this.recordPointer = recordPointer;
        this.metadata = metadata;
    }

    /** @deprecated use .recordPointer instead */
    get value() {
        return this.recordPointer;
    }
}

class BPlusTreeLeafEntry {
    /**
     * 
     * @param {BPlusTreeLeaf} leaf 
     * @param {string|number|boolean|Date|undefined} key 
     * @param {BPlusTreeLeafEntryValue} [value] 
     */
    constructor(leaf, key, value) {
        if (typeof value !== 'undefined' && !(value instanceof BPlusTreeLeafEntryValue)) {
            throw new Error(`value must be an instance of BPlusTreeLeafEntryValue`);
        }
        this.leaf = leaf;
        this.key = key;
        this.values = typeof value === 'undefined' ? [] : [value];
    }
}

class BPlusTreeLeaf {
    /**
     * 
     * @param {BPlusTree|BPlusTreeNode} parent 
     */
    constructor(parent) {
        /**
         * @type {BPlusTree|BPlusTreeNode}
         */
        this.parent = parent;
        /**
         * @type {BPlusTreeLeafEntry[]}
         */
        this.entries = [];
        /**
         * @type {BPlusTreeLeaf}
         */
        this.prevLeaf = null;
        /**
         * @type {BPlusTreeLeaf}
         */
        this.nextLeaf = null;
    }

    /**
     * The BPlusTree this leaf is in
     * @type {BPlusTree}
     */
    get tree() {
        return this.parent instanceof BPlusTree ? this.parent : this.parent.tree;
    }

    /**
     * Adds an entry to this leaf
     * @param {string|number|boolean|Date|undefined} key 
     * @param {number[]|Uint8Array} recordPointer data to store with the key, max size is 255
     * @param {object} [metadata] data to include, must contain all keys used in BPlusTree constructor
     * @returns {BPlusTreeLeafEntry} returns the added leaf entry
     */
    add(key, recordPointer, metadata) {
        if (typeof recordPointer === "string") {
            // For now, allow this. Convert to byte array
            console.warn(`WARNING: converting recordPointer "${recordPointer}" to byte array. This is deprecated, will fail in the future`);
            let bytes = [];
            for(let i = 0; i < recordPointer.length; i++) {
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
                throw new Error(`Cannot insert duplicate key ${key}`);
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
            let insertIndex = this.entries.findIndex(otherEntry => _isMore(otherEntry.key, entry.key));
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
        let str = "Leaf: [" + this.entries.map(entry => entry.key).join(" | ") + "]";
        return str;
    }

    /**
     * BPlusTreeLeaf.toBinary
     * @param {boolean} keepFreeSpace 
     * @param {BinaryWriter} writer
     */
    toBinary(keepFreeSpace = false, writer) {
        // See BPlusTreeNode.toBinary() for data layout
        const bytes = [];
        const startIndex = writer.length;

        // byte_length
        bytes.push(0, 0, 0, 0);

        // is_leaf:
        bytes.push(1); // (yes)

        // free_byte_length:
        bytes.push(0, 0, 0, 0);

        const references = [];

        // prev_leaf_ptr:
        this.prevLeaf && references.push({ name: `<${this.entries[0].key}`, target: this.prevLeaf, index: startIndex + bytes.length });
        bytes.push(0, 0, 0, 0);

        // next_leaf_ptr:
        this.nextLeaf && references.push({ name: `>${this.entries[this.entries.length-1].key}`, target: this.nextLeaf, index: startIndex + bytes.length });
        bytes.push(0, 0, 0, 0);

        // entries_length:
        bytes.push(this.entries.length);

        this.entries.forEach(entry => {
            let keyBytes = BPlusTree.getBinaryKeyData(entry.key);
            bytes.push(...keyBytes);

            // val_length:
            const valLengthIndex = bytes.length;
            bytes.push(0, 0, 0, 0);

            /**
             * 
             * @param {BPlusTreeLeafEntryValue} entryValue 
             */
            const writeValue = (entryValue) => {
                const { recordPointer, metadata } = entryValue;

                // value_length:
                bytes.push(recordPointer.length);

                // value_data:
                bytes.push(...recordPointer);

                // metadata:
                this.tree.metadataKeys.forEach(key => {
                    const metadataValue = metadata[key];
                    const valueBytes = BPlusTree.getBinaryKeyData(metadataValue); // metadata_value has same structure as key, so getBinaryKeyData comes in handy here
                    bytes.push(...valueBytes);
                });
            };

            if (this.tree.uniqueKeys) {
                // value:
                writeValue(entry.values[0]);
            }
            else {
                // value_list_length:
                const valueListLength = entry.values.length;
                bytes.push((valueListLength >> 24) & 0xff);
                bytes.push((valueListLength >> 16) & 0xff);
                bytes.push((valueListLength >> 8) & 0xff);
                bytes.push(valueListLength & 0xff);

                entry.values.forEach(entryValue => {
                    // value:
                    writeValue(entryValue);
                });
            }

            // update val_length
            const valLength = bytes.length - valLengthIndex - 4;
            bytes[valLengthIndex] = (valLength >> 24) & 0xff;
            bytes[valLengthIndex+1] = (valLength >> 16) & 0xff;
            bytes[valLengthIndex+2] = (valLength >> 8) & 0xff;
            bytes[valLengthIndex+3] = valLength & 0xff;
        });

        // Add free space
        const leafDataSize = bytes.length;
        const avgBytesPerEntry = Math.ceil(leafDataSize / this.entries.length);
        const availableEntries = this.tree.maxEntriesPerNode - this.entries.length;
        const freeBytesLength = 
            keepFreeSpace && this.entries.length > 0
            ? availableEntries * avgBytesPerEntry
            : 0;
        for (let i = 0; i < freeBytesLength; i++) { bytes.push(0); }

        // update byte_length:
        const totalLeafSize = bytes.length;
        bytes[0] = (totalLeafSize >> 24) & 0xff;
        bytes[1] = (totalLeafSize >> 16) & 0xff;
        bytes[2] = (totalLeafSize >> 8) & 0xff;
        bytes[3] = totalLeafSize & 0xff;

        // update free_byte_length
        bytes[5] = (freeBytesLength >> 24) & 0xff;
        bytes[6] = (freeBytesLength >> 16) & 0xff;
        bytes[7] = (freeBytesLength >> 8) & 0xff;
        bytes[8] = freeBytesLength & 0xff;

        return writer.append(bytes)
        .then(() => {
            return { references };
        });
    }
}

class BPlusTree {
    /**
     * 
     * @param {number} maxEntriesPerNode max number of entries per tree node. Working with this instead of m for max number of children, because that makes less sense imho
     * @param {boolean} uniqueKeys whether the keys added must be unique
     * @param {string[]} [metadataKeys] (optional) names of metadata keys that will be included in tree
     */
    constructor(maxEntriesPerNode, uniqueKeys, metadataKeys) {
        this.maxEntriesPerNode = maxEntriesPerNode;
        this.uniqueKeys = uniqueKeys;
        this.root = new BPlusTreeLeaf(this);
        this.metadataKeys = metadataKeys || [];
        this.depth = 1;
    }

    /**
     * Adds a key to the tree
     * @param {string|number|boolean|Date|undefined} key 
     * @param {number[]|Uint8Array} value data to store with the key, max size is 255
     * @param {object} [metadata] data to include, must contain all keys used in BPlusTree constructor
     * @returns {BPlusTree} returns reference to this tree
     */
    add(key, value, metadata) {
        // Find the leaf to insert to
        let leaf;
        if (this.root instanceof BPlusTreeLeaf) {
            // Root is leaf node (total entries <= maxEntriesPerNode)
            leaf = this.root;
        }
        else {
            // Navigate to the right leaf to add to
            leaf = this.findLeaf(key, true);
        }
        leaf.add(key, value, metadata);
        return this;
    }

    // TODO: Enable bulk adding of keys: throw away all nodes, append/insert all keys ordered. Upon commit, cut all data into leafs, construct the nodes up onto the root
    // addBulk(arr, commit = false) {
    //     // Adds given items in bulk and reconstructs the tree
    //     let leaf = this.firstLeaf();
    //     while(leaf) {
    //         leaf = leaf.getNext()
    //     }
    // }

    /**
     * Finds the relevant leaf for a key
     * @param {string|number|boolean|Date|undefined} key 
     * @returns {BPlusTreeLeaf} returns the leaf the key is in, or would be in when present
     */
    findLeaf(key) {
        /**
         * 
         * @param {BPlusTreeNode} node 
         * @returns {BPlusTreeLeaf}
         */
        const findLeaf = (node) => { 
            if (node instanceof BPlusTreeLeaf) {
                return node;
            }
            for (let i = 0; i < node.entries.length; i++) {
                let entry = node.entries[i];
                if (_isLess(key, entry.key)) {
                    node = entry.ltChild;
                    if (!node) {
                        return null;
                    }
                    if (node instanceof BPlusTreeLeaf) {
                        return node;
                    }
                    else {
                        return findLeaf(node);
                    }
                }
            }
            // Still here? key must be >= last entry
            console.assert(_isMoreOrEqual(key, node.entries[node.entries.length-1].key));
            return findLeaf(node.gtChild);
        };
        return findLeaf(this.root);   
    }

    find(key) {
        const leaf = this.findLeaf(key);
        const entry = leaf.entries.find(entry => _isEqual(entry.key, key));
        if (!entry) { return null; }
        if (this.uniqueKeys) {
            return entry.values[0];
        }
        else {
            return entry.values;
        }
    }

    search(op, val) {
        if (["in","!in","between","!between"].indexOf(op) >= 0) {
            // val must be an array
            console.assert(val instanceof Array, `val must be an array when using operator ${op}`);
        }

        if (op === "exists" || op === "!exists") {
            op = op === "exists" ? "!=" : "==";
            val = undefined;
        }
        if (val === null) {
            val = undefined;
        }

        let results = [];
        const add = (entry) => {
            let obj = { key: entry.key };
            if (this.uniqueValues) {
                obj.value = entry.values[0];
            }
            else {
                obj.values = entry.values;
            }
            results.push(obj);
        };
        if (["<","<="].indexOf(op) >= 0) {
            let leaf = this.findLeaf(val);
            while(leaf) {
                for (let i = leaf.entries.length-1; i >= 0; i--) {
                    const entry = leaf.entries[i];
                    if (op === "<=" && _isLessOrEqual(entry.key, val)) { add(entry); }
                    else if (op === "<" && _isLess(entry.key, val)) { add(entry); }
                }
                leaf = leaf.prevLeaf;
            }
        }
        else if ([">",">="].indexOf(op) >= 0) {
            let leaf = this.findLeaf(val);
            while(leaf) {
                for (let i = 0; i < leaf.entries.length; i++) {
                    const entry = leaf.entries[i];
                    if (op === ">=" && _isMoreOrEqual(entry.key, val)) { add(entry); }
                    else if (op === ">" && _isMore(entry.key, val)) { add(entry); }
                }
                leaf = leaf.nextLeaf;
            }
        }
        else if (op === "==") {
            let leaf = this.findLeaf(val);
            let entry = leaf.entries.find(entry => _isEqual(entry.key, val)); //  entry.key === val
            if (entry) {
                add(entry);
            }
        }
        else if (op === "!=") {
            // Full index scan needed
            let leaf = this.firstLeaf();
            while(leaf) {
                for (let i = 0; i < leaf.entries.length; i++) {
                    const entry = leaf.entries[i];
                    if (_isNotEqual(entry.key, val)) { add(entry); } // entry.key !== val
                }
                leaf = leaf.nextLeaf;
            }
        }
        else if (op === "in") {
            let sorted = val.slice().sort();
            let searchKey = sorted.shift();
            let leaf; // = this.findLeaf(searchKey);
            let trySameLeaf = false;
            while (searchKey) {
                if (!trySameLeaf) {
                    leaf = this.findLeaf(searchKey);
                }
                let entry = leaf.entries.find(entry => _isEqual(entry.key, val)); // entry.key === searchKey
                if (!entry && trySameLeaf) {
                    trySameLeaf = false;
                    continue;
                }
                if (entry) { add(entry); }
                searchKey = sorted.shift();
                trySameLeaf = true;
            }
        }
        else if (op === "!in") {
            // Full index scan needed
            let keys = val;
            let leaf = this.firstLeaf();
            while(leaf) {
                for (let i = 0; i < leaf.entries.length; i++) {
                    const entry = leaf.entries[i];
                    if (keys.findIndex(val => _isEqual(entry.key, val)) < 0) { add(entry); } //if (keys.indexOf(entry.key) < 0) { add(entry); }
                }
                leaf = leaf.nextLeaf;
            }
        }
        else if (op === "between") {
            let bottom = val[0], top = val[1];
            if (top < bottom) {
                let swap = top;
                top = bottom;
                bottom = swap;
            }
            let leaf = this.findLeaf(bottom);
            let stop = false;
            while(!stop && leaf) {
                for (let i = 0; i < leaf.entries.length; i++) {
                    const entry = leaf.entries[i];
                    if (_isMoreOrEqual(entry.key, bottom) && _isLessOrEqual(entry.key, top)) { add(entry); }
                    if (_isMore(entry.key, top)) { stop = true; break; }
                }
                leaf = leaf.nextLeaf;
            }
        }
        else if (op === "!between") {
            // Equal to key < bottom || key > top
            let bottom = val[0], top = val[1];
            if (top < bottom) {
                let swap = top;
                top = bottom;
                bottom = swap;
            }
            // Add lower range first, lowest value < val < bottom
            let leaf = this.firstLeaf();
            let stop = false;
            while (leaf && !stop) {
                for (let i = 0; i < leaf.entries.length; i++) {
                    const entry = leaf.entries[i];
                    if (_isLess(entry.key, bottom)) { add(entry); }
                    else { stop = true; break; }
                }
                leaf = leaf.nextLeaf;
            }
            // Now add upper range, top < val < highest value
            leaf = this.findLeaf(top);
            while (leaf) {
                for (let i = 0; i < leaf.entries.length; i++) {
                    const entry = leaf.entries[i];
                    if (_isMore(entry.key, top)) { add(entry); }
                }
                leaf = leaf.nextLeaf;
            }            
        }
        return results;
    }

    /**
     * @returns {BPlusTreeLeaf} the first leaf in the tree
     */
    firstLeaf() {
        // Get the very first leaf
        let node = this.root;
        while (!(node instanceof BPlusTreeLeaf)) {
            node = node.entries[0].ltChild;
        }
        return node;
    }

    /**
     * @returns {BPlusTreeLeaf} the last leaf in the tree
     */
    lastLeaf() {
        // Get the very last leaf
        let node = this.root;
        while (!(node instanceof BPlusTreeLeaf)) {
            node = node.gtChild;
        }        
    }

    all() {
        // Get the very first leaf
        let leaf = this.firstLeaf();
        // Now iterate through all the leafs
        const all = [];
        while (leaf) {
            all.push(...leaf.entries.map(entry => entry.key));
            leaf = leaf.nextLeaf; //leaf.next();
        }
        return all;
    }

    reverseAll() {
        // Get the very last leaf
        let leaf = this.lastLeaf();
        // Now iterate through all the leafs (backwards)
        const all = [];
        while (leaf) {
            all.push(...leaf.entries.map(entry => entry.key));
            leaf = leaf.prevLeaf;
        }
        return all;
    }

    static get debugBinary() { return false; }
    static addBinaryDebugString(str, byte) {
        if (this.debugBinary) {
            return [str, byte];
        }
        else {
            return byte;
        }
    }
    static getKeyFromBinary(bytes, index) {
        // key_type:
        let keyType = bytes[index];
        index++;

        // key_length:
        let keyLength = bytes[index];
        index++;

        // key_data:
        let keyData = bytes.slice(index, index + keyLength); // [];
        index += keyLength;

        let key;
        switch(keyType) {
            case KEY_TYPE.UNDEFINED: {
                // no need to do this: key = undefined;
                break;
            }
            case KEY_TYPE.STRING: {
                key = textDecoder.decode(Uint8Array.from(keyData));
                // key = keyData.reduce((k, code) => k + String.fromCharCode(code), "");
                break;
            }
            case KEY_TYPE.NUMBER: {
                if (keyData.length < 8) {
                    // Append trailing 0's
                    keyData.push(...[0,0,0,0,0,0,0,0].slice(keyData.length));
                }
                key = bytesToNumber(keyData);
                break;
            }
            case KEY_TYPE.BOOLEAN: {
                key = keyData[0] === 1;
                break;
            }
            case KEY_TYPE.DATE: {
                key = new Date(bytesToNumber(keyData));
                break;
            }
        }
        return { key, length: keyLength };
    }
    static getBinaryKeyData(key) {
        let keyBytes = [];
        let keyType = KEY_TYPE.UNDEFINED;
        switch(typeof key) {
            case "undefined": {
                keyType = KEY_TYPE.UNDEFINED;
                break;
            }                
            case "string": {
                keyType = KEY_TYPE.STRING;
                keyBytes = Array.from(textEncoder.encode(key));
                // for (let i = 0; i < key.length; i++) {
                //     keyBytes.push(key.charCodeAt(i));
                // }
                break;
            }
            case "number": {
                keyType = KEY_TYPE.NUMBER;
                keyBytes = numberToBytes(key);
                // Remove trailing 0's to reduce size for smaller and integer values
                while (keyBytes[keyBytes.length-1] === 0) { keyBytes.pop(); }
                break;
            }
            case "boolean": {
                keyType = KEY_TYPE.BOOLEAN;
                keyBytes = [key ? 1 : 0];
                break;
            }
            case "object": {
                if (key instanceof Date) {
                    keyType = KEY_TYPE.DATE;
                    keyBytes = numberToBytes(key.getTime());
                }
                else {
                    throw new Error(`Unsupported key type`);
                }
                break;
            }
            default: {
                throw new Error(`Unsupported key type: ${typeof key}`);
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

    /**
     * BPlusTree.toBinary
     * @param {boolean} keepFreeSpace 
     * @param {BinaryWriter} writer
     */
    toBinary(keepFreeSpace = false, writer) {
        if (!(writer instanceof BinaryWriter)) {
            throw new Error(`writer argument must be an instance of BinaryWriter`);
        }
        // Return binary data
        const indexTypeFlags = 
              (this.uniqueKeys ? 1 : 0) 
            | (this.metadataKeys.length > 0 ? 2 : 0);
        const bytes = [
            // byte_length:
            0, 0, 0, 0,
            // index_type:
            indexTypeFlags,
            // max_node_entries:
            this.maxEntriesPerNode
        ];
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
                for (let i=0; i < key.length; i++) {
                    bytes.push(key.charCodeAt(i));
                }
            });

            // update metadata_length:
            const length = bytes.length - index - 4;
            bytes[index] = (length >> 24) & 0xff;
            bytes[index+1] = (length >> 16) & 0xff;
            bytes[index+2] = (length >> 8) & 0xff;
            bytes[index+3] = length & 0xff;
        }

        const headerLength = bytes.length;
        return writer.append(bytes)
        .then(() => {
            return this.root.toBinary(keepFreeSpace, writer);
        })
        .then(({ references, pointers }) => {
            console.assert(references.length === 0, "All references must be resolved now");

            // update byte_length:
            const byteLength = writer.length - headerLength;
            const bytes = [
                (byteLength >> 24) & 0xff,
                (byteLength >> 16) & 0xff,
                (byteLength >> 8) & 0xff,
                byteLength & 0xff
            ]
            return writer.write(bytes, 0)
            .then(() => {
                return writer.end();
            });
        });
    }    
}

function _checkNewEntryArgs(key, recordPointer, metadataKeys, metadata) {
    const storageTypesText = 'supported types are string, number, boolean, Date and undefined';
    const isStorableType = (val) => {
        return ['number','string','boolean','undefined'].indexOf(typeof val) >= 0 || val instanceof Date;
    };
    if (!isStorableType(key)) {
        return new TypeError(`key contains a value that cannot be stored. ${storageTypesText}`);
    }
    if (!(recordPointer instanceof Array || recordPointer instanceof Uint8Array)) {
        return new TypeError("recordPointer must be a byte array or Uint8Array");
    }
    if (recordPointer.length > 255) {
        return new Error(`Unable to store recordPointers larger than 255 bytes`); // binary restriction
    }
    // Check if all metadata keys are present and have valid data
    try {
        metadataKeys && metadataKeys.forEach(key => {
            if (!(key in metadata)) { 
                throw new TypeError(`metadata must include key "${key}"`); 
            }
            if (!isStorableType(typeof metadata[key])) {
                throw new TypeError(`metadata "${key}" contains a value that cannot be stored. ${storageTypesText}`);
            }
        });
    }
    catch(err) {
        return err;
    }
}

class BPlusTreeBuilder {
    /**
     * @param {boolean} uniqueKeys
     * @param {number} [fillFactor=100]
     * @param {string[]} [metadataKeys=[]]
     */
    constructor(uniqueKeys, fillFactor = 100, metadataKeys = []) {
        this.uniqueKeys = uniqueKeys;
        this.fillFactor = fillFactor;
        this.metadataKeys = metadataKeys || [];
        this.list = new Map(); // {};
        this.indexedValues = 0;
    }

    /**
     * @param {string|number|boolean|Date|undefined} key 
     * @param {number[]|Uint8Array} recordPointer 
     * @param {object} [metadata] 
     */
    add(key, recordPointer, metadata) {
        const err = _checkNewEntryArgs(key, recordPointer, this.metadataKeys, metadata);
        if (err) {
            throw err;
        }
        const entryValue = new BPlusTreeLeafEntryValue(recordPointer, metadata);
        const existing = this.list.get(key); // this.list[key]
        if (this.uniqueKeys && typeof existing !== 'undefined') {
            throw new Error(`Cannot add duplicate key "${key}", tree must have unique keys`);
        }
        else if (existing) {
            existing.push(entryValue);
        }
        else {
            this.list.set(key, this.uniqueKeys //this.list[key] =
                ? entryValue
                : [entryValue]);
        }
        this.indexedValues++;
    }

    /**
     * 
     * @param {string|number|boolean|Date|undefined} key 
     * @param {number[]|Uint8Array} [recordPointer] specific recordPointer to remove. If the tree has unique keys, this can be omitted
     */
    remove(key, recordPointer = undefined) {
        const isEqual = (val1, val2) => {
            if (val1 instanceof Array && val2 instanceof Array) {
                return val1.every((v,i) => val2[i] === v);
            }
            return val1 === val2;
        };
        if (this.uniqueKeys) {
            this.list.delete(key); //delete this.list[key];
        }
        else {
            const entryValues = this.list.get(key); //[key]
            const valIndex = entryValues.findIndex(entryValue => isEqual(entryValue.recordPointer, recordPointer));
            if (~valIndex) {
                if (item.length === 1) {
                    this.list.delete(key); //delete this.list[key];
                }
                else {
                    entryValues.splice(valIndex, 1);
                }
            }
        }
    }

    create(maxEntries = undefined) {
        // Create a tree bottom-up with all nodes filled to the max (optionally capped to fillFactor)

        let list = [];
        this.list.forEach((val, key) => {
            list.push({ key, val });
        });
        this.list.clear();
        this.list = null; // Make unusable
        list.sort((a,b) => {
            return _sortCompare(a.key, b.key);
            // if (_isLess(a.key, b.key)) { return -1; }
            // else if (_isMore(a.key, b.key)) { return 1; }
            // return 0;
        });

        //const length = Object.keys(this.list).length;
        const minNodeSize = 3; //25;
        const maxNodeSize = 255;
        const entriesPerNode = typeof maxEntries === 'number' ? maxEntries : Math.min(maxNodeSize, Math.max(minNodeSize, Math.ceil(list.length / 10)));
        const entriesPerLeaf = Math.max(minNodeSize, Math.floor(entriesPerNode * (this.fillFactor / 100)));
        const minParentEntries = Math.max(1, Math.floor(entriesPerNode / 2));
        const tree = new BPlusTree(entriesPerNode, this.uniqueKeys, this.metadataKeys);

        const nrOfLeafs = Math.max(1, Math.ceil(list.length / entriesPerLeaf));
        const parentConnections = entriesPerNode+1;  // should be +1 because the > connection
        let currentLevel = 1;
        let nrOfNodesAtLevel = nrOfLeafs;
        let nrOfParentNodes = Math.ceil(nrOfNodesAtLevel / parentConnections);
        let nodesAtLevel = [];
        while (true) {
            // Create parent nodes
            const creatingLeafs = currentLevel === 1;
            const parentNodes = [];
            for (let i = 0; i < nrOfParentNodes; i++) {
                const node = new BPlusTreeNode(tree, null);
                if (i > 0) { 
                    const prevNode = parentNodes[i-1];
                    node.prevNode = prevNode;
                    prevNode.nextNode = node;
                }
                parentNodes.push(node);
            }

            for (let i = 0; i < nrOfNodesAtLevel; i++) {
                // Eg 500 leafs with 25 entries each, 500/25 = 20 parent nodes:
                // When i is between 0 and (25-1), parent node index = 0
                // When i is between 25 and (50-1), parent index = 1 etc
                // So, parentIndex = Math.floor(i / 25)
                const parentIndex = Math.floor(i / parentConnections); 
                const parent = parentNodes[parentIndex];

                if (creatingLeafs) {
                    // Create leaf
                    const leaf = new BPlusTreeLeaf(parent);
                    nodesAtLevel.push(leaf);

                    // Setup linked list properties
                    const prevLeaf = nodesAtLevel[nodesAtLevel.length-2];
                    if (prevLeaf) {
                        leaf.prevLeaf = prevLeaf;
                        prevLeaf.nextLeaf = leaf;
                    }

                    // Create leaf entries
                    const fromIndex = i * entriesPerLeaf;
                    const entryKVPs = list.slice(fromIndex, fromIndex + entriesPerLeaf);
                    entryKVPs.forEach(kvp => {
                        const entry = new BPlusTreeLeafEntry(leaf, kvp.key);
                        entry.values = this.uniqueKeys ? [kvp.val] : kvp.val;
                        leaf.entries.push(entry);
                    });
                    
                    const isLastLeaf = Math.floor((i+1) / parentConnections) > parentIndex 
                        || i === nrOfNodesAtLevel-1;
                    if (isLastLeaf) {
                        // Have parent's gtChild point to this last leaf
                        parent.gtChild = leaf;

                        if (parentNodes.length > 1 && parent.entries.length < minParentEntries) {
                            /* Consider this order 4 B+Tree: 3 entries per node, 4 connections

                                                    12  >
                                            4  7  10 >	  ||	>
                                1  2  3 || 4  5  6 || 7  8  9 || 10  11  12 || 13 14 15

                                The last leaf (13 14 15) is the only child of its parent, its assignment to
                                parent.gtChild is right, but there is no entry to > compare to. In this case, we have to
                                move the previous leaf's parent entry to our own parent:

                                                    10  >
                                            4  7  >	   ||	13  >
                                1  2  3 || 4  5  6 || 7  8  9 || 10  11  12 || 13 14 15

                                We moved just 1 parent entry which is fine in case of an order 4 tree, floor((O-1) / 2) is the 
                                minimum entries for a node, floor((4-1) / 2) = floor(1.5) = 1.
                                When the tree order is higher, it's effect on higher tree nodes becomes greater and the tree 
                                becomes inbalanced if we do not meet the minimum entries p/node requirement. 
                                So, we'll have to move Math.floor(entriesPerNode / 2) parent entries to our parent
                            */
                            const nrOfParentEntries2Move = minParentEntries - parent.entries.length;
                            const prevParent = parent.prevNode;
                            for (let j = 0; j < nrOfParentEntries2Move; j++) {
                                const firstChild = parent.entries.length === 0 
                                    ? leaf                                      // In first iteration, firstLeaf === leaf === "13 14 15"
                                    : parent.entries[0].ltChild;                // In following iterations, firstLeaf === last moved leaf "10 11 12"
                                //const prevChild = firstChild.prevChild;
                                const moveEntry = prevParent.entries.pop();     // removes "10" from prevLeaf's parent
                                const moveLeaf = prevParent.gtChild;
                                prevParent.gtChild = moveEntry.ltChild;         // assigns "7 8 9" leaf to prevLeaf's parent > connection
                                moveEntry.key = firstChild.entries[0].key;      // changes the key to "13"
                                moveLeaf.parent = parent;                       // changes moving "10 11 12" leaf's parent to ours
                                moveEntry.ltChild = moveLeaf;                   // assigns "10 11 12" leaf to <13 connection
                                parent.entries.unshift(moveEntry);              // inserts "13" entry into our parent node
                                moveEntry.node = parent;                      // changes moving entry's parent to ours
                            }
                            //console.log(`Moved ${nrOfParentEntries2Move} parent node entries`);
                        }
                    }
                    else {
                        // Create parent entry with ltChild that points to this leaf
                        const ltChildKey = list[fromIndex + entriesPerLeaf].key;
                        const parentEntry = new BPlusTreeNodeEntry(parent, ltChildKey);
                        parentEntry.ltChild = leaf;
                        parent.entries.push(parentEntry);
                    }
                }
                else {
                    // Nodes have already been created at the previous iteration,
                    // we have to create entries for parent nodes only
                    const node = nodesAtLevel[i];
                    node.parent = parent;

                    // // Setup linked list properties - not needed by BPlusTreeNode itself, but used in code below
                    // const prevNode = nodesAtLevel[nodesAtLevel.length-2];
                    // if (prevNode) {
                    //     node.prevNode = prevNode;
                    //     prevNode.nextNode = node;
                    // }

                    const isLastNode = Math.floor((i+1) / parentConnections) > parentIndex
                        || i === nrOfNodesAtLevel-1;
                    if (isLastNode) {
                        parent.gtChild = node;

                        if (parentNodes.length > 1 && parent.entries.length < minParentEntries) {
                            // This is not right, we have to fix it.
                            // See leaf code above for additional info
                            const nrOfParentEntries2Move = minParentEntries - parent.entries.length;
                            const prevParent = parent.prevNode;
                            for (let j = 0; j < nrOfParentEntries2Move; j++) {
                                const firstChild = parent.entries.length === 0 
                                    ? node
                                    : parent.entries[0].ltChild;
                                
                                const moveEntry = prevParent.entries.pop();
                                const moveNode = prevParent.gtChild;
                                prevParent.gtChild = moveEntry.ltChild;
                                let ltChild = firstChild.entries[0].ltChild;
                                while (!(ltChild instanceof BPlusTreeLeaf)) {
                                    ltChild = ltChild.entries[0].ltChild;
                                }
                                moveEntry.key = ltChild.key; //firstChild.entries[0].key;
                                moveNode.parent = parent;
                                moveEntry.ltChild = moveNode;
                                parent.entries.unshift(moveEntry);
                                moveEntry.node = parent;
                            }
                            //console.log(`Moved ${nrOfParentEntries2Move} parent node entries`);
                        }
                    }
                    else {
                        let ltChild = node.nextNode;
                        while (!(ltChild instanceof BPlusTreeLeaf)) {
                            ltChild = ltChild.entries[0].ltChild;
                        }
                        const ltChildKey = ltChild.entries[0].key; //node.gtChild.entries[node.gtChild.entries.length-1].key; //nodesAtLevel[i+1].entries[0].key;
                        const parentEntry = new BPlusTreeNodeEntry(parent, ltChildKey);
                        parentEntry.ltChild = node;
                        parent.entries.push(parentEntry);
                    }
                }
            }

            if (nrOfLeafs === 1) {
                // Very little data. Only 1 leaf
                let leaf = nodesAtLevel[0];
                leaf.parent = tree;
                tree.root = leaf;
                break;
            }
            else if (nrOfParentNodes === 1) {
                // Done
                tree.root = parentNodes[0];
                break;
            }
            currentLevel++; // Level up
            nodesAtLevel = parentNodes;
            nrOfNodesAtLevel = nodesAtLevel.length;
            nrOfParentNodes = Math.ceil(nrOfNodesAtLevel / parentConnections);
            tree.depth++;
        }

        if (false) {
            // TEST the tree!
            const ok = list.every(item => {
                const val = tree.find(item.key);
                if (val === null) {
                    return false;
                }
                return true;
                //return  !== null;
            })
            if (!ok) {
                throw new Error(`This tree is not ok`);
            }
        }

        return tree;
    }

    dumpToFile(filename) {
        const fs = require('fs');
        fs.appendFileSync(filename, this.uniqueKeys + '\n');
        fs.appendFileSync(filename, this.fillFactor + '\n');
        for (let [key, val] of this.list) {
            let json = JSON.stringify({ key, val }) + '\n';
            fs.appendFileSync(filename, json);
        }
    }

    static fromFile(filename) {
        const fs = require('fs');
        const entries = fs.readFileSync(filename, 'utf8')
            .split('\n')
            .map(str => str.length > 0 ? JSON.parse(str) : '');

        const last = entries.pop(); // Remove last empty one (because split \n)
        console.assert(last === '');
        const uniqueKeys = entries.shift() === 'true';
        const fillFactor = parseInt(entries.shift());
        let builder = new BPlusTreeBuilder(uniqueKeys, fillFactor);
        // while(entries.length > 0) {
        //     let entry = entries.shift();
        //     builder.list.set(entry.key, entry.val);
        // }
        for (let i = 0; i < entries.length; i++) {
            builder.list.set(entries[i].key, entries[i].val);
        }
        return builder;
    }
}

// TODO: Refactor to typed arrays
class ChunkReader {
    constructor(chunkSize, readFn) {
        this.chunkSize = chunkSize;
        this.read = readFn;
        this.data = null;
        this.offset = 0;    // offset of loaded data (start index of current chunk in data source)
        this.index = 0;     // current chunk reading index ("cursor" in currently loaded chunk)
    }
    init() {
        return this.read(0, this.chunkSize)
        .then(chunk => {
            this.data = chunk;
            this.offset = 0;
            this.index = 0;
        });
    }
    get(byteCount) {
        return this.assert(byteCount)
        .then(() => {
            const bytes = this.data.slice(this.index, this.index + byteCount);
            this.index += byteCount;
            return bytes;
        });
    }
    more(chunks = 1) {
        return this.read(this.offset + this.data.length, chunks * this.chunkSize)
        .then(nextChunk => {
            //this.data.push(...nextChunk);
            //nextChunk.forEach(byte => this.data.push(byte));
            this.data = this.data.concat(Array.from(nextChunk));
        });
    }
    seek(offset) {
        if (this.index + offset < this.data.length) {
            this.index += offset;
            return Promise.resolve();
        }
        let dataIndex = this.offset + this.index + offset;
        return this.read(dataIndex, this.chunkSize)
        .then(newChunk => {
            this.data = newChunk;
            this.offset = dataIndex;
            this.index = 0;
        });        
    }
    assert(byteCount) {
        if (this.index + byteCount > this.data.length) {
            return this.more(Math.ceil(byteCount / this.chunkSize));
        }
        else {
            return Promise.resolve();
        }        
    }
    skip(byteCount) {
        this.index += byteCount;
    }
    rewind(byteCount) {
        this.index -= byteCount;
    }
    go(index) {
        if (this.offset <= index && this.offset + this.data.length > index) {
            this.index = index - this.offset;
            return Promise.resolve();
        }
        return this.read(index, this.chunkSize)
        .then(chunk => {
            this.data = chunk;
            this.offset = index;
            this.index = 0;
        });
    }
    savePosition(offsetCorrection = 0) {
        let savedIndex = this.offset + this.index + offsetCorrection;
        let go = (offset = 0) => {
            let index = savedIndex + offset;
            return this.go(index);
        }
        return {
            go,
            index: savedIndex
        };
    }
    get sourceIndex() {
        return this.offset + this.index;
    }
}

class BinaryBPlusTree {
    /**
     * Provides functionality to read and search in a B+tree from a binary data source
     * @param {Array|(index: number, length: number) => Promise<Array>} readFn byte array, or function that reads from your data source, must return a promise that resolves with a byte array (the bytes read from file/memory)
     * @param {number} chunkSize numbers of bytes per chunk to read at once
     * @param {(data: number[], index: number) => Promise<any>} writeFn function that writes to your data source, must return a promise that resolves once write has completed
     */
    constructor(readFn, chunkSize = 1024, writeFn = undefined) {
        this._chunkSize = chunkSize;
        if (readFn instanceof Array) {
            let data = readFn;
            if (BPlusTree.debugBinary) {
                this.debugData = data;
                data = data.map(entry => entry instanceof Array ? entry[1] : entry);
            }
            this._readFn = (i, length) => {
                let slice = data.slice(i, i + length);
                return Promise.resolve(slice);
            };
        }
        else if (typeof readFn === "function") {
            this._readFn = readFn;
        }
        else {
            throw new TypeError(`readFn must be a byte array or function that reads from a data source`);
        }

        if (typeof writeFn === "function") {
            this._writeFn = writeFn;
        }
        else if (typeof writeFn === "undefined" && readFn instanceof Array) {
            const sourceData = readFn;
            this._writeFn = (data, index) => {
                for (let i = 0; i < data.length; i++) {
                    sourceData[index + i] = data[i];
                }
                return Promise.resolve();
            }
        }        
        else {
            this._writeFn = () => {
                throw new Error(`Cannot write data, no writeFn was supplied`);
            }
        }
    }

    _getReader() {
        const reader = new ChunkReader(this._chunkSize, this._readFn);
        return reader.init()
        .then(() => {
            return reader.get(6);
        })
        .then(header => {
            this.info = {
                headerLength: 6,
                byteLength: (header[0] << 24) | (header[1] << 16) | (header[2] << 8) | header[3],
                isUnique: (header[4] & 0x1) === 1,
                hasMetadata: (header[4] & 0x2) === 2,
                entriesPerNode: header[5],
                metadataKeys: []
            };
            if (this.info.hasMetadata) {
                // The tree has metadata keys, read them
                this.info.headerLength += 4;
                return reader.get(4)
                .then(bytes => {
                    const length = (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]; 
                    this.info.headerLength += length;
                    return reader.get(length);
                })
                .then(bytes => {
                    const keyCount = bytes[0];
                    let index = 1;
                    for (let i = 0; i < keyCount; i++) {
                        const keyLength = bytes[index];
                        index++;
                        let key = '';
                        for (let j = 0; j < keyLength; j++) {
                            key += String.fromCharCode(bytes[index+j]);
                        }
                        index += keyLength;
                        this.info.metadataKeys.push(key);
                    }

                    // Done reading header
                    return reader;
                });
            }
            // Done reading header
            return reader;
        });
    }

    /**
     * 
     * @param {ChunkReader} reader 
     * @returns {Promise<BinaryBPlusTreeNodeInfo>}
     */
    _readChild(reader) {
        const index = reader.sourceIndex; //reader.savePosition().index;
        const headerLength = 9;
        return reader.get(headerLength) // byte_length, is_leaf, free_byte_length
        .then(bytes => {
            const byteLength = (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]; // byte_length
            const isLeaf = bytes[4] === 1; // is_leaf
            const freeBytesLength = (bytes[5] << 24) | (bytes[6] << 16) | (bytes[7] << 8) | bytes[8];

            // load whole node/leaf for easy processing
            return reader.get(byteLength - headerLength) // todo: - freeBytesLength, right?
            .then(bytes => {
                const childInfo = new BinaryBPlusTreeNodeInfo({
                    isLeaf,
                    bytes,
                    index,
                    length: byteLength,
                    free: freeBytesLength
                });
                return childInfo;
            });
        });
    }

    /**
     * 
     * @param {BinaryBPlusTreeNodeInfo} leaf 
     * @param {ChunkReader} reader 
     * @param {object} [options]
     * @param {boolean} [options.stats=false]
     * @returns {BinaryBPlusTreeLeaf}
     */
    _getLeaf(leafInfo, reader, options) {
        const leaf = new BinaryBPlusTreeLeaf(leafInfo);
        const bytes = leaf.bytes;
        const savedPosition = reader.savePosition(-bytes.length);
        const getSignedOffset = (bytes, index) => {
            let offset = ((bytes[index] & 0x7f) << 24) | (bytes[index+1] << 16) | (bytes[index+2] << 8)  | bytes[index+3];
            let isNegative = (bytes[index] & 0x80) > 0;
            if (isNegative) { offset = -offset; }
            return offset;
        };

        const prevLeafOffset = getSignedOffset(bytes, 0); // prev_leaf_ptr
        const nextLeafOffset = getSignedOffset(bytes, 4); // next_leaf_ptr
        leaf.prevLeafOffset = prevLeafOffset;
        leaf.nextLeafOffset = nextLeafOffset;

        let entriesLength = bytes[8]; // entries_length

        let index = 9;

        const readValue = () => {
            let valueLength = bytes[index]; // value_length
            index++;
            let value = [];
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
                let valueInfo = BPlusTree.getKeyFromBinary(bytes, index);
                metadata[key] = valueInfo.key;
                index += valueInfo.length + 2;
            });
            return new BinaryBPlusTreeLeafEntryValue(value, metadata);
        };

        for (let i = 0; i < entriesLength; i++) {
            let keyInfo = BPlusTree.getKeyFromBinary(bytes, index);
            let key = keyInfo.key;
            index += keyInfo.length + 2;

            // Read value(s) and return
            const valLength = (bytes[index] << 24) | (bytes[index+1] << 16) | (bytes[index+2] << 8) | bytes[index+3]; // val_length
            index += 4; 
            if (options && options.stats) {
                // Skip values, only load value count
                let entry = new BinaryBPlusTreeLeafEntry(key, null);
                if (this.info.isUnique) { 
                    entry.totalValues = 1;
                }
                else {
                    entry.totalValues = (bytes[index] << 24) | (bytes[index+1] << 16) | (bytes[index+2] << 8) | bytes[index+3]; // value_list_length
                }
                leaf.entries.push(entry);
                index += valLength; // Skip val_length
            }
            else if (this.info.isUnique) {
                // Read single value
                const entryValue = readValue();
                leaf.entries.push(new BinaryBPlusTreeLeafEntry(key, [entryValue]));
            }
            else {
                // Read value_list_length
                const valuesLength = (bytes[index] << 24) | (bytes[index+1] << 16) | (bytes[index+2] << 8) | bytes[index+3]; // value_list_length
                index += 4;
                const entryValues = [];
                for(let i = 0; i < valuesLength; i++) {
                    const entryValue = readValue();
                    entryValues.push(entryValue);
                }
                leaf.entries.push(new BinaryBPlusTreeLeafEntry(key, entryValues));
            }
        }

        if (prevLeafOffset !== 0) {
            leaf.getPrevious = () => {
                return savedPosition.go(prevLeafOffset)
                .then(() => {
                    return this._readChild(reader)
                    .then(childInfo => {
                        console.assert(childInfo.isLeaf, `If this is not the case, debug me`);
                        return this._getLeaf(childInfo, reader, options);
                    });
                });
            };
        }
        if (nextLeafOffset !== 0) {
            leaf.getNext = () => {
                return savedPosition.go(nextLeafOffset + 4) // +4 because next_leaf_ptr is 4 bytes from savedPosition
                .then(() => {
                    return this._readChild(reader)
                    .then(childInfo => {
                        console.assert(childInfo.isLeaf, `If this is not the case, debug me`);
                        return this._getLeaf(childInfo, reader, options);
                    });                    
                });
            };
        }
        return leaf;
    }

    /**
     * 
     * @param {BinaryBPlusTreeLeaf} leafInfo 
     * @returns {Promise<void>}
     */
    _writeLeaf(leafInfo) {

        const tree = new BPlusTree(this.info.entriesPerNode, this.info.isUnique, this.info.metadataKeys);
        const leaf = new BPlusTreeLeaf(tree);
        leafInfo.entries.forEach(entry => {
            const key = entry.key;
            const leafEntry = new BPlusTreeLeafEntry(leaf, key);
            leafEntry.values = entry.values;
            leaf.entries.push(leafEntry);
        });
        // const { bytes } = leaf.toBinary(false); // Let us add the free space ourselves

        const bytes = [];
        return leaf.toBinary(false, BinaryWriter.forArray(bytes)) // Let us add the free space ourselves
        .then(() => {
            // Add free space
            const freeBytesLength = leafInfo.length - bytes.length;
            if (freeBytesLength < 0) {
                throw new Error(`Cannot write leaf: its data became too big to store in available space`);
            }
            for (let i = 0; i < freeBytesLength; i++) {
                bytes.push(0);
            }
            
            // update byte_length:
            bytes[0] = (bytes.length >> 24) & 0xff;
            bytes[1] = (bytes.length >> 16) & 0xff;
            bytes[2] = (bytes.length >> 8) & 0xff;
            bytes[3] = bytes.length & 0xff;

            // update free_byte_length
            bytes[5] = (freeBytesLength >> 24) & 0xff;
            bytes[6] = (freeBytesLength >> 16) & 0xff;
            bytes[7] = (freeBytesLength >> 8) & 0xff;
            bytes[8] = freeBytesLength & 0xff;

            // set pointers to prev/next leafs manually (they stay the same as before)
            const maxSignedNumber = Math.pow(2, 31) - 1;
            const writeSignedOffset = (index, offset, debugName) => {
                const negative = offset < 0;
                if (negative) { offset = -offset; }
                if (offset > maxSignedNumber) {
                    throw new Error(`reference offset to big to store in 31 bits`);
                }
                bytes[index] = ((offset >> 24) & 0x7f) | (negative ? 0x80 : 0);
                // if (debugName) {
                //     data[index] = [debugName, data[index]];
                // }
                bytes[index+1] = (offset >> 16) & 0xff;
                bytes[index+2] = (offset >> 8) & 0xff;
                bytes[index+3] = offset & 0xff;
            };

            // update prev_leaf_ptr:
            writeSignedOffset(9, leafInfo.prevLeafOffset);

            // update next_leaf_ptr:
            writeSignedOffset(13, leafInfo.nextLeafOffset);

            return this._writeFn(bytes, leafInfo.index);
        });
    }

    /**
     * 
     * @param {BinaryBPlusTreeNodeInfo} nodeInfo 
     * @param {ChunkReader} reader 
     * @returns {Promise<BinaryBPlusTreeNode>}
     */
    _getNode(nodeInfo, reader) {
        // const node = { 
        //     entries: [] 
        // };
        const node = new BinaryBPlusTreeNode(nodeInfo);
        const bytes = node.bytes;
        const entriesLength = bytes[0];
        let index = 1;

        for (let i = 0; i < entriesLength; i++) {
            let keyInfo = BPlusTree.getKeyFromBinary(bytes, index);
            let key = keyInfo.key;
            index += keyInfo.length + 2;
            let entry = new BinaryBPlusTreeNodeEntry(key);
            node.entries.push(entry);

            // read lt_child_ptr:
            let ltChildOffset = (bytes[index] << 24) | (bytes[index+1] << 16) | (bytes[index+2] << 8) | bytes[index+3]; // lt_child_ptr
            if (ltChildOffset > 0) {
                const savedPosition = reader.savePosition(-bytes.length + index + 3); // +3 because offset is from first byte
                entry.getLtChild = () => {
                    return savedPosition.go(ltChildOffset)
                    .then(() => {
                        return this._readChild(reader);
                    });
                };
                // reader.rewind(bytes.length - index); // correct reader's index
                // return reader.seek(offset + 3).then(() => {
                //     return readChild();
                // });
            }
            index += 4;
        }
        // read gt_child_ptr:
        let gtChildOffset = (bytes[index] << 24) | (bytes[index+1] << 16) | (bytes[index+2] << 8) | bytes[index+3]; // gt_child_ptr
        if (gtChildOffset > 0) {
            const savedPosition = reader.savePosition(-bytes.length + index + 3); // +3 because offset is from first byte
            node.getGtChild = () => {
                return savedPosition.go(gtChildOffset)
                .then(() => {
                    return this._readChild(reader);
                });
            };
            // reader.rewind(bytes.length - index); // correct reader's index
            // return reader.seek(gtNodeOffset + 3).then(() => {
            //     return readChild();
            // });
        }
        return node;
    }

    /**
     * @param {object} [options]
     * @param {boolean} [options.stats] 
     */
    getFirstLeaf(options) {
        let reader;
        const processChild = (childInfo) => {
            if (childInfo.isLeaf) {
                return this._getLeaf(childInfo, reader, options);
            }
            else {
                const node = this._getNode(childInfo, reader);
                return node.entries[0].getLtChild()
                .then(processChild);
            }
        };
        return this._getReader()
        .then(r => {
            reader = r;
            return this._readChild(reader);
        })
        .then(processChild);
    }

    /**
     * 
     * @param {object} [options]
     * @param {boolean} [options.stats] 
     */
    getLastLeaf(options) {
        let reader;
        /**
         * 
         * @param {BinaryBPlusTreeNodeInfo} childInfo 
         */
        const processChild = (childInfo) => {
            if (childInfo.isLeaf) {
                return this._getLeaf(childInfo, reader, options);
            }
            else {
                return this._getNode(childInfo, reader)
                .then(node => {
                    return node.getGtChild();
                })
                .then(processChild);
            }
        };
        return this._getReader()
        .then(r => {
            reader = r;
            return this._readChild(reader);
        })
        .then(processChild);
    }

    /**
     * 
     * @param {string|boolean|number|Date} searchKey 
     * @param {object} [options]
     * @param {boolean} [options.stats] 
     * @returns {Promise<BinaryBPlusTreeLeaf>}
     */
    findLeaf(searchKey, options) {
        // navigate to the right child
        let reader;
        const readChild = () => {
            return this._readChild(reader)
            .then(childInfo => {
                if (childInfo.isLeaf) {
                    return this._getLeaf(childInfo, reader, options);
                }
                else {
                    return readNode(childInfo);
                }
            });
        };

        const readNode = (childInfo) => {
            const bytes = childInfo.bytes;
            let entries = bytes[0];
            let index = 1;

            for (let i = 0; i < entries; i++) {
                let keyInfo = BPlusTree.getKeyFromBinary(bytes, index);
                let key = keyInfo.key;
                index += keyInfo.length + 2;

                if (_isLess(searchKey, key)) {
                    // Check lesser child node
                    let offset = (bytes[index] << 24) | (bytes[index+1] << 16) | (bytes[index+2] << 8) | bytes[index+3]; // lt_child_ptr
                    if (offset > 0) {
                        reader.rewind(bytes.length - index); // correct reader's index
                        return reader.seek(offset + 3).then(() => {
                            return readChild();
                        });
                    }
                    else {
                        return null;
                    }
                }
                else {
                    // Increase index to point to next entry
                    index += 4; // skip lt_child_ptr
                }
            }
            // Still here? key > last entry in node
            let gtNodeOffset = (bytes[index] << 24) | (bytes[index+1] << 16) | (bytes[index+2] << 8) | bytes[index+3]; // gt_child_ptr
            if (gtNodeOffset > 0) {
                reader.rewind(bytes.length - index); // correct reader's index
                return reader.seek(gtNodeOffset + 3).then(() => {
                    return readChild();
                });
            }
            else {
                return null;
            }
        };            

        // let the reader start after the header bytes
        return this._getReader()
        .then(r => {
            reader = r;
            return reader.go(this.info.headerLength);
        }) 
        .then(() => {
            return readChild();
        });
    }

    /**
     * Searches the tree
     * @param {string} op operator to use for key comparison, can be single value operators "<", "<=", "==", "!=", ">", ">=", "matches", "!matches", double value operators "between", "!between", and multiple value operators "in", "!in"
     * @param {string|number|boolean|Date|Array} param single value or array for double/multiple value operators
     * @param {object} [include]
     * @param {boolean} [include.keys=false]
     * @param {boolean} [include.entries=true]
     * @param {boolean} [include.values=false]
     * @param {boolean} [include.count=false]
     * @param {BinaryBPlusTreeLeafEntry[]} [include.filter=undefined] recordPointers to filter upon
     * @returns {Promise<{ entries?: BinaryBPlusTreeLeafEntry[], keys?: Array, count?: number }}
     * // {Promise<BinaryBPlusTreeLeafEntry[]>}
     */
    search(op, param, include = { entries: true, values: false, keys: false, count: false, filter: undefined }) {
        if (["in","!in","between","!between"].indexOf(op) >= 0) {
            // param must be an array
            console.assert(param instanceof Array, `param must be an array when using operator ${op}`);
        }
        if (op === "exists" || op === "!exists") {
            op = op === "exists" ? "!=" : "==";
            param = undefined;
        }
        if (param === null) { param = undefined; }

        const getLeafOptions = { stats: !(include.entries || include.values) };
        const results = {
            /** @type {BinaryBPlusTreeLeafEntry[]} */
            entries: [],
            keys: [],
            keyCount: 0,
            valueCount: 0
        };

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

        /**
         * @param {BinaryBPlusTreeLeafEntry} entry 
         */
        const add = (entry) => {
            totalMatches += entry.totalValues;
            if (filterRecordPointers) {
                // Apply filter first, only use what remains

                // String comparison method seem to have slightly better performance than binary

                // Using string comparison:
                const recordPointers = entry.values.map(val => String.fromCharCode(...val.recordPointer));
                const values = [];
                for (let i = 0; i < recordPointers.length; i++) {
                    let a = recordPointers[i];
                    if (~filterRecordPointers.indexOf(a)) {
                        values.push(entry.values[i]);
                    }
                }

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
                
                if (values.length === 0) { return; }
                entry.values = values;
                entry.totalValues = values.length;
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
        //     console.log(`tree.search [${op} ${param}] took ${t2-t1}ms, matched ${totalMatches} values, returning ${totalAdded} values in ${results.entries.length} entries`);
        //     return results;
        // };

        if (["<","<="].indexOf(op) >= 0) {
            const processLeaf = (leaf) => {
                let stop = false;
                for (let i = 0; i < leaf.entries.length; i++) {
                    const entry = leaf.entries[i];
                    if (op === "<=" && _isLessOrEqual(entry.key, param)) { add(entry); }
                    else if (op === "<" && _isLess(entry.key, param)) { add(entry); }
                    else { stop = true; break; }
                }
                if (!stop && leaf.getNext) {
                    return leaf.getNext()
                    .then(processLeaf)
                }
                else {
                    return results; //ret(results);
                }
            }
            return this.getFirstLeaf(getLeafOptions)
            .then(processLeaf);
        }
        else if ([">",">="].indexOf(op) >= 0) {
            const processLeaf = (leaf) => {
                for (let i = 0; i < leaf.entries.length; i++) {
                    const entry = leaf.entries[i];
                    if (op === ">=" && _isMoreOrEqual(entry.key, param)) { add(entry); }
                    else if (op === ">" && _isMore(entry.key, param)) { add(entry); }
                }
                if (leaf.getNext) {
                    return leaf.getNext()
                    .then(processLeaf);
                }
                else {
                    return results; //ret(results);
                }
            }
            return this.findLeaf(param, getLeafOptions)
            .then(processLeaf);
        }
        else if (op === "==") {
            return this.findLeaf(param, getLeafOptions)
            .then(leaf => {
                let entry = leaf.entries.find(entry => _isEqual(entry.key, param)); //entry.key === param
                if (entry) {
                    add(entry);
                }
                return results; //ret(results);
            });
        }
        else if (op === "!=") {
            // Full index scan needed
            const processLeaf = leaf => {
                for (let i = 0; i < leaf.entries.length; i++) {
                    const entry = leaf.entries[i];
                    if (_isNotEqual(entry.key, param)) { add(entry); } //entry.key !== param
                }
                if (leaf.getNext) {
                    return leaf.getNext()
                    .then(processLeaf);
                }
                else {
                    return results; //ret(results);
                }
            };
            return this.getFirstLeaf(getLeafOptions)
            .then(processLeaf);
        }
        else if (op === "like") {
            const wildcardIndex = ~(~param.indexOf('*') || ~param.indexOf('?'));
            const startSearch = wildcardIndex > 0 ? param.slice(0, wildcardIndex) : '';
            const pattern = '^' + param.replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
            const re = new RegExp(pattern, 'i');
            const processLeaf = leaf => {
                for (let i = 0; i < leaf.entries.length; i++) {
                    const entry = leaf.entries[i];
                    if (re.test(entry.key)) { 
                        add(entry); 
                    }
                }
                let stop = false;
                if (wildcardIndex > 0) {
                    // Check if we can stop. If the last entry does not start with the first part of the string.
                    // Eg: like 'Al*', we can stop if the last entry starts with 'Am'
                    const lastEntry = leaf.entries[leaf.entries.length-1];
                    stop = lastEntry.key.slice(0, wildcardIndex) > startSearch;
                }
                if (!stop && leaf.getNext) {
                    return leaf.getNext()
                    .then(processLeaf);
                }
                else {
                    return results; //ret(results);
                }
            };
            if (wildcardIndex === 0) {
                return this.getFirstLeaf(getLeafOptions)
                .then(processLeaf);
            }
            else {
                return this.findLeaf(startSearch, getLeafOptions)
                .then(processLeaf);
            }
        }
        else if (op === "!like") {
            // Full index scan needed
            const pattern = '^' + param.replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
            const re = new RegExp(pattern, 'i');
            const processLeaf = leaf => {
                for (let i = 0; i < leaf.entries.length; i++) {
                    const entry = leaf.entries[i];
                    if (!re.test(entry.key)) { add(entry); }
                }
                if (leaf.getNext) {
                    return leaf.getNext()
                    .then(processLeaf);
                }
                else {
                    return results; //ret(results);
                }
            };
            return this.getFirstLeaf(getLeafOptions)
            .then(processLeaf);
        }        
        else if (op === "in") {
            let sorted = param.slice().sort();
            let searchKey = sorted.shift();
            const processLeaf = (leaf) => {
                while (true) {
                    let entry = leaf.entries.find(entry => _isEqual(entry.key, searchKey)); //entry.key === searchKey
                    if (entry) { add(entry); }
                    searchKey = sorted.shift();
                    if (!searchKey) {
                        return results; //ret(results);
                    }
                    else if (searchKey > leaf.entries[leaf.entries.length-1].key) {
                        return this.findLeaf(searchKey).then(processLeaf);
                    }
                    // Stay in the loop trying more keys on the same leaf
                }
            };
            return this.findLeaf(searchKey, getLeafOptions)
            .then(processLeaf);
        }
        else if (op === "!in") {
            // Full index scan needed
            let keys = param;
            const processLeaf = (leaf) => {
                for (let i = 0; i < leaf.entries.length; i++) {
                    const entry = leaf.entries[i];
                    if (keys.findIndex(key => _isEqual(key, entry.key)) < 0) { add(entry); } //if (keys.indexOf(entry.key) < 0)
                }
                if (leaf.getNext) {
                    return leaf.getNext()
                    .then(processLeaf);
                }
                else {
                    return results; //ret(results);
                }
            };
            return this.getFirstLeaf(getLeafOptions)
            .then(processLeaf);
        }        
        else if (op === "between") {
            let bottom = param[0], top = param[1];
            if (top < bottom) {
                let swap = top;
                top = bottom;
                bottom = swap;
            }
            return this.findLeaf(bottom)
            .then(leaf => {
                let stop = false;
                const processLeaf = leaf => {
                    for (let i = 0; i < leaf.entries.length; i++) {
                        const entry = leaf.entries[i];
                        if (_isMoreOrEqual(entry.key, bottom) && _isLessOrEqual(entry.key, top)) { add(entry); }
                        if (_isMore(entry.key, top)) { stop = true; break; }
                    }
                    if (stop || !leaf.getNext) {
                        return results; //ret(results);
                    }
                    else {
                        return leaf.getNext().then(processLeaf);
                    }
                };
                return processLeaf(leaf, getLeafOptions);
            });
        }
        else if (op === "!between") {
            // Equal to key < bottom || key > top
            let bottom = param[0], top = param[1];
            if (top < bottom) {
                let swap = top;
                top = bottom;
                bottom = swap;
            }
            // Add lower range first, lowest value < val < bottom
            return this.getFirstLeaf(getLeafOptions)
            .then(leaf => {
                let stop = false;
                const processLeaf = leaf => {
                    for (let i = 0; i < leaf.entries.length; i++) {
                        const entry = leaf.entries[i];
                        if (_isLess(entry.key, bottom)) { add(entry); }
                        else { stop = true; break; }
                    }
                    if (!stop && leaf.getNext) {
                        return leaf.getNext().then(processLeaf);
                    }
                };
                return processLeaf(leaf);
            })
            .then(() => {
                // Now add upper range, top < val < highest value
                return this.findLeaf(top, getLeafOptions);
            })
            .then(leaf => {
                const processLeaf = leaf => {
                    for (let i = 0; i < leaf.entries.length; i++) {
                        const entry = leaf.entries[i];
                        if (_isMore(entry.key, top)) { add(entry); }
                    }
                    if (!leaf.getNext) {
                        return results; //ret(results);
                    }
                    else {
                        return leaf.getNext().then(processLeaf);
                    }                
                };
                return processLeaf(leaf);
            });
        }
        else if (op === "matches" || op === "!matches") {
            // Full index scan needed
            let re = param;
            const processLeaf = (leaf) => {
                for (let i = 0; i < leaf.entries.length; i++) {
                    const entry = leaf.entries[i];
                    const isMatch = re.test(entry.key);
                    if ((isMatch && op === "matches") || (!isMatch && op === "!matches")) {
                        add(entry); 
                    }
                }
                if (leaf.getNext) {
                    return leaf.getNext()
                    .then(processLeaf);
                }
                else {
                    return results; //ret(results);
                }
            };
            return this.getFirstLeaf(getLeafOptions)
            .then(processLeaf);
        }
    }

    /**
     * 
     * @param {any} searchKey 
     * @param {object} [options]
     * @param {boolean} [options.stats] 
     * @returns {Promise<BinaryBPlusTreeLeafEntryValue>|Promise<BinaryBPlusTreeLeafEntryValue[]>|Promise<number>} returns a promise that resolves with 1 value (unique keys), a values array or the number of values (options.stats === true)
     */
    find(searchKey, options) {
        return this.findLeaf(searchKey, options)
        .then(leaf => {
            const entry = leaf.entries.find(entry => _isEqual(searchKey, entry.key));
            if (options && options.stats) {
                return entry ? entry.totalValues : 0;
            }
            else if (entry) {
                if (this.info.isUnique) {
                    return entry.values[0];
                }
                else {
                    return entry.values;
                }
            }
            else {
                return null;
            }
        });
    }

    /**
     * @param {string|number|boolean|Date|undefined} key 
     * @param {number[]|Uint8Array} recordPointer 
     * @param {object} [metadata] 
     */
    add(key, recordPointer, metadata) {
        const err = _checkNewEntryArgs(key, recordPointer, this.metadataKeys, metadata);
        if (err) {
            throw err;
        }
        const entryValue = new BinaryBPlusTreeLeafEntryValue(recordPointer, metadata);
        return this.findLeaf(key)
        .then(leaf => {
            // This is the leaf the key should be added to
            const entryIndex = leaf.entries.findIndex(entry => _isEqual(key, entry.key));
            let addNew = false;
            if (this.info.isUnique) {
                // Make sure key doesn't exist yet
                if (~entryIndex) {
                    throw new Error(`Cannot add duplicate key "${key}": tree expects unique keys`);
                }

                addNew = true;
            }
            else {
                if (~entryIndex) {
                    leaf.entries[entryIndex].values.push(entryValue);
                }
                else {
                    addNew = true;
                }
            }

            if (addNew) {
                if (leaf.entries.length + 1 > this.info.entriesPerNode) {
                    throw new Error(`Cannot add key "${key}": leaf is full`);
                }

                // Create entry
                // const entry = { 
                //     key, 
                //     value, 
                //     values: [value] 
                // };
                const entry = new BinaryBPlusTreeLeafEntry(key, [entryValue]);

                // Insert it
                const insertBeforeIndex = leaf.entries.findIndex(entry => _isMore(entry.key, key));
                if (insertBeforeIndex < 0) { 
                    leaf.entries.push(entry);
                }
                else {
                    leaf.entries.splice(insertBeforeIndex, 0, entry);    
                }            
            }
            return this._writeLeaf(leaf);
        })
        .catch(err => {
            throw err;
        });
    }

    /**
     * @param {string|number|boolean|Date|undefined} key 
     * @param {number[]|Uint8Array} recordPointer 
     */
    remove(key, recordPointer = undefined) {
        return this.findLeaf(key)
        .then(leaf => {
            // This is the leaf the key should be in
            const entryIndex = leaf.entries.findIndex(entry => _isEqual(key, entry.key));
            if (!~entryIndex) { return; }
            if (this.info.isUnique || typeof recordPointer === "undefined" || leaf.entries[entryIndex].values.length === 1) {
                leaf.entries.splice(entryIndex, 1);
            }
            else {
                let valueIndex = leaf.entries[entryIndex].values.findIndex(val => _compareBinary(val.recordPointer, recordPointer));
                if (!~valueIndex) { return; }
                leaf.entries[entryIndex].values.splice(valueIndex, 1);
            }
            return this._writeLeaf(leaf);
        })
        .catch(err => {
            throw err;
        });
    }

    /**
     * @param {string|number|boolean|Date|undefined} key 
     * @param {number[]|Uint8Array} newRecordPointer 
     * @param {number[]|Uint8Array} [currentRecordPointer] 
     * @param {object} [newMetadata]
     */
    update(key, newRecordPointer, currentRecordPointer = undefined, newMetadata) {
        if (currentRecordPointer === null) { currentRecordPointer = undefined; }
        const newEntryValue = new BPlusTreeLeafEntryValue(newRecordPointer, newMetadata);
        return this.findLeaf(key)
        .then(leaf => {
            // This is the leaf the key should be in
            const entryIndex = leaf.entries.findIndex(entry => _isEqual(entry.key, key));
            if (!~entryIndex) { 
                throw new Error(`Key to update ("${key}") not found`); 
            }
            const entry = leaf.entries[entryIndex];
            if (this.info.isUnique) {
                entry.values = [newEntryValue];
            }
            else if (typeof currentRecordPointer === "undefined") {
                throw new Error(`To update a non-unique key, the current value must be passed as parameter`);
            }
            else {
                let valueIndex = entry.values.findIndex(val => _compareBinary(val.recordPointer, currentRecordPointer));
                if (!~valueIndex) { 
                    throw new Error(`Key/value combination to update not found (key: "${key}") `); 
                }
                entry.values[valueIndex] = newEntryValue;
            }
            return this._writeLeaf(leaf);
        })
        .catch(err => {
            throw err;
        });
    }

    /**
     * 
     * @param {BinaryBPlusTreeTransactionOperation[]} operations 
     */
    transaction(operations) {
        return new Promise((resolve, reject) => {
            const success = () => {
                if (operations.length === 0) {
                    resolve();
                }
                else {
                    processNextOperation();
                }
            };
            const processNextOperation = () => {
                const op = operations.shift();
                let p;
                switch(op.type) {
                    case 'add': {
                        p = this.add(op.key, op.recordPointer, op.metadata);
                        break;
                    }
                    case 'remove': {
                        p = this.remove(op.key, op.recordPointer);
                        break;
                    }
                    case 'update': {
                        p = this.update(op.key, op.newValue, op.currentValue);
                        break;
                    }
                }
                p.then(success)
                .catch(reason => {
                    operations.unshift(op);
                    reject(reason);
                });
            };
            processNextOperation();
        });
    }

    /**
     * 
     * @param {number} fillFactor 
     * @returns {Promise<BPlusTree>}
     */
    toTree(fillFactor = 100) {
        return this.toTreeBuilder(fillFactor)
        .then(builder => {
            return builder.create();
        });
    }

    /**
     * @returns {Promise<BPlusTreeBuilder>} Promise that resolves with a BPlusTreeBuilder
     */
    toTreeBuilder(fillFactor) {
        const treeBuilder = new BPlusTreeBuilder(this.info.isUnique, fillFactor, this.info.metadataKeys);
        return this.getFirstLeaf()
        .then(leaf => {

            /**
             * 
             * @param {BinaryBPlusTreeLeaf} leaf 
             */
            const processLeaf = leaf => {
                leaf.entries.forEach(entry => {
                    // if (this.isUnique) {
                    //     const entryValue = entry.value;
                    //     treeBuilder.add(entry.key, entryValue.value, entryValue.metadata);
                    // }
                    // else {
                    entry.values.forEach(entryValue => treeBuilder.add(entry.key, entryValue.value, entryValue.metadata));
                    // }
                });
                if (leaf.getNext) {
                    return leaf.getNext().then(processLeaf);
                }
            };

            return processLeaf(leaf);
        })
        .then(() => {
            return treeBuilder;
        });
    }
}

class BinaryBPlusTreeNodeInfo {
    /**
     * 
     * @param {{ isLeaf: boolean, bytes: number[], index: number, length: number, free: number }} info 
     */
    constructor(info) {
        this.isLeaf = info.isLeaf;
        this.bytes = info.bytes;
        this.index = info.index;
        this.length = info.length;
        this.free = info.free;
    }
}

class BinaryBPlusTreeNode extends BinaryBPlusTreeNodeInfo {
    /**
     * 
     * @param {BinaryBPlusTreeNodeInfo} nodeInfo 
     */
    constructor(nodeInfo) {
        super(nodeInfo);

        /** @type {BinaryBPlusTreeNodeEntry[]} */
        this.entries = [];

        /** @type {() => Promise<BinaryBPlusTreeNodeInfo} */
        this.getGtChild = () => {
            return Promise.reject(new Error(`getGtChild must be overridden`));
        };
    }
}

class BinaryBPlusTreeNodeEntry {
    /**
     * 
     * @param {string|number|boolean|Date} key 
     */
    constructor(key) {
        this.key = key;

        /** @type {() => Promise<BinaryBPlusTreeNodeInfo} */
        this.getLtChild = () => {
            return Promise.reject(new Error(`getLtChild must be overridden`));
        }
    }
}

class BinaryBPlusTreeLeaf extends BinaryBPlusTreeNodeInfo {
    /**
     * @param {BinaryBPlusTreeNodeInfo} nodeInfo 
     */
    constructor(nodeInfo) {
        super(nodeInfo);
        
        this.prevLeafOffset = 0;
        this.nextLeafOffset = 0;        
        /** @type {BinaryBPlusTreeLeafEntry[]} */
        this.entries = [];

        /** @type {() => Promise<BinaryBPlusTreeLeaf>?} only present if there is a previous leaf */
        this.getPrevious = undefined;
        /** @type {function?} only present if there is a next leaf */
        this.getNext = undefined;
    }

    findEntryIndex(key) {
        return this.entries.findIndex(entry => _isEqual(entry.key, key));
    }

    findEntry(key) {
        return this.entries[this.findEntryIndex(key)];
    }
}

class BinaryBPlusTreeLeafEntryValue {
    /**
     * 
     * @param {number[]|Uint8Array} recordPointer used to be called "value", renamed to prevent confusion
     * @param {object} [metadata] 
     */
    constructor(recordPointer, metadata) {
        this.recordPointer = recordPointer;
        this.metadata = metadata;
    }

    /** @deprecated use .recordPointer instead */
    get value() {
        return this.recordPointer;
    }
}

class BinaryBPlusTreeLeafEntry {
    /**
     * 
     * @param {string|number|boolean|Date} key 
     * @param {Array<BinaryBPlusTreeLeafEntryValue>} values Array of binary values - NOTE if the tree has unique values, it must always wrap the single value in an Array: [value]
     */
    constructor(key, values) {
        this.key = key;
        this.values = values;
    }

    /**
     * @deprecated use .values[0] instead
     */
    get value() {
        return this.values[0];
    }

    get totalValues() {
        if (typeof this._totalValues === 'number') { return this._totalValues; }
        return this.values.length;
    }

    set totalValues(nr) {
        this._totalValues = nr;
    }
}

class BinaryBPlusTreeTransactionOperation {
    constructor(operation) {
        /** @type {string} */
        this.type = operation.type;
        /** @type {string|number|boolean|Date|undefined} */
        this.key = operation.key;
        if (operation.type === 'add' || operation.type === 'remove') {
            /** @type {number[]|Uint8Array} */
            this.recordPointer = operation.recordPointer;
        }
        if (operation.type === 'add') {
            this.metadata = operation.metadata;
        }
        if (operation.type === 'update') {
            /** @type {BinaryBPlusTreeLeafEntryValue} */
            this.newValue = operation.newValue;
            /** @type {BinaryBPlusTreeLeafEntryValue} */
            this.currentValue = operation.currentValue;
        }
    }
    /**
     * @param {string|number|boolean|Date|undefined} key 
     * @param {number[]|Uint8Array} recordPointer 
     * @param {object} metadata
     */
    static add(key, recordPointer, metadata) {
        return new BinaryBPlusTreeTransactionOperation({ type: 'add', key, recordPointer, metadata });
    }
    /**
     * @param {string|number|boolean|Date|undefined} key 
     * @param {BinaryBPlusTreeLeafEntryValue} newValue 
     * @param {BinaryBPlusTreeLeafEntryValue} currentValue 
     * @param {object} metadata
     */
    static update(key, newValue, currentValue, metadata) {
        return new BinaryBPlusTreeTransactionOperation({ type: 'update', key, newValue, currentValue, metadata });
    }
    /**
     * @param {string|number|boolean|Date|undefined} key 
     * @param {number[]|Uint8Array} recordPointer
     */
    static remove(key, recordPointer) {
        return new BinaryBPlusTreeTransactionOperation({ type: 'remove', key, recordPointer });
    }
}

BinaryBPlusTree.EntryValue = BinaryBPlusTreeLeafEntryValue;
BinaryBPlusTree.TransactionOperation = BinaryBPlusTreeTransactionOperation;

const fs = require('fs');
class BinaryWriter {
    /**
     * 
     * @param {fs.WriteStream} stream 
     * @param {((data: number[]|Uint8Array, position: number) => Promise<void>)} writeFn
     */
    constructor(stream, writeCallback) {
        this._stream = stream;
        this._write = writeCallback;
        this._written = 0;
    }

    static forArray(bytes) {
        let stream = {
            write(data) {
                for (let i = 0; i < data.byteLength; i++) {
                    bytes.push(data[i]);
                }
                return true; // let caller know its ok to continue writing
            },
            end(callback) {
                callback();
            }
        };
        const writer = new BinaryWriter(stream, (data, position) => {
            for(let i = 0; i < data.byteLength; i++) {
                bytes[position + i] = data[i];
            }
            return Promise.resolve();
        });  
        return writer;      
    }

    get length() { return this._written; }
    get queued() { return this._written - this._stream.bytesWritten; }

    /**
     * 
     * @param {number[]|Uint8Array|Buffer} data 
     */
    append(data) {
        if (data instanceof Array) {
            data = Uint8Array.from(data);
        }
        return new Promise(resolve => {
            const ok = this._stream.write(data);
            this._written += data.byteLength;
            if (!ok) {
                this._stream.once('drain', resolve);
            }
            else {
                process.nextTick(resolve);
            }
        });
    }

    write(data, position) {
        if (data instanceof Array) {
            data = Uint8Array.from(data);
        }
        return this._write(data, position);
    }

    end() {
        return new Promise(resolve => {
            this._stream.end(resolve);
            // writer.stream.on('finish', resolve);
        });
    }
}

module.exports = { 
    BPlusTree,
    BinaryBPlusTree,
    BinaryBPlusTreeLeafEntry,
    BPlusTreeBuilder,
    BinaryWriter
};