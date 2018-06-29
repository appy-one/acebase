const { numberToBytes, bytesToNumber } = require('./utils');

class BTreeEntry {
    constructor(key, value) {
        /**
         * @type {BTreeNode}
         */
        this.ltChild = null;
        this.key = key;
        this.values = [value];   // Unique indexes will only have this 1 entry
    }
}

const KEY_TYPE = {
    UNDEFINED: 0,
    STRING: 1,
    NUMBER: 2,
    BOOLEAN: 3,
    DATE: 4
};

class BTreeNode {

    /**
     * 
     * @param {BTree} tree 
     * @param {BTreeNode} parent 
     * @param {string|number|boolean|Date|undefined} key 
     * @param {byte[]|string} value 
     */
    constructor(tree, parent, key, value) {
        this.tree = tree;
        this.parent = parent; 

        /**
         * @type {BTreeEntry}
         */
        this.gtChild = null;

        /**
         * @type {BTreeEntry[]}
         */
        this.entries = [];
        if (key instanceof BTreeEntry) {
            this.entries.push(key);
        }
        else if (key instanceof Array && key.length > 0 && key.every(entry => entry instanceof BTreeEntry)) {
            this.entries = key;
        }
        else if (typeof value !== "undefined") {
            this.add(key, value);
        }
        // key instanceof Array ? key : [key instanceof BTreeEntry ? key : new BTreeEntry(key, value)];
        
    }

    get size() {
        return this.entries.length; //(this.entries.length-1) / 2;
    }

    toString(level = 0) {
        let str = ""; // `${level}: `;
        this.entries.forEach(entry => {
            //if (entry.ltChild) { str += `(${entry.ltChild.toString(level+1)})`; }
            str += `${entry.key} `; 
        });
        // str += "\r\n";
        // this.entries.forEach(entry => {
        //     if (entry.ltChild) { str += `${entry.ltChild.toString(level+1)} | `; }
        //     else { str += "null | " }
        // });
        return str;
    }

    _checkSize() {
        if (this.size > this.tree.maxSize) {
            // split
            let index = Math.ceil(this.tree.maxSize / 2);
            const moveRight = this.entries.splice(index + 1);
            const moveUp = this.entries.pop(); //moveRight.shift();
            const ltChild = moveUp.ltChild;
            moveUp.ltChild = this; // Value moving up will always point to the left values of our split
            const gtChild = this.gtChild;
            this.gtChild = ltChild;

            // Propagate moveUp to parent
            if (this.parent === null) {
                // Create new parent
                const newParent = new BTreeNode(this.tree, null, moveUp);
                const newSibling = new BTreeNode(this.tree, newParent, moveRight);
                newParent.gtChild = newSibling;
                newSibling.gtChild = gtChild;
                this.parent = newParent;
            }
            else {
                const newSibling = new BTreeNode(this.tree, this.parent, moveRight);
                newSibling.gtChild = gtChild;

                // Find where to insert moveUp
                let insertIndex = this.parent.entries.findIndex(entry => entry.key > moveUp.key);
                if (insertIndex < 0) {
                    // Add to the end
                    this.parent.entries.push(moveUp);
                    this.parent.gtChild = newSibling;
                }
                else {
                    // Insert somewhere in between
                    let insertBefore = this.parent.entries[insertIndex];
                    insertBefore.ltChild = newSibling;
                    this.parent.entries.splice(insertIndex, 0, moveUp);
                }

                this.parent._checkSize(); // Let it check its size
            }
        }
    }

    /**
     * 
     * @param {string|number|boolean|Date|undefined} key 
     * @param {ArrayBuffer|[]|string} value 
     */
    add(key, value) {
        if (typeof value === "string") {
            // For now, allow this. Convert to byte array
            let bytes = [];
            for(let i = 0; i < value.length; i++) {
                bytes.push(value.charCodeAt(i));
            }
            value = bytes;
        }
        if (!(value instanceof Array || value instanceof ArrayBuffer)) {
            throw new TypeError("value must be a byte array");
        }
        const newEntry = new BTreeEntry(key, value);
        let added = false;
        for (let i = 0; i < this.entries.length; i++) {
            let entry = this.entries[i];
            //let nextEntry = this.entries[i+2];
            if (key === entry.key) {
                if (this.tree.uniqueValues) {
                    throw new Error(`Cannot insert duplicate keys into unique index`);
                }
                else {
                    // Add it to the existing array
                    entry.values.push(value);
                    added = true;
                }
            }
            else if (key < entry.key) {
                if (entry.ltChild !== null) {
                    // There is a child node with smaller values, pass it on
                    entry.ltChild.add(key, value);
                }
                else {
                    // Add before this entry
                    this.entries.splice(i, 0, newEntry);
                }
                added = true;
                break;
            }
        }
        if (!added) {
            // Value is bigger. 
            if (this.gtChild !== null) {
                // Pass on to child
                this.gtChild.add(key, value);
            }
            else {
                //Add it to the end
                added = true;
                this.entries.push(newEntry);
            }
        }
        added && this._checkSize();
    }

    find(key) {
        for(let i = 0; i < this.entries.length; i++) {
            let entry = this.entries[i];
            if (entry.key === key) { 
                if (this.tree.uniqueValues) {
                    return entry.values[0]; 
                }
                else {
                    return entry.values;
                }
            }
            else if (entry.key > key) {
                return entry.ltChild ? entry.ltChild.find(key) : undefined;
            }
        }
        return this.gtChild ? this.gtChild.find(key) : undefined;
    }

    toBinary() {
        // layout:
        // data                 := index_length, index_type, max_node_entries, root_node
        // index_length         := 4 byte number
        // index_type           := 1 byte = [0,0,0,0,0,0,0,is_unique]
        // max_node_entries     := 1 byte number
        // root_node            := node
        // node*                := node_length, entries_length, entries, gt_child_ptr, children
        // node_length          := 4 byte number (byte count)
        // entries_length       := 1 byte number
        // entries              := entry, [entry, [entry...]]
        // entry                := key, lt_child_ptr, val
        // key                  := key_type, key_length, key_data
        // key_type             := 1 byte number
        //                          0: UNDEFINED (equiv to sql null values)
        //                          1: STRING
        //                          2: NUMBER
        //                          3: BOOLEAN
        //                          4: DATE
        // key_length           := 1 byte number
        // key_data             := [key_length] bytes ASCII string
        // lt_child_ptr         := 4 byte number (byte offset)
        // val                  := val_length, val_data
        // val_length           := 4 byte number (byte count)
        // val_data             := is_unique?
        //                          0: value_list
        //                          1: value
        // value_list           := value_list_length, value, [value, [value...]]
        // value_list_length    := 4 byte number
        // value                := value_length, value_data
        // value_length         := 1 byte number
        // value_data           := [value_length] bytes data 
        // gt_child_ptr         := 4 byte number (byte offset)
        // children             := node, [node, [node...]]
        // * BTreeNode.toBinary() starts writing here

        let bytes = [];

        // node_length:
        bytes.push(0, 0, 0, 0);

        // entries_length:
        bytes.push(this.entries.length);

        let pointers = [];
        this.entries.forEach(entry => {
            //let key = typeof entry.key === "string" ? entry.key : entry.key.toString();
            let key = [];
            let keyType = KEY_TYPE.UNDEFINED;
            switch(typeof entry.key) {
                case "undefined": {
                    keyType = KEY_TYPE.UNDEFINED;
                    break;
                }                
                case "string": {
                    keyType = KEY_TYPE.STRING;
                    for (let i = 0; i < entry.key.length; i++) {
                        key.push(entry.key.charCodeAt(i));
                    }
                    break;
                }
                case "number": {
                    keyType = KEY_TYPE.NUMBER;
                    key = numberToBytes(entry.key);
                    // Remove trailing 0's to reduce size for smaller and integer values
                    while (key[key.length-1] === 0) { key.pop(); }
                    break;
                }
                case "boolean": {
                    keyType = KEY_TYPE.BOOLEAN;
                    key = [entry.key ? 1 : 0];
                    break;
                }
                case "object": {
                    if (entry.key instanceof Date) {
                        keyType = KEY_TYPE.DATE;
                        key = numberToBytes(entry.key.getTime());
                    }
                    else {
                        throw new Error(`Unsupported key type`);
                    }
                    break;
                }
                default: {
                    throw new Error(`Unsupported key type: ${typeof entry.key}`);
                }
            }

            // key_type:
            bytes.push(keyType);

            // key_length:
            bytes.push(key.length);

            // key_data:
            bytes.push(...key);

            // lt_child_ptr:
            let index = bytes.length;
            bytes.push(0, 0, 0, 0);
            pointers.push({ name: `<${entry.key}`, index, node: entry.ltChild });

            // val_length:
            const valLengthIndex = bytes.length;
            bytes.push(0, 0, 0, 0);

            // // val_type:
            // const valType = this.tree.uniqueValues ? 1 : 0;
            // bytes.push(valType);

            const writeValue = (value) => {
                // value_length:
                bytes.push(value.length);

                // value_data:
                bytes.push(...value);
                // for (let i = 0; i < value.length; i++) {
                //     bytes.push(value[i]);
                // }
            };
            if (this.tree.uniqueValues) {
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

                entry.values.forEach(value => {
                    // value:
                    writeValue(value);
                });
            }

            // update val_length
            const valLength = bytes.length - valLengthIndex - 4;
            bytes[valLengthIndex] = (valLength >> 24) & 0xff;
            bytes[valLengthIndex+1] = (valLength >> 16) & 0xff;
            bytes[valLengthIndex+2] = (valLength >> 8) & 0xff;
            bytes[valLengthIndex+3] = valLength & 0xff;
        });

        // gt_child_ptr:
        let index = bytes.length;
        bytes.push(0, 0, 0, 0);
        pointers.push({ name: `>${this.entries[this.entries.length - 1].key}`, index, node: this.gtChild });

        // update node_length:
        bytes[0] = (bytes.length >> 24) & 0xff;
        bytes[1] = (bytes.length >> 16) & 0xff;
        bytes[2] = (bytes.length >> 8) & 0xff;
        bytes[3] = bytes.length & 0xff;

        // Update all lt_child_ptr's:
        this.entries.forEach(entry => {
            index = bytes.length;
            if (entry.ltChild !== null) {
                // Update lt_child_ptr:
                let pointer = pointers.find(pointer => pointer.node === entry.ltChild);
                let offset = index - (pointer.index + 3);
                bytes[pointer.index] = (offset >> 24) & 0xff;
                bytes[pointer.index+1] = (offset >> 16) & 0xff;
                bytes[pointer.index+2] = (offset >> 8) & 0xff;
                bytes[pointer.index+3] = offset & 0xff;
                // Add child node
                let childBytes = entry.ltChild.toBinary();
                bytes.push(...childBytes);
            }
        });

        // Update gt_child_ptr:
        if (this.gtChild !== null) {
            index = bytes.length;
            let pointer = pointers.find(pointer => pointer.node === this.gtChild);
            let offset = index - (pointer.index + 3);
            bytes[pointer.index] = (offset >> 24) & 0xff;
            bytes[pointer.index+1] = (offset >> 16) & 0xff;
            bytes[pointer.index+2] = (offset >> 8) & 0xff;
            bytes[pointer.index+3] = offset & 0xff;

            // Add child here
            let childBytes = this.gtChild.toBinary();
            bytes.push(...childBytes);
        }
        return bytes;
    }
}

class BTree {
    /**
     * Creates a new B-tree
     * @param {number} maxSize number of keys to use per node
     * @param {boolean} uniqueValues whether the index is unique
     */
    constructor(maxSize, uniqueValues) {
        this.maxSize = maxSize;
        this.uniqueValues = uniqueValues;

        /**
         * @type {BTreeNode}
         */
        this.root = null;
    }

    add(key, value) {
        if (this.root === null) {
            this.root = new BTreeNode(this, null, key, value);
        }
        else {
            this.root.add(key, value);
            // If root node split, update the root to the newly created one
            if (this.root.parent !== null) {
                this.root = this.root.parent;
            }
            // while (this.root.parent !== null) {
            //     this.root = this.root.parent;
            // }
        }
    }

    find(key) {
        return this.root.find(key);
    }

    toBinary() {
        // Return binary data
        let data = this.root.toBinary();
        let header = [
            // index_length:
            (data.length >> 24) & 0xff,
            (data.length >> 16) & 0xff,
            (data.length >> 8) & 0xff,
            data.length & 0xff,
            // index_type:
            this.uniqueValues ? 1 : 0,
            // max_node_entries:
            this.maxSize
        ];
        data.unshift(...header);
        return data;
        // let chunks = [];
        // this.root.toBinary(chunks);

        // // Append all chunks
        // const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
        // const data = new Uint8Array(length);
        // let offset = 0;
        // chunks.forEach((chunk) => {
        //     data.set(chunk, offset);
        //     offset += chunk.length;
        // });
        // return data;
    }
}

class BinaryBTree {
    constructor(data) {
        this.data = data;

        this.read = new BinaryBTreeReader((i, length) => {
            return new Promise((resolve) => {
                let slice = data.slice(i, length);
                resolve(slice);
            });
        });
    }

    find(searchKey) {
        // data layout: see BTreeNode.toBinary

        const data = this.data;
        const isUnique = (data[4] & 0x1) === 1;
        let index = 6;
        const checkNode = () => {
            index += 4; // Skip node_length
            let entries = data[index];
            index++;
            for (let i = 0; i < entries; i++) {
                // key_type:
                let keyType = data[index];
                index++;

                // key_length:
                let keyLength = data[index];
                index++;

                // key_data:
                let keyData =  data.slice(index, index + keyLength); // [];
                index += keyLength;

                let key;
                switch(keyType) {
                    case KEY_TYPE.UNDEFINED: {
                        // no need to do this: key = undefined;
                        break;
                    }
                    case KEY_TYPE.STRING: {
                        key = keyData.reduce((k, code) => k + String.fromCharCode(code), "");
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

                if (searchKey === key) {
                    // Match! Read value(s) and return
                    const readValue = () => {
                        let valueLength = data[index];
                        index++;
                        let value = [];
                        for (let j = 0; j < valueLength; j++) {
                            value[j] = data[index + j];
                        }
                        return value;
                    };

                    index += 4; // Skip lt_child_ptr
                    index += 4; // Ignore val_length, we will read all values
                    if (isUnique) {
                        // Read value
                        return readValue();
                    }
                    else {
                        // Read value_list
                        const valuesLength = (data[index] << 24) | (data[index+1] << 16) | (data[index+2] << 8) | data[index+3]; // lt_child_ptr
                        index += 4;
                        const values = [];
                        for(let i = 0; i < valuesLength; i++) {
                            const value = readValue();
                            values.push(value);
                        }
                        return values;
                    }
                }
                else if (searchKey < key) {
                    // Check lesser child node
                    let offset = (data[index] << 24) | (data[index+1] << 16) | (data[index+2] << 8) | data[index+3]; // lt_child_ptr
                    index += offset + 3;
                    return offset > 0 ? checkNode() : null; // Check it
                }
                else {
                    // Increase index to point to next entry
                    index += 4; // skip lt_child_ptr
                    // read val_length
                    let valLength = (data[index] << 24) | (data[index+1] << 16) | (data[index+2] << 8) | data[index+3]; // lt_child_ptr
                    index += valLength + 4; // skip all value data (+4?)
                }
            }
            // Still here? key > last entry in node
            let offset = (data[index] << 24) | (data[index+1] << 16) | (data[index+2] << 8) | data[index+3]; // lt_child_ptr
            index += offset + 3;
            return offset > 0 ? checkNode() : null; // Check it
        };
        return checkNode();
    }
}

class BinaryBTreeReader {
    constructor(read) {
        this.read = read;
    }
}

class AsyncBinaryBTree {
    constructor(data) {
        this.read = new BinaryBTreeReader((i, length) => {
            let slice = data.slice(i, i + length);
            return Promise.resolve(slice);
            // return new Promise((resolve) => {
            //     let slice = data.slice(i, i + length);
            //     resolve(slice);
            // });
        }).read;
    }

    find(searchKey) {
        // layout: see BTreeNode.toBinary()
        // Read header (5 bytes) and first chunk of data
        const chunkSize = 32; //512;
        return this.read(0, chunkSize)
        .then(chunk => {
            // Start here.
            // If at any point more data is needed, it should do another 
            // read and proceed

            let data = chunk;
            let dataOffset = 0;

            /**
             * Reads more adjacent data and appends it to current data chunk
             */
            const moreData = (chunks = 1) => {
                return this.read(dataOffset + data.length, chunks * chunkSize)
                .then(nextChunk => {
                    // TODO: Refactor to typed arrays
                    data.push(...nextChunk);
                    return;
                })
            };

            /**
             * Reads new data from current reading index + passed offset argument
             * @param {number} offset 
             */
            const seekData = (offset) => {
                // Where do we seek to?
                // dataOffset = 512,
                // index = 50, 
                // offset = 700
                // dataIndex = dataOffset + index + offset
                if (index + offset < data.length) {
                    index += offset;
                    return Promise.resolve();
                }
                let dataIndex = dataOffset + index + offset;
                return this.read(dataIndex, chunkSize)
                .then(newChunk => {
                    data = newChunk;
                    dataOffset = dataIndex;
                    index = 0;
                    return;
                });
            };

            /**
             * Asserts enough bytes are available in the loaded data
             * @param {number} length 
             */
            const assertBytes = (length) => {
                if (index + length > data.length) {
                    return moreData(Math.ceil(length / chunkSize));
                }
                else {
                    return Promise.resolve();
                }
            };

            const isUnique = (data[4] & 0x1) === 1;
            let index = 6;

            const checkNode = () => {
                return assertBytes(4)
                .then(() => {
                    const nodeLength = (data[index] << 24) | (data[index+1] << 16) | (data[index+2] << 8) | data[index+3]; // lt_child_ptr
                    return assertBytes(nodeLength);
                })
                .then(() => {
                    // Enough data loaded to process whole node
                    index += 4;
                    let entries = data[index];
                    index++;

                    for (let i = 0; i < entries; i++) {
                        // key_type:
                        let keyType = data[index];
                        index++;
        
                        // key_length:
                        let keyLength = data[index];
                        index++;
        
                        // key_data:
                        let keyData = data.slice(index, index + keyLength); // [];
                        index += keyLength;
        
                        let key;
                        switch(keyType) {
                            case KEY_TYPE.UNDEFINED: {
                                // no need to do this: key = undefined;
                                break;
                            }
                            case KEY_TYPE.STRING: {
                                key = keyData.reduce((k, code) => k + String.fromCharCode(code), "");
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
        
                        if (searchKey === key) {
                            // Match! Read value(s) and return
                            const readValue = () => {
                                let valueLength = data[index];
                                index++;
                                let value = [];
                                for (let j = 0; j < valueLength; j++) {
                                    value[j] = data[index + j];
                                }
                                return value;
                            };
        
                            index += 4; // Skip lt_child_ptr
                            index += 4; // Ignore val_length, we will read all values
                            if (isUnique) {
                                // Read value
                                return readValue();
                            }
                            else {
                                // Read value_list
                                const valuesLength = (data[index] << 24) | (data[index+1] << 16) | (data[index+2] << 8) | data[index+3]; // lt_child_ptr
                                index += 4;
                                const values = [];
                                for(let i = 0; i < valuesLength; i++) {
                                    const value = readValue();
                                    values.push(value);
                                }
                                return values;
                            }
                        }
                        else if (searchKey < key) {
                            // Check lesser child node
                            let offset = (data[index] << 24) | (data[index+1] << 16) | (data[index+2] << 8) | data[index+3]; // lt_child_ptr
                            if (offset > 0) {
                                return seekData(offset + 3).then(() => {
                                    return checkNode();
                                });
                            }
                            else {
                                return null;
                            }
                        }
                        else {
                            // Increase index to point to next entry
                            index += 4; // skip lt_child_ptr
                            // read val_length
                            let valLength = (data[index] << 24) | (data[index+1] << 16) | (data[index+2] << 8) | data[index+3]; // lt_child_ptr
                            index += valLength + 4; // skip all value data (+4?)
                        }
                    }
                    // Still here? key > last entry in node
                    let offset = (data[index] << 24) | (data[index+1] << 16) | (data[index+2] << 8) | data[index+3]; // lt_child_ptr
                    if (offset > 0) {
                        return seekData(offset + 3).then(() => {
                            return checkNode();
                        });
                    }
                    else {
                        return null;
                    }
                });
            };            

            return checkNode();
        });
    }
}


module.exports = { 
    BTree, 
    BinaryBTree ,
    AsyncBinaryBTree
};