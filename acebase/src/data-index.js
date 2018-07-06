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

    all() {
        const all = [];
        const add = (entry) => {
            let obj = { key: entry.key };
            if (this.tree.uniqueValues) {
                obj.value = entry.values[0];
            }
            else {
                obj.values = entry.values;
            }
            all.push(obj);
        };        
        for(let i = 0 ; i < this.entries.length; i++) {
            let entry = this.entries[i];
            entry.ltChild && all.push(...entry.ltChild.all());
            add(entry);
        }
        this.gtChild && all.push(...this.gtChild.all()); 
        return all;
    }

    search(op, val) {
        if (["in","!in","between","!between"].indexOf(op) >= 0) {
            // val must be an array
            console.assert(val instanceof Array, `val must be an array when using operator ${op}`);
        }
        let results = [];
        const add = (entry) => {
            let obj = { key: entry.key };
            if (this.tree.uniqueValues) {
                obj.value = entry.values[0];
            }
            else {
                obj.values = entry.values;
            }
            results.push(obj);
        };
        /**
         * 
         * @param {BTreeNode} parentNode 
         */
        const addNode = (parentNode) => {
            for(let i = 0 ; i < parentNode.entries.length; i++) {
                let entry = parentNode.entries[i];
                entry.ltChild && addNode(entry.ltChild); 
                add(entry);
            }
            parentNode.gtChild && addNode(parentNode.gtChild); 
        }
        
        for(let i = 0; i < this.entries.length; i++) {
            const entry = this.entries[i];
            const isFirstEntry = i === 0;
            const isLastEntry = i + 1 === this.entries.length;
            // const valIsBetween = ["between","!between"].indexOf(op) >= 0 && entry.key >= val[0] && entry.key <= val[1];
            // const valIsInSet =  ["in","!in"].indexOf(op) >= 0 && val.indexOf(entry.key) >= 0;

            // if (op === "between") {
            //     // This is way easier using a B+ tree!!!
            //     if (valIsBetween && isFirstEntry && val[0] !== entry.key) {
            //         entry.ltChild && results.push(...entry.ltChild.search(op, val));
            //     }
            //     if (valIsBetween) {
            //         add(entry);
            //     }
            //     if (valIsBetween && isLastEntry && val[1] !== entry.key) {
            //         this.gtChild && results.push(...this.gtChild.search(op, val));
            //     }
            // }
            //else 
            if (entry.key < val) {
                if (["<","<=","!="].indexOf(op) >= 0) {
                    entry.ltChild && addNode(entry.ltChild);
                    add(entry);
                }
                if (isLastEntry) {
                    // Last entry is smaller than compare value
                    this.gtChild && results.push(...this.gtChild.search(op, val));
                }
            }
            else if (entry.key === val) {
                if (op === "<=") {
                    entry.ltChild && addNode(entry.ltChild);
                }
                if (["<=","==",">="].indexOf(op) >= 0) {
                    add(entry);
                }
                if (isLastEntry && op === ">=") {
                    this.gtChild && results.push(...this.gtChild.search(op, val));
                }
            }
            else if (entry.key > val) {
                if (isFirstEntry) {
                    // First entry is greater than compare value
                    entry.ltChild && results.push(...entry.ltChild.search(op, val));
                }
                if ([">",">=","!="].indexOf(op) >= 0) {
                    add(entry);
                    if (isLastEntry) {
                        this.gtChild && addNode(this.gtChild);
                    }
                }
                else if (isFirstEntry) {
                    break; // Break the loop, because the values will only become bigger
                }
            }
            else {
                throw new Error(`Impossible. Debug this`);
            }
        }
        return results;
    }


    toBinary() {
        // EBNF layout:
        // data                 = index_length, index_type, max_node_entries, root_node
        // index_length         = 4 byte number
        // index_type           = 1 byte = [0,0,0,0,0,0,0,is_unique]
        // max_node_entries     = 1 byte number
        // root_node            = node
        // node*                = node_length, entries_length, entries, gt_child_ptr, children
        // node_length          = 4 byte number (byte count)
        // entries_length       = 1 byte number
        // entries              = entry, [entry, [entry...]]
        // entry                = key, lt_child_ptr, val
        // key                  = key_type, key_length, key_data
        // key_type             = 1 byte number
        //                          0: UNDEFINED (equiv to sql null values)
        //                          1: STRING
        //                          2: NUMBER
        //                          3: BOOLEAN
        //                          4: DATE
        // key_length           = 1 byte number
        // key_data             = [key_length] bytes ASCII string
        // lt_child_ptr         = 4 byte number (byte offset)
        // val                  = val_length, val_data
        // val_length           = 4 byte number (byte count)
        // val_data             = is_unique?
        //                          0: value_list
        //                          1: value
        // value_list           = value_list_length, value, [value, [value...]]
        // value_list_length    = 4 byte number
        // value                = value_length, value_data
        // value_length         = 1 byte number
        // value_data           = [value_length] bytes data 
        // gt_child_ptr         = 4 byte number (byte offset)
        // children             = node, [node, [node...]]
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
        if(this.entries.findIndex(entry => entry.key === newKey) >= 0) {
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
            // A = [ 10, 20, 30, 40] becomes A = [ 10, 20 ], B = [ 40 ], C = 30 moves to parent
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
                const insertIndex = this.parent.entries.findIndex(entry => entry.key > moveUpEntry.key);
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

    toBinary() {
        // EBNF layout:
        // data                 = byte_length, index_type, max_node_entries, root_node
        // byte_length          = 4 byte number (byte count)
        // index_type           = 1 byte = [0,0,0,0,0,0,0,is_unique]
        // max_node_entries     = 1 byte number
        // root_node            = node | leaf
        // node*                = byte_length, is_leaf, entries_length, entries, gt_child_ptr, children
        // is_leaf              = 1 byte
        //                          0: no, it's a node
        //                          1: yes, leaf
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
        // key_data             = [key_length] bytes ASCII string
        // lt_child_ptr         = 4 byte number (byte offset to node | leaf)
        // gt_child_ptr         = 4 byte number (byte offset to node | leaf)
        // children             = node, [node, [node...]] | leaf, [leaf, [leaf...]]
        // leaf**               = byte_length, is_leaf, prev_leaf_ptr, next_leaf_ptr, entries_length, leaf_entries
        // leaf_entries         = leaf_entry, [leaf_entry, [leaf_entry...]]
        // leaf_entry           = key, val
        // prev_leaf_ptr        = 4 byte signed_number (byte offset to leaf)
        // next_leaf_ptr        = 4 byte signed_number (byte offset to leaf)
        // signed_number        = 32 bits = [negative_flag, bit{31}]
        // val                  = val_length, val_data
        // val_length           = 4 byte number (byte count)
        // val_data             = is_unique?
        //                          0: value_list
        //                          1: value
        // value_list           = value_list_length, value, [value, [value...]]
        // value_list_length    = 4 byte number
        // value                = value_length, value_data
        // value_length         = 1 byte number
        // value_data           = [value_length] bytes data         
        //
        // * Written by BPlusTreeNode.toBinary()
        // ** Written by BPlusTreeLeaf.toBinary() 

        let bytes = [];

        // byte_length:
        bytes.push(0, 0, 0, 0);

        // is_leaf:
        bytes.push(0); // (no)

        // entries_length:
        bytes.push(this.entries.length);

        let pointers = [],      // pointers refer to an offset in the binary data where nodes/leafs can be found
            references = [];    // references point to an index in the binary data where pointers are to be stored
        
        this.entries.forEach(entry => {
            let keyBytes = BPlusTree.getBinaryKeyData(entry.key);
            bytes.push(...keyBytes);

            // lt_child_ptr:
            let index = bytes.length;
            bytes.push(0, 0, 0, 0);
            references.push({ name: `<${entry.key}`, index, node: entry.ltChild });
        });

        // gt_child_ptr:
        let index = bytes.length;
        bytes.push(0, 0, 0, 0);
        references.push({ name: `>${this.entries[this.entries.length - 1].key}`, index, node: this.gtChild });

        // update byte_length:
        bytes[0] = (bytes.length >> 24) & 0xff;
        bytes[1] = (bytes.length >> 16) & 0xff;
        bytes[2] = (bytes.length >> 8) & 0xff;
        bytes[3] = bytes.length & 0xff;

        const addChild = (childNode, name) => {
            index = bytes.length;
            const refIndex = references.findIndex(ref => ref.node === childNode);
            const ref = references.splice(refIndex, 1)[0];
            const offset = index - (ref.index + 3);
            bytes[ref.index] = BPlusTree.addBinaryDebugString(`child_ptr ${name}`, (offset >> 24) & 0xff);
            bytes[ref.index+1] = (offset >> 16) & 0xff;
            bytes[ref.index+2] = (offset >> 8) & 0xff;
            bytes[ref.index+3] = offset & 0xff;
            
            // Add child here
            let child = childNode.toBinary();
            bytes.push(...child.bytes);            
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
                pointer.index += index;
                pointers.push(pointer);
            });
            // Add unresolved references added by the child
            child.references.forEach(ref => {
                ref.index += index;
                references.push(ref);
            });
        };

        // Update all lt_child_ptr's:
        this.entries.forEach(entry => {
            index = bytes.length;
            if (entry.ltChild !== null) {
                // Update lt_child_ptr:
                addChild(entry.ltChild, `<${entry.key}`);
            }
        });

        // Update gt_child_ptr:
        if (this.gtChild !== null) {
            addChild(this.gtChild, `>=${this.entries[this.entries.length-1].key}`);
        }

        // Check if we can resolve any leaf references
        // let maxOffset = Math.pow(2, 31) - 1;
        // pointers.forEach(pointer => {
        //     const i = references.findIndex(ref => ref.leaf === pointer.leaf);
        //     if (i >= 0) {
        //         let ref = references.splice(i, 1); // remove it from the references
        //         let offset = pointer.index - ref.index;
        //         const negative = (offset < 0);
        //         if (negative) { offset = -offset; }
        //         if (offset > maxOffset) {
        //             throw new Error(`offset to big to store in 31 bits`);
        //         }
        //         bytes[ref.index] = ((offset >> 24) & 0x7f) | (negative ? 0x80 : 0);
        //         bytes[ref.index+1] = (offset >> 16) & 0xff;
        //         bytes[ref.index+2] = (offset >> 8) & 0xff;
        //         bytes[ref.index+3] = offset & 0xff;
        //     }
        // });
        BPlusTreeNode.resolveBinaryReferences(bytes, references, pointers);
        return { bytes, references, pointers };
    }

    static resolveBinaryReferences(bytes, references, pointers) {
        let maxOffset = Math.pow(2, 31) - 1;
        pointers.forEach(pointer => {
            while(true) {
                const i = references.findIndex(ref => ref.target === pointer.leaf);
                if (i < 0) {
                    break;
                }
                else {
                    let ref = references.splice(i, 1)[0]; // remove it from the references
                    let offset = pointer.index - ref.index;
                    const negative = (offset < 0);
                    if (negative) { offset = -offset; }
                    if (offset > maxOffset) {
                        throw new Error(`reference offset to big to store in 31 bits`);
                    }
                    let debugName = bytes[ref.index] instanceof Array ? bytes[ref.index][0] : undefined;
                    bytes[ref.index] = ((offset >> 24) & 0x7f) | (negative ? 0x80 : 0);
                    if (debugName) {
                        bytes[ref.index] = [debugName, bytes[ref.index]];
                    }
                    bytes[ref.index+1] = (offset >> 16) & 0xff;
                    bytes[ref.index+2] = (offset >> 8) & 0xff;
                    bytes[ref.index+3] = offset & 0xff;
                }
            }
        });      
    }

}

class BPlusTreeLeafEntry {
    /**
     * 
     * @param {BPlusTreeLeaf} leaf 
     * @param {string|number|boolean|Date|undefined} key 
     * @param {ArrayBuffer|[]|string} value 
     */
    constructor(leaf, key, value) {
        this.leaf = leaf;
        this.key = key;
        this.values = [value];
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

    get tree() {
        return this.parent instanceof BPlusTree ? this.parent : this.parent.tree;
    }

    /**
     * Adds an entry to this leaf
     * @param {BPlusTreeLeafEntry} entry 
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
        if (value.length > 255) {
            throw new Error(`Unable to store values larger than 255 bytes`); // binary restriction
        }

        // First. check if we already have an entry with this key
        const entryIndex = this.entries.findIndex(entry => entry.key === key);
        if (entryIndex >= 0) {
            if (this.tree.uniqueKeys) {
                throw new Error(`Cannot insert duplicate key ${key}`);
            }
            const entry = this.entries[entryIndex];
            entry.values.push(value);
            return entry;
        }

        // New key, create entry
        const entry = new BPlusTreeLeafEntry(this, key, value);
        if (this.entries.length === 0) {
            this.entries.push(entry);
        }
        else {
            // Find where to insert sorted
            let insertIndex = this.entries.findIndex(otherEntry => otherEntry.key > entry.key);
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

    toBinary() {
        // See BPlusTreeNode.toBinary() for data layout
        let bytes = [];

        // byte_length
        bytes.push(0, 0, 0, 0);

        // is_leaf:
        bytes.push(1); // (yes)

        let references = [];

        // prev_leaf_ptr:
        this.prevLeaf && references.push({ name: `<${this.entries[0].key}`, target: this.prevLeaf, index: bytes.length });
        bytes.push(BPlusTree.addBinaryDebugString("prev_leaf_ptr", 0), 0, 0, 0);

        // next_leaf_ptr:
        this.nextLeaf && references.push({ name: `>${this.entries[this.entries.length-1].key}`, target: this.nextLeaf, index: bytes.length });
        bytes.push(BPlusTree.addBinaryDebugString("next_leaf_ptr", 0), 0, 0, 0);

        // entries_length:
        bytes.push(BPlusTree.addBinaryDebugString("entries_length", this.entries.length));

        this.entries.forEach(entry => {
            let keyBytes = BPlusTree.getBinaryKeyData(entry.key);
            bytes.push(...keyBytes);

            // val_length:
            const valLengthIndex = bytes.length;
            bytes.push(BPlusTree.addBinaryDebugString("val_length", 0), 0, 0, 0);

            const writeValue = (value) => {
                // value_length:
                bytes.push(BPlusTree.addBinaryDebugString("value_length", value.length));

                // value_data:
                bytes.push(...value);
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

        // update byte_length:
        bytes[0] = (bytes.length >> 24) & 0xff;
        bytes[1] = (bytes.length >> 16) & 0xff;
        bytes[2] = (bytes.length >> 8) & 0xff;
        bytes[3] = bytes.length & 0xff;

        return { bytes, references };
    }

    // DEPRECATED, now uses linked list to link next/prev leafs
    // This was very useful to determine if tree structure was ok
    // next() {
    //     // Walk the tree to find out what leaf is next. Enables index scanning
    //     let searchNode = this;
    //     console.log(this.toString());
    //     while(searchNode.parent) {
    //         let index = searchNode.parent.entries.findIndex(entry => entry.ltChild === searchNode);
    //         let lastIndex = searchNode.parent.entries.length - 1;
    //         let next;
    //         if (index < 0) {
    //             console.assert(searchNode.parent.gtChild === searchNode);
    //             // We need to go further up
    //             searchNode = searchNode.parent;
    //             continue;
    //         }
    //         else if (index === lastIndex) {
    //             next = searchNode.parent.gtChild;
    //             if (next instanceof BPlusTreeNode) {
    //                 next = next.entries[0];
    //             }
    //         }
    //         else {
    //             next = searchNode.parent.entries[index + 1];
    //         }

    //         while (next.ltChild) {
    //             next = next.ltChild;
    //         }
    //         return next;
    //     } 
    //     return null;
    // }
}
class BPlusTree {
    /**
     * 
     * @param {number} maxEntriesPerNode max number of entries per tree node. Working with this instead of m for max number of children, because that makes less sense imho
     * @param {boolean} uniqueKeys whether the keys added must be unique
     */
    constructor(maxEntriesPerNode, uniqueKeys) {
        this.maxEntriesPerNode = maxEntriesPerNode;
        this.uniqueKeys = uniqueKeys;
        this.root = new BPlusTreeLeaf(this);
        this.depth = 1;
    }

    // checkTree() {
    //     /**
    //      * 
    //      * @param {BPlusTreeNode} node 
    //      */
    //     const checkNode = (node) => {
    //         if (node.parent) {
    //             const index = node.parent.entries.findIndex(entry => entry.ltChild === node);
    //             if (index < 0) {
    //                 console.assert(node.parent.gtChild === node, `Node "${node.toString()}" must be referred to by parent "${node.parent.toString()}"`);
    //             }
    //         }
    //         if (node instanceof BPlusTreeNode) {
    //             node.entries.forEach(entry => {
    //                 checkNode(entry.ltChild);
    //             });
    //             checkNode(node.gtChild);
    //         }
    //     };
    //     checkNode(this.root);
    // }

    add(key, value) {
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
        leaf.add(key, value);
    }

    findLeaf(key) {
        /**
         * 
         * @param {BPlusTreeNode} node 
         * @returns {BPlusTreeLeaf}
         */
        const findLeaf = (node) => { 
            for (let i = 0; i < node.entries.length; i++) {
                let entry = node.entries[i];
                if (key < entry.key) {
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
            console.assert(key >= node.entries[node.entries.length-1].key)
            if (node.gtChild instanceof BPlusTreeLeaf) {
                return node.gtChild;
            } 
            return findLeaf(node.gtChild);
        };
        return findLeaf(this.root);   
    }

    find(key) {
        const leaf = this.findLeaf(key);
        const entry = leaf.entries.find(entry => entry.key === key);
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
                    if (op === "<=" && entry.key <= val) { add(entry); }
                    else if (op === "<" && entry.key < val) { add(entry); }
                }
                leaf = leaf.prevLeaf;
            }
        }
        else if ([">",">="].indexOf(op) >= 0) {
            let leaf = this.findLeaf(val);
            while(leaf) {
                for (let i = 0; i < leaf.entries.length; i++) {
                    const entry = leaf.entries[i];
                    if (op === ">=" && entry.key >= val) { add(entry); }
                    else if (op === ">" && entry.key > val) { add(entry); }
                }
                leaf = leaf.nextLeaf;
            }
        }
        else if (op === "==") {
            let leaf = this.findLeaf(val);
            let entry = leaf.entries.find(entry => entry.key === val);
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
                    if (entry.key !== val) { add(entry); }
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
                let entry = leaf.entries.find(entry => entry.key === searchKey);
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
                    if (keys.indexOf(entry.key) < 0) { add(entry); }
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
                    if (entry.key >= bottom && entry.key <= top) { add(entry); }
                    if (entry.key > top) { stop = true; break; }
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
                    if (entry.key < bottom) { add(entry); }
                    else { stop = true; break; }
                }
                leaf = leaf.nextLeaf;
            }
            // Now add upper range, top < val < highest value
            leaf = this.findLeaf(top);
            while (leaf) {
                for (let i = 0; i < leaf.entries.length; i++) {
                    const entry = leaf.entries[i];
                    if (entry.key > top) { add(entry); }
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

    static get debugBinary() { return true; }
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
                for (let i = 0; i < key.length; i++) {
                    keyBytes.push(key.charCodeAt(i));
                }
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

    toBinary() {
        // Return binary data
        let { bytes, references, pointers } = this.root.toBinary();

        //BPlusTreeNode.resolveBinaryReferences(bytes, references, pointers);
        console.assert(references.length === 0, "All references must be resolved now");

        // Add header
        let header = [
            // index_length:
            BPlusTree.addBinaryDebugString("index_length", (bytes.length >> 24) & 0xff),
            (bytes.length >> 16) & 0xff,
            (bytes.length >> 8) & 0xff,
            bytes.length & 0xff,
            // index_type:
            BPlusTree.addBinaryDebugString("index_type", this.uniqueKeys ? 1 : 0),
            // max_node_entries:
            this.maxEntriesPerNode
        ];
        bytes.unshift(...header);
        return bytes;
    }
}

// TODO: Refactor to typed arrays
class ChunkReader {
    constructor(chunkSize, readFn) {
        this.chunkSize = chunkSize;
        this.read = readFn;
        this.data = null;
        this.offset = 0;    // offset of loaded data
        this.index = 0;     // current chunk reading index
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
            this.data.push(...nextChunk);
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
            return;
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
            go
        };
    }
}

class BinaryBPlusTree {
    // constructor(readFn) {
    //     this.read = readFn;
    // }
    constructor(data) {
        if (BPlusTree.debugBinary) {
            this.debugData = data;
            data = data.map(entry => entry instanceof Array ? entry[1] : entry);
        }
        this.data = data;

        // this._ready = false;
        // this.reader = new ChunkReader(32, (i, length) => {
        //     let slice = this.data.slice(i, i + length);
        //     return Promise.resolve(slice);
        // });
    }

    // ready() {
    //     if (this._ready && this.info) {
    //         return Promise.resolve(this.info);
    //     }
    //     return this.reader.init()
    //     .then(() => {
    //         return this.reader.get(6);
    //     })
    //     .then(header => {
    //         this.info = {
    //             byteLength: (header[0] << 24) | (header[1] << 16) | (header[2] << 8) | header[3],
    //             isUnique: (header[4] & 0x1) === 1,
    //             entriesPerNode: header[5]
    //         };
    //         this._ready = true;
    //         return this.info;
    //     });
    // }

    _getReader() {
        const reader = new ChunkReader(32, (i, length) => {
            let slice = this.data.slice(i, i + length);
            return Promise.resolve(slice);
        });
        return reader.init()
        .then(() => {
            return reader.get(6);
        })
        .then(header => {
            this.info = {
                byteLength: (header[0] << 24) | (header[1] << 16) | (header[2] << 8) | header[3],
                isUnique: (header[4] & 0x1) === 1,
                entriesPerNode: header[5]
            };
            //this._ready = true;
            return reader;
        });
    }

    _readChild(reader) {
        return reader.get(5) // byte_length, is_leaf
        .then(bytes => {
            const byteLength = (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]; // byte_length
            const isLeaf = bytes[4] === 1; // is_leaf

            // load whole node/leaf for easy processing
            return reader.get(byteLength - 5)
            .then(bytes => {
                return {
                    isLeaf,
                    bytes
                };
            });
        });
    }

    _getLeaf(bytes, reader) {
        const savedPosition = reader.savePosition(-bytes.length);
        const getSignedOffset = (bytes, index) => {
            let offset = ((bytes[index] & 0x7f) << 24) | (bytes[index+1] << 16) | (bytes[index+2] << 8)  | bytes[index+3];
            let isNegative = (bytes[index] & 0x80) > 0;
            if (isNegative) { offset = -offset; }
            return offset;
        };
        const prevLeafOffset = getSignedOffset(bytes, 0); // prev_leaf_ptr
        const nextLeafOffset = getSignedOffset(bytes, 4); // next_leaf_ptr
        
        let index = 8;
        let entriesLength = bytes[index]; // entries_length
        index++;
        let entries = [];

        const readValue = () => {
            let valueLength = bytes[index];
            index++;
            let value = [];
            for (let j = 0; j < valueLength; j++) {
                value[j] = bytes[index + j];
            }
            index += valueLength;
            return value;
        };

        for (let i = 0; i < entriesLength; i++) {
            let keyInfo = BPlusTree.getKeyFromBinary(bytes, index);
            let key = keyInfo.key;
            index += keyInfo.length + 2;

            // Read value(s) and return
            index += 4; // Skip val_length, we will read all values
            if (this.info.isUnique) {
                // Read single value
                entries.push({
                    key,
                    values: [readValue()]
                });
            }
            else {
                // Read value_list_length
                const valuesLength = (bytes[index] << 24) | (bytes[index+1] << 16) | (bytes[index+2] << 8) | bytes[index+3]; // value_list_length
                index += 4;
                const values = [];
                for(let i = 0; i < valuesLength; i++) {
                    const value = readValue();
                    values.push(value);
                }
                entries.push({
                    key,
                    values
                });
            }
        }

        const leaf = {
            entries
        };
        if (prevLeafOffset !== 0) {
            leaf.getPrevious = () => {
                return savedPosition.go(prevLeafOffset)
                .then(() => {
                    return this._readChild(reader)
                    .then(child => {
                        console.assert(child.isLeaf, `If this is not the case, debug me`);
                        return this._getLeaf(child.bytes, reader);
                    });
                });
            };
        }
        if (nextLeafOffset !== 0) {
            leaf.getNext = () => {
                return savedPosition.go(nextLeafOffset + 4) // +4 because next_leaf_ptr is 4 bytes from savedPosition
                .then(() => {
                    return this._readChild(reader)
                    .then(child => {
                        console.assert(child.isLeaf, `If this is not the case, debug me`);
                        return this._getLeaf(child.bytes, reader);
                    });                    
                });
            };
        }
        return leaf;
    }

    _getNode(bytes, reader) {
        const node = { 
            entries: [] 
        };
        const entriesLength = bytes[0];
        let index = 1;

        for (let i = 0; i < entriesLength; i++) {
            let keyInfo = BPlusTree.getKeyFromBinary(bytes, index);
            let key = keyInfo.key;
            index += keyInfo.length + 2;
            let entry = {
                key
            };
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

    getFirstLeaf() {
        let reader;
        const processChild = (child) => {
            if (child.isLeaf) {
                return this._getLeaf(child.bytes, reader);
            }
            else {
                const node = this._getNode(child.bytes, reader);
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

    getLastLeaf() {
        let reader;
        const processChild = (child) => {
            if (child.isLeaf) {
                return this._getLeaf(child.bytes, reader);
            }
            else {
                return this._getNode(child.bytes, reader)
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

    findLeaf(searchKey) {
        // navigate to the right child
        let reader;
        const readChild = () => {
            return this._readChild(reader)
            .then(child => {
                if (child.isLeaf) {
                    return this._getLeaf(child.bytes, reader);
                }
                else {
                    return readNode(child.bytes);
                }
            });
        };

        const readNode = (bytes) => {
            let entries = bytes[0];
            let index = 1;

            for (let i = 0; i < entries; i++) {
                let keyInfo = BPlusTree.getKeyFromBinary(bytes, index);
                let key = keyInfo.key;
                index += keyInfo.length + 2;

                if (searchKey < key) {
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

        // let the reader start after the 6 header bytes
        return this._getReader()
        .then(r => {
            reader = r;
            return reader.go(6);
        }) 
        .then(() => {
            return readChild();
        });
    }

    search(op, param) {
        if (["in","!in","between","!between"].indexOf(op) >= 0) {
            // param must be an array
            console.assert(param instanceof Array, `param must be an array when using operator ${op}`);
        }

        let results = [];
        const add = (entry) => {
            let obj = { key: entry.key };
            if (this.info.uniqueValues) {
                obj.value = entry.values[0];
            }
            else {
                obj.values = entry.values;
            }
            results.push(obj);
        };

        if (["<","<="].indexOf(op) >= 0) {
            const processLeaf = (leaf) => {
                for (let i = leaf.entries.length-1; i >= 0; i--) {
                    const entry = leaf.entries[i];
                    if (op === "<=" && entry.key <= param) { add(entry); }
                    else if (op === "<" && entry.key < param) { add(entry); }
                }
                if (leaf.getPrevious) {
                    return leaf.getPrevious()
                    .then(processLeaf)
                }
                else {
                    return results;
                }
            }
            return this.findLeaf(param)
            .then(processLeaf);
        }
        else if ([">",">="].indexOf(op) >= 0) {
            const processLeaf = (leaf) => {
                for (let i = 0; i < leaf.entries.length; i++) {
                    const entry = leaf.entries[i];
                    if (op === ">=" && entry.key >= param) { add(entry); }
                    else if (op === ">" && entry.key > param) { add(entry); }
                }
                if (leaf.getNext) {
                    return leaf.getNext()
                    .then(processLeaf);
                }
                else {
                    return results;
                }
            }
            return this.findLeaf(param)
            .then(processLeaf);
        }
        else if (op === "==") {
            return this.findLeaf(param)
            .then(leaf => {
                let entry = leaf.entries.find(entry => entry.key === param);
                if (entry) {
                    add(entry);
                }
                return results;
            });
        }
        else if (op === "!=") {
            // Full index scan needed
            const processLeaf = leaf => {
                for (let i = 0; i < leaf.entries.length; i++) {
                    const entry = leaf.entries[i];
                    if (entry.key !== param) { add(entry); }
                }
                if (leaf.getNext) {
                    return leaf.getNext()
                    .then(processLeaf);
                }
                else {
                    return results;
                }
            };
            return this.getFirstLeaf()
            .then(processLeaf);
        }
        else if (op === "in") {
            let sorted = param.slice().sort();
            let searchKey = sorted.shift();
            const processLeaf = (leaf) => {
                while (true) {
                    let entry = leaf.entries.find(entry => entry.key === searchKey);
                    if (entry) { add(entry); }
                    searchKey = sorted.shift();
                    if (!searchKey) {
                        return results;
                    }
                    else if (searchKey > leaf.entries[leaf.entries.length-1].key) {
                        return this.findLeaf(searchKey).then(processLeaf);
                    }
                    // Stay in the loop trying more keys on the same leaf
                }
            };
            return this.findLeaf(searchKey).then(processLeaf);
        }
        else if (op === "!in") {
            // Full index scan needed
            let keys = param;
            const processLeaf = (leaf) => {
                for (let i = 0; i < leaf.entries.length; i++) {
                    const entry = leaf.entries[i];
                    if (keys.indexOf(entry.key) < 0) { add(entry); }
                }
                if (leaf.getNext) {
                    return leaf.getNext()
                    .then(processLeaf);
                }
                else {
                    return results;
                }
            };
            return this.getFirstLeaf().then(processLeaf);
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
                        if (entry.key >= bottom && entry.key <= top) { add(entry); }
                        if (entry.key > top) { stop = true; break; }
                    }
                    if (stop || !leaf.getNext) {
                        return results;
                    }
                    else {
                        return leaf.getNext().then(processLeaf);
                    }
                };
                return processLeaf(leaf);
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
            return this.getFirstLeaf()
            .then(leaf => {
                let stop = false;
                const processLeaf = leaf => {
                    for (let i = 0; i < leaf.entries.length; i++) {
                        const entry = leaf.entries[i];
                        if (entry.key < bottom) { add(entry); }
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
                return this.findLeaf(top);
            })
            .then(leaf => {
                const processLeaf = leaf => {
                    for (let i = 0; i < leaf.entries.length; i++) {
                        const entry = leaf.entries[i];
                        if (entry.key > top) { add(entry); }
                    }
                    if (!leaf.getNext) {
                        return results;
                    }
                    else {
                        return leaf.getNext().then(processLeaf);
                    }                
                };
                return processLeaf(leaf);
            });
        }
    }

    find(searchKey) {
        // layout: see BPlusTreeNode.toBinary()

        // let reader = new ChunkReader(32, this.read);
        let reader = new ChunkReader(32, (i, length) => {
            let slice = this.data.slice(i, i + length);
            return Promise.resolve(slice);
        });

        return reader.init()
        .then(() => {
            return reader.get(6);
        })
        .then(header => {
            const isUnique = (header[4] & 0x1) === 1;

            const checkChild = () => {
                return reader.get(5) // byte_length, is_leaf
                .then(bytes => {
                    const byteLength = (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]; // byte_length
                    const isLeaf = bytes[4] === 1; // is_leaf

                    // load whole node/leaf for easy processing
                    return reader.get(byteLength - 5)
                    .then(bytes => {
                        if (isLeaf) {
                            return checkLeaf(bytes);
                        }
                        else {
                            return checkNode(bytes);
                        }
                    });
                });
            };

            const checkLeaf = (bytes) => {
                let index = 8;  // skip prev_leaf_ptr, next_leaf_ptr
                let entries = bytes[index];
                index++;

                for (let i = 0; i < entries; i++) {
                    let keyInfo = BPlusTree.getKeyFromBinary(bytes, index);
                    let key = keyInfo.key;
                    index += keyInfo.length + 2;

                    if (key < searchKey) {
                        let valLength = (bytes[index] << 24) | (bytes[index+1] << 16) | (bytes[index+2] << 8) | bytes[index+3]; //  val_length
                        index += valLength + 4; // skip to next entry
                        continue;
                    }
                    else if (key === searchKey) {
                        // Match! Read value(s) and return
                        const readValue = () => {
                            let valueLength = bytes[index];
                            index++;
                            let value = [];
                            for (let j = 0; j < valueLength; j++) {
                                value[j] = bytes[index + j];
                            }
                            return value;
                        };
    
                        index += 4; // Ignore val_length, we will read all values
                        if (isUnique) {
                            // Read value
                            return readValue();
                        }
                        else {
                            // Read value_list_length
                            const valuesLength = (bytes[index] << 24) | (bytes[index+1] << 16) | (bytes[index+2] << 8) | bytes[index+3]; // value_list_length
                            index += 4;
                            const values = [];
                            for(let i = 0; i < valuesLength; i++) {
                                const value = readValue();
                                values.push(value);
                            }
                            return values;
                        }
                    }
                    else {
                        return null; // key > searchKey, stop
                    }
                }
            }

            const checkNode = (bytes) => {
                let entries = bytes[0];
                let index = 1;

                for (let i = 0; i < entries; i++) {
                    let keyInfo = BPlusTree.getKeyFromBinary(bytes, index);
                    let key = keyInfo.key;
                    index += keyInfo.length + 2;

                    if (searchKey < key) {
                        // Check lesser child node
                        let offset = (bytes[index] << 24) | (bytes[index+1] << 16) | (bytes[index+2] << 8) | bytes[index+3]; // lt_child_ptr
                        if (offset > 0) {
                            reader.rewind(bytes.length - index); // correct reader's index
                            return reader.seek(offset + 3).then(() => {
                                return checkChild();
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
                        return checkChild();
                    });
                }
                else {
                    return null;
                }
            };            

            return checkChild();
        });
    }

}

module.exports = { 
    BTree, 
    BinaryBTree ,
    AsyncBinaryBTree,
    BPlusTree,
    BinaryBPlusTree
};