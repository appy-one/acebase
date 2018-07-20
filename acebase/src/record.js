const { Storage } = require('./storage');
const { PathReference } = require('./path-reference');
const { DataReference } = require('./data-reference');
const { bytesToNumber, numberToBytes, concatTypedArrays, getPathKeys, getPathInfo, cloneObject } = require('./utils');
const { TextEncoder, TextDecoder } = require('text-encoding');
const uuid62 = require('uuid62');
const { BPlusTree, BinaryBPlusTree } = require('./data-index');
const debug = require('./debug');

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const VALUE_TYPES = {
    // Native types:
    OBJECT: 1,
    ARRAY: 2,
    NUMBER: 3,
    BOOLEAN: 4,
    STRING: 5,
    // Custom types:
    DATETIME: 6,
    //ID: 7
    BINARY: 8,
    REFERENCE: 9
};

const UNCHANGED = { unchanged: "this data did not change" };
const FLAG_WRITE_LOCK = 0x10;
const FLAG_READ_LOCK = 0x20;
const FLAG_KEY_TREE = 0x40;
const FLAG_VALUE_TYPE = 0xf;

class RecordAddress {
    constructor(path, pageNr = -1, recordNr = -1) {
        this.path = path.replace(/^\/|\/$/g, "");
        this.pageNr = pageNr;
        this.recordNr = recordNr;
    }
}

class RecordReference {
    /**
     * RecordReference constructor, are used to reference subrecords when their parent is being updated. 
     * This prevents rewriting whole trees when child data remained the same.
     * @param {number} valueType - One of the VALUE_TYPE constants
     * @param {RecordAddress} address - Address of the referenced record
     */
    constructor(valueType, address) {
        this.type = valueType;
        this.address = address;
    }
}

class RecordTransaction {

    constructor(path, callback) {
        this.path = path;
        this.callback = callback;
        //this.tid = "tx-" + path + "-" + uuid62.v1(); // Generate a transaction id
        this.tid = uuid62.v1(); // Generate a transaction id

        // Following should be set by client code
        this.record = null; 
        this.oldValue = null;
        this.newValue = undefined;
        this.result = null;
        this.dataMoved = false;

        let doneResolve, failReject;
        this.wait = () => {
            return new Promise((resolve, reject) => {
                doneResolve = resolve;
                failReject = reject;
            });
        };
        this.done = () => {
            const result = this.result || "success";
            debug.log(`transaction ${this.tid} on path "/${this.path}" ${result}`);
            doneResolve(result);
        };
        this.fail = (reason) => {
            debug.error(`transaction ${this.tid} on path "/${this.path}" FAILED`, reason);
            failReject(reason);
        }
    }
}

class RecordLock {
    /**
     * Constructor for a record lock
     * @param {Storage} storage 
     * @param {string} path 
     * @param {string} tid 
     * @param {boolean} forWriting 
     */
    constructor(storage, path, tid, forWriting) {
        this.tid = tid;
        this.path = path;
        this.forWriting = forWriting;
        this.state = RecordLock.LOCK_STATE.PENDING;
        this.storage = storage;
        this.requested = Date.now();
        this.granted = undefined;
        this.expires = undefined;
    }
    release(comment) {
        //return this.storage.unlock(this.path, this.tid, comment);
        return this.storage.unlock(this, comment);
    }
    static get LOCK_STATE() {
        return {
            PENDING: 'pending',
            LOCKED: 'locked',
            EXPIRED: 'expired',
            DONE: 'done'
        };
    };
}

class Record {
    /** Constructor for a Record object. For internal use only.
     * @param {Storage} storage - reference to the used storage engine
     * @param {Uint8Array|Buffer} data - the raw uncut byte data that is stored in the record
     * @param {RecordAddress} address - which page/recordNr/path the record resides
     */
    constructor(storage, address = null) {
        this.storage = storage;
        this.address = address;
        this.allocation = [];
        this.headerLength = -1;
        this.totalBytes = -1;
        this.fileIndex = -1;
        this.valueType = -1;
        this.hasKeyTree = false;
        this.startData = null;
    }

    // _indexChildren() {
    //     let children = this._children = [];
    //     Record.getChildStream(this.storage, this.address, { bytes: this.data, valueType: this.valueType })
    //     .next(child => {
    //         children.push(child);
    //     });
    // }

    static exists(storage, path, options = { lock: undefined }) {
        if (path === "") {
            // Root always exists
            return Promise.resolve(true);
        }

        // Refactored to use resolve, which now uses child streams
        return Record.resolve(storage, path, options)
        .then(address => {
            return !!address;
        });
    }

    /**
     * Reads all data from this record. Only do this when a stream won't do (eg if you need all data because the record contains a string)
     */
    getAllData(options = { lock: undefined }) {
        let allData = new Uint8Array(this.totalBytes);
        let index = 0;
        return this.getDataStream(options)
        .next(({ data }) => {
            allData.set(data, index);
            index += data.length;
        })
        .then(() => {
            return allData;
        });
    }

    /**
     * Gets the value stored in this record by parsing the binary data in this and any sub records
     * @param {options} - options: when omitted retrieves all nested data. If include is set to an array of keys it will only return those children. If exclude is set to an array of keys, those values will not be included
     * @returns {Promise<any>} - returns the stored object, array or string
     */
    getValue(options = { include: undefined, exclude: undefined, child_objects: true, lock: undefined }) {
        if (!options) { options = {}; }
        if (typeof options.include !== "undefined" && !(options.include instanceof Array)) {
            throw new TypeError(`options.include must be an array of key names`);
        }
        if (typeof options.exclude !== "undefined" && !(options.exclude instanceof Array)) {
            throw new TypeError(`options.exclude must be an array of key names`);
        }
        if (["undefined","boolean"].indexOf(typeof options.child_objects) < 0) {
            throw new TypeError(`options.child_objects must be a boolean`);
        }

        return new Promise((resolve, reject) => {
            switch (this.valueType) {
                case VALUE_TYPES.STRING: {
                    this.getAllData({ lock: options.lock })
                    .then(binary => {
                        let str = textDecoder.decode(binary.buffer);
                        resolve(str);
                    });
                    break;
                }
                case VALUE_TYPES.REFERENCE: {
                    this.getAllData({ lock: options.lock })
                    .then(binary => {
                        let path = textDecoder.decode(binary.buffer);
                        resolve(new PathReference(path));
                    });
                    break;
                }
                case VALUE_TYPES.BINARY: {
                    this.getAllData({ lock: options.lock })
                    .then(binary => {
                        resolve(binary.buffer);
                    });
                    break;
                }
                case VALUE_TYPES.ARRAY:
                case VALUE_TYPES.OBJECT: {
                    // We need ALL data, including from child sub records
                    const isArray = this.valueType === VALUE_TYPES.ARRAY;
                    const promises = [];
                    const obj = isArray ? [] : {};
                    const streamOptions = { lock: options.lock };
                    if (options.include && options.include.length > 0) {
                        const keyFilter = options.include.filter(key => key.indexOf('/') < 0);
                        if (keyFilter.length > 0) { 
                            streamOptions.keyFilter = keyFilter;
                        }
                    }
                    this.getChildStream(streamOptions) //Record.getChildStream(this.storage, this.address, { bytes: this.data, valueType: this.valueType })
                    .next((child, index) => {
                        if (options.child_objects === false && [VALUE_TYPES.OBJECT, VALUE_TYPES.ARRAY].indexOf(child.type) >= 0) {
                            // Options specify not to include any child objects
                            return;
                        }
                        if (options.include && options.include.length > 0 && options.include.indexOf(child.key) < 0) { 
                            // This particular child is not in the include list
                            return; 
                        }
                        if (options.exclude && options.exclude.length > 0 && options.exclude.indexOf(child.key) >= 0) {
                            // This particular child is on the exclude list
                            return; 
                        }
                        if (child.address) {
                            //let address = new RecordAddress(`${this.address.path}/${child.key}`, child.address.pageNr, child.address.recordNr);
                            let promise = Record.get(this.storage, child.address, { lock: options.lock }).then(record => {
                                // Get recursive on it
                                // Are there any relevant nested includes / excludes?
                                let childOptions = { lock: options.lock };
                                if (options.include) {
                                    const include = options.include
                                        .filter((path) => path.startsWith("*/") || path.startsWith(`${child.key}/`))
                                        .map(path => path.substr(path.indexOf('/') + 1));
                                    if (include.length > 0) { childOptions.include = include; }
                                }
                                if (options.exclude) {
                                    const exclude = options.exclude
                                        .filter((path) => path.startsWith("*/") || path.startsWith(`${child.key}/`))
                                        .map(path => path.substr(path.indexOf('/') + 1));

                                    if (exclude.length > 0) { childOptions.exclude = exclude; }
                                }
                                return record.getValue(childOptions).then(val => { //{ use_mapping: options.use_mapping }
                                    obj[isArray ? index : child.key] = val;
                                    return record;
                                });
                            });;
                            promises.push(promise);
                        }
                        else if (typeof child.value !== "undefined") {
                            obj[isArray ? index : child.key] = child.value;
                        }
                        else {
                            if (isArray) {
                                throw `Value for index ${index} has not been set yet, find out why. Path: ${this.address.path}`;
                            }
                            else {
                                throw `Value for key ${child.key} has not been set yet, find out why. Path: ${this.address.path}`;
                            }
                        }
                    })
                    .then(() => {
                        Promise.all(promises).then(() => {
                            resolve(obj);
                        });
                    });
                    break;
                }
                default: {
                    throw "Unsupported record value type";
                }
            }
        });
    }

    /**
     * Updates a record
     * @param {Object} updates - Object containing the desired changes to perform
     * @param {{ trackChanges?: boolean, transaction?: RecordTransaction, lock?: RecordLock }} options - Options
     * @returns {Promise<Record>} - Returns a promise that resolves with the updated record
     */
    update(updates, options = { trackChanges: true, transaction: undefined, lock: undefined }) {

        if (typeof updates !== "object") {
            throw new TypeError(`updates parameter must be an object`);
        }
        if (typeof options.trackChanges === "undefined") {
            options.trackChanges = true;
        }

        // // TODO: Refactor to use read and write streams for better scalability (records with 1000+ children)
        // if (!this._children) { this._indexChildren(); } // Make sure child data is indexed

        // // Create new object that combines current with new values
        // const combined = {};
        // const discardedRecords = [];
        // const updatedKeys = Object.keys(updates);
        // updatedKeys.forEach(key => {
        //     const child = this._children.find(c => c.key === key);
        //     if (child && child.address && !(updates[key] instanceof RecordReference)) {
        //         // Current child value resides in a separate record,
        //         // it's value is being changed, so we can free the old space
        //         discardedRecords.push(child.address);
        //     }
        //     if (updates[key] !== null) {
        //         // Only include if the child is not being removed by setting it to null
        //         combined[key] = updates[key];
        //     }
        // });
        // this._children.forEach(child => {
        //     if (updatedKeys.indexOf(child.key) < 0) {
        //         if (child.address) {
        //             combined[child.key] = new RecordReference(child.type, child.address);
        //         }
        //         else {
        //             combined[child.key] = child.value;
        //         }
        //     }
        // });

        const combined = {};
        const discardedRecords = [];
        const updatedKeys = Object.keys(updates);
        return this.getChildStream({ lock: options.lock })
        .next(child => {
            if (updatedKeys.indexOf(child.key) >= 0) {
                // Existing child is being updated, do not copy current value
                if (child.address && !(updates[child.key] instanceof RecordReference)) {
                    // Current child value resides in a separate record,
                    // it's value is being changed, so we can free the old space
                    discardedRecords.push(child.address);
                }
            }
            else if (child.address) {
                combined[child.key] = new RecordReference(child.type, child.address);
            }
            else {
                combined[child.key] = child.value;
            }
        })
        .then(() => {
            updatedKeys.forEach(key => {
                if (updates[key] !== null) {
                    combined[key] = updates[key];
                }
            });
        })
        .then(() => {
            const transactionPromises = [];
            const previous = {
                loaded: false,
                value: undefined
            };
            if (options.transaction instanceof RecordTransaction) {
                previous.loaded = true;
                previous.value = options.transaction.oldValue;
            }
            else if (options.trackChanges === true) {
                const p = this.getValue({ include: updatedKeys, lock: options.lock })
                    .then(current => { //{ include: updatedKeys, use_mapping: false }
                    Object.keys(combined).forEach(key => {
                        if (updatedKeys.indexOf(key) < 0 && typeof current[key] === "undefined") {
                            current[key] = UNCHANGED; // Mark as unchanged so change tracker in subscription functionality knows it
                        }
                    });
                    previous.loaded = true;
                    previous.value = current;
                    return current;
                });
                transactionPromises.push(p);
            }

            return Promise.all(transactionPromises).then(_ => {
                return Record.create(this.storage, this.address.path, combined, { lock: options.lock, allocation: this.allocation })
                .then(record => {
                    //debug.log(`Record "/${this.address.path}" updated`);
                    let addressChanged = record.address.pageNr !== this.address.pageNr || record.address.recordNr !== this.address.recordNr;

                    if (addressChanged && options.transaction instanceof RecordTransaction) {
                        options.transaction.dataMoved = true;
                    }

                    let parentUpdatePromise;
                    if (addressChanged && this.address.path.length > 0) {
                        // Update parent record, so it references this new record instead of the old one..
                        // Of course, skip if this is the root record that moved. (has no parent..)
                        // const i = this.address.path.lastIndexOf("/");
                        // const parentPath = i < 0 ? "" : this.address.path.slice(0, i); //this.address.path.replace(new RegExp(`/${this.key}$`), "");
                        // const key = i < 0 ? this.address.path : this.address.path.slice(i + 1);
                        const pathInfo = getPathInfo(this.address.path);
                        const tid = options.lock ? options.lock.tid : uuid62.v1();
                        // Lock the parent for reading and writing
                        parentUpdatePromise = this.storage.lock(pathInfo.parent, tid, true, `record.create:updateParent "/${pathInfo.parent}"`)
                        .then(parentLock => {
                            return Record.get(this.storage, { path: pathInfo.parent }, { lock: parentLock })
                            .then(parentRecord => {
                                return parentRecord.update(
                                    { [pathInfo.key]: new RecordReference(record.valueType, record.address) }, 
                                    { trackChanges: false, lock: parentLock }
                                );
                            })
                            .then(r => {
                                parentLock.release(`record.create:updateParent`);
                            });
                        });
                    }

                    return Promise.all([parentUpdatePromise])
                    .then(() => {
                        // Update this record with the new record data

                        // delete this._children;
                        // delete this._value;
                        //this.data = record.data; 
                        this.fileIndex = record.fileIndex;
                        this.headerLength = record.headerLength;
                        this.totalBytes = record.totalBytes;
                        this.startData = record.startData;
                        this.valueType = record.valueType;
                        this.address = record.address;
                        this.allocation = record.allocation;
                        this.hasKeyTree = record.hasKeyTree;
                        this.timestamp = record.timestamp;
                        
                        const discard = (record) => {
                            debug.log(`Releasing (OLD) record allocation for "/${record.address.path}"`);
                            this.storage.addressCache.invalidate(record.address);
                            this.storage.FST.release(record.allocation);
                            const promises = [];
                            return record.getChildStream({ lock: options.lock }) //return Record.getChildStream(this.storage, record.address)
                            .next(child => {
                                if (child.address) {
                                    let p = Record.get(this.storage, child.address, { lock: options.lock }).then(discard);
                                    promises.push(p);
                                }
                            })
                            .then(() => {
                                return Promise.all(promises);
                            });
                        }
                        const promises = [];
                        discardedRecords.forEach(address => {
                            const p = Record.get(this.storage, address, { lock: options.lock }).then(discard);
                            promises.push(p);
                        });

                        //this.storage.subscriptions.execute(this.address.path, "update", combined);
                        if (previous.loaded) {
                            // this.storage.emit("datachanged", {
                            //     type: "update",
                            //     path: this.address.path,
                            //     previous: previous.value
                            // });
                            this.storage.subscriptions.trigger("update", this.address.path, previous.value);
                        }

                        return Promise.all(promises).then(_ => this);
                    });
                });
            });

        });

    }
    
    /**
     * Creates a new record in the database with given data.
     * @param {Storage} storage - reference to Storage engine object
     * @param {string} path - path of the the record's address, eg users/ewout/posts/post1
     * @param {any} value  - value (object,array,string,ArrayBuffer) to store in the record
     * @param {{lock: RecordLock, allocation: Array<{ pageNr: number, recordNr: number, length: number }>}} options lock: previously achieved lock; allocation: previous record allocation to re-use (overwrite)
     * @returns {Promise<Record>} - Returns a promise that resolves with the created record
     */
    static create(storage, path, value, options = { lock: undefined, allocation: null }) {

        //if (typeof options.allocation === "undefined") {
            options.allocation = null;
        //}
        
        const re = /(^\/)|(\/$)/g;
        path = path.replace(re, "");

        debug.log(`About to save a(n) ${typeof value} to "/${path}"`);

        const _write = (type, bytes, ref, hasKeyTree) => {
            // First record has a CT (Chunk Table), all following records contain pure DATA only
            // 
            // record           := record_header, record_data
            // record_header    := record_info, value_type, chunk_table, last_record_len
            // record_info      := 4 bits = [0, FLAG_KEY_TREE, FLAG_READ_LOCK, FLAG_WRITE_LOCK]
            // value_type       := 4 bits number
            // chunk_table      := chunk_entry, [chunk_entry, [chunk_entry...]]
            // chunk_entry      := ct_entry_type, [ct_entry_data]
            // ct_entry_type    := 1 byte number, 
            //                      0 = end of table, no entry data
            //                      1 = number of contigious following records (if first range with multiple records, start is current record)
            //                      2 = following range (start address, nr of contigious following record)
            //
            // ct_entry_data    := ct_entry_type?
            //                      1: nr_records
            //                      2: start_page_nr, start_record_nr, nr_records
            //
            // nr_records       := 2 byte number, (actual nr - 1)
            // start_page_nr    := 4 byte number
            // start_record_nr  := 2 byte number
            // last_record_len  := 2 byte number
            // record_data      := value_type?
            //                      OBJECT: FLAG_TREE?
            //                          0: object_property, [object_property, [object_property...]]
            //                          1: object_tree
            //                      ARRAY: array_entry, [array_entry, [array_entry...]]
            //                      STRING: binary_data
            //                      BINARY: binary_data
            //
            // object_property  := key_info, child_info
            // object_tree      := bplus_tree_binary<key_index_or_name, child_info>
            // array_entry      := child_value_type, tiny_value, value_info, [value_data]
            // key_info         := key_indexed, key_index_or_name
            // key_indexed      := 1 bit
            // key_index_or_name:= key_indexed?
            //                      0: key_length, key_name
            //                      1: key_index
            //
            // key_length       := 7 bits (actual length - 1)
            // key_index        := 15 bits
            // key_name         := [key_length] byte string (ASCII)
            // child_info       := child_value_type, tiny_value, value_info, [value_data]
            // child_value_type := 4 bits number
            // tiny_value       := child_value_type?
            //                      BOOLEAN: [0000] or [0001]
            //                      NUMBER: [0000] to [1111] (positive number between 0 and 15)
            //                      (other): (empty string, object, array)
            //
            // value_info       := value_location, inline_length
            // value_location   := 2 bits,
            //                      [00] = DELETED (not implemented yet)
            //                      [01] = TINY
            //                      [10] = INLINE
            //                      [11] = RECORD
            //
            // inline_length    := 6 bits number (actual length - 1)
            // value_data       := value_location?
            //                      INLINE: [inline_length] byte value
            //                      RECORD: value_page_nr, value_record_nr
            //
            // value_page_nr    := 4 byte number
            // value_record_nr  := 2 byte number
            //

            const bytesPerRecord = storage.settings.recordSize;
            //let headerBytes = 7; // Minimum length: 1 byte record_info and value_type, 4 byte CT (1 byte for entry_type 1, 2 bytes for length, 1 byte for entry_type 0 (end)), 2 bytes last_chunk_length
            let headerBytes = 4; // Minimum length: 1 byte record_info and value_type, 1 byte CT (1 byte for entry_type 0), 2 bytes last_chunk_length
            let totalBytes = (bytes.length + headerBytes);
            let requiredRecords = Math.ceil(totalBytes / bytesPerRecord);
            let lastChunkSize = bytes.length; //totalBytes % bytesPerRecord;

            if (requiredRecords > 1) {
                // In the worst case scenario, we get fragmented record space for each required record.
                // Calculate with this scenario. If we claim a record too many, we'll free it again when done
                headerBytes += 3; // Add 2 bytes for ct_entry_type:1 of first record (instead of ct_entry_type:0) and 1 byte for ending ct_entry_type: 0
                //let additionalHeaderBytes = (requiredRecords-1) * 9;   // Add 9 bytes for each ct_entry_type:2 of additional records
                let wholePages = Math.floor(requiredRecords / storage.settings.pageSize);
                let maxAdditionalRanges = Math.max(0, wholePages-1) + Math.min(3, requiredRecords-1);
                let additionalHeaderBytes = maxAdditionalRanges * 9;   // Add 9 bytes for each ct_entry_type:2 of additional ranges
                totalBytes = (bytes.length + headerBytes + additionalHeaderBytes);
                requiredRecords = Math.ceil(totalBytes / bytesPerRecord);
                lastChunkSize = totalBytes % bytesPerRecord;
            }

            const rangesFromAllocation = (allocation) => {
                let range = { 
                    pageNr: allocation[0].pageNr, 
                    recordNr: allocation[0].recordNr, 
                    length: 1 
                };
                let ranges = [range];
                for(let i = 1; i < allocation.length; i++) {
                    if (allocation[i].pageNr !== range.pageNr || allocation[i].recordNr !== range.recordNr + range.length) {
                        range = { pageNr: allocation[i].pageNr, recordNr: allocation[i].recordNr, length: 1 };
                        ranges.push(range);
                    }
                    else {
                        range.length++;
                    }
                }
                return ranges;
            };
            const allocationFromRanges = (ranges) => {
                let allocation = [];
                ranges.forEach(range => {
                    for (let i = 0; i < range.length; i++) {
                        allocation.push({ pageNr: range.pageNr, recordNr: range.recordNr + i });
                    }
                });
                return allocation;       
            };

            // Request storage space for these records
            let deallocateRanges;
            let allocationPromise;
            let allocation = options.allocation === null ? null : allocationFromRanges(options.allocation);
            if (allocation !== null && allocation.length >= requiredRecords) {
                // Overwrite existing allocation
                let freed = allocation.slice(requiredRecords);
                allocation = allocation.slice(0, requiredRecords);
                if (freed.length > 0) {
                    debug.log(`Record "/${path}" reduced in size, releasing ${freed.length} addresses`);
                    //storage.FST.release(freed);
                    deallocateRanges = rangesFromAllocation(freed);
                }
                let ranges = rangesFromAllocation(allocation);
                allocationPromise = Promise.resolve({
                    ranges,
                    allocation
                });
            }
            else {
                if (allocation !== null) {
                    // More records are required to store data, free old addresses
                    debug.log(`Record "/${path}" grew in size, releasing its current ${allocation.length} allocated addresses`);
                    // let ranges = rangesFromAllocation(allocation);
                    // storage.FST.release(ranges);
                    deallocateRanges = rangesFromAllocation(allocation);
                }
                // allocation = storage.FST.getFreeAddresses(requiredRecords);
                // debug.log(`Allocated ${allocation.length} new addresses for "/${path}"`);
                allocationPromise = storage.FST.allocate(requiredRecords).then(ranges => {
                    let allocation = allocationFromRanges(ranges);
                    debug.log(`Allocated ${allocation.length} addresses for "/${path}"`);
                    return {
                        ranges,
                        allocation
                    };
                });
            }

            function addChunkTableTypesToRanges(ranges) {
                if (requiredRecords === 1) {
                    ranges[0].type = 0;  // No CT (Chunk Table)
                }
                else {
                    ranges.forEach((range,index) => {
                        if (index === 0) {
                            range.type = 1;     // 1st range CT record
                        }
                        else {
                            range.type = 2;     // CT record with pageNr, recordNr, length
                        }
                    });
                }
                return ranges;
            }

            return allocationPromise.then(result => {
                let { ranges, allocation } = result;
                addChunkTableTypesToRanges(ranges);

                // Calculate final amount of bytes and records needed
                headerBytes += (ranges.length - 1) * 9; // Add 9 header bytes for each additional range
                totalBytes = (bytes.length + headerBytes);
                requiredRecords = Math.ceil(totalBytes / bytesPerRecord);
                lastChunkSize = requiredRecords === 1 ? bytes.length : totalBytes % bytesPerRecord;

                if (requiredRecords < allocation.length) {
                    //debug.warn(`NOT IMPLEMENTED YET: Too many records were allocated to store record. We should free those!`)
                    const unallocate = allocation.splice(requiredRecords);
                    debug.log(`Requested ${unallocate.length} too many addresses to store "/${path}", releasing them`);
                    //storage.FST.release(rangesFromAllocation(unallocate));
                    if (!deallocateRanges) { deallocateRanges = []; }
                    deallocateRanges.push(...rangesFromAllocation(unallocate));
                    // let remove = unallocate.length;
                    // while (remove > 0) {
                    //     let lastRange = ranges[ranges.length - 1];
                    //     lastRange.length -= remove;
                    //     if (lastRange.length <= 0) {
                    //         ranges.pop(); // Remove it
                    //         remove = Math.abs(lastRange.length);
                    //     }
                    //     else {
                    //         remove = 0;
                    //     }
                    // }
                    ranges = rangesFromAllocation(allocation);
                    addChunkTableTypesToRanges(ranges);
                }

                // Build the binary header data
                //let headerRecords = Math.ceil(headerBytes / bytesPerRecord);
                let header = new Uint8Array(headerBytes); //new Uint8Array(headerRecords * bytesPerRecord);
                let headerView = new DataView(header.buffer, 0, header.length);
                header.fill(0);     // Set all zeroes
                header[0] = type; // value_type
                if (hasKeyTree) {
                    header[0] |= FLAG_KEY_TREE;
                }

                // Add chunk table
                let offset = 1;
                ranges.forEach(range => {
                    headerView.setUint8(offset, range.type);
                    if (range.type === 0) {
                        return; // No additional CT data
                    }
                    else if (range.type === 1) {
                        headerView.setUint16(offset + 1, range.length);
                        offset += 3;
                    }
                    else if (range.type === 2) {
                        headerView.setUint32(offset + 1, range.pageNr);
                        headerView.setUint16(offset + 5, range.recordNr);
                        headerView.setUint16(offset + 7, range.length);
                        offset += 9;
                    }
                    else {
                        throw "Unsupported range type";
                    }
                });
                headerView.setUint8(offset, 0);             // ct_type 0 (end of CT), 1 byte
                offset++;
                headerView.setUint16(offset, lastChunkSize);  // last_chunk_size, 2 bytes
                offset += 2;

                // Create and write all chunks
                const writes = [];
                let copyOffset = 0;
                ranges.forEach((range, r) => {
                    const chunk = {
                        data: new Uint8Array(range.length * bytesPerRecord),
                        get length() { return this.data.length; }
                    };
                    chunk.data.fill(0);
                    if (r === 0) {
                        chunk.data.set(header, 0); // Copy header data into first chunk
                        const view = new Uint8Array(bytes.buffer, 0, Math.min(bytes.length, chunk.length - header.length));
                        chunk.data.set(view, header.length); // Copy first chunk of data into range
                        copyOffset += view.length;
                    }
                    else {
                        // Copy chunk data from source data
                        const view = new Uint8Array(bytes.buffer, copyOffset, Math.min(bytes.length - copyOffset, chunk.length));
                        chunk.data.set(view, 0);
                        copyOffset += chunk.length;
                    }
                    const fileIndex = storage.getRecordFileIndex(range.pageNr, range.recordNr);
                    const promise = storage.writeData(fileIndex, chunk.data);
                    writes.push(promise);
                });

                return Promise.all(writes)
                .then((results) => {
                    const bytesWritten = results.reduce((a,b) => a + b, 0);
                    const chunks = results.length;
                    const address = new RecordAddress(path, allocation[0].pageNr, allocation[0].recordNr);
                    // if (bytesWritten > 128) {
                    //     console.log(`More than 1 record`);
                    // }
                    debug.log(`Record "/${address.path}" saved at address ${address.pageNr}, ${address.recordNr}; ${bytesWritten} bytes written in ${chunks} chunk(s)`);
                    const record = new Record(storage, address);
                    //let keepDataLength = Math.ceil(header.length / storage.settings.recordSize) * storage.settings.recordSize;
                    record.startData =  bytes; //bytes.slice(0, keepDataLength); // Keep header data 
                    record.allocation = ranges; 
                    record.valueType = type;
                    record.hasKeyTree = hasKeyTree;
                    record.totalBytes = totalBytes;
                    record.headerLength = headerBytes;
                    record.fileIndex = storage.getRecordFileIndex(address.pageNr, address.recordNr);
                    record.timestamp = Date.now();

                    storage.addressCache.update(address);

                    if (deallocateRanges) {
                        console.log(`Releasing ${deallocateRanges.length} old ranges of "/${address.path}"`);
                        storage.FST.release(rangesFromAllocation(deallocateRanges));
                    }

                    return record;
                });
            });
        };

        // read/write lock the record
        //const tid = options.lock ? options.lock.tid : "create-" + path + "-" + uuid62.v1();
        //const tid = "create-" + path + "-" + (options.lock ? /[a-z0-9]+$/i.exec(options.lock.tid) : uuid62.v1());
        const tid = options.lock ? options.lock.tid : uuid62.v1();
        let lock;
        return storage.lock(path, tid, true, `Record.create "/${path}"`) 
        .then(l => {
            lock = l;
            if (typeof value === "string") {
                const encoded = textEncoder.encode(value);
                return _write(VALUE_TYPES.STRING, encoded, value, false);
            }
            else if (value instanceof PathReference || value instanceof DataReference) {
                const encoded = textEncoder.encode(value.path);
                return _write(VALUE_TYPES.REFERENCE, encoded, value, false);
            }
            else if (value instanceof ArrayBuffer) {
                return _write(VALUE_TYPES.BINARY, new Uint8Array(value), value, false);
            }
            else if (typeof value !== "object") {
                throw `Unsupported type to store in stand-alone record`;
            }

            const serialize = (path, val) => {
                // if (val instanceof ID) {
                //     let bytes = val.getBytes(); // 16 of 'em
                //     return { type: VALUE_TYPES.ID, bytes };
                // }
                // else 
                if (val instanceof Date) {
                    // Store as 64-bit (8 byte) signed integer. 
                    // NOTE: 53 bits seem to the max for the Date constructor in Chrome browser, 
                    // although higher dates can be constructed using specific year,month,day etc
                    // NOTE: Javascript Numbers seem to have a max "safe" value of (2^53)-1 (Number.MAX_SAFE_INTEGER),
                    // this is because the other 12 bits are used for sign (1 bit) and exponent.
                    // See https://stackoverflow.com/questions/9939760/how-do-i-convert-an-integer-to-binary-in-javascript
                    const ms = val.getTime();
                    const bytes = numberToBytes(ms);
                    return { type: VALUE_TYPES.DATETIME, bytes };
                }
                else if (val instanceof Array) {
                    // Create separate record for the array
                    if (val.length === 0) {
                        return { type: VALUE_TYPES.ARRAY, bytes: [] };
                    }
                    const promise = Record.create(storage, path, val, { lock }).then(record => {
                        return { type: VALUE_TYPES.ARRAY, record };
                    });
                    return promise;
                }
                else if (val instanceof RecordReference) {
                    // Used internally, happens to existing external record data that is not being changed.
                    const record = new Record(storage, val.address);
                    return { type: val.type, record};
                }
                else if (val instanceof ArrayBuffer) {
                    if (val.byteLength > storage.settings.maxInlineValueSize) {
                        const promise = Record.create(storage, path, val, { lock }).then(record => {
                            return { type: VALUE_TYPES.BINARY, record };
                        });
                        return promise;                    
                    }
                    else {
                        return { type: VALUE_TYPES.BINARY, bytes: val };
                    }
                }
                else if (typeof val === "object") {
                    // Create seperate record for this object
                    const promise = Record.create(storage, path, val, { lock }).then(record => {
                        return { type: VALUE_TYPES.OBJECT, record };
                    });
                    return promise;
                }
                else if (typeof val === "number") {
                    const bytes = numberToBytes(val);
                    return { type: VALUE_TYPES.NUMBER, bytes };
                }
                else if (typeof val === "boolean") {
                    return { type: VALUE_TYPES.BOOLEAN, bool: val };
                }
                else {
                    // This is a string, or reference, or something we don't know how to serialize
                    let type = VALUE_TYPES.STRING;
                    if (val instanceof PathReference || val instanceof DataReference) {
                        type = VALUE_TYPES.REFERENCE;
                        val = val.path;
                    }
                    else if (typeof val !== "string") {
                        // Not a string, convert to one
                        val = val.toString();
                    }
                    // Idea for later: Use string interning to store identical string values only once, 
                    // using ref count to decide when to remove
                    const encoded = textEncoder.encode(val);
                    if (encoded.length > storage.settings.maxInlineValueSize) {
                        // Create seperate record for this string value
                        const promise = Record.create(storage, path, val, { lock }).then(record => {
                            return { type, record };
                        });
                        return promise;
                    }
                    else {
                        // Small enough to store inline
                        return { type, binary: encoded };
                    }
                }
            };

            // Store array or object
            let childPromises = [];
            let serialized = [];
            let isArray = value instanceof Array;
            
            if (isArray) {
                // Store array
                value.forEach((val, index) => {
                    if (typeof val === "undefined" || val === null || typeof val === "function") {
                        throw `Array at index ${index} has invalid value. Cannot store null, undefined or functions`;
                    }
                    const childPath = `${path}[${index}]`;
                    let s = serialize(childPath, val);
                    const combine = (s) => {
                        s.index = index;
                        s.ref = val;
                        serialized.push(s);
                    }
                    if (s instanceof Promise) {
                        s = s.then(combine);
                        childPromises.push(s);
                    }
                    else {
                        combine(s);
                    }
                });
            }
            else {
                // Store object

                // Create property tree
                Object.keys(value).forEach(key => {
                    const childPath = `${path}/${key}`;
                    let val = value[key];
                    if (typeof val === "function" || val === null) {
                        return; // Skip functions and null values
                    }
                    else if (typeof val === "undefined") {
                        if (storage.settings.removeVoidProperties === true) {
                            delete value[key]; // Kill the property in the passed object as well, to prevent differences in stored and working values
                            return;
                        }
                        else {
                            throw `Property ${key} has invalid value. Cannot store null or undefined values. Set removeVoidProperties option to true to automatically remove void properties`;
                        }
                    }
                    else {
                        let s = serialize(childPath, val);
                        const combine = (s) => {
                            s.key = key;
                            s.ref = val;
                            serialized.push(s);
                        }
                        if (s instanceof Promise) {
                            s = s.then(combine);
                            childPromises.push(s);
                        }
                        else {
                            combine(s);
                        }
                    }
                });
            }

            const getBinaryValue = (kvp) => {
                // value_type:
                let bytes = [];
                let index = 0;
                bytes[index] = kvp.type << 4;
                // tiny_value?:
                let tinyValue = -1;
                if (kvp.type === VALUE_TYPES.BOOLEAN) { tinyValue = kvp.bool ? 1 : 0; }
                else if (kvp.type === VALUE_TYPES.NUMBER && kvp.ref >= 0 && kvp.ref <= 15 && Math.floor(kvp.ref) === kvp.ref) { tinyValue = kvp.ref; }
                else if (kvp.type === VALUE_TYPES.STRING && kvp.binary && kvp.binary.length === 0) { tinyValue = 0; }
                else if (kvp.type === VALUE_TYPES.ARRAY && kvp.ref.length === 0) { tinyValue = 0; }
                else if (kvp.type === VALUE_TYPES.OBJECT && Object.keys(kvp.ref).length === 0) { tinyValue = 0; }
                if (tinyValue >= 0) {
                    // Tiny value
                    bytes[index] |= tinyValue;
                    bytes.push(64); // 01000000 --> tiny value
                    // The end
                }
                else if (kvp.record) {
                    // External record
                    //recordsToWrite.push(kvp.record);
                    index = bytes.length;
                    bytes[index] = 192; // 11000000 --> record value
                    let address = kvp.record.address;
                    
                    // Set the 6 byte record address (page_nr,record_nr)
                    let bin = new Uint8Array(6);
                    let view = new DataView(bin.buffer);
                    view.setUint32(0, address.pageNr);
                    view.setUint16(4, address.recordNr);
                    bytes.push(...bin);
                    
                    // End
                }
                else {
                    // Inline value
                    let data = kvp.bytes || kvp.binary;
                    index = bytes.length;
                    bytes[index] = 128; // 10000000 --> inline value
                    bytes[index] |= data.length - 1; // inline_length
                    bytes.push(...data);
                    // End
                }
                return bytes;
            };

            return Promise.all(childPromises).then(() => {
                // Append all serialized data into 1 binary array
                let data, keyTree;
                if (true && serialized.length > 5) { // 5 for quick testing... should be 50 or so 
                    // Create a B+tree
                    keyTree = new BPlusTree(4, true); // 4 for quick testing, should be 10 or so
                    serialized.forEach(kvp => {
                        let binaryValue = getBinaryValue(kvp);
                        keyTree.add(kvp.key, binaryValue); // TODO: replace kvp.key with same keyIndex'ing strategy as usual
                    });
                    let bytes = keyTree.toBinary();
                    data = new Uint8Array(bytes);
                }
                else {
                    data = serialized.reduce((binary, kvp) => {
                        // For binary key/value layout, see _write function
                        let bytes = [];
                        if (!isArray) {
                            if (kvp.key.length > 128) { throw `Key ${kvp.key} is too long to store. Max length=128`; }
                            let keyIndex = storage.KIT.getOrAdd(kvp.key); // Gets an caching index for this key

                            // key_info:
                            if (keyIndex >= 0) {
                                // Cached key name
                                bytes[0] = 128;                       // key_indexed = 1
                                bytes[0] |= (keyIndex >> 8) & 127;    // key_nr (first 7 bits)
                                bytes[1] = keyIndex & 255;            // key_nr (last 8 bits)
                            }
                            else {
                                // Inline key name
                                bytes[0] = kvp.key.length - 1;        // key_length
                                // key_name:
                                for (let i = 0; i < kvp.key.length; i++) {
                                    let charCode = kvp.key.charCodeAt(i);
                                    if (charCode > 255) { throw `Invalid character in key ${kvp.key} at char ${i+1}`; }
                                    bytes.push(charCode);
                                }
                            }
                        }
                        const binaryValue = getBinaryValue(kvp);
                        bytes.push(...binaryValue);
                        return concatTypedArrays(binary, new Uint8Array(bytes));
                    }, new Uint8Array());
                }

                // Now write the record
                return _write(isArray ? VALUE_TYPES.ARRAY : VALUE_TYPES.OBJECT, data, serialized, !!keyTree);
            });
        })
        .then(record => {
            //if (!options.lock) {
            // The lock was requested by us, release it
            lock.release(`Record.create`);
            //}
            return record;
        });        
    }
    
    /**
     * Retrieves information about a specific child by key name or index
     * @param {string|number} key key name or index number
     * @param {{ lock?: RecordLock }} options a previously achieved lock can be passed in the lock property
     * @returns {Promise<{ exists: boolean, key?: string, index?: number, storageType: string, address?: RecordAddress, value?: any, valueType: number }>} returns a Promise that resolves with the child record or null if it the child did not exist
     */
    getChildInfo(key, options = { lock: undefined }) {
        let child = null;
        return this.getChildStream({ keyFilter: [key], lock: options.lock })
        .next(c => {
            child = c;
        })
        .then(() => {
            if (child) {
                return {
                    exists: true,
                    key: child.key,
                    index: child.index,
                    storageType: child.address ? "record" : "value",
                    address: child.address,
                    value: child.value,
                    valueType: child.type 
                };
            }
            return {
                exists: false,
                storageType: "none",
                valueType: -1
            };
        });
    }

    // hasChild(key, options = { lock: undefined }) {
    //     return this.getChildInfo(key, options).then(info => info.exists);
    // }

    // /**
    //  * Retrieves a child record by key name or index
    //  * @param {string|number} key | key name or index number
    //  * @returns {Promise<Record>} | returns a Promise that resolves with the child record or null if it the child did not exist
    //  */
    // getChildRecord(key) {
    //     if (typeof key !== "number" && (typeof key !== "string" || key.length === 0)) {
    //         throw `Key must be a string or an index number`;
    //     }

    //     let child = null;
    //     return this.getChildStream([key])
    //     .next(c => {
    //         child = c;
    //         return false;
    //     })
    //     .then(() => {
    //         if (child) {
    //             if (!child.address) {
    //                 throw `Child ${key} does not reference a record address`;
    //             }
    //             return Record.get(this.storage, child.address);
    //         }
    //         else {
    //             return null;
    //         }
    //     });

    //     // if (!this._children) { this._indexChildren(); }
    //     // let index = typeof key === "number" ? key : this._children.findIndex(c => c.key === key);
    //     // if (index < 0) {
    //     //     return Promise.resolve(null);
    //     // }
    //     // let child = this._children[index];
    //     // if (!child.address) {
    //     //     throw `Child ${key} does not reference a record address`;
    //     // }
    //     // return Record.get(this.storage, child.address);
    // }

    // getChildValue(key) {
    //     if (typeof key !== "number" && (typeof key !== "string" || key.length === 0)) {
    //         throw `Key must be a string or an index number`;
    //     }

    //     let child = null;
    //     return this.getChildStream([key])
    //     .next(c => {
    //         child = c;
    //         return false;
    //     })
    //     .then(() => {
    //         if (child) {
    //             if (child.address) {
    //                 throw `Child ${key} references a record address`;
    //             }
    //             return child.value;
    //         }
    //         else {
    //             return null;
    //         }
    //     });
    //     // if (!this._children) { this._indexChildren(); }
    //     // let index = typeof key === "number" ? key : this._children.findIndex(c => c.key === key);
    //     // if (index < 0) {
    //     //     return null;
    //     // }
    //     // let child = this._children[index];
    //     // if (child.address) {
    //     //     throw `Child ${key} references a record address`;
    //     // }
    //     // return child.value;    
    // }

    // getChildStorageType(key) {
    //     if (typeof key !== "number" && (typeof key !== "string" || key.length === 0)) {
    //         throw `Key must be a string or an index number`;
    //     }
    //     if (!this._children) { this._indexChildren(); }
    //     let index = typeof key === "number" ? key : this._children.findIndex(c => c.key === key);
    //     if (index < 0 || index >= this._children.length) {
    //         return null;
    //     }
    //     let child = this._children[index];
    //     if (child.address) {
    //         return "record";
    //     }
    //     else {
    //         return "value";
    //     }
    // }

    // hasChild(key) {
    //     if (!this._children) { this._indexChildren(); }
    //     let index = typeof key === "number" ? key : this._children.findIndex(c => c.key === key);
    //     if (index < 0 || index >= this._children.length) {
    //         return false;
    //     }
    //     return true;
    // }

    // children() {
    //     if (!this._children) { this._indexChildren(); }
    //     const children = [];
    //     this._children.forEach(child => {
    //         children.push({ key: child.key, valueType: child.type, storageType: child.address ? "record" : "value" });
    //     })
    //     return children;
    // }

    // childStream() {
    //     // TODO: refactor this to fetch record data itself, based upon need
    //     // Maybe move to Record.getChildStream()
    //     if (!this._children) { this._indexChildren(); } 
    //     let i = 0;
    //     const nextChild = () => {
    //         const child = this._children[i];
    //         if (!child) { return; }
    //         i++;
    //         return { key: child.key, valueType: child.type, storageType: child.address ? "record" : "value" };
    //     };
    //     const generator = {
    //         next(callback) {
    //             let done;
    //             let promise = new Promise(resolve => done = resolve);
    //             let generate = () => {
    //                 const child = nextChild(); // This will become async later
    //                 const proceed = child ? callback(child) : false;
    //                 if (proceed === false) {
    //                     done();
    //                 }
    //                 else {
    //                     setImmediate(generate); // Prevent stacking
    //                 }
    //             };
    //             generate();
    //             return promise;
    //         }
    //     }
    //     return generator;
    // }

    static update(storage, path, updates, options = { lock: undefined }) {
        const tid = options.lock ? options.lock.tid : uuid62.v1();
        let lock;
        return storage.lock(path, tid, true, `Record.update "/${path}"`)
        .then(l => {
            lock = l;
            return Record.get(storage, { path }, { lock });
        })
        .then(record => {
            if (!record) {
                const pathInfo = getPathInfo(path);
                return Record.update(storage, pathInfo.parent, { [pathInfo.key]: updates }, { lock });
            }
            else {
                return record.update(updates, { lock });
            }
        })
        .then(r => {
            lock.release(`Record.update, done`);
        });
    }

    static transaction(storage, path, callback) {
        const pathInfo = getPathInfo(path);

        if (pathInfo.parent === null) {
            throw new Error(`Can't perform transaction on root record`);
        }

        const transaction = new RecordTransaction(pathInfo.parent, callback);
        const state = {
            lock: undefined,
            parentLock: undefined,
            record: undefined,
            parentRecord: undefined
        };

        storage.lock(pathInfo.parent, transaction.tid, true, `Record.transaction "/${pathInfo.parent}"`)
        .then(lock => {
            state.parentLock = lock;
            return Record.get(storage, { path: lock.path }, { lock });
        })
        .then(parentRecord => {
            if (!parentRecord) {
                return null; //console.log(`Problem`);
            }
            // Get currentValue
            state.parentRecord = parentRecord;
            return parentRecord.getChildInfo(pathInfo.key)
            .then(child => {
                if (!child.exists) {
                    return null;
                }
                else if (child.storageType === "record") {
                    // Child is stored in its own record
                    //delete state.parentRecord;
                    transaction.path = child.address.path;
                    return storage.lock(child.address.path, transaction.tid, true, `Record.transaction:childRecord "/${child.address.path}"`)
                    .then(lock => {
                        state.lock = lock;
                        return Record.get(storage, child.address, { lock })
                        .then(record => {
                            state.record = record;
                            return record.getValue({ lock });
                        });
                    });
                }
                else {
                    // Child is a simple value stored within parent record
                    return child.value;
                }
            })
        })
        .then(currentValue => {
            transaction.oldValue = cloneObject(currentValue); // Clone or it'll be altered by the callback
            let newValue = callback(currentValue);
            if (newValue instanceof Promise) {
                return newValue.then(newValue => {
                    return newValue;
                });
            }
            return newValue;
        })
        .then(newValue => {
            if (typeof newValue === "undefined") {
                transaction.result = "canceled";
                return; //record;
            }
            else if (newValue !== null) {
                // Mark any keys that are not present in the new value as deleted
                Object.keys(transaction.oldValue).forEach(key => {
                    if (typeof newValue[key] === "undefined") {
                        newValue[key] = null;
                    }
                });
            }
            transaction.newValue = newValue;
            if (state.record) {
                return state.record.update(newValue, { transaction, lock: state.lock });
            }
            else if (state.parentRecord) {
                return state.parentRecord.update( { [pathInfo.key]: newValue }, { transaction, lock: state.parentLock });
            }
            else {
                //return Record.create(storage, path, newValue, { lock: state.parentLock });
                // parent doesn't exist, forward to parent's parent
                let parentPathInfo = getPathInfo(pathInfo.parent);
                return Record.update(storage, parentPathInfo.parent, { [parentPathInfo.key]: { [pathInfo.key]: newValue }}, { lock: state.parentLock } );
            }
        })
        .then(() => {
            state.parentLock.release();
            state.lock && state.lock.release();
            transaction.done();
        });

        return transaction.wait();
    }

    /**
     * 
     * @param {Storage} storage 
     * @param {RecordAddress} address 
     */
    static getDataStream(storage, address, options = { lock: undefined }) { // , options
        const maxRecordsPerChunk = 200; // 200: about 25KB of data when using 128 byte records
        let resolve, reject;
        let callback;
        const generator = {
            /**
             * @param {(result: {data: Uint8Array, valueType: number, chunks: { pageNr: number, recordNr: number, length: number }[], chunkIndex: number, totalBytes: number, hasKeyTree: boolean }) => boolean} cb callback function that is called with each chunk read. Reading will stop immediately when false is returned
             * @returns {Promise<{ valueType: number, chunks: { pageNr: number, recordNr: number, length: number }[]}>} returns a promise that resolves when all data is read
             */
            next(cb) { 
                callback = cb; 
                const promise = new Promise((rs, rj) => { resolve = rs; reject = rj; }); 
                work(); //setImmediate(work);
                return promise;
            }
        };

        const work = () => {
            if (typeof address.path === "string" 
                && typeof address.pageNr === "undefined" 
                && typeof address.recordNr === "undefined"
            ) {
                // Resolve pageNr and recordNr first
                Record.resolve(storage, address.path, { lock: options.lock })
                .then(addr => {
                    if (!addr) { 
                        // No address found for path, so it doesn't exist
                        return reject("Record does not exist"); //resolve({ valueType: -1, chunks: null }); 
                    }
                    address.pageNr = addr.pageNr;
                    address.recordNr = addr.recordNr;
                    work(); // Do it again
                });
                return;
            }

            const fileIndex = storage.getRecordFileIndex(address.pageNr, address.recordNr);

            //const tid = options.lock ? options.lock.tid : "read-datastream-" + address.path + "-" + uuid62.v1();
            //const tid = "read-datastream-" + address.path + "-" + (options.lock ? /[a-z0-9]+$/i.exec(options.lock.tid) : uuid62.v1());
            const tid = options.lock ? options.lock.tid : uuid62.v1();
            storage.lock(address.path, tid, false, `getDataStream "/${address.path}"`) // Write-lock the record while streaming
            .then(lock => {
                //const lock = "TODO!! Read lock should be achieved, other code might write to this record in between chunk reads!";
                // Read the first record which includes headers
                let data = new Uint8Array(storage.settings.recordSize);
                return storage.readData(fileIndex, data)
                .then(bytesRead => {
                    // Read header
                    //const isLocked = data[0] & FLAG_WRITE_LOCK; // 0001 0000
                    //console.log(`Got first data chunk of "/${address.path}"`);
                    const hasKeyTree = (data[0] & FLAG_KEY_TREE) === FLAG_KEY_TREE;
                    const valueType = data[0] & FLAG_VALUE_TYPE; // Last 4-bits of first byte of read data has value type

                    if (valueType === 0) {
                        throw new Error("Corrupt record data!");
                    }
                    
                    const view = new DataView(data.buffer);
                    // Read Chunk Table
                    // TODO: If the CT is too big for 1 record, it needs to read more records or it will crash... 
                    // UPDATE: the max amount of chunks === nr of whole pages needed + 3, so this will (probably) never happen
                    let chunkTable = [];
                    let offset = 1;
                    while (true) {
                        const type = view.getUint8(offset);
                        const chunk = {
                            type,
                            pageNr: address.pageNr,
                            recordNr: address.recordNr,
                            length: 1
                        };

                        if (type === 0) {
                            // No more chunks, exit
                            offset++;
                            break;
                        }
                        else if (type === 1) {
                            // First chunk is longer than the 1 record already read
                            chunk.recordNr++;
                            chunk.length = view.getUint16(offset + 1) - 1;
                            offset += 3;
                        }
                        else if (type === 2) {
                            // Next chunk is location somewhere else (not contigious)
                            chunk.pageNr = view.getUint32(offset + 1);
                            chunk.recordNr = view.getUint16(offset + 5);
                            chunk.length = view.getUint16(offset + 7);
                            offset += 9;
                        }
                        chunkTable.push(chunk);
                    }
                    const lastRecordSize = view.getUint16(offset);
                    offset += 2;
                    const headerLength = offset;

                    const chunks = [{
                        pageNr: address.pageNr,
                        recordNr: address.recordNr,
                        length: 1
                    }];

                    // Loop through chunkTable entries, add them to chunks array
                    const firstChunkLength = chunkTable.length === 0 ? lastRecordSize : data.length - headerLength;
                    let totalBytes = firstChunkLength;
                    chunkTable.forEach((entry, i) => {
                        let chunk = {
                            pageNr: entry.pageNr,
                            recordNr: entry.recordNr,
                            length: entry.length
                        }
                        let chunkLength = (chunk.length * storage.settings.recordSize);
                        if (i === chunkTable.length-1) { 
                            chunkLength -= storage.settings.recordSize;
                            chunkLength += lastRecordSize;
                        }
                        totalBytes += chunkLength;
                        while (chunk.length > maxRecordsPerChunk) {
                            let remaining = chunk.length - maxRecordsPerChunk;
                            chunk.length = maxRecordsPerChunk;
                            chunks.push(chunk);
                            chunk = {
                                pageNr: chunk.pageNr,
                                record: chunk.recordNr + maxRecordsPerChunk,
                                length: remaining
                            };
                        }
                        chunks.push(chunk);
                    });

                    // Run callback with the first chunk (and possibly the only chunk) already read
                    const firstChunkData = new Uint8Array(data.buffer, headerLength, firstChunkLength);
                    let proceed = callback({ data: firstChunkData, valueType, chunks, chunkIndex: 0, totalBytes, hasKeyTree, fileIndex, headerLength }) !== false;
                    const isLastChunk = chunkTable.length === 0;
                    if (!proceed || isLastChunk) {
                        lock.release(`getDataStream:first, proceed=${proceed}, last=${isLastChunk}`);
                        resolve({ valueType, chunks });
                        return; //return lock;
                    }
                    const next = (index) => {
                        //debug.log(address.path);
                        const chunk = chunks[index];
                        const fileIndex = storage.getRecordFileIndex(chunk.pageNr, chunk.recordNr);
                        let length = chunk.length * storage.settings.recordSize;
                        if (index === chunks.length-1) {
                            length -= storage.settings.recordSize;
                            length += lastRecordSize;
                        }
                        const data = new Uint8Array(length);
                        return storage.readData(fileIndex, data).then(bytesRead => {
                            const proceed = callback({ data, valueType, chunks, chunkIndex:index, totalBytes, hasKeyTree, fileIndex, headerLength }) !== false;
                            const isLastChunk = index + 1 === chunks.length
                            if (!proceed || isLastChunk) {
                                lock.release(`getDataStream:next, proceed=${proceed}, last=${isLastChunk}`);
                                resolve({ valueType, chunks });
                                return; //return lock;
                            }
                            else {
                                return next(index+1);
                            }
                        });
                    }
                    return next(1);
                });
            });
            // .then(lock => {
            //     //if (!options.lock) {
            //     // Lock was requested by us
            //     return lock.release();
            //     //}
            // });
        };

        return generator;
    }

    /**
     * Starts reading a record, returns a generator that fires .next for each child key until the callback function returns false. The generator (.next) returns a promise that resolves when all child keys have been processed, or was cancelled because false was returned in the generator callback
     * @param {Storage} storage 
     * @param {RecordAddress} address 
     * @returns {{next: (cb: (child: { key?: string, index?: number, type: number, value?: any, address?: RecordAddress }) => boolean) => Promise<void>}} - returns a generator that is called for each child. return false from your .next callback to stop iterating
     */
    static getChildStream(storage, address, options = { lock: undefined, keyFilter: undefined }) {
        let resolve, reject;
        let callback;
        const generator = {
            next(cb) { 
                callback = cb; 
                const promise = new Promise((rs, rj) => {
                    resolve = rs;
                    reject = rj;
                });
                work();
                return promise;
            }
        };

        const work = () => {
            Record.get(storage, address, { lock: options.lock })
            .then(record => {
                if (!record) {
                    return reject("record does not exist");
                }
                record.getChildStream(options).next(callback).then(resolve);
            });
        };
        return generator;
    }

    /**
     * Starts reading this record, returns a generator that fires .next for each child key until the callback function returns false. The generator (.next) returns a promise that resolves when all child keys have been processed, or was cancelled because false was returned in the generator callback
     * @param {{keyFilter?: string[], lock?: RecordLock }} options optional options: keyFilter specific keys to get, offers performance and memory improvements when searching specific keys
     * @returns {{next: (cb: (child: { key?: string, index?: number, type: number, value?: any, address?: RecordAddress }) => boolean) => Promise<void>}} - returns a generator that is called for each child. return false from your .next callback to stop iterating
     */
    getChildStream(options = { keyFilter: undefined, lock: undefined }) {
        let resolve;
        let callback;
        let childCount = 0;
        let isArray = this.valueType === VALUE_TYPES.ARRAY;
        const generator = {
            next(cb) { 
                callback = cb; 
                const promise = new Promise(r => resolve = r);
                work();
                return promise;
            }
        };

        // To get values from binary data:
        const getValueFromBinary = (child, binary, index, assert) => {
            assert && assert(2);
            child.type = binary[index] >> 4;
            //let value, address;
            const tinyValue = binary[index] & 0xf;
            const valueInfo = binary[index + 1];
            const isRemoved = child.type === 0;
            const unusedDataLength = isRemoved ? valueInfo : 0;
            const isTinyValue = (valueInfo & 192) === 64;
            const isInlineValue = (valueInfo & 192) === 128;
            const isRecordValue = (valueInfo & 192) === 192;
            index += 2;
            if (isRemoved) {
                // NOTE: will not happen yet because record saving currently rewrites
                // whole records on updating. Adding new/updated data to the end of a 
                // record will offer performance improvements. Rewriting a whole new record
                // can then be scheduled upon x updates
                assert && assert(unusedDataLength);
                index += unusedDataLength;
                return { index, skip: true }; // Don't add this child
            }
            else if (isTinyValue) {
                if (child.type === VALUE_TYPES.BOOLEAN) { child.value = tinyValue === 1; }
                else if (child.type === VALUE_TYPES.NUMBER) { child.value = tinyValue; }
                else if (child.type === VALUE_TYPES.STRING) { child.value = ""; }
                else if (child.type === VALUE_TYPES.ARRAY) { child.value = []; }
                else if (child.type === VALUE_TYPES.OBJECT) { child.value = {}; }
                else if (child.type === VALUE_TYPES.BINARY) { child.value = new ArrayBuffer(0); }
                else if (child.type === VALUE_TYPES.REFERENCE) { child.value = new PathReference(""); }
                else { throw `Tiny value deserialization method missing for value type ${child.type}`};
            }
            else if (isInlineValue) {
                const length = (valueInfo & 63) + 1;
                assert  && assert(length);
                const bytes = binary.slice(index, index + length);
                if (child.type === VALUE_TYPES.NUMBER) { child.value = bytesToNumber(bytes); }
                else if (child.type === VALUE_TYPES.STRING) { child.value = textDecoder.decode(bytes); }
                else if (child.type === VALUE_TYPES.DATETIME) { let time = bytesToNumber(bytes); child.value = new Date(time); }
                //else if (type === VALUE_TYPES.ID) { value = new ID(bytes); }
                else if (child.type === VALUE_TYPES.ARRAY) { throw `Inline array deserialization not yet implemented`; }
                else if (child.type === VALUE_TYPES.OBJECT) { throw `Inline object deserialization not yet implemented`; }
                else if (child.type === VALUE_TYPES.BINARY) { child.value = new Uint8Array(bytes).buffer; }
                else if (child.type === VALUE_TYPES.REFERENCE) { 
                    const path = textDecoder.decode(bytes);
                    child.value = new PathReference(path); 
                }
                else { throw `Inline value deserialization method missing for value type ${type}`};
                index += length;
            }
            else if (isRecordValue) {
                // Record address
                assert && assert(6);
                if (typeof binary.buffer === "undefined") {
                    binary = new Uint8Array(binary);
                }
                const view = new DataView(binary.buffer, binary.byteOffset + index, 6);
                const pageNr = view.getUint32(0);
                const recordNr = view.getUint16(4);
                const childPath = isArray ? `${this.address.path}[${child.index}]` : this.address.path === "" ? child.key : `${this.address.path}/${child.key}`;
                child.address = new RecordAddress(childPath, pageNr, recordNr);
                index += 6;
            }
            else {
                throw new Error("corrupt");
            }
            return { index };
        };

        // Gets children from a chunk of data, linear key/value pairs:
        let incompleteData = null;
        const getChildrenFromChunk = (valueType, binary) => {
            if (incompleteData !== null) {
                binary = concatTypedArrays(incompleteData, binary);
                incompleteData = null;
            }
            let children = [];
            if (valueType === VALUE_TYPES.OBJECT || valueType === VALUE_TYPES.ARRAY) {
                isArray = valueType === VALUE_TYPES.ARRAY;
                let index = 0;
                const assert = (bytes) => {
                    if (index + bytes > binary.length) { 
                        throw new Error(`truncated data`); 
                    }
                };

                // Index child keys or array indexes
                while(index < binary.length) {
                    childCount++;
                    let startIndex = index;
                    let child = {
                        key: undefined,
                        index: undefined,
                        type: undefined,
                        value: undefined,
                        address: undefined
                    };
    
                    try {
                        if (isArray) {
                            child.index = childCount-1;
                        }
                        else {
                            assert(2);
                            const keyIndex = (binary[index] & 128) === 0 ? -1 : (binary[index] & 127) << 8 | binary[index+1];
                            if (keyIndex >= 0) {
                                child.key = this.storage.KIT.keys[keyIndex];
                                index += 2;
                            }
                            else {
                                const keyLength = (binary[index] & 127) + 1;
                                index++;
                                assert(keyLength);
                                child.key = "";
                                for(let i = 0; i < keyLength; i++) {
                                    child.key += String.fromCharCode(binary[index + i]);
                                }
                                index += keyLength;
                            }
                        }
        
                        let res = getValueFromBinary(child, binary, index, assert);
                        index = res.index;
                        if (res.skip) {
                            continue;
                        }
                        else if (!isArray && options.keyFilter && options.keyFilter.indexOf(child.key) < 0) {
                            continue;
                        }
                        else if (isArray && options.keyFilter && options.keyFilter.indexOf(child.index) < 0) {
                            continue;
                        }

                        children.push(child);
                    }
                    catch(err) {
                        if (err.message === "corrupt") { throw err; }
                        incompleteData = binary.slice(startIndex);
                        break;
                    }
                    // next
                }
            }
            return children;
        }

        let i = 0;
        const createStreamFromLinearData = (chunkData, isLastChunk) => {
            let children = getChildrenFromChunk(this.valueType, chunkData);
            let stop = !children.every(child => {
                const proceed = callback(child, i) !== false; // Keep going until callback returns false
                i++;
                return proceed;
            });
            if (stop || isLastChunk) {
                resolve();
                return false;
            }
        };

        const rangesFromRecords = (records) => {
            let range = { 
                pageNr: records[0].pageNr, 
                recordNr: records[0].recordNr, 
                length: 1 
            };
            let ranges = [range];
            for(let i = 1; i < records.length; i++) {
                if (records[i].pageNr !== range.pageNr || records[i].recordNr !== range.recordNr + range.length) {
                    range = { pageNr: records[i].pageNr, recordNr: records[i].recordNr, length: 1 };
                    ranges.push(range);
                }
                else {
                    range.length++;
                }
            }
            return ranges;
        };

        // Gets children from a indexed binary tree of key/value data
        const createStreamFromBinaryTree = () => {
            
            const reader = (index, length) => {
                // index to fileIndex:
                // fileIndex + headerLength + (floor(index / recordSize)*recordSize) + (index % recordSize)
                // above is not true for fragmented records

                // start recordNr & offset:
                // recordNr = floor((index + headerLength) / recordSize)
                // offset = (index + headerLength) % recordSize
                // end recordNr & offset:
                // recordNr = floor((index + headerLength + length) / recordSize)
                // offset = (index + headerLength + length) % recordSize

                const recordSize = this.storage.settings.recordSize;
                const startRecord = {
                    nr: Math.floor((this.headerLength + index) / recordSize),
                    offset: (this.headerLength + index) % recordSize
                };
                const endRecord = {
                    nr: Math.floor((this.headerLength + index + length) / recordSize),
                    offset: (this.headerLength + index + length) % recordSize
                };
                const records = [];
                this.allocation.forEach(range => {
                    for(let i = 0; i < range.length; i++) {
                        records.push({ pageNr: range.pageNr, recordNr: range.recordNr + i });
                    }
                });
                const readRecords = records.slice(startRecord.nr, endRecord.nr + 1);
                const readRanges = rangesFromRecords(readRecords);
                const reads = [];
                const totalLength = (readRecords.length * recordSize) - startRecord.offset;
                const binary = new Uint8Array(totalLength);
                let bOffset = 0;
                for (let i = 0; i < readRanges.length; i++) {
                    const range = readRanges[i];
                    let fIndex = this.storage.getRecordFileIndex(range.pageNr, range.recordNr);
                    let bLength = range.length * recordSize;
                    if (i === 0) { 
                        fIndex += startRecord.offset; 
                        bLength -= startRecord.offset; 
                    }
                    // if (i + 1 === readRanges.length) {
                    //     bLength -= endRecord.offset;
                    // }
                    let p = this.storage.readData(fIndex, binary, bOffset, bLength);
                    reads.push(p);
                    bOffset += bLength;
                }
                return Promise.all(reads).then(() => {
                    // Convert Uint8Array to byte array
                    let bytes = [];
                    bytes.push(...binary);
                    return bytes;
                })
            }

            // function to read appropriate data from the database upon request by BinaryBPlusTree
            const readerOld = (index, length) => {
                let binary = new Uint8Array(Math.min(length, this.totalBytes - index));
                let rangeStartIndex = 0;
                let reads = [];
                this.allocation.every(range => {
                    let rangeLength = (range.length * this.storage.settings.recordSize);
                    let rangeEndIndex = rangeStartIndex + rangeLength;
                    if (rangeStartIndex > index + length) {
                        return false; // Stop .every
                    }
                    if (rangeEndIndex >= index) {
                        let fIndex = this.storage.getRecordFileIndex(range.pageNr, range.recordNr);
                        if (fIndex === this.fileIndex && index === 0 && this.startData.length >= (rangeLength - this.headerLength)) {
                            // We already have the first bit of data
                            binary.set(this.startData, 0);
                            //reads.push(Promise.resolve());
                        }
                        else {
                            // index === 225, length === 100, range start === 200, end = 250 --> read === index + length - range start === 225 + 100 - 200 === 125, but 
                            // index === 225, length === 100, range start === 300, end = 350 --> read === index + length - range start === 225 + 100 - 300 === 25
                            // let readLength = (index + length) - rangeStartIndex;
                            // if (fIndex === this.fileIndex) { 
                            //     // First record contains headers, we need to skip those
                            //     readLength -= this.headerLength; 
                            //     fIndex += this.headerLength; 
                            // }
                            // if (rangeStartIndex + readLength > rangeEndIndex) { 
                            //     // If the ...
                            //     readLength = rangeEndIndex - rangeStartIndex; 
                            // }
                            //let readLength = Math.min(rangeLength, (index + length) - rangeStartIndex);
                            if (fIndex === this.fileIndex) { 
                                // First record contains headers, we need to skip those
                                //readLength -= this.headerLength; 
                                fIndex += this.headerLength;
                            }
                            let read = this.storage.readData(fIndex, binary, rangeStartIndex, binary.length);
                            reads.push(read);
                        }
                    }
                    rangeStartIndex = rangeEndIndex;
                    return true; // keep going
                });
                return Promise.all(reads)
                .then(() => {
                    // Convert Uint8Array to byte array
                    let bytes = [];
                    bytes.push(...binary);
                    return bytes;
                });
            };

            // Get lock for reading, then proceed
            //let tid = options.lock ? options.lock.tid : "read-keytree-" + this.address.path + "-" + uuid62.v1();
            //const tid = "read-keytree-" + this.address.path + "-" + (options.lock ? /[a-z0-9]+$/i.exec(options.lock.tid) : uuid62.v1());
            const tid = options.lock ? options.lock.tid : uuid62.v1();
            this.storage.lock(this.address.path, tid, false, `readKeyStream "/${this.address.path}"`) // Write-lock the record while streaming
            .then(lock => {
                let i = -1;
                const tree = new BinaryBPlusTree(reader);
                const done = (comment) => {
                    //if (!options.lock) {
                    // Lock was requested by us, release it
                    lock.release(comment);
                    //}
                    resolve();
                };
                const processLeaf = (leaf) => {
                    const children = leaf.entries
                    .map(entry => {
                        i++;
                        if (options.keyFilter) {
                            if (isArray && options.keyFilter.indexOf(i) < 0) { return null; }
                            else if (!isArray && options.keyFilter.indexOf(child.key) < 0) { return null; }
                        }
                        const child = {
                            key: entry.key
                        };
                        const res = getValueFromBinary(child, entry.value, 0);
                        if (res.skip) {
                            return null;
                        }
                        // child.type = res.type;
                        // child.address = res.address;
                        // child.value = res.value;
                        return child;
                    })
                    .filter(child => child !== null);

                    i = 0;
                    const stop = !children.every(child => {
                        return callback(child, i++) !== false; // Keep going until callback returns false
                    });
                    if (stop || !leaf.getNext) {
                        done(`readKeyStream:processLeaf, stop=${stop}, last=${!leaf.getNext}`);
                    }
                    else {
                        leaf.getNext().then(processLeaf);
                    }
                };
                if (options.keyFilter && !isArray) {
                    let i = 0;
                    const nextKey = () => {
                        const key = options.keyFilter[i];
                        tree.find(key)
                        .then(value => {
                            let proceed = true;
                            if (value !== null) {
                                const child = { key };
                                const res = getValueFromBinary(child, value, 0);
                                if (!res.skip) {
                                    proceed = callback(child, i) !== false;
                                }
                            }
                            const isLastKey = i + 1 === options.keyFilter.length;
                            if (!proceed || isLastKey) {
                                done(`readKeyStream:nextKey, proceed=${proceed}, last=${isLastKey}`);
                            }
                            else {
                                i++;
                                nextKey();
                            }
                        });
                    }
                    nextKey();
                }
                else {
                    tree.getFirstLeaf().then(processLeaf);
                }
            });
        };
        const work = () => {
            if (this.hasKeyTree) {
                createStreamFromBinaryTree();
            }
            // else if (this.allocation.length === 1 && this.allocation[0].length === 1) {
            //     // We have all data in memory (small record)
            //     createStreamFromLinearData(this.startData, true);
            // }
            else {
                this.getDataStream({ lock: options.lock }) //Record.getDataStream(this.storage, this.address, { lock: options.lock })
                .next(({ data, valueType, chunks, chunkIndex, hasKeyTree, headerLength, fileIndex }) => {
                    let isLastChunk = chunkIndex === chunks.length-1;
                    return createStreamFromLinearData(data, isLastChunk);
                });
            }
        };
        return generator;
    }

    getDataStream(options = { lock: undefined }) {
        // TODO: Implement caching?
        if (this.startData.length === this.totalBytes) {
            // We have all data
            return {
                next: (cb) => {
                    cb({ data: this.startData, chunks: this.allocation, chunkIndex: 0 });
                    return Promise.resolve();
                }
            };
        }

        // We don't have all data, get it now
        let resolve;
        let callback;
        const generator = {
            /**
             * @param {(result: {data: Uint8Array, chunkIndex: number, chunks: { pageNr: number, recordNr: number, length: number }[] }) => boolean} cb callback function that is called with each chunk read. Reading will stop immediately when false is returned
             * @returns {Promise<{ chunks: { pageNr: number, recordNr: number, length: number }[]}>} returns a promise that resolves when all data is read
             */
            next(cb) { 
                callback = cb; 
                const promise = new Promise(r => resolve = r); 
                work();
                return promise;
            }
        };
 
        const work = () => {
            // TODO:
            // if (this.storage.wasWritelockedSince(this.address.path, this.timestamp)) {
            //     // We need fresh data
            // }
            // else {
            //     // Just start streaming ahead
            // }

            Record.getDataStream(this.storage, this.address, { lock: options.lock })
            .next(({ data, valueType, chunks, chunkIndex, totalBytes, hasKeyTree, fileIndex, headerLength }) => {
                if (chunkIndex === 0) {
                    // Update this record with fresh data
                    let allocation = [];
                    if (chunks.length > 1 && chunks[0].pageNr === chunks[1].pageNr && chunks[0].recordNr+1 === chunks[1].recordNr) {
                        allocation.push({
                            pageNr: chunks[0].pageNr,
                            recordNr: chunks[0].recordNr,
                            length: chunks[1].length + 1
                        });
                        chunks.length > 2 && allocation.push(...chunks.slice(2));
                    }
                    else {
                        allocation.push(...chunks);
                    }
                    this.startData = data;
                    this.headerLength = headerLength;
                    this.fileIndex = fileIndex;
                    this.allocation = allocation;
                    this.valueType = valueType;
                    this.hasKeyTree = hasKeyTree;
                    this.totalBytes = totalBytes;
                    this.timestamp = Date.now();
                }

                const proceed = callback({ data, chunks, chunkIndex }) !== false;
                if (!proceed) {
                    return false;
                }
            })
            .then(summary => {
                resolve(summary);
            });
        };

        // let chunks = [];
        // let startDataRecords = Math.floor(this.startData / this.storage.settings.recordSize);
        // this.allocation.forEach((range, index) => {
        //     if (index == 0 && startDataRecords < range.length) {
        //         let firstChunk = { pageNr: range.pageNr, recordNr: range.recordNr, length: startDataRecords };
        //         chunks.push(firstChunk);
        //         let secondChunk = { pageNr: range.pageNr, recordNr: range.recordNr + startDataRecords, length: range.length - startDataRecords };
        //         chunks.push(secondChunk);
        //     }
        //     else {
        //         chunks.push(range);
        //     }
        // });
        // const work = () => {
        //     const next = (index) => {
        //         const chunk = chunks[index];
        //         if (!chunk) { resolve({ chunks }); return; }
        //         else if (index == 0) {
        //             const proceed = callback({ data: this.startData, chunks, chunkIndex:index }) !== false;
        //             if (proceed) {
        //                 next(index+1);
        //             }
        //             else {
        //                 resolve({ chunks });
        //             }
        //         }

        //         const fileIndex = this.storage.getRecordFileIndex(chunk.pageNr, chunk.recordNr);
        //         let length = chunk.length * storage.settings.recordSize;
        //         if (index === chunks.length-1) {
        //             length -= storage.settings.recordSize;
        //             length += lastRecordSize;
        //         }
        //         const data = new Uint8Array(length);
        //         storage.readData(fileIndex, data).then(bytesRead => {
        //             const proceed = callback({ data, chunks, chunkIndex:index }) !== false;
        //             if (proceed) {
        //                 next(index+1);
        //             }
        //             else {
        //                 resolve({ chunks });
        //             }
        //         });
        //     }
        //     next(0);
        // };
        return generator;
    }


    /**
     * Check if this record matches the passed criteria
     * @param {Array<{ key: string, op: string, compare: string }>} filters criteria to test
     */
    matches(filters) {
        let filterKeys = filters.reduce((keys, f) => {
            if (keys.indexOf(f.key) < 0) {
                keys.push(f.key);
            }
            return keys;
        }, []);

        return Promise.all(filterKeys.map(key => this.getChildInfo(key)))
        .then(childInfos => {
            const promises = [];
            let matchesFilters = childInfos.every(childInfo => {
                const child = childInfo;
                const fs = filters.filter(f => f.key === child.key);
                return fs.every(f => {
                    let proceed = true;
                    if (f.op === "!exists" || (f.op === "==" && (f.compare === null || f.compare === undefined))) { 
                        proceed = !child.exists;
                    }
                    else if (f.op === "exists" || (f.op === "!=" && (f.compare === null || f.compare === undefined))) {
                        proceed = child.exists;
                    }
                    else if (!child.exists) {
                        proceed = false;
                    }
                    else {
                        const isMatch = (val) => {
                            if (f.op === "<") { return val < f.compare; }
                            if (f.op === "<=") { return val <= f.compare; }
                            if (f.op === "==") { return val === f.compare; }
                            if (f.op === "!=") { return val !== f.compare; }
                            if (f.op === ">") { return val > f.compare; }
                            if (f.op === ">=") { return val >= f.compare; }
                            if (f.op === "in") { return f.compare.indexOf(val) >= 0; }
                            if (f.op === "!in") { return f.compare.indexOf(val) < 0; }
                            if (f.op === "matches") {
                                return f.compare.test(val.toString());
                            }
                            if (f.op === "!matches") {
                                return !f.compare.test(val.toString());
                            }
                            if (f.op === "between") {
                                return val >= f.compare[0] && val <= f.compare[1];
                            }
                            if (f.op === "!between") {
                                return val < f.compare[0] || val > f.compare[1];
                            }
                            if (f.op === "custom") {
                                return f.compare(val);
                            }
                        };

                        if (child.address) {
                            if (child.valueType === VALUE_TYPES.OBJECT && ["has","!has"].indexOf(f.op) >= 0) {
                                const op = f.op === "has" ? "exists" : "!exists";
                                const p = Record.get(this.storage, child.address)
                                    .then(cr => cr.matches([{ key: f.compare, op }])
                                    .then(isMatch => { return { key: child.key, result: isMatch }; }));
                                promises.push(p);
                                proceed = true;
                            }
                            else if (child.valueType === VALUE_TYPES.ARRAY && ["contains","!contains"].indexOf(f.op) >= 0) {
                                const p = Record.get(this.storage, child.address)
                                    .then(cr => cr.getValue())
                                    .then(arr => { 
                                        const i = arr.indexOf(f.compare);
                                        return { key: child.key, result: (i >= 0 && f.op === "contains") || (i < 0 && f.op === "!contains") };
                                    });
                                promises.push(p);
                                proceed = true;
                            }
                            else if (child.valueType === VALUE_TYPES.STRING) {
                                const p = Record.get(this.storage, child.address)
                                    .then(cr => cr.getValue())
                                    .then(val => {
                                        return { key: child.key, result: isMatch(val) };
                                    });
                                promises.push(p);
                                proceed = true;
                            }
                            else {
                                proceed = false;
                            }
                        }
                        else if (child.type === VALUE_TYPES.OBJECT && ["has","!has"].indexOf(f.op) >= 0) {
                            const has = f.compare in child.value;
                            proceed = (has && f.op === "has") || (!has && f.op === "!has");
                        }
                        else if (child.type === VALUE_TYPES.ARRAY && ["contains","!contains"].indexOf(f.op) >= 0) {
                            const contains = child.value.indexOf(f.compare) >= 0;
                            proceed = (contains && f.op === "contains") || (!contains && f.op === "!contains");
                        }
                        else {
                            const ret = isMatch(child.value);
                            if (ret instanceof Promise) {
                                promises.push(ret);
                                ret = true;
                            }
                            proceed = ret;
                        }
                    }
                    return proceed;
                }); // fs.every
            }); // childInfos.every

            if (matchesFilters && promises.length > 0) {
                // We have to wait for promises to resolve before we know for sure if it is a match
                return Promise.all(promises).then(results => {
                    return results.every(r => r.result);
                });            
            }
            else {
                return Promise.resolve(matchesFilters);
            }
        });
    }

    // static transaction(storage, address, callback) {
    //     const transaction = new RecordTransaction(callback);
    //     Record.get(storage, address, { transaction }).then(record => {
    //         if (!record) {
    //             debug.error(`Path "/${address.path}" does not have its own record to run transaction on. Use the parent instead`);
    //             transaction.fail("no record to run transaction on");
    //         }
    //     });
    //     return transaction.wait();
    // }

    /**
     * Gets the record stored at a specific address (pageNr+recordNr, or path)
     * @param {Storage} storage - reference to the used storage engine
     * @param {RecordAddress} address - which page/recordNr/path the record resides
     * @returns {Promise<Record>} - returns a promise that resolves with a Record object or null reference if the record doesn't exist
     */
    static get(storage, address, options = { lock: undefined }) {
        // let allData = null;
        // let index = 0;
        // let usesKeyTree = false;
        // return this.getDataStream(storage, address)
        // .next(({ data, totalBytes, hasKeyTree }) => {
        //     if (allData === null) { 
        //         allData = new Uint8Array(totalBytes); 
        //     }
        //     allData.set(data, index);
        //     index += data.length;
        //     usesKeyTree = hasKeyTree;
        // })
        // .then(({ valueType, chunks }) => {
        //     if (chunks === null) { return null; }
        //     let allocated = [];
        //     chunks.forEach(chunk => {
        //         // Add range to record allocation
        //         for(let i = 0; i < chunk.length; i++) {
        //             allocated.push({ pageNr: chunk.pageNr, recordNr: chunk.recordNr + i });
        //         }
        //     });
        //     const record = new Record(storage, allData, address);
        //     record.allocation = allocated;
        //     record.valueType = valueType;
        //     record.hasKeyTree = usesKeyTree;
        //     return record;
        // });

        let record;
        return Record.getDataStream(storage, address, { lock: options.lock })
        .next(({ data, valueType, hasKeyTree, chunks, headerLength, fileIndex, totalBytes }) => {
            let allocation = [];
            if (chunks.length > 1 && chunks[0].pageNr === chunks[1].pageNr && chunks[0].recordNr+1 === chunks[1].recordNr) {
                allocation.push({
                    pageNr: chunks[1].pageNr,
                    recordNr: chunks[0].recordNr,
                    length: chunks[1].length + 1
                });
                chunks.length > 2 && allocation.push(...chunks.slice(2));
            }
            else {
                allocation.push(...chunks);
            }

            record = new Record(storage, address);
            record.startData = data;
            record.headerLength = headerLength;
            record.fileIndex = fileIndex;
            record.allocation = allocation;
            record.valueType = valueType;
            record.hasKeyTree = hasKeyTree;
            record.totalBytes = totalBytes;
            record.timestamp = Date.now();
            return false; // Stop data streaming after first bit of data
        })
        .catch(reason => {
            record = null; // Record probably doesn't exist
        })
        .then(() => {
            return record;
        });
    }

    // /**
    //  * Gets the record stored at a specific address (pageNr+recordNr, or path)
    //  * @param {Storage} storage - reference to the used storage engine
    //  * @param {RecordAddress} address - which page/recordNr/path the record resides
    //  * @returns {Promise<Record>} - returns a promise that resolves with a Record object or null reference if the record doesn't exist
    //  */
    // static get(storage, address, options = undefined) {
    //     if (typeof address.path === "string" 
    //         && typeof address.pageNr === "undefined" 
    //         && typeof address.recordNr === "undefined"
    //     ) {
    //         // Resolve pageNr and recordNr
    //         return this.resolve(storage, address.path).then(address => {
    //             if (!address) { 
    //                 // No address found for path, so it doesn't exist
    //                 return Promise.resolve(null); 
    //             }
    //             return this.get(storage, address, options);
    //         });
    //     }
        
    //     // if (options && options.transaction && !options.transaction.got_lock) {
    //     //     // Get a lock on this record before continuing
    //     //     return storage.lock(address.path, options.transaction.tid).then(success => {
    //     //         if (!success) {
    //     //             return Promise.reject("could not lock record")
    //     //         }
    //     //         options.transaction.got_lock = true;
    //     //         return this.get(storage, address, options);
    //     //     })
    //     // }

    //     const fileIndex = storage.getRecordFileIndex(address.pageNr, address.recordNr);
    //     let data = new Uint8Array(storage.settings.recordSize);
    //     // Read the first record which includes headers
    //     return storage.readData(fileIndex, data).then(bytesRead => {
    //         // Read header
    //         //data = new Uint8Array(data);
    //         //const readLock = data[0] & FLAG_READ_LOCK; // 0010 0000
    //         const lock = data[0] & FLAG_WRITE_LOCK; // 0001 0000
    //         const valueType = data[0] & FLAG_VALUE_TYPE; // Last 4-bits of first byte of read data has value type

    //         // if (options && options.transaction && lock === 0) {
    //         //     throw new Error(`Record is not locked, should have been done since this is a transaction`);
    //         // }

    //         if (valueType === 0) {
    //             throw new Error("Corrupt data!");
    //         }

    //         const allocated = [{ pageNr: address.pageNr, recordNr: address.recordNr }];
    //         const view = new DataView(data.buffer);
    //         // Read Chunk Table
    //         // TODO: If the CT is too big for 1 record, it needs to read more records or it will crash...
    //         let chunks = [];
    //         let offset = 1;
    //         while (true) {
    //             const type = view.getUint8(offset);
    //             const chunk = {
    //                 type,
    //                 pageNr: address.pageNr,
    //                 recordNr: address.recordNr,
    //                 length: 1
    //             };

    //             if (type === 0) {
    //                 // No more chunks, exit
    //                 offset++;
    //                 break;
    //             }
    //             else if (type === 1) {
    //                 // First chunk is longer than the 1 record already read
    //                 chunk.recordNr++;
    //                 chunk.length = view.getUint16(offset + 1) - 1;
    //                 offset += 3;
    //             }
    //             else if (type === 2) {
    //                 // Next chunk is location somewhere else (not contigious)
    //                 chunk.pageNr = view.getUint32(offset + 1);
    //                 chunk.recordNr = view.getUint16(offset + 5);
    //                 chunk.length = view.getUint16(offset + 7);
    //                 offset += 9;
    //             }
    //             chunks.push(chunk);

    //             // Add range to record allocation
    //             for(let i = 0; i < chunk.length; i++) {
    //                 allocated.push({ pageNr: chunk.pageNr, recordNr: chunk.recordNr + i });
    //             }
    //         }
    //         const lastChunkSize = view.getUint16(offset);
    //         offset += 2;
    //         const headerLength = offset;

    //         let reads = [];
    //         chunks.forEach((chunk, c) => {
    //             const fileIndex = storage.getRecordFileIndex(chunk.pageNr, chunk.recordNr);
    //             let length = chunk.length * storage.settings.recordSize;
    //             if (c === chunks.length-1) {
    //                 length -= storage.settings.recordSize;
    //                 length += lastChunkSize;
    //             }
    //             const data = new Uint8Array(length);
    //             const promise = storage.readData(fileIndex, data).then(bytesRead => data);
    //             reads.push(promise);
    //         });
    //         return Promise.all(reads).then((results) => {
    //             // Glue all read data together
    //             const bytesRead = results.reduce((a,b,i) => (i === 0 ? a : a.length) + b.length, 0);
    //             let totalBytes = data.length - headerLength;
    //             let firstChunkSize = totalBytes;
    //             if (chunks.length === 0) {
    //                 totalBytes = firstChunkSize = lastChunkSize;
    //             }
    //             else {
    //                 totalBytes += bytesRead;
    //                 //totalBytes -= (storage.settings.recordSize - lastChunkSize);
    //             }

    //             const allData = new Uint8Array(totalBytes);
    //             // First, add the data that was in the first record
    //             const view = new Uint8Array(data.buffer, headerLength, firstChunkSize);
    //             allData.set(view, 0);
    //             let i = firstChunkSize;
    //             // Now add all additional chunks read
    //             results.forEach((data, d) => {
    //                 let l = data.length; //d < results.length - 1 ? data.length : lastChunkSize;
    //                 allData.set(data, i, l);
    //                 i += l;
    //             });

    //             // Create and return record instance
    //             const record = new Record(storage, allData, address);
    //             record.allocation = allocated;
    //             record.valueType = valueType;

    //             // if (options && options.transaction) {
    //             //     const lockState = storage.checkLock(address.path, options.transaction.tid);
    //             //     if (!lockState.ok) {
    //             //         options.transaction.fail(lockState.error);
    //             //     }
    //             //     else {
    //             //         options.transaction.execute(record)
    //             //         .then(result => {
    //             //             return storage.unlock(address.path, options.transaction.tid);
    //             //         })
    //             //         .then(success => {
    //             //             options.transaction.done();
    //             //         });;
    //             //     }
    //             // }
    //             return record;
    //         });
    //     });

    // }

    /**
     * Resolves the RecordAddress for given path
     * @param {Storage} storage - reference to the used storage engine
     * @param {string} path - path to resolve
     * @param {{ lock?: RecordLock }} options
     * @returns {Promise<RecordAddress>} - returns Promise that resolves with the given path if the record exists, or with a null reference if it doesn't
     */
    static resolve(storage, path, options = { lock: undefined }) {
        path = path.replace(/^\/|\/$/g, ""); // Remove start/end slashes
        let address = storage.addressCache.find(path);
        if (address) {
            return Promise.resolve(address);
        }
        // Cache miss. 
        // Look it up the hard way by reading parent record from file
        let ancestorAddress = storage.addressCache.findAncestor(path);
        let tailPath = path.substr(ancestorAddress.path.length).replace(/^\//, "");
        let keys = getPathKeys(tailPath);
        
        return new Promise((resolve, reject) => {
            const next = (index, parentAddress) => {
                // Because IO reading is async, it is possible that another caller already came
                // accross the record we are trying to resolve. Check the cache again
                let address = storage.addressCache.find(path);
                if (address) { 
                    // Found by other caller in the mean time, stop IO and return
                    return resolve(address); 
                }

                Record.get(storage, parentAddress, { lock: options.lock })
                .then(parentRecord => {
                    if (!parentRecord) { 
                        // Parent doesn't exist
                        return resolve(null); 
                    }

                    parentRecord.getChildInfo(keys[index], { lock: options.lock })
                    .then(childInfo => {
                        if (childInfo.address) {
                            storage.addressCache.update(childInfo.address); // Cache anything that comes along!
                        }
                        if (!childInfo.exists) { 
                            // Key does not exist
                            resolve(null); 
                        }
                        else if (!childInfo.address) {
                            // Child is not stored in its own record
                            resolve(null);
                        }
                        else if (index === keys.length-1) {
                            // This is the node we were looking for
                            resolve(childInfo.address);
                        }
                        else {
                            // We have to dig deeper
                            next(index + 1, childInfo.address);
                        }
                    });
                });

                // let found = false;
                // Record.getChildStream(storage, parentAddress)
                // .next(child => {
                //     if (child.address) {
                //         storage.addressCache.update(child.address); // Cache anything that comes along!
                //     }
                //     if (child.key === keys[index]) {
                //         // Child key found
                //         if (!child.address) { 
                //             // Child is not stored in its own record
                //             resolve(null); 
                //         }
                //         else if (index === keys.length-1) {
                //             // This is the node we were looking for
                //             found = true;
                //             resolve(child.address);
                //         }
                //         else {
                //             // We have to dig deeper
                //             next(index + 1, child.address);
                //         }
                //         return false; // Stop stream
                //     }
                // })
                // .then(() => {
                //     if (!found) {
                //         resolve(null);
                //     }
                // });
            };
            next(0, ancestorAddress);
        });

        // return Record.get(storage, ancestorAddress).then(record => {
        //     // Chain promises to drill down from ancestor to requested child record
        //     let i = 0;
        //     let next = () => {
        //         let childKey = keys[i];
        //         // if (typeof childKey === "string" && childKey.indexOf("[") >= 0) {
        //         //     // Key is an array with an index (somearray[23]). Split key and index, add the index to keys
        //         //     const m = childKey.match(/^(.*?)\[([0-9]+)\]$/);
        //         //     if (m[1].length === 0) {
        //         //         childKey = parseInt(m[2]);
        //         //     }
        //         //     else {
        //         //         childKey = m[1];
        //         //         const index = parseInt(m[2]);
        //         //         keys.splice(i, 1, childKey, index);
        //         //     }
        //         // }
        //         let childType = record.getChildStorageType(childKey);
        //         if (childType !== "record") {
        //             // Child doesn't exist or isn't stored in its own record
        //             return null; 
        //         }
        //         return record.getChildRecord(childKey).then(childRecord => {
        //             if (!childRecord) {
        //                 // Record doesn't exist, resolve with null reference
        //                 return null;
        //             }
        //             storage.addressCache.update(childRecord.address);
        //             record = childRecord;
        //             i++;
        //             if (i === keys.length) {
        //                 // This was the last key in the chain (childRecord.address.path === path)
        //                 // Return the address
        //                 return record.address;
        //             }
        //             // Return new promise that looks up the next child in path :-D
        //             return next();
        //         });
        //     };
        //     return next();
        // });
    }

}

module.exports = {
    Record,
    RecordAddress,
    RecordTransaction,
    RecordLock,
    VALUE_TYPES,
    UNCHANGED
};