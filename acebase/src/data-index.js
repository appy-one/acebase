const { Storage } = require('./storage');
const { Record, RecordAddress, VALUE_TYPES } = require('./record');
const { BPlusTree, BinaryBPlusTree } = require('./btree');
const { getPathKeys } = require('./utils');
const uuid62 = require('uuid62');
const fs = require('fs');

function _createRecordPointer(wildcards, key, address) {
    // layout:
    // record_pointer   = wildcards_info, key_info, record_location
    // wildcards_info   = wildcards_length, wildcards
    // wildcards_length = 1 byte (nr of wildcard values)
    // wildcards        = wilcard[wildcards_length]
    // wildcard         = wilcard_length, wilcard_bytes
    // wildcard_length  = 1 byte
    // wildcard_value   = byte[wildcard_length] (ASCII char codes)
    // key_info         = key_length, key_bytes
    // key_length       = 1 byte
    // key_bytes        = byte[key_length] (ASCII char codes)
    // record_location  = page_nr, record_nr
    // page_nr          = 4 byte number
    // record_nr        = 2 byte number

    let recordPointer = [wildcards.length]; // wildcards_length
    for (let i = 0; i < wildcards.length; i++) {
        const wildcard = wildcards[i];
        recordPointer.push(wildcard.length); // wildcard_length
        // wildcard_bytes:
        for (let j = 0; j < wildcard.length; j++) {
            recordPointer.push(wildcard.charCodeAt(j));
        }
    }
    
    recordPointer.push(key.length); // key_length
    // key_bytes:
    for (let i = 0; i < key.length; i++) {
        recordPointer.push(key.charCodeAt(i));
    }
    // page_nr:
    recordPointer.push((address.pageNr >> 24) & 0xff);
    recordPointer.push((address.pageNr >> 16) & 0xff);
    recordPointer.push((address.pageNr >> 8) & 0xff);
    recordPointer.push(address.pageNr & 0xff);
    // record_nr:
    recordPointer.push((address.recordNr >> 8) & 0xff);
    recordPointer.push(address.recordNr & 0xff);
    return recordPointer;
};

function _parseRecordPointer(path, recordPointer) {
    const wildcardsLength = recordPointer[0];
    let wildcards = [];
    let index = 1;
    for (let i = 0; i < wildcardsLength; i++) {
        let wildcard = "";
        let length = recordPointer[index];
        for (let j = 0; j < length; j++) {
            wildcard += String.fromCharCode(recordPointer[index+j+1]);
        }
        wildcards.push(wildcard);
        index += length + 1;
    }
    const keyLength = recordPointer[index];
    let key = "";
    for(let i = 0; i < keyLength; i++) {
        key += String.fromCharCode(recordPointer[index+i+1]);
    }
    index += keyLength + 1;
    const pageNr = recordPointer[index] << 24 | recordPointer[index+1] << 16 | recordPointer[index+2] << 8 | recordPointer[index+3];
    index += 4;
    const recordNr = recordPointer[index] << 8 | recordPointer[index+1];
    if (wildcards.length > 0) {
        let i = 0;
        path = path.replace(/\*/g, () => {
            const wildcard = wildcards[i];
            i++;
            return wildcard;
        });
    }
    return { key, pageNr, recordNr, address: new RecordAddress(`${path}/${key}`, pageNr, recordNr) };
}
// /**
//  * @param {string} path index path
//  * @param {string} key index key
//  * @returns {Promise<{ tree: BinaryBPlusTree, close: () => void}>} returns a promise that resolves with a reference to the binary B+Tree and a close method to close the file once reading is done
//  */
//  const _keepIndexUpdated = (index) => {
//     // Subscribe to changes
//     this.subscriptions.add(`${index.path}`, "child_changed", (childPath, newValue, oldValue) => {
//         // A child's value changed.
//         // Did the indexed key change?
//         if (oldValue[key] !== UNCHANGED && newValue[key] !== oldValue[key]) {
//             // TODO: do something clever to update the index
//             // But BPlusTree/BinaryBPlusTree does not support changes yet!
//             // _getIndexTree(index.path, index.key)
//             // .then(idx => {
//             //     idx.tree.update(oldValue[key], newValue[key], (data) => {
//             //         // Check if this is the current record
//             //         const recordPointer = _parseRecordPointer(path, data);
//             //         const pathInfo = getPathInfo(recordPointer.address.path);
//             //         return pathInfo.key === key;
//             //     });
//             // });

//             // Re-create the entire index for now
//             this.indexes.create(index.path, index.key, true);
//         }
//     });
//     this.subscriptions.add(`${index.path}`, "child_added", (childPath, newValue) => {
//         // A child was added
//         // TODO: do something clever to update the index
//         this.indexes.create(index.path, index.key, true);
//     });
//     this.subscriptions.add(`${index.path}`, "child_removed", (childPath) => {
//         // A child was removed
//         // TODO: do something clever to update the index
//         this.indexes.create(index.path, index.key, true);
//     });
// };

class DataIndex {
    /**
     * Creates a new index
     * @param {Storage} storage
     * @param {string} path 
     * @param {string} key 
     */
    constructor(storage, path, key) {
        this.storage = storage;
        this.path = path.replace(/\/\*$/, ""); // Remove optional trailing "/*"
        this.key = key;
    }

    /**
     * 
     * @param {Record} record 
     * @param {any} newValue 
     */
    handleRecordUpdate(record, newValue) {
        // TODO: Lock and check if key value changed instead of bluntly rebuilding
        this.build();
    }

    _lock(forWriting, comment) {
        const tid = forWriting ? "write-index" : "read-index";
        return this.storage.lock(`index:${this.path}/*/${this.key}`, tid, forWriting, comment);
    }

    get fileName() {
        return `${this.storage.name}-${this.path.replace(/\//g, '-').replace(/\*/g, '#')}-${this.key}.idx`;        
    }

    /**
     * 
     * @param {string} op 
     * @param {any} val 
     */
    query(op, val) {
        var lock;
        return this._lock(false, `index.query "${op}", ${val}`)
        .then(l => {
            lock = l;
            return this._getTree();
        })
        .then(idx => {
            /**
             * @type BinaryBPlusTree
             */
            const tree = idx.tree;
            return tree.search(op, val)
            .then(entries => {
                // We now have record pointers
                lock.release();
                idx.close();

                const results = [];
                entries.forEach(entry => {
                    const value = entry.key;
                    entry.values.forEach(data => {
                        const recordPointer = _parseRecordPointer(this.path, data);
                        results.push({ key: recordPointer.key, value, address: recordPointer.address });
                    })
                });
                return results;
            });
        });
    }
        
    build() {
        const path = this.path;
        const hasWildcards = path.indexOf('*') >= 0;
        const wildcardsPattern = '^' + path.replace(/\*/g, "([a-z0-9\-_$]+)") + '/';
        const wildcardRE = new RegExp(wildcardsPattern, 'i');
        const tree = new BPlusTree(30, false);
        let lock;
        const keys = getPathKeys(path);

        const getAll = (currentPath, keyIndex) => {
            // "users/*/posts" 
            // --> Get all children of "users", 
            // --> get their "posts" children,
            // --> get their children to index
            const childPromises = [];
            const getChildren = () => {
                return Record.getChildStream(this.storage, { path }, { lock })
                .next(child => {
                    if (!child.address || child.type !== VALUE_TYPES.OBJECT) { //if (child.storageType !== "record" || child.valueType !== VALUE_TYPES.OBJECT) {
                        return; // This child cannot be indexed because it is not an object with properties
                    }
                    else if (keyIndex === keys.length) {
                        // We have to index this child
                        const p = Record.get(this.storage, child.address, { lock })
                        .then(childRecord => {
                            return childRecord.getChildInfo(this.key, { lock });
                        })
                        .then(childInfo => {
                            // What can be indexed? 
                            // strings, numbers, booleans, dates
                            if (childInfo.exists && [VALUE_TYPES.STRING, VALUE_TYPES.NUMBER, VALUE_TYPES.BOOLEAN, VALUE_TYPES.DATETIME].indexOf(childInfo.valueType) >= 0) {
                                // Index this value
                                if (childInfo.storageType === "record") {
                                    return Record.get(this.storage, childInfo.address, { lock })
                                    .then(valueRecord => {
                                        return valueRecord.getValue();
                                    });
                                }
                                else {
                                    return childInfo.value;
                                }
                            }
                            else {
                                return null;
                            }
                        })
                        .then(value => {
                            if (value !== null) {
                                // Add it to the index, using value as the index key, a record pointer as the value
                                // Create record pointer
                                let wildcards = [];
                                if (hasWildcards) {
                                    const match = wildcardRE.exec(child.address.path);
                                    wildcards = match.slice(1);
                                }
                                const recordPointer = _createRecordPointer(wildcards, child.key, child.address);
                                // Add it to the index
                                tree.add(value, recordPointer);
                            }
                        });
                        childPromises.push(p);
                    }
                    else {
                        const p = getAll(child.address.path, keyIndex+1);
                        childPromises.push(p);
                    }
                })
                .catch(reason => {
                    // Record doesn't exist? No biggy
                    console.warn(reason);
                })
                .then(() => {
                    return Promise.all(childPromises);
                });
            };
            
            let path = currentPath;
            while (keys[keyIndex] && keys[keyIndex] !== "*") {
                if (path.length > 0) { path += '/'; }
                path += keys[keyIndex];
                keyIndex++;
            }
            if (!lock) {
                return this.storage.lock(path, uuid62.v1(), false, `index.build "/${path}", "${this.key}"`)
                .then(l => {
                    lock = l;
                    return getChildren();
                });
            }
            else {
                return getChildren();
            }    
        };

        let indexLock;
        return this._lock(true, `index.build "/${path}", "${this.key}"`)
        .then(l => {
            indexLock = l;
            return getAll("", 0);
        })
        .then(() => {
            // All child objects have been indexed. save the index
            const binary = new Uint8Array(tree.toBinary());
            return new Promise((resolve, reject) => {
                fs.writeFile(this.fileName, Buffer.from(binary.buffer), (err) => {
                    if (err) {
                        debug.error(err);
                        reject(err);
                    }
                    else {
                        resolve();
                    }
                });
            });
        })
        .then(() => {
            lock.release(); // release the data lock
            indexLock.release(); // release index lock
            return this;    
        });
    }

    _getTree () {
        return new Promise((resolve, reject) => {
            fs.open(this.fileName, "r", (err, fd) => {
                if (err) {
                    return reject(err);
                }
                const reader = (index, length) => {
                    const binary = new Uint8Array(length);
                    const buffer = Buffer.from(binary.buffer);
                    return new Promise((resolve, reject) => {
                        fs.read(fd, buffer, 0, length, index, (err, bytesRead) => {
                            if (err) {
                                reject(err);
                            }
                            // Convert Uint8Array to byte array
                            let bytes = [];
                            bytes.push(...binary);
                            resolve(bytes);
                        });
                    });
                }
                const tree = new BinaryBPlusTree(reader, 512);
                resolve({ 
                    tree,
                    close: () => {
                        fs.close(fd, err => {
                            if (err) {
                                console.warn(`Could not close index file ${this.fileName}:`, err);
                            }
                        });
                    }
                });
            });
        });
    }
}

module.exports = { 
    DataIndex
};