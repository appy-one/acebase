import { Utils } from 'acebase-core';
import { assert } from '../assert.js';
import { writeByteLength } from '../binary.js';
import { DetailedError } from '../detailed-error.js';
import { FLAGS, KEY_TYPE } from './binary-tree-builder.js';
import { BinaryWriter } from './binary-writer.js';
import { WRITE_SMALL_LEAFS } from './config.js';
import { BPlusTreeLeaf } from './tree-leaf.js';
import { _isEqual, _isLess, _isLessOrEqual, _isMore, _isMoreOrEqual, _isNotEqual } from './typesafe-compare.js';
const { bigintToBytes, bytesToBigint, bytesToNumber, decodeString, encodeString, numberToBytes } = Utils;
export class BPlusTree {
    /**
     * @param maxEntriesPerNode max number of entries per tree node. Working with this instead of m for max number of children, because that makes less sense imho
     * @param uniqueKeys whether the keys added must be unique
     * @param metadataKeys (optional) names of metadata keys that will be included in tree
     */
    constructor(maxEntriesPerNode, uniqueKeys, metadataKeys = []) {
        this.maxEntriesPerNode = maxEntriesPerNode;
        this.uniqueKeys = uniqueKeys;
        this.metadataKeys = metadataKeys;
        this.root = new BPlusTreeLeaf(this);
        this.depth = 1;
        this.fillFactor = 100;
    }
    /**
     * Adds a key/value pair to the tree
     * @param key
     * @param value data to store with the key, max size is 255
     * @param metadata data to include, must contain all keys used in BPlusTree constructor
     * @returns {BPlusTree} returns reference to this tree
     */
    add(key, value, metadata) {
        // key = _normalizeKey(key); // if (_isIntString(key)) { key = parseInt(key); }
        // Find the leaf to insert to
        let leaf;
        if (this.root instanceof BPlusTreeLeaf) {
            // Root is leaf node (total entries <= maxEntriesPerNode)
            leaf = this.root;
        }
        else {
            // Navigate to the right leaf to add to
            leaf = this.findLeaf(key);
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
     * @param key
     * @returns returns the leaf the key is in, or would be in when present
     */
    findLeaf(key) {
        const findLeaf = (node) => {
            if (node instanceof BPlusTreeLeaf) {
                return node;
            }
            for (let i = 0; i < node.entries.length; i++) {
                const entry = node.entries[i];
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
            assert(_isMoreOrEqual(key, node.entries[node.entries.length - 1].key));
            return findLeaf(node.gtChild);
        };
        return findLeaf(this.root);
    }
    find(key) {
        const leaf = this.findLeaf(key);
        const entry = leaf.entries.find(entry => _isEqual(entry.key, key));
        if (!entry) {
            return null;
        }
        if (this.uniqueKeys) {
            return entry.values[0];
        }
        else {
            return entry.values;
        }
    }
    search(op, val) {
        if (['in', '!in', 'between', '!between'].includes(op) && !(val instanceof Array)) {
            // val must be an array
            throw new TypeError(`val must be an array when using operator ${op}`);
        }
        else if (val instanceof Array) {
            throw new TypeError(`val cannot be an array when using operator ${op}`);
        }
        if (['exists', '!exists'].includes(op)) {
            // These operators are a bit strange: they return results for key [undefined] (op === "!exists"), or all other keys (op === "exists")
            // search("exists", ..) executes ("!=", undefined)
            // search("!exists", ..) executes ("==", undefined)
            op = op === 'exists' ? '!=' : '==';
            val = undefined;
        }
        if (val === null) {
            val = undefined;
        }
        const results = [];
        const add = (entry) => {
            const obj = { key: entry.key };
            if (this.uniqueKeys) { // if (this.uniqueValues) {
                // Bug discovered during TS port
                obj.value = entry.values[0];
            }
            else {
                obj.values = entry.values;
            }
            results.push(obj);
        };
        if (['<', '<='].includes(op)) {
            let leaf = this.findLeaf(val);
            while (leaf) {
                for (let i = leaf.entries.length - 1; i >= 0; i--) {
                    const entry = leaf.entries[i];
                    if (op === '<=' && _isLessOrEqual(entry.key, val)) {
                        add(entry);
                    }
                    else if (op === '<' && _isLess(entry.key, val)) {
                        add(entry);
                    }
                }
                leaf = leaf.prevLeaf;
            }
        }
        else if (['>', '>='].includes(op)) {
            let leaf = this.findLeaf(val);
            while (leaf) {
                for (let i = 0; i < leaf.entries.length; i++) {
                    const entry = leaf.entries[i];
                    if (op === '>=' && _isMoreOrEqual(entry.key, val)) {
                        add(entry);
                    }
                    else if (op === '>' && _isMore(entry.key, val)) {
                        add(entry);
                    }
                }
                leaf = leaf.nextLeaf;
            }
        }
        else if (op === '==') {
            const leaf = this.findLeaf(val);
            const entry = leaf.entries.find(entry => _isEqual(entry.key, val)); //  entry.key === val
            if (entry) {
                add(entry);
            }
        }
        else if (op === '!=') {
            // Full index scan needed
            let leaf = this.firstLeaf();
            while (leaf) {
                for (let i = 0; i < leaf.entries.length; i++) {
                    const entry = leaf.entries[i];
                    if (_isNotEqual(entry.key, val)) {
                        add(entry);
                    } // entry.key !== val
                }
                leaf = leaf.nextLeaf;
            }
        }
        else if (op === 'in') {
            const sorted = val.slice().sort();
            let searchKey = sorted.shift();
            let leaf; // = this.findLeaf(searchKey);
            let trySameLeaf = false;
            while (searchKey) {
                if (!trySameLeaf) {
                    leaf = this.findLeaf(searchKey);
                }
                const entry = leaf.entries.find(entry => _isEqual(entry.key, val)); // entry.key === searchKey
                if (!entry && trySameLeaf) {
                    trySameLeaf = false;
                    continue;
                }
                if (entry) {
                    add(entry);
                }
                searchKey = sorted.shift();
                trySameLeaf = true;
            }
        }
        else if (op === '!in') {
            // Full index scan needed
            const keys = val;
            let leaf = this.firstLeaf();
            while (leaf) {
                for (let i = 0; i < leaf.entries.length; i++) {
                    const entry = leaf.entries[i];
                    if (keys.findIndex(val => _isEqual(entry.key, val)) < 0) {
                        add(entry);
                    } //if (keys.indexOf(entry.key) < 0) { add(entry); }
                }
                leaf = leaf.nextLeaf;
            }
        }
        else if (op === 'between') {
            const keys = val;
            let bottom = keys[0], top = keys[1];
            if (top < bottom) {
                const swap = top;
                top = bottom;
                bottom = swap;
            }
            let leaf = this.findLeaf(bottom);
            let stop = false;
            while (!stop && leaf) {
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
                leaf = leaf.nextLeaf;
            }
        }
        else if (op === '!between') {
            // Equal to key < bottom || key > top
            const keys = val;
            let bottom = keys[0], top = keys[1];
            if (top < bottom) {
                const swap = top;
                top = bottom;
                bottom = swap;
            }
            // Add lower range first, lowest value < val < bottom
            let leaf = this.firstLeaf();
            let stop = false;
            while (leaf && !stop) {
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
                leaf = leaf.nextLeaf;
            }
            // Now add upper range, top < val < highest value
            leaf = this.findLeaf(top);
            while (leaf) {
                for (let i = 0; i < leaf.entries.length; i++) {
                    const entry = leaf.entries[i];
                    if (_isMore(entry.key, top)) {
                        add(entry);
                    }
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
        return node;
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
        const keyType = bytes[index];
        index++;
        // key_length:
        const keyLength = bytes[index];
        index++;
        // key_data:
        let keyData = bytes.slice(index, index + keyLength); // [];
        index += keyLength;
        if ([KEY_TYPE.NUMBER, KEY_TYPE.BIGINT, KEY_TYPE.DATE].includes(keyType)) {
            keyData = Array.from(keyData);
        }
        let key;
        switch (keyType) {
            case KEY_TYPE.UNDEFINED: {
                // no need to do this: key = undefined;
                break;
            }
            case KEY_TYPE.STRING: {
                key = decodeString(keyData); // textDecoder.decode(Uint8Array.from(keyData));
                // key = keyData.reduce((k, code) => k + String.fromCharCode(code), "");
                break;
            }
            case KEY_TYPE.NUMBER: {
                if (keyData.length < 8) {
                    // Append trailing 0's
                    if (keyData instanceof Array) {
                        keyData.push(...[0, 0, 0, 0, 0, 0, 0, 0].slice(keyData.length));
                    }
                    else {
                        throw new Error(`Issue found during TS port: keyData is a Buffer, type is NUMBER and its length < 8, so it needs 0's padding`);
                    }
                }
                key = bytesToNumber(keyData);
                break;
            }
            case KEY_TYPE.BIGINT: {
                key = bytesToBigint(keyData);
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
            default: {
                throw new DetailedError('unknown-key-type', `Unknown key type ${keyType}`);
            }
        }
        return { key, length: keyLength, byteLength: keyLength + 2 };
    }
    static getBinaryKeyData(key) {
        // TODO: Deprecate, moved to BinaryBPlusTreeBuilder.getKeyBytes
        let keyBytes = [];
        let keyType = KEY_TYPE.UNDEFINED;
        switch (typeof key) {
            case 'undefined': {
                keyType = KEY_TYPE.UNDEFINED;
                break;
            }
            case 'string': {
                keyType = KEY_TYPE.STRING;
                keyBytes = Array.from(encodeString(key)); // textEncoder.encode(key)
                break;
            }
            case 'number': {
                keyType = KEY_TYPE.NUMBER;
                keyBytes = numberToBytes(key);
                // Remove trailing 0's to reduce size for smaller and integer values
                while (keyBytes[keyBytes.length - 1] === 0) {
                    keyBytes.pop();
                }
                break;
            }
            case 'bigint': {
                keyType = KEY_TYPE.BIGINT;
                keyBytes = bigintToBytes(key);
                break;
            }
            case 'boolean': {
                keyType = KEY_TYPE.BOOLEAN;
                keyBytes = [key ? 1 : 0];
                break;
            }
            case 'object': {
                if (key instanceof Date) {
                    keyType = KEY_TYPE.DATE;
                    keyBytes = numberToBytes(key.getTime());
                }
                else {
                    throw new DetailedError('invalid-object-key-type', 'Unsupported object key type');
                }
                break;
            }
            default: {
                throw new DetailedError('invalid-key-type', `Unsupported key type: ${typeof key}`);
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
    async toBinary(keepFreeSpace = false, writer) {
        // TODO: Refactor to use BinaryBPlusTreeBuilder, .getHeader()
        if (!(writer instanceof BinaryWriter)) {
            throw new Error('writer argument must be an instance of BinaryWriter');
        }
        // Return binary data
        const indexTypeFlags = (this.uniqueKeys ? FLAGS.UNIQUE_KEYS : 0)
            | (this.metadataKeys.length > 0 ? FLAGS.HAS_METADATA : 0)
            | (keepFreeSpace ? FLAGS.HAS_FREE_SPACE : 0)
            | FLAGS.HAS_FILL_FACTOR
            | (WRITE_SMALL_LEAFS ? FLAGS.HAS_SMALL_LEAFS : 0)
            | FLAGS.HAS_LARGE_PTRS;
        const bytes = [
            // byte_length:
            0, 0, 0, 0,
            // index_type:
            indexTypeFlags,
            // max_node_entries:
            this.maxEntriesPerNode,
            // fill_factor:
            this.fillFactor,
        ];
        if (keepFreeSpace) {
            bytes.push(0, 0, 0, 0); // free_byte_length
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
            writeByteLength(bytes, index, length);
        }
        const headerLength = bytes.length;
        await writer.append(bytes);
        const { references } = await this.root.toBinary(keepFreeSpace, writer);
        assert(references.length === 0, 'All references must be resolved now');
        let freeBytesLength = 0;
        if (keepFreeSpace) {
            // Add 10% free space
            freeBytesLength = Math.ceil((writer.length - headerLength) * 0.1);
            const bytesPerWrite = 1024 * 100; // 100KB per write seems fair?
            const writes = Math.ceil(freeBytesLength / bytesPerWrite);
            for (let i = 0; i < writes; i++) {
                const length = i + 1 < writes
                    ? bytesPerWrite
                    : freeBytesLength % bytesPerWrite;
                const zeroes = new Uint8Array(length);
                await writer.append(zeroes);
            }
        }
        // update byte_length:
        const byteLength = writer.length; // - headerLength;
        const lbytes = writeByteLength([], 0, byteLength);
        await writer.write(lbytes, 0);
        if (keepFreeSpace) {
            // update free_byte_length:
            const fbytes = writeByteLength([], 0, freeBytesLength);
            await writer.write(fbytes, 7);
        }
        await writer.end();
    }
    static get typeSafeComparison() {
        return {
            isMore(val1, val2) { return _isMore(val1, val2); },
            isMoreOrEqual(val1, val2) { return _isMoreOrEqual(val1, val2); },
            isLess(val1, val2) { return _isLess(val1, val2); },
            isLessOrEqual(val1, val2) { return _isLessOrEqual(val1, val2); },
            isEqual(val1, val2) { return _isEqual(val1, val2); },
            isNotEqual(val1, val2) { return _isNotEqual(val1, val2); },
        };
    }
}
//# sourceMappingURL=tree.js.map