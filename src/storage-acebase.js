const fs = require('fs');
const pfs = require('./promise-fs');
const { ID, PathInfo, PathReference, Utils } = require('acebase-core');
const { concatTypedArrays, bytesToNumber, numberToBytes, encodeString, decodeString } = Utils;
// const { TextEncoder, TextDecoder } = require('text-encoding');
const { Node } = require('./node');
const { NodeAddress } = require('./node-address');
const { NodeCache } = require('./node-cache');
const { NodeInfo } = require('./node-info');
const { NodeLock } = require('./node-lock');
const colors = require('colors');
const { Storage, StorageSettings, NodeNotFoundError } = require('./storage');
const { VALUE_TYPES, getValueTypeName } = require('./node-value-types');
const { BinaryBPlusTree, BPlusTreeBuilder, BinaryWriter } = require('./btree');

// // TODO: Refactor TextEncoder and TextDecoder to Node Buffers
// // --> Buffer.from('❤🙌😎','utf8').toString() === the same string
// const textEncoder = new TextEncoder();
// const textDecoder = new TextDecoder();

class AceBaseStorageSettings extends StorageSettings {
    constructor(settings) {
        super(settings);
        settings = settings || {};
        this.recordSize = settings.recordSize || 128;   // record size in bytes
        this.pageSize = settings.pageSize || 1024;      // page size in records
    }
};

class AceBaseStorage extends Storage {
    /**
     * Stores data in a binary file
     * @param {string} name 
     * @param {AceBaseStorageSettings} settings 
     */
    constructor(name, settings) {
        console.assert(settings instanceof AceBaseStorageSettings, 'settings must be an instance of AceBaseStorageSettings');
        super(name, settings);

        if (settings.maxInlineValueSize > 64) {
            throw new Error("maxInlineValueSize cannot be larger than 64"); // This is technically not possible because we store inline length with 6 bits: range = 0 to 2^6-1 = 0 - 63 // NOTE: lengths are stored MINUS 1, because an empty value is stored as tiny value, so "a"'s stored inline length is 0, allowing values up to 64 bytes
        }
        if (settings.pageSize > 65536) {
            throw new Error("pageSize cannot be larger than 65536"); // Technically not possible because record_nr references are 16 bit: range = 0 - 2^16 = 0 - 65535
        }
        // if (settings.clusterMaster && (typeof settings.clusterMaster.host !== "string" || typeof settings.clusterMaster.port !== "number")) {
        //     throw new TypeError("clusterMaster must be an object with host and port properties");
        // }

        this.name = name;
        this.settings = settings; // uses settings from file when existing db
        const stats = {
            writes: 0,
            reads: 0,
            bytesRead: 0,
            bytesWritten: 0
        };
        this.stats = stats;
        this.nodeCache = new NodeCache();

        // this.nodeLocker = new NodeLocker();

        const filename = `${this.settings.path}/${this.name}.acebase/data.db`;
        let fd = null;

        // const writeQueue = [];
        // let writingNow = false;
        const writeData = (fileIndex, buffer, offset = 0, length = -1) => {
            if (buffer.constructor === Uint8Array) { //buffer instanceof Uint8Array) {
                // If the passsed buffer is of type Uint8Array (which is essentially the same as Buffer),
                // convert it to a Buffer instance or fs.write will FAIL.
                buffer = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
            }
            console.assert(buffer instanceof Buffer, 'buffer argument must be a Buffer or Uint8Array');
            if (length === -1) {
                length = buffer.byteLength;
            }
            const work = (fileIndex, buffer, offset, length, resolve, reject) => {
            //     writingNow = true;
                fs.write(fd, buffer, offset, length, fileIndex, (err, bytesWritten) => {
                    if (err) {
                        this.debug.error(`Error writing to file`, err);
                        reject(err);
                    }
                    else {
                        stats.writes++;
                        stats.bytesWritten += bytesWritten;
                        resolve(bytesWritten);
                    }
                    // writingNow = false;
                    // if (writeQueue.length > 0) {
                    //     let next = writeQueue.shift();
                    //     // Execute fs.write again, so refactor to function
                    //     ({ fileIndex, buffer, offset, length, resolve, reject } = next);
                    //     work(fileIndex, buffer, offset, length, resolve, reject);
                    // }
                });
            };
            return new Promise((resolve, reject) => {
            //     if (writingNow || writeQueue.length > 0) {
            //         writeQueue.push({ fileIndex, buffer, offset, length, resolve, reject });
            //         return;
            //     }
                work(fileIndex, buffer, offset, length, resolve, reject);
            });
        };
        this.writeData = writeData; // Make available to external classes

        /**
         * 
         * @param {number} fileIndex Index of the file to read
         * @param {Buffer|ArrayBuffer|ArrayBufferView} buffer Buffer object, ArrayBuffer or TypedArray (Uint8Array, Int8Array, Uint16Array etc) to read data into
         * @param {number} offset byte offset in the buffer to read data into, default is 0
         * @param {number} length total bytes to read (if omitted or -1, it will use buffer.byteLength)
         */
        const readData = (fileIndex, buffer, offset = 0, length = -1) => {
            // if (!(buffer instanceof Buffer)) {
            //     throw "No Buffer used";
            // }            
            if (length === -1) {
                length = buffer.byteLength;
            }
            return new Promise((resolve, reject) => {
                if (buffer instanceof ArrayBuffer) {
                    buffer = Buffer.from(buffer);
                }
                else if (!(buffer instanceof Buffer) && buffer.buffer instanceof ArrayBuffer) {
                    // Convert a typed array such as Uint8Array to Buffer with shared memory space
                    buffer = Buffer.from(buffer.buffer);
                    if (buffer.byteOffset > 0) {
                        throw new Error(`When using a TypedArray as buffer, its byteOffset MUST be 0.`);
                    }
                }
                fs.read(fd, buffer, offset, length, fileIndex, (err, bytesRead) => {
                    if (err) {
                        this.debug.error(`Error reading record`, buffer, offset, length, fileIndex);
                        this.debug.error(err);
                        return reject(err);
                    }
                    stats.reads++;
                    stats.bytesRead += bytesRead;
                    resolve(bytesRead);
                })
            });
        }
        this.readData = readData;

        // Setup cluster functionality
        if (this.cluster.enabled && this.cluster.isMaster) {
            // Handle worker requests
            this.cluster.on('worker_request', ({ request, reply, broadcast }) => {
                if (request.type === 'some_request') { 
                    reply('ok'); 
                }
                let promise;
                if (request.type === "allocate") {
                    promise = this.FST.allocate(request.records);
                }
                else if (request.type === "release") {
                    this.FST.release(request.ranges);
                    reply('ok');
                }
                else if (request.type === "lock") {
                    promise = this.nodeLocker.lock(request.path, request.tid, request.forWriting, request.comment, request.options);
                }
                else if (request.type === "unlock") {
                    promise = this.nodeLocker.unlock(request.lockId, request.comment, request.processQueue);
                }
                else if (request.type === "add_key") {
                    let index = this.KIT.getOrAdd(request.key);
                    reply(index);
                }
                else if (request.type === "update_address") {
                     // Send it to all other workers
                    this.addressCache.update(request.address, true);
                    broadcast(request);
                    reply(true);
                }
                promise && promise.then(result => {
                    reply(result);
                });
            })
        }

        // Setup Key Index Table object and functions
        if (this.cluster.enabled && !this.cluster.isMaster) {
            // Subscribe to new keys added events
            this.cluster.on("master_notification", msg => {
                if (msg.type === "key_added") {
                    this.KIT.keys[msg.index] = msg.key;
                }
                else if (msg.type === "update_address") {
                    this.addressCache.update(msg.address, true);
                }
            });
        };

        const storage = this;

        this.KIT = {
            fileIndex: 64,
            length: 65536 - 64,
            bytesUsed: 0,
            keys: [],

            /**
             * Gets a key's index, or attempts to add a new key to the KIT
             * @param {string} key | key to store in the KIT
             * @returns {number} | returns the index of the key in the KIT when successful, or -1 if the key could not be added
             */
            getOrAdd(key) {
                if (key.length > 15 || key.length === 1) {
                    return -1;
                }
                if (/^[0-9]+$/.test(key)) {
                    return -1; //storage.debug.error(`Adding KIT key "${key}"?!!`);
                }
                let index = this.keys.indexOf(key);
                if (index < 0) {
                    if (storage.cluster.enabled && !storage.cluster.isMaster) {
                        // Forward request to cluster master. Response will be too late for us, but it will be cached for future calls
                        storage.cluster.request({ type: "add_key", key }).then(index => {
                            this.keys[index] = key; // Add to our local array
                        });
                        return -1;
                    }
                    index = this.keys.push(key) - 1;
                    if (storage.cluster.enabled && storage.cluster.isMaster) {
                        // Notify all workers
                        storage.cluster.workers.forEach(worker => {
                            worker.send({ type: "key_added", key, index });
                        });
                    }
                }
                else {
                    return index;
                }
                try {
                    this.write();
                }
                catch(err) {
                    this.keys.pop(); // Remove the key
                    index = -1;
                }
                return index; //return Promise.resolve(index);
            },

            write() {
                if (storage.cluster.enabled && !storage.cluster.isMaster) {
                    throw new Error(`DEV ERROR: KIT.write not allowed to run if it is a cluster worker!!`);
                }
                // Key Index Table starts at index 64, and is 2^16 (65536) bytes long
                const data = Buffer.alloc(this.length);
                const view = new DataView(data.buffer);
                let index = 0;
                for(let i = 0; i < this.keys.length; i++) {
                    const key = this.keys[i];
                    // Add 1-byte key length
                    view.setUint8(index, key.length);
                    index++;
                    
                    for (let i = 0; i < key.length; i++) {
                        if (index > this.length) {
                            throw new Error(`Too many keys to store in KIT, size limit of ${this.length} has been reached; current amount of keys is ${this.keys.length}`);
                        }
                        let charCode = key.charCodeAt(i);
                        if (charCode > 255) { throw `Invalid character in key ${key} at char ${i+1}`; }
                        view.setUint8(index, charCode);
                        index++;
                    }
                }
                const bytesToWrite = Math.max(this.bytesUsed, index);    // Determine how many bytes should be written to overwrite current KIT
                this.bytesUsed = index;

                writeData(this.fileIndex, data, 0, bytesToWrite)
                // .then(bytesWritten => {
                //     storage.debug.log(`KIT saved, ${bytesWritten} bytes written`);
                // })
                .catch(err => {
                    storage.debug.error(`Error writing KIT: `, err);
                });
            },

            load() {
                return new Promise((resolve, reject) => {
                    let data = Buffer.alloc(this.length);
                    fs.read(fd, data, 0, data.length, this.fileIndex, (err, bytesRead) => {
                        if (err) {
                            storage.debug.error(`Error reading KIT from file: `, err);
                            return reject(err);
                        }
                        // Interpret the read data
                        let view = new DataView(data.buffer);
                        let keys = [];
                        let index = 0;
                        while(true) {
                            const keyLength = view.getUint8(index);
                            if (keyLength === 0) { break; }
                            index++;
                            let key = "";
                            for(let i = 0; i < keyLength; i++) {
                                key += String.fromCharCode(view.getUint8(index + i));
                            }
                            keys.push(key);
                            index += keyLength;
                        }
                        this.bytesUsed = index;
                        this.keys = keys;
                        storage.debug.log(`KIT read, ${this.keys.length} keys indexed`.bold);
                        //storage.debug.log(keys);
                        resolve(keys);
                    });
                });
            }
        };

        // Setup Free Space Table object and functions        
        if (this.cluster.enabled && !this.cluster.isMaster) {
            this.FST = {
                /**
                 * 
                 * @param {number} requiredRecords 
                 * @returns {Promise<Array<{ pageNr: number, recordNr: number, length: number }>>}
                 */
                allocate(requiredRecords) {
                    return storage.cluster.request({ type: "allocate", records: requiredRecords })
                    // .then(result => {
                    //     return result;
                    // });
                },
                release(ranges) {
                    return storage.cluster.request({ type: "release", ranges });
                },
                load() {
                    return Promise.resolve([]); // Fake loader
                }
            };
        }
        else {
            this.FST = {
                fileIndex: 65536,   // Free Space Table starts at index 2^16 (65536)
                length: 65536,      // and is max 2^16 (65536) bytes long
                bytesUsed: 0,       // Current byte length of FST data
                pages: 0,
                ranges: [],

                /**
                 * 
                 * @param {number} requiredRecords 
                 * @returns {Promise<Array<{ pageNr: number, recordNr: number, length: number }>>}
                 */
                allocate(requiredRecords) {
                    // First, try to find a range that fits all requested records sequentially
                    const recordsPerPage = storage.settings.pageSize;
                    let allocation = [];
                    let pageAdded = false;
                    const ret = (comment) => {
                        // console.error(`ALLOCATED ${comment}: ${allocation.map(a => `${a.pageNr},${a.recordNr}+${a.length-1}`).join('; ')}`);
                        this.write(pageAdded);
                        return Promise.resolve(allocation);
                    };

                    let totalFree = this.ranges.reduce((t, r) => t + r.end - r.start, 0);
                    while (totalFree < requiredRecords) {
                        // There is't enough free space, we'll have to create new page(s)
                        let newPageNr = this.pages;
                        this.pages++;
                        const newRange = { page: newPageNr, start: 0, end: recordsPerPage };
                        this.ranges.push(newRange);
                        totalFree += recordsPerPage;
                        pageAdded = true;
                    }

                    if (requiredRecords <= recordsPerPage) {
                        // Find exact range
                        let r = this.ranges.find(r => r.end - r.start === requiredRecords);
                        if (r) {
                            allocation.push({ pageNr: r.page, recordNr: r.start, length: requiredRecords });
                            let i = this.ranges.indexOf(r);
                            this.ranges.splice(i, 1);
                            return ret(`exact_range`);
                        }
                    
                        // Find first fitting range
                        r = this.ranges.find(r => r.end - r.start > requiredRecords);
                        if (r) {
                            allocation.push({ pageNr: r.page, recordNr: r.start, length: requiredRecords });
                            r.start += requiredRecords;
                            return ret(`first_fitting`);
                        }
                    }

                    // If we get here, we'll have to deal with the scraps
                    // Check how many ranges would be needed to store record (sort from large to small)
                    const sortedRanges = this.ranges.slice().sort((a,b) => {
                        let l1 = a.end - a.start;
                        let l2 = b.end - b.start;
                        if (l1 < l2) { return 1; }
                        if (l1 > l2) { return -1; }
                        if (a.page < b.page) { return -1; }
                        if (a.page > b.page) { return 1; }
                        return 0;
                    });

                    const MAX_RANGES = 3;
                    const test = {
                        ranges: [],
                        totalRecords: 0,
                        wholePages: 0,
                        additionalRanges: 0
                    };
                    for (let i = 0; test.totalRecords < requiredRecords && i < sortedRanges.length && test.additionalRanges <= MAX_RANGES; i++) {
                        let r = sortedRanges[i];
                        test.ranges.push(r);
                        let nrOfRecords = r.end - r.start;
                        test.totalRecords += nrOfRecords;
                        if (nrOfRecords === recordsPerPage) {
                            test.wholePages++;
                        }
                        else {
                            test.additionalRanges++;
                        }
                    }
                    if (test.additionalRanges > MAX_RANGES) {
                        // Prevent overfragmentation, don't use more than 3 ranges

                        const pagesToCreate = Math.ceil(requiredRecords / recordsPerPage) - test.wholePages;

                        // Do use the available whole page ranges
                        for (let i = 0; i < test.wholePages; i++) {
                            let range = test.ranges[i];
                            console.assert(range.start === 0 && range.end === recordsPerPage, `Available ranges were not sorted correctly, this range MUST be a whole page!!`);
                            let rangeIndex = this.ranges.indexOf(range);
                            this.ranges.splice(rangeIndex, 1);
                            allocation.push({ pageNr: range.page, recordNr: 0, length: recordsPerPage });
                            requiredRecords -= recordsPerPage;
                        }

                        // Now create remaining needed pages
                        for (let i = 0; i < pagesToCreate; i++) {
                            let newPageNr = this.pages;
                            this.pages++;
                            let useRecords = Math.min(requiredRecords, recordsPerPage);
                            allocation.push({ pageNr: newPageNr, recordNr: 0, length: useRecords });
                            if (useRecords < recordsPerPage) {
                                this.ranges.push({ page: newPageNr, start: useRecords, end: recordsPerPage });
                            }
                            requiredRecords -= useRecords;
                            pageAdded = true;
                        }
                    }
                    else {
                        // Use the ranges found
                        test.ranges.forEach((r, i) => {
                            let length = r.end - r.start;
                            if (length > requiredRecords) {
                                console.assert(i === test.ranges.length - 1, "DEV ERROR: This MUST be the last range or logic is not right!")
                                allocation.push({ pageNr: r.page, recordNr: r.start, length: requiredRecords });
                                r.start += requiredRecords;
                                requiredRecords = 0;
                            }
                            else {
                                allocation.push({ pageNr: r.page, recordNr: r.start, length });
                                let rangeIndex = this.ranges.indexOf(r);
                                this.ranges.splice(rangeIndex, 1);
                                requiredRecords -= length;
                            }
                        });
                    }
                    console.assert(requiredRecords === 0, "DEV ERROR: requiredRecords MUST be zero now!");
                    return ret(`scraps`);
                },

                release(ranges) {
                    // Add freed ranges
                    ranges.forEach(range => {
                        this.ranges.push({ page: range.pageNr, start: range.recordNr, end: range.recordNr + range.length });
                    });

                    // Now normalize the ranges
                    for(let i = 0; i < this.ranges.length; i++) {
                        const range = this.ranges[i];
                        let adjRange;
                        for (let j = i + 1; j < this.ranges.length; j++) {
                            const otherRange = this.ranges[j];
                            if (otherRange.page !== range.page) { continue; }
                            if (otherRange.start === range.end) {
                                // This range is right before the other range
                                otherRange.start = range.start;
                                adjRange = otherRange;
                                break;
                            }
                            if (range.start === otherRange.end) {
                                // This range starts right after the other range
                                otherRange.end = range.end;
                                adjRange = otherRange;
                                break;
                            }
                        }
                        if (adjRange) {
                            // range has merged with adjacent one
                            this.ranges.splice(i, 1);
                            i--;
                        }
                    }

                    this.sort();
                    this.write();
                },

                sort() {
                    this.ranges.sort((a,b) => {
                        if (a.page < b.page) return -1;
                        if (a.page > b.page) return 1;
                        if (a.start < b.start) return -1;
                        if (a.start > b.start) return 1;
                        return 0; // Impossible!
                    });
                },

                write(updatedPageCount = false) {
                    // Free Space Table starts at index 2^16 (65536), and is 2^16 (65536) bytes long
                    const data = Buffer.alloc(this.length);
                    // data.fill(0); //new Uint8Array(buffer).fill(0); // Initialize with all zeroes
                    const view = new DataView(data.buffer);
                    // Add 4-byte page count
                    view.setUint32(0, this.pages); //new Uint32Array(data.buffer, 0, 4).set([metadata.fst.pages]);
                    // Add 2-byte number of free ranges
                    view.setUint16(4, this.ranges.length); //new Uint16Array(data.buffer, 4, 2).set([ranges.length]);
                    let index = 6;
                    for(let i = 0; i < this.ranges.length; i++) {
                        const range = this.ranges[i];
                        // Add 4-byte page nr
                        view.setUint32(index, range.page); //new DataView(data.buffer, index, 4).setInt32(0, range.page);
                        // Add 2-byte start record nr, 2-byte end record nr
                        //new Uint16Array(data.buffer, index + 4, 4).set([range.start, range.end]);
                        view.setUint16(index + 4, range.start); 
                        view.setUint16(index + 6, range.end); 
                        index += 8;
                    }
                    const bytesToWrite = Math.max(this.bytesUsed, index);    // Determine how many bytes should be written to overwrite current FST
                    this.bytesUsed = index;

                    if (this.bytesUsed > this.length) {
                        throw new Error(`FST grew too big to store in the database file. Fix this!`);
                    }

                    writeData(this.fileIndex, data, 0, bytesToWrite)
                    .then(bytesWritten => {
                        //storage.debug.log(`FST saved, ${this.bytesUsed} bytes used for ${this.ranges.length} ranges`);
                        if (updatedPageCount === true) {
                            // Update the file size
                            const newFileSize = storage.rootRecord.fileIndex + (this.pages * settings.pageSize * settings.recordSize);
                            fs.ftruncateSync(fd, newFileSize);
                        }
                    })
                    .catch(err => {
                        storage.debug.error(`Error writing FST: `, err);
                    });
                },

                load() {
                    return new Promise((resolve, reject) => {
                        let data = Buffer.alloc(this.length);
                        fs.read(fd, data, 0, data.length, this.fileIndex, (err, bytesRead) => {
                            if (err) {
                                storage.debug.error(`Error reading FST from file`);
                                storage.debug.error(err);
                                return reject(err);
                            }
                            // Interpret the read data
                            let view = new DataView(data.buffer);
                            let allocatedPages = view.getUint32(0); //new DataView(data.buffer, 0, 4).getUint32(0);
                            let freeRangeCount = view.getUint16(4); //new DataView(data.buffer, 4, 2).getUint16(0);
                            let ranges = [];
                            let index = 6;
                            for (let i = 0; i < freeRangeCount; i++) {
                                //let view = new DataView(data.buffer, index, 8);
                                let range = {
                                    page: view.getUint32(index),
                                    start: view.getUint16(index + 4),
                                    end: view.getUint16(index + 6)
                                }
                                ranges.push(range);
                                index += 8;
                            }
                            this.pages = allocatedPages;
                            this.bytesUsed = index;
                            this.ranges = ranges;
                            storage.debug.log(`FST read, ${allocatedPages} pages allocated, ${freeRangeCount} free ranges`.bold);
                            resolve(ranges);
                        });
                    });
                }
            };
        }

        this.rootRecord = {
            fileIndex: 131072, // This is not necessarily the ROOT record, it's the FIRST record (which _is_ the root record at very start)
            pageNr: 0,
            recordNr: 0,
            exists: false,
            get address() {
                return new NodeAddress("", this.pageNr, this.recordNr);
            },
            
            /**
             * Updates the root node address
             * @param {NodeAddress} address 
             */
            update (address) {
                // Root address changed
                console.assert(address.path === "");
                if (address.pageNr === this.pageNr && address.recordNr === this.recordNr) {
                    // No need to update
                    return Promise.resolve();
                }
                this.pageNr = address.pageNr;
                this.recordNr = address.recordNr;
                this.exists = true;
                // storage.debug.log(`Root record address updated to ${address.pageNr}, ${address.recordNr}`.bold);

                // Save to file, or it didn't happen
                const bytes = new Uint8Array(6);
                const view = new DataView(bytes.buffer);
                view.setUint32(0, address.pageNr);
                view.setUint16(4, address.recordNr);
                
                return writeData(HEADER_INDEXES.ROOT_RECORD_ADDRESS, bytes, 0, bytes.length)
                .then(bytesWritten => {
                    storage.debug.log(`Root record address updated to ${address.pageNr}, ${address.recordNr}`.bold);
                });
            }
        }

        const descriptor = encodeString("AceBase⚡"); // textEncoder.encode("AceBase⚡");
        const baseIndex = descriptor.length;
        const HEADER_INDEXES = {
            VERSION_NR: baseIndex,
            DB_LOCK: baseIndex + 1,
            ROOT_RECORD_ADDRESS: baseIndex + 2,
            RECORD_SIZE: baseIndex + 8,
            PAGE_SIZE: baseIndex + 10,
            MAX_INLINE_VALUE_SIZE: baseIndex + 12
        };

        const openDatabaseFile = (justCreated) => {
            return new Promise((resolve, reject) => {
                const error = (err, txt) => {
                    this.debug.error(txt);
                    this.debug.error(err);
                    if (this.file) {
                        fs.close(this.file, (err) => {
                            // ...
                        });
                    }
                    this.emit("error", err);
                    reject(err);
                };

                fs.open(filename, "r+", 0, (err, file) => {
                    if (err) {
                        return error(err, `Failed to open database file`);
                    }
                    this.file = fd = file;

                    // const logfile = fs.openSync(`${this.settings.path}/${this.name}.acebase/log`, 'as');
                    // this.logwrite = (action) => {
                    //     fs.appendFile(logfile, JSON.stringify(action), () => {});
                    // }; 
            
                    const data = Buffer.alloc(64);
                    fs.read(fd, data, 0, data.length, 0, (err, bytesRead) => {
                        if (err) {
                            return error(err, `Could not read database header`);
                        }

                        // Cast Buffer to Uint8Array
                        const header = new Uint8Array(data);
                        
                        // Check descriptor
                        for(let i = 0; i < descriptor.length; i++) {
                            if (header[i] !== descriptor[i]) {
                                return error(`unsupported_db`, `This is not a supported database file`); 
                            }
                        }
                        
                        // Version should be 1
                        let index = descriptor.length;
                        if (header[index] !== 1) {
                            return error(`unsupported_db`, `This database version is not supported, update your source code`);
                        }
                        index++;
                        
                        // File should not be locked
                        if (header[index] !== 0) {
                            return error(`locked_db`, `The database is locked`);
                        }
                        index++;

                        // Read root record address
                        const view = new DataView(header.buffer, index, 6);
                        // let address = this.addressCache.find(""); //this.addressCache.root.address;
                        // address.pageNr = view.getUint32(0);
                        // address.recordNr = view.getUint16(4);
                        this.rootRecord.pageNr = view.getUint32(0);
                        this.rootRecord.recordNr = view.getUint16(4);
                        if (!justCreated) {
                            this.rootRecord.exists = true;
                        }
                        index += 6;

                        // Read saved settings
                        this.settings.recordSize = header[index] << 8 | header[index+1];
                        this.settings.pageSize = header[index+2] << 8 | header[index+3];
                        this.settings.maxInlineValueSize = header[index+4] << 8 | header[index+5];

                        // Done by Storage base class:
                        // colors.setTheme({
                        //     art: ['magenta', 'bold'],
                        //     intro: ['dim']
                        // });
                        this.debug.log(`Database "${name}" details:`.intro);
                        this.debug.log(`- Type: AceBase binary`);
                        this.debug.log(`- Record size: ${this.settings.recordSize}`.intro);
                        this.debug.log(`- Page size: ${this.settings.pageSize}`.intro);
                        this.debug.log(`- Max inline value size: ${this.settings.maxInlineValueSize}`.intro);
                        this.debug.log(`- Root record address: ${this.rootRecord.pageNr}, ${this.rootRecord.recordNr}`.intro);

                        this.KIT.load()  // Read Key Index Table
                        .then(() => {
                            return this.FST.load(); // Read Free Space Table
                        })
                        .then(() => {
                            // Load indexes
                            return this.indexes.load();
                        })
                        .then(() => {
                            resolve(fd);
                            !justCreated && this.emit("ready");
                        });
                    });

                });
            });
        };

        // Open or create database 
        fs.exists(filename, (exists) => {
            if (exists) {
                // Open
                openDatabaseFile(false);
            }
            else {
                // Create the file with 64 byte header (settings etc), KIT, FST & root record
                const version = 1;
                const headerBytes = 64;

                let stats = new Uint8Array([
                    version,    // Version nr
                    0,          // Database file is not locked
                    0,0,0,0,    // Root record pageNr (32 bits)
                    0,0,        // Root record recordNr (16 bits)
                    settings.recordSize >> 8 & 0xff,
                    settings.recordSize & 0xff,
                    settings.pageSize >> 8 & 0xff,
                    settings.pageSize & 0xff,
                    settings.maxInlineValueSize >> 8 & 0xff,
                    settings.maxInlineValueSize & 0xff
                ]);
                let header = concatTypedArrays(descriptor, stats);
                let padding = new Uint8Array(headerBytes - header.length);
                padding.fill(0);
                header = concatTypedArrays(header, padding);
                
                // Create object Key Index Table (KIT) to allow very small record creation.
                // key_index uses 2 bytes, so max 65536 keys could technically be indexed.
                // Using an average key length of 7 characters, the index would become 
                // 7 chars + 1 delimiter * 65536 keys = 520KB. That would be total overkill.
                // The table should be at most 64KB so that means approx 8192 keys can 
                // be indexed. With shorter keys, this will be more. With longer keys, less.
                let kit = new Uint8Array(65536 - header.length);
                kit.fill(0);
                let uint8 = concatTypedArrays(header, kit);

                // Create empty 64KB FST ("Free space table")
                // Each FST record is 8 bytes:
                //    Page nr: 4 bytes
                //    Record start nr: 2 bytes
                //    Record end nr: 2 bytes 
                // Using a 64KB FST (minus 64B header size) allows 8184 entries: (65536-64) / 8
                // Defragmentation should kick in when FST is becoming full!
                let fst = new Uint8Array(65536);
                fst.fill(0);
                uint8 = concatTypedArrays(uint8, fst);

                const dir = filename.slice(0, filename.lastIndexOf('/'));
                if (dir !== '.' && !fs.existsSync(dir)) {
                    fs.mkdirSync(dir);
                }
                fs.writeFile(filename, Buffer.from(uint8.buffer), (err) => {
                    if (err) {
                        throw err;
                    }
                    openDatabaseFile(true)
                    .then(() => {
                        // Now create the root record
                        return Node.set(this, "", {}); //Record.create(this, "", {});
                    })
                    .then(rootRecord => {
                        this.emit("ready");
                    });
                });
            }
        });
    }

    _init() {

    }

    get pageByteSize() {
        return this.settings.pageSize * this.settings.recordSize;
    }

    /**
     * 
     * @param {number} pageNr 
     * @param {number} recordNr 
     */
    getRecordFileIndex(pageNr, recordNr) {
        const index = 
            this.rootRecord.fileIndex 
            + (pageNr * this.pageByteSize) 
            + (recordNr * this.settings.recordSize);
        return index;
    }

    /**
     * Enumerates all children of a given Node for reflection purposes
     * @param {string} path 
     * @param {object} [options] optional options used by implementation for recursive calls
     * @param {string[]|number[]} [options.keyFilter] specify the child keys to get callbacks for, skips .next callbacks for other keys
     * @param {string} [options.tid] optional transaction id for node locking purposes
     * @returns {{ next(child: NodeInfo) => Promise<void>}} returns a generator object that calls .next for each child until the .next callback returns false
     */
    getChildren(path, options = { keyFilter: undefined, tid: undefined }) {
        options = options || {};
        var callback; //, resolve, reject;
        const generator = {
            /**
             * 
             * @param {(child: NodeInfo) => boolean} valueCallback callback function to run for each child. Return false to stop iterating
             * @oldparam {(child: { key?: string, index?: number, valueType: number, value?: any }) => boolean} valueCallback callback function to run for each child. Return false to stop iterating
             * @returns {Promise<bool>} returns a promise that resolves with a boolean indicating if all children have been enumerated, or was canceled by the valueCallback function
             */
            next(valueCallback) {
                callback = valueCallback;
                return start();
                // const promise = new Promise((rs, rj) => { resolve = rs; reject = rj; });
                // return promise;
            }
        };
        const start = () => {
            const tid = this.nodeLocker.createTid(); //ID.generate();
            let canceled = false;
            var lock;
            return this.nodeLocker.lock(path, tid, false, `Node.getChildren "/${path}"`)
            .then(l => {
                lock = l;
                return this.getNodeInfo(path, { tid });
            })
            .then(nodeInfo => {
                if (!nodeInfo.exists) {
                    throw new NodeNotFoundError(`Node "/${path}" does not exist`);
                }
                // const isArray = nodeInfo.type === VALUE_TYPES.ARRAY;
                let reader = new NodeReader(this, nodeInfo.address, lock, true);
                return reader.getChildStream({ keyFilter: options.keyFilter })
                .next(childInfo => {
                    const proceed = callback(childInfo);
                    if (proceed === false) { canceled = true; }
                    return proceed;
                });
            })
            .then(() => {
                lock.release();
                return canceled;
            })
            .catch(err => {
                lock.release('Node.getChildren error');
                this.debug.error(`Error getting children: ${err.message}`);
                throw err;
            });
        };
        return generator;
    }

    /**
     * Gets a node's value and (if supported) revision
     * @param {string} path 
     * @param {object} [options] optional options that can limit the amount of (sub)data being loaded, and any other implementation specific options for recusrsive calls
     * @param {string[]} [options.include] child paths to include
     * @param {string[]} [options.exclude] child paths to exclude
     * @param {boolean} [options.child_objects] whether to include child objects and arrays
     * @param {string} [options.tid] optional transaction id for node locking purposes
     * @returns {Promise<{ revision: string, value: any}>}
     */
    getNode(path, options = { include: undefined, exclude: undefined, child_objects: true, tid: undefined }) {
        const tid = options.tid || this.nodeLocker.createTid(); // ID.generate();
        var lock;
        return this.nodeLocker.lock(path, tid, false, `Node.getValue "/${path}"`)
        .then(l => {
            lock = l;
            return this.getNodeInfo(path, { tid });
        })
        .then(nodeInfo => {
            if (!nodeInfo.exists) {
                return null;
            }
            if (nodeInfo.address) {
                let reader = new NodeReader(this, nodeInfo.address, lock, true);
                return reader.getValue({ include: options.include, exclude: options.exclude, child_objects: options.child_objects });
            }
            return nodeInfo.value;
        })
        .then(value => {
            lock.release();
            return {
                revision: null, // TODO: implement
                value
            };
        });
    }

    /**
     * Retrieves info about a node (existence, wherabouts etc)
     * @param {string} path 
     * @param {object} [options] optional options used by implementation for recursive calls
     * @param {string} [options.tid] optional transaction id for node locking purposes
     * @param {boolean} [options.no_cache=false] 
     * @returns {Promise<NodeInfo>}
     */
    getNodeInfo(path, options = { tid: undefined, no_cache: false }) {
        options = options || {};
        options.no_cache = options.no_cache === true;

        if (path === "") {
            if (!this.rootRecord.exists) {
                return Promise.resolve(new NodeInfo({ path, exists: false }));
            }
            return Promise.resolve(new NodeInfo({ path, address: this.rootRecord.address, exists: true, type: VALUE_TYPES.OBJECT }));
        }

        // Check if the info has been cached
        let cachedInfo = this.nodeCache.find(path, true);
        if (cachedInfo instanceof Promise) {
            // not currently cached, but it was announced
            return cachedInfo;
        }
        else if (cachedInfo) {
            return Promise.resolve(cachedInfo);
        }

        // Cache miss, announce the lookup
        this.nodeCache.announce(path);

        // Try again on the parent node, enable others to bind to our lookup result
        // _currentNodeLookups.set(path, []);
        const pathInfo = PathInfo.get(path); // getPathInfo(path);
        const parentPath = pathInfo.parentPath; //pathInfo.parent;
        const tid = options.tid || this.nodeLocker.createTid(); //ID.generate();

        // Performance issue: 250 requests for different children of a single parent.
        // They will all wait until 1 figures out the parent's address, and then
        // ALL start reading it together to look for their child keys.
        // solution: synthesize requests that must read from the same parent, and
        // handle them in 1 read. Use RxJS Observable?

        // Achieve a read lock on the parent node and read it
        let lock;
        return this.nodeLocker.lock(parentPath, tid, false, `Node.getInfo "/${parentPath}"`)
        .then(l => {
            lock = l;
            return this.getNodeInfo(parentPath, { tid, no_cache: options.no_cache });
        })
        .then(parentInfo => {

            if (!parentInfo.exists || [VALUE_TYPES.OBJECT, VALUE_TYPES.ARRAY].indexOf(parentInfo.valueType) < 0 || !parentInfo.address) {
                // Parent does not exist, is not an object or array, or has no children (object not stored in own address)
                // so child doesn't exist
                const childInfo = new NodeInfo({ path, exists: false });
                this.nodeCache.update(childInfo);
                return childInfo;
            }

            const reader = new NodeReader(this, parentInfo.address, lock, true);
            return reader.getChildInfo(pathInfo.key);
        })
        .then(childInfo => {
            lock.release(`Node.getInfo: done with path "/${parentPath}"`);
            this.nodeCache.update(childInfo, true); // NodeCache.update(childInfo); // Don't have to, nodeReader will have done it already
            return childInfo;
        });
    }

    /**
     * Removes a node by delegating to updateNode on the parent with null value.
     * Throws an Error if path is root ('')
     * @param {string} path
     * @param {object} [options] optional options used by implementation for recursive calls
     * @param {string} [options.tid] optional transaction id for node locking purposes
     * @returns {Promise<void>}
     */
    removeNode(path, options = { tid: undefined }) {
        throw new Error(`This method must be implemented by subclass`);
    }

    /**
     * Delegates to legacy update method that handles everything
     * @param {string} path
     * @param {any} value
     * @param {object} [options] optional options used by implementation for recursive calls
     * @param {string} [options.tid] optional transaction id for node locking purposes
     * @returns {Promise<void>}
     */
    setNode(path, value, options = { tid: undefined }) {
        return this._updateNode(path, value, { merge: false, tid: options.tid });
    }

    /**
     * Delegates to legacy update method that handles everything
     * @param {string} path
     * @param {any} value
     * @param {object} [options] optional options used by implementation for recursive calls
     * @param {string} [options.tid] optional transaction id for node locking purposes
     * @returns {Promise<void>}
     */    
    updateNode(path, updates, options = { tid: undefined }) {
        return this._updateNode(path, updates, { merge: true, tid: options.tid });
    }

    /**
     * Updates or overwrite an existing node, or creates a new node. Handles storing of subnodes, 
     * freeing old node and subnodes allocation, updating/creation of parent nodes, and removing 
     * old cache entries. Triggers event notifications and index updates after the update succeeds.
     * 
     * @param {string} path
     * @param {object} updates object with key/value pairs
     * @param {object} [options] optional options used by implementation for recursive calls
     * @param {string} [options.tid] optional transaction id for node locking purposes
     * @returns {Promise<void>}
     */
    _updateNode(path, value, options = { merge: true, tid: undefined, _internal: false }) {
        // this.debug.log(`Update request for node "/${path}"`);

        const tid = options.tid || this.nodeLocker.createTid(); // ID.generate();
        const pathInfo = PathInfo.get(path);

        if (value === null) {
            // Deletion of node is requested. Update parent
            return this._updateNode(pathInfo.parentPath, { [pathInfo.key]: null }, { merge: true, tid });
        }

        if (path !== "" && this.valueFitsInline(value)) {
            // Simple value, update parent instead
            return this._updateNode(pathInfo.parentPath, { [pathInfo.key]: value }, { merge: true, tid });
        }

        let lock;
        return this.nodeLocker.lock(path, tid, true, '_updateNode')
        .then(l => {
            lock = l;
            return this.getNodeInfo(path, { tid })
        })
        .then(nodeInfo => {
            const merge = nodeInfo.exists && nodeInfo.address && options.merge;
            const write = () => {
                if (merge) {
                    // Node exists already, is stored in its own record, and it must be updated (merged)
                    return _mergeNode(this, nodeInfo, value, lock);
                }
                else {
                    // Node doesn't exist, isn't stored in its own record, or must be overwritten
                    return _createNode(this, nodeInfo, value, lock, !options._internal);
                }
            };
            if (options._internal) {
                return write();
            }
            else {
                return this._writeNodeWithTracking(path, value, { 
                    tid,
                    merge,
                    _customWriteFunction: write // Will use this function instead of this._writeNode
                });
            }
        })
        .then(result => {
            const { recordMoved, recordInfo, deallocate } = result;

            // Update parent if the record moved
            let parentUpdatePromise = Promise.resolve(false);
            if (recordMoved && pathInfo.parentPath !== null) {

                // TODO: Orchestrate parent update requests, so they can be processed in 1 go
                // EG: Node.orchestrateUpdate(storage, path, update, currentLock)
                // The above could then check if there are other pending locks for the parent, 
                // then combine all requested updates and process with 1 call.
                parentUpdatePromise = lock.moveToParent()
                .then(parentLock => {
                    // console.error(`Got parent ${parentLock.forWriting ? 'WRITE' : 'read'} lock on "${pathInfo.parentPath}", tid ${lock.tid}`)
                    lock = parentLock;
                    return this._updateNode(pathInfo.parentPath, { [pathInfo.key]: new InternalNodeReference(recordInfo.valueType, recordInfo.address) }, { merge: true, tid, _internal: true })
                    .then(() => true); // return true for parentUpdated
                });
            }

            return parentUpdatePromise
            .then(parentUpdated => {
                if (parentUpdated && pathInfo.parentPath !== '') {
                    console.assert(this.nodeCache._cache.has(pathInfo.parentPath), 'Not cached?!!');
                }

                // release lock on current target (path or parent)
                lock && lock.release();

                if (deallocate && deallocate.totalAddresses > 0) {
                    // Release record allocation marked for deallocation
                    deallocate.normalize();
                    this.debug.verbose(`Releasing ${deallocate.totalAddresses} addresses (${deallocate.ranges.length} ranges) previously used by node "/${path}" and/or descendants: ${deallocate}`.gray);
                    
                    // // TEMP check, remove loop when all is good:
                    // storage.nodeCache._cache.forEach((entry, path) => {
                    //     let cachedAddress = entry.nodeInfo.address;
                    //     if (!cachedAddress) { return; }
                    //     const i = deallocate.addresses.findIndex(a => a.pageNr === cachedAddress.pageNr && a.recordNr === cachedAddress.recordNr);
                    //     if (i >= 0) {
                    //         throw new Error(`This is bad`);
                    //     }
                    // });

                    this.FST.release(deallocate.ranges);
                }

                return true;
            });
        })
        .catch(err => {
            this.debug.error(`Node.update ERROR: `, err);
            lock && lock.release(`Node.update: error`);
            throw err; //return false;
        });
    }
}

const BINARY_TREE_FILL_FACTOR_50 = 50;
const BINARY_TREE_FILL_FACTOR_95 = 95;

const FLAG_WRITE_LOCK = 0x10;
const FLAG_READ_LOCK = 0x20;
const FLAG_KEY_TREE = 0x40;
const FLAG_VALUE_TYPE = 0xf;

class StorageAddressRange {
    /**
     * 
     * @param {number} pageNr 
     * @param {number} recordNr 
     * @param {number} length 
     */
    constructor(pageNr, recordNr, length) {
        this.pageNr = pageNr;
        this.recordNr = recordNr;
        this.length = length;
    }
}

class StorageAddress {
    /**
     * 
     * @param {number} pageNr 
     * @param {number} recordNr 
     */
    constructor(pageNr, recordNr) {
        this.pageNr = pageNr;
        this.recordNr = recordNr;
    }
}

class NodeAllocation {
    /**
     * 
     * @param {StorageAddressRange[]} allocatedRanges 
     */
    constructor(allocatedRanges) {
        this.ranges = allocatedRanges;
    }

    /**
     * @returns {StorageAddress[]}
     */
    get addresses() {
        let addresses = [];
        this.ranges.forEach(range => {
            for (let i = 0; i < range.length; i++) {
                const address = new StorageAddress(range.pageNr, range.recordNr + i);
                addresses.push(address);
            }
        });
        return addresses; 
    }

    get totalAddresses() {
        return this.ranges.map(range => range.length).reduce((total, nr) => total + nr, 0);
    }

    /**
     * @returns {NodeChunkTable}
     */
    toChunkTable() {
        let ranges = this.ranges.map(range => new NodeChunkTableRange(0, range.pageNr, range.recordNr, range.length));

        if (ranges.length === 1 && ranges[0].length === 1) {
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
                // TODO: Implement type 3 (contigious pages)
            });
        }
        return new NodeChunkTable(ranges);
    }

    /**
     * 
     * @param {StorageAddress[]} records 
     * @returns {NodeAllocation}
     */
    static fromAdresses(records) {
        if (records.length === 0) { 
            throw new Error(`Cannot create allocation for 0 addresses`); 
        }
        let range = new StorageAddressRange(records[0].pageNr, records[0].recordNr, 1);
        let ranges = [range];
        for(let i = 1; i < records.length; i++) {
            if (records[i].pageNr !== range.pageNr || records[i].recordNr !== range.recordNr + range.length) {
                range = new StorageAddressRange(records[i].pageNr, records[i].recordNr, 1);
                ranges.push(range);
            }
            else {
                range.length++;
            }
        }
        return new NodeAllocation(ranges);
    }

    toString() {
        // this.normalize();
        return this.ranges.map(range => {
            return `${range.pageNr},${range.recordNr}+${range.length-1}`;
        })
        .join('; ');
    }

    normalize() {
        // Appends ranges
        const total = this.totalAddresses;
        for(let i = 0; i < this.ranges.length; i++) {
            const range = this.ranges[i];
            let adjRange;
            for (let j = i + 1; j < this.ranges.length; j++) {
                const otherRange = this.ranges[j];
                if (otherRange.pageNr !== range.pageNr) { continue; }
                if (otherRange.recordNr === range.recordNr + range.length) {
                    // This range is right before the other range
                    otherRange.length += range.length;
                    otherRange.recordNr = range.recordNr;
                    adjRange = otherRange;
                    break;
                }
                if (range.recordNr === otherRange.recordNr + otherRange.length) {
                    // This range starts right after the other range
                    otherRange.length += range.length; //otherRange.end = range.end;
                    adjRange = otherRange;
                    break;
                }
            }
            if (adjRange) {
                // range has merged with adjacent one
                this.ranges.splice(i, 1);
                i--;
            }
        }
        console.assert(this.totalAddresses === total, `the amount of addresses changed during normalization`);
    }
}

class NodeChunkTable {
    /**
     * 
     * @param {NodeChunkTableRange[]} ranges 
     */
    constructor(ranges) {
        this.ranges = ranges;
    }
}

class NodeChunkTableRange {
    /**
     * 
     * @param {number} type 
     * @param {number} pageNr 
     * @param {number} recordNr 
     * @param {number} length 
     */
    constructor(type, pageNr, recordNr, length) {
        this.type = type;
        this.pageNr = pageNr;
        this.recordNr = recordNr;
        this.length = length;
    }
}

class RecordInfo {
    /**
     * @param {string} path
     * @param {boolean} hasKeyIndex 
     * @param {number} valueType 
     * @param {NodeAllocation} allocation 
     * @param {number} headerLength 
     * @param {number} lastRecordLength 
     * @param {number} bytesPerRecord
     * @param {Uint8Array} startData
     */
    constructor(path, hasKeyIndex, valueType, allocation, headerLength, lastRecordLength, bytesPerRecord, startData) {
        this.path = path;
        this.hasKeyIndex = hasKeyIndex;
        this.valueType = valueType;
        this.allocation = allocation;
        this.headerLength = headerLength;
        this.lastRecordLength = lastRecordLength;
        this.bytesPerRecord = bytesPerRecord;
        this.startData = startData;
    }

    get totalByteLength() {
        if (this.allocation.ranges.length === 1 && this.allocation.ranges[0].length === 1) {
            // Only 1 record used for storage
            return this.lastRecordLength;
        }

        let byteLength = (((this.allocation.totalAddresses-1) * this.bytesPerRecord) + this.lastRecordLength) - this.headerLength;
        return byteLength;
    }

    get address() {
        const firstRange = this.allocation.ranges[0];
        return new NodeAddress(this.path, firstRange.pageNr, firstRange.recordNr);
    }
}

class TruncatedDataError extends Error {}

class NodeReader {
    /**
     * 
     * @param {AceBaseStorage} storage 
     * @param {NodeAddress} address 
     * @param {NodeLock} lock 
     * @param {boolean} [updateCache=false]
     */
    constructor(storage, address, lock, updateCache = false) {
        if (!(address instanceof NodeAddress)) {
            throw new TypeError(`address argument must be a NodeAddress`);
        }
        this.storage = storage;
        this.address = address;
        this.lock = lock;
        this.lockTimestamp = lock.granted;
        this.updateCache = updateCache;
        
        /** @type {RecordInfo} */
        this.recordInfo = null;

        this._assertLock();

        // console.error(`NodeReader created on ${address}, tid ${lock.tid} (${lock.forWriting ? 'WRITE' : 'read'})`);
        // const cache = storage.nodeCache.find(address.path);
        // if (!cache) {
        //     console.error(`NodeReader: uncached ${address}`); // breakpoint expression: !lock.forWriting && address.path !== ''
        // }
        // else if (!cache.address) {
        //     console.error(`NodeReader: cache for ${address} = ${cache}`);
        // }
        // else if (!cache.address.equals(address)) {
        //     console.error(`NodeReader: cached address ${cache.address} does not match reading address ${address}`);
        // }
    }

    _assertLock() {
        if (this.lock.state !== NodeLock.LOCK_STATE.LOCKED) {
            throw new Error(`Node "/${this.address.path}" must be (read) locked, current state is ${this.lock.state}`);
        }
        if (this.lock.granted !== this.lockTimestamp) {
            // Lock has been renewed/changed? Will have to be read again if this happens.
            //this.recordInfo = null; 
            // Don't allow this to happen
            throw new Error(`Lock on node "/${this.address.path}" has changed. This is not allowed. Debug this`);
        }
    }

    /**
     * @param {boolean} includeChildNodes
     * @returns {Promise<NodeAllocation>}
     */
    getAllocation(includeChildNodes = false) {
        this._assertLock();

        if (!includeChildNodes && this.recordInfo !== null) {
            return Promise.resolve(this.recordInfo.allocation);
        }
        else {
            /** @type {NodeAllocation} */
            let allocation = null;

            return this.readHeader()
            .then(() => {
                allocation = this.recordInfo.allocation;
                if (!includeChildNodes) { 
                    return [{ path: this.address.path, allocation }]; 
                }

                const childPromises = [];
                return this.getChildStream()
                .next(child => {
                    let address = child.address;
                    if (address) {
                        // Get child Allocation
                        let childLock;
                        let promise = this.storage.nodeLocker.lock(child.path, this.lock.tid, false, `NodeReader:getAllocation:child "/${child.path}"`)
                        .then(l => {
                            childLock = l;
                            const reader = new NodeReader(this.storage, address, childLock, this.updateCache);
                            return reader.getAllocation(true);
                        })
                        .then(childAllocation => {
                            childLock.release();
                            //allocation.ranges.push(...childAllocation.ranges);
                            return { path: child.path, allocation: childAllocation };
                        });
                        childPromises.push(promise);
                    }
                })
                .then(() => {
                    return Promise.all(childPromises);
                });
            })
            .then(arr => {
                arr.forEach(result => {
                    allocation.ranges.push(...result.allocation.ranges);
                })
                //console.log(childAllocations);
                return allocation;
            });
        }
    }

    /**
     * Reads all data for this node. Only do this when a stream won't do (eg if you need all data because the record contains a string)
     * @returns {Promise<Uint8Array>}
     */
    getAllData() {
        this._assertLock();
        if (this.recordInfo === null) {
            return this.readHeader().then(() => {
                return this.getAllData();
            });
        }

        let allData = new Uint8Array(this.recordInfo.totalByteLength);
        let index = 0;
        return this.getDataStream()
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
    getValue(options = { include: undefined, exclude: undefined, child_objects: true, no_cache: false }) {
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

        this._assertLock();

        if (this.recordInfo === null) {
            return this.readHeader().then(() => {
                return this.getValue(options);
            });
        }
        
        this.storage.debug.log(`Reading node "/${this.address.path}" from address ${this.address.pageNr},${this.address.recordNr}`.magenta);

        return new Promise((resolve, reject) => {
            switch (this.recordInfo.valueType) {
                case VALUE_TYPES.STRING: {
                    this.getAllData()
                    .then(binary => {
                        let str = decodeString(binary); // textDecoder.decode(binary.buffer);
                        resolve(str);
                    });
                    break;
                }
                case VALUE_TYPES.REFERENCE: {
                    this.getAllData()
                    .then(binary => {
                        let path = decodeString(binary); // textDecoder.decode(binary.buffer);
                        resolve(new PathReference(path));
                    });
                    break;
                }
                case VALUE_TYPES.BINARY: {
                    this.getAllData()
                    .then(binary => {
                        resolve(binary.buffer);
                    });
                    break;
                }
                case VALUE_TYPES.ARRAY:
                case VALUE_TYPES.OBJECT: {
                    // We need ALL data, including from child sub records
                    const isArray = this.recordInfo.valueType === VALUE_TYPES.ARRAY;
                    const promises = [];
                    const obj = isArray ? [] : {};
                    const streamOptions = { };
                    if (options.include && options.include.length > 0) {
                        const keyFilter = options.include.filter(key => key !== '*' && key.indexOf('/') < 0);
                        if (keyFilter.length > 0) { 
                            streamOptions.keyFilter = keyFilter;
                        }
                    }

                    this.getChildStream(streamOptions)
                    .next((child, index) => {
                        if (options.child_objects === false && [VALUE_TYPES.OBJECT, VALUE_TYPES.ARRAY].includes(child.type)) {
                            // Options specify not to include any child objects
                            return;
                        }
                        if (options.include && options.include.length > 0 && !options.include.includes('*') && !options.include.includes(child.key)) { 
                            // This particular child is not in the include list
                            return; 
                        }
                        if (options.exclude && options.exclude.length > 0 && options.exclude.includes(child.key)) {
                            // This particular child is on the exclude list
                            return; 
                        }
                        if (child.address) {
                            let childLock;
                            let childValuePromise = this.storage.nodeLocker.lock(child.address.path, this.lock.tid, false, `NodeReader.getValue:child "/${child.address.path}"`)
                            .then(lock => {
                                childLock = lock;

                                // Are there any relevant nested includes / excludes?
                                let childOptions = {};
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
                                // if (typeof options.no_cache === 'boolean') {
                                //     childOptions.no_cache = options.no_cache;
                                // }

                                // if (options.no_cache !== true) {
                                //     let cachedEntry = NodeCache.find(child.address.path);
                                //     if (!cachedEntry) {
                                //         NodeCache.update(child.address, child.valueType); // Cache its address
                                //     }
                                //     // else if (!cachedAddress.equals(child.address)) {
                                //     //     this.storage.debug.warn(`Using cached address to read child node "/${child.address.path}" from  address ${cachedAddress.pageNr},${cachedAddress.recordNr} instead of (${child.address.pageNr},${child.address.recordNr})`.magenta);
                                //     //     child.address = cachedAddress;
                                //     // }
                                // }

                                // this.storage.debug.log(`Reading child node "/${child.address.path}" from ${child.address.pageNr},${child.address.recordNr}`.magenta);
                                const reader = new NodeReader(this.storage, child.address, childLock, this.updateCache);
                                return reader.getValue(childOptions);
                            })
                            .then(val => {
                                childLock.release(`NodeReader.getValue:child done`);
                                obj[isArray ? child.index : child.key] = val;
                            })
                            .catch(reason => {
                                childLock && childLock.release(`NodeReader.getValue:child ERROR`);
                                this.storage.debug.error(`NodeReader.getValue:child error: `, reason);
                                throw reason;
                            });
                            promises.push(childValuePromise);
                        }
                        else if (typeof child.value !== "undefined") {
                            obj[isArray ? child.index : child.key] = child.value;
                        }
                        else {
                            if (isArray) {
                                throw `Value for index ${child.index} has not been set yet, find out why. Path: ${this.address.path}`;
                            }
                            else {
                                throw `Value for key ${child.key} has not been set yet, find out why. Path: ${this.address.path}`;
                            }
                        }
                    })
                    .then(() => {
                        // We're done reading child info
                        return Promise.all(promises); // Wait for any child reads to complete
                    })
                    .then(() => {
                        resolve(obj);
                    })                        
                    .catch(err => {
                        this.storage.debug.error(err);
                        reject(err);
                    });

                    break;
                }
                default: {
                    throw "Unsupported record value type";
                }
            }
        });
    }

    getDataStream() {
        this._assertLock();

        if (this.recordInfo === null) {
            return this.readHeader()
            .then(() => {
                return this.getDataStream();
            })
        }

        const bytesPerRecord = this.storage.settings.recordSize;
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
                read();
                return promise;
            }
        };

        const read = () => {
            const fileIndex = this.storage.getRecordFileIndex(this.address.pageNr, this.address.recordNr);

            return this.readHeader()
            .then(recordInfo => {

                // Divide all allocation ranges into chunks of maxRecordsPerChunk
                const ranges = recordInfo.allocation.ranges;
                const chunks = [];
                let totalBytes = 0;
                ranges.forEach((range, i) => {
                    let chunk = {
                        pageNr: range.pageNr,
                        recordNr: range.recordNr,
                        length: range.length
                    }
                    let chunkLength = (chunk.length * bytesPerRecord);
                    if (i === ranges.length-1) { 
                        chunkLength -= bytesPerRecord;
                        chunkLength += recordInfo.lastRecordLength;
                    }
                    totalBytes += chunkLength;
                    if (i === 0 && chunk.length > 1) {
                        // Split, first chunk contains start data only
                        let remaining = chunk.length - 1;
                        chunk.length = 1;
                        chunks.push(chunk);
                        chunk = {
                            pageNr: chunk.pageNr,
                            recordNr: chunk.recordNr + 1,
                            length: remaining
                        };
                    }
                    while (chunk.length > maxRecordsPerChunk) {
                        // Split so the chunk has maxRecordsPerChunk
                        let remaining = chunk.length - maxRecordsPerChunk;
                        chunk.length = maxRecordsPerChunk;
                        chunks.push(chunk);
                        chunk = {
                            pageNr: chunk.pageNr,
                            recordNr: chunk.recordNr + maxRecordsPerChunk,
                            length: remaining
                        };
                    }
                    chunks.push(chunk);
                });

                const isLastChunk = chunks.length === 1;

                // Run callback with the first chunk (and possibly the only chunk) already read
                const firstChunkData = recordInfo.startData;
                const { valueType, hasKeyIndex, headerLength, lastRecordLength } = recordInfo;
                let proceed = callback({ 
                    data: recordInfo.startData, 
                    valueType, 
                    chunks, 
                    chunkIndex: 0, 
                    totalBytes, 
                    hasKeyTree: hasKeyIndex, 
                    fileIndex, 
                    headerLength
                }) !== false;

                if (!proceed || isLastChunk) {
                    resolve({ valueType, chunks });
                    return;
                }
                const next = (index) => {
                    //this.storage.debug.log(address.path);
                    const chunk = chunks[index];
                    const fileIndex = this.storage.getRecordFileIndex(chunk.pageNr, chunk.recordNr);
                    let length = chunk.length * bytesPerRecord;
                    if (index === chunks.length-1) {
                        length -= bytesPerRecord;
                        length += lastRecordLength;
                    }
                    const data = new Uint8Array(length);
                    return this.storage.readData(fileIndex, data)
                    .then(bytesRead => {
                        const isLastChunk = index + 1 === chunks.length
                        const proceed = callback({ 
                            data, 
                            valueType, 
                            chunks, 
                            chunkIndex:index, 
                            totalBytes, 
                            hasKeyTree: hasKeyIndex, 
                            fileIndex, 
                            headerLength 
                        }) !== false;

                        if (!proceed || isLastChunk) {
                            resolve({ valueType, chunks });
                            return;
                        }
                        else {
                            return next(index+1);
                        }
                    });
                }
                return next(1);                
            });
        };

        return generator;
    }
 
    /**
     * Starts reading this record, returns a generator that fires .next for each child key until the callback function returns false. The generator (.next) returns a promise that resolves when all child keys have been processed, or was cancelled because false was returned in the generator callback
     * @param {{ keyFilter?: string[] }} options optional options: keyFilter specific keys to get, offers performance and memory improvements when searching specific keys
     * @returns {{next: (cb: (child: NodeInfo, index: number) => boolean) => Promise<void>}  - returns a generator that is called for each child. return false from your .next callback to stop iterating
     */
    getChildStream(options = { keyFilter: undefined }) {
        this._assertLock();

        // if (this.recordInfo === null) {
        //     return this.readHeader()
        //     .then(() => {
        //         return this.getChildStream(options);
        //     })
        // }

        let resolve, reject;
        /** @type {(childInfo: NodeInfo, index: number)} */ let callback;
        let childCount = 0;
        const generator = {
            /**
             * 
             * @param {(childInfo: NodeInfo, index: number)} cb 
             */
            next(cb) { 
                callback = cb; 
                const promise = new Promise((rs, rj) => { resolve = rs; reject = rj; });
                start();
                return promise;
            }
        };

        let isArray = false;
        const start = () => {
            if (this.recordInfo === null) {
                return this.readHeader()
                .then(() => {
                    start();
                });
            }

            isArray = this.recordInfo.valueType === VALUE_TYPES.ARRAY;
            if (this.recordInfo.hasKeyIndex) {
                return createStreamFromBinaryTree()
                .then(resolve)
                .catch(reject);
            }
            // TODO: Enable again?
            // else if (this.allocation.length === 1 && this.allocation[0].length === 1) {
            //     // We have all data in memory (small record)
            //     return createStreamFromLinearData(this.recordInfo.startData, true).then(resolve).catch(reject);
            // }
            else {
                return this.getDataStream()
                .next(({ data, valueType, chunks, chunkIndex, hasKeyTree, headerLength, fileIndex }) => {
                    let isLastChunk = chunkIndex === chunks.length-1;
                    return createStreamFromLinearData(data, isLastChunk); //, fileIndex
                })
                .then(resolve)
                .catch(reject);
            }
        };

        // Gets children from a indexed binary tree of key/value data
        const createStreamFromBinaryTree = () => {
            
            return new Promise((resolve, reject) => {
                let i = 0;
                const tree = new BinaryBPlusTree(this._treeDataReader.bind(this));
                const processLeaf = (leaf) => {

                    // if (!leaf.getNext) {
                    //     resolve(); // Resolve already, so lock can be removed
                    // }

                    const children = leaf.entries
                    .map(entry => {
                        // DISABLED 2020/04/15: key datatype must NEVER be changed!!
                        // if (typeof entry.key !== 'string') { 
                        //     // Have to do this because numeric string keys were saved as numbers for sorting & matching purposes
                        //     entry.key = entry.key.toString(); 
                        // }
                        // /DISABLED
                        if (options.keyFilter && !options.keyFilter.includes(entry.key)) {
                            return null;
                        }
                        const child = isArray ? new NodeInfo({ path: `${this.address.path}[${entry.key}]`, index: entry.key }) : new NodeInfo({ path: `${this.address.path}/${entry.key}`, key: entry.key });
                        const res = getValueFromBinary(child, entry.value.recordPointer, 0);
                        if (res.skip) {
                            return null;
                        }
                        return child;
                    })
                    .filter(child => child !== null);

                    const stop = !children.every(child => {
                        return callback(child, i++) !== false; // Keep going until callback returns false
                    });
                    if (!stop && leaf.getNext) {
                        return leaf.getNext().then(processLeaf);
                    }
                    else { //} if (stop) {
                        resolve(); //done(`readKeyStream:processLeaf, stop=${stop}, last=${!leaf.getNext}`);
                    }
                };

                if (options.keyFilter) { // && !isArray
                    let i = 0;
                    const nextKey = () => {
                        const isLastKey = i + 1 === options.keyFilter.length;
                        const key = options.keyFilter[i];
                        return tree.find(key)
                        .catch(err => {
                            console.error(`Error reading tree for node ${this.address}: ${err.message}`, err);
                            throw err;
                        })
                        .then(value => {
                            // if (isLastKey) {
                            //     resolve();  // Resolve already, so lock can be removed
                            // }

                            let proceed = true;
                            if (value !== null) {
                                const childInfo = isArray ? new NodeInfo({ path: `${this.address.path}[${key}]`, index: key }) : new NodeInfo({ path: `${this.address.path}/${key}`, key });
                                const res = getValueFromBinary(childInfo, value.recordPointer, 0);
                                if (!res.skip) {
                                    proceed = callback(childInfo, i) !== false;
                                }
                            }
                            if (proceed && !isLastKey) {
                                i++;
                                nextKey();
                            }
                            else { //if (!proceed) {
                                resolve(); //done(`readKeyStream:nextKey, proceed=${proceed}, last=${isLastKey}`);
                            }
                        });                        
                    }
                    nextKey().catch(reject);
                }
                else {
                    tree.getFirstLeaf().then(processLeaf).catch(reject);
                }
            });              
        }

        // To get values from binary data:
        /**
         * 
         * @param {NodeInfo} child 
         * @param {number[]} binary 
         * @param {number} index 
         */
        const getValueFromBinary = (child, binary, index) => {
            const startIndex = index;
            const assert = (bytes) => {
                if (index + bytes > binary.length) {
                    throw new TruncatedDataError(`truncated data`); 
                }
            };
            assert(2);
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
                throw new Error("corrupt: removed child data isn't implemented yet");
                // NOTE: will not happen yet because record saving currently rewrites
                // whole records on updating. Adding new/updated data to the end of a 
                // record will offer performance improvements. Rewriting a whole new record
                // can then be scheduled upon x updates
                assert(unusedDataLength);
                index += unusedDataLength;
                child.exists = false;
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
                assert(length);
                const bytes = binary.slice(index, index + length);
                if (child.type === VALUE_TYPES.NUMBER) { child.value = bytesToNumber(bytes); }
                else if (child.type === VALUE_TYPES.STRING) {
                    child.value = decodeString(bytes); // textDecoder.decode(Uint8Array.from(bytes)); 
                }
                else if (child.type === VALUE_TYPES.DATETIME) { let time = bytesToNumber(bytes); child.value = new Date(time); }
                //else if (type === VALUE_TYPES.ID) { value = new ID(bytes); }
                else if (child.type === VALUE_TYPES.ARRAY) { throw new Error(`Inline array deserialization not implemented`); }
                else if (child.type === VALUE_TYPES.OBJECT) { throw new Error(`Inline object deserialization not implemented`); }
                else if (child.type === VALUE_TYPES.BINARY) { child.value = new Uint8Array(bytes).buffer; }
                else if (child.type === VALUE_TYPES.REFERENCE) { 
                    const path = decodeString(bytes); // textDecoder.decode(Uint8Array.from(bytes));
                    child.value = new PathReference(path); 
                }
                else { 
                    throw `Inline value deserialization method missing for value type ${child.type}`
                };
                index += length;
            }
            else if (isRecordValue) {
                // Record address
                assert(6);
                if (typeof binary.buffer === "undefined") {
                    binary = new Uint8Array(binary);
                }
                const view = new DataView(binary.buffer, binary.byteOffset + index, 6);
                const pageNr = view.getUint32(0);
                const recordNr = view.getUint16(4);
                const childPath = isArray ? `${this.address.path}[${child.index}]` : this.address.path === "" ? child.key : `${this.address.path}/${child.key}`;
                child.address = new NodeAddress(childPath, pageNr, recordNr);

                // Cache anything that comes along
                // TODO: Consider moving this to end of function so it caches small values as well
                if (this.updateCache) {
                    this.storage.nodeCache.update(child, false);
                }

                if (child.address && child.address.equals(this.address)) {
                    throw new Error(`Circular reference in record data`);
                }

                index += 6;
            }
            else {
                throw new Error("corrupt");
            }

            //child.file.length = index - startIndex;


            return { index };
        };

        // Gets children from a chunk of data, linear key/value pairs:
        let incompleteData = null;
        const getChildrenFromChunk = (valueType, binary) => {  //, chunkStartIndex) => {
            if (incompleteData !== null) {
                //chunkStartIndex -= incompleteData.length;
                binary = concatTypedArrays(incompleteData, binary);
                incompleteData = null;
            }
            let children = [];
            if (valueType === VALUE_TYPES.OBJECT || valueType === VALUE_TYPES.ARRAY) {
                isArray = valueType === VALUE_TYPES.ARRAY;
                let index = 0;
                const assert = (bytes) => {
                    if (index + bytes > binary.length) { // binary.byteOffset + ... >
                        throw new TruncatedDataError(`truncated data`); 
                    }
                };

                // Index child keys or array indexes
                while(index < binary.length) {
                    childCount++;
                    let startIndex = index;
                    // let child = {
                    //     key: undefined,
                    //     index: undefined,
                    //     type: undefined,
                    //     value: undefined,
                    //     address: undefined,
                    //     // file: {
                    //     //     index: chunkStartIndex + index,
                    //     //     length: 0
                    //     // }
                    // };

                    const child = new NodeInfo({});
    
                    try {
                        if (isArray) {
                            //child.path = `${this.address.path}[${childCount-1}]`;
                            child.path = PathInfo.getChildPath(this.address.path, childCount-1);
                            child.index = childCount-1;
                        }
                        else {
                            assert(2);
                            const keyIndex = (binary[index] & 128) === 0 ? -1 : (binary[index] & 127) << 8 | binary[index+1];
                            if (keyIndex >= 0) {
                                child.key = this.storage.KIT.keys[keyIndex];
                                //child.path =`${this.address.path}/${child.key}`;
                                child.path = PathInfo.getChildPath(this.address.path, child.key);
                                index += 2;
                            }
                            else {
                                const keyLength = (binary[index] & 127) + 1;
                                index++;
                                assert(keyLength);
                                let key = "";
                                for(let i = 0; i < keyLength; i++) {
                                    key += String.fromCharCode(binary[index + i]);
                                }

                                child.key = key;
                                //child.path =`${this.address.path}/${key}`;
                                child.path = PathInfo.getChildPath(this.address.path, key);
                                index += keyLength;
                            }
                        }
        
                        let res = getValueFromBinary(child, binary, index);
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
                        if (err instanceof TruncatedDataError) { //if (err.message === "corrupt") { throw err; }
                            incompleteData = binary.slice(startIndex);
                            break;
                        }
                        else {
                            throw err;
                        }
                    }
                    // next
                }
            }
            return children;
        }

        let i = 0;
        const createStreamFromLinearData = (chunkData, isLastChunk) => { // , chunkStartIndex
            let children = getChildrenFromChunk(this.recordInfo.valueType, chunkData); //, chunkStartIndex);
            let stop = !children.every(child => {
                const proceed = callback(child, i) !== false; // Keep going until callback returns false
                i++;
                return proceed;
            });
            if (stop || isLastChunk) {
                return false;
            }
        }

        return generator;
    }

    /**
     * Retrieves information about a specific child by key name or index
     * @param {string|number} key key name or index number
     * @returns {Promise<NodeInfo>} returns a Promise that resolves with NodeInfo of the child
     */
    getChildInfo(key) {
        let childInfo = null;
        return this.getChildStream({ keyFilter: [key] })
        .next(info => {
            childInfo = info;
        })
        .then(() => {
            if (childInfo) {
                return childInfo;
            }
            let childPath = PathInfo.getChildPath(this.address.path, key);
            return new NodeInfo({ path: childPath, key, exists: false });
        });
    }

    _treeDataWriter(binary, index) {
        if (binary instanceof Array) {
            binary = Buffer.from(binary);
        }
        const length = binary.length;
        const recordSize = this.storage.settings.recordSize;
        const headerLength = this.recordInfo.headerLength;
        const startRecord = {
            nr: Math.floor((headerLength + index) / recordSize),
            offset: (headerLength + index) % recordSize
        };
        const endRecord = {
            nr: Math.floor((headerLength + index + length) / recordSize),
            offset: (headerLength + index + length) % recordSize
        };
        const writeRecords = this.recordInfo.allocation.addresses.slice(startRecord.nr, endRecord.nr + 1);
        const writeRanges = NodeAllocation.fromAdresses(writeRecords).ranges;
        const writes = [];
        // const binary = new Uint8Array(data);
        let bOffset = 0;
        for (let i = 0; i < writeRanges.length; i++) {
            const range = writeRanges[i];
            let fIndex = this.storage.getRecordFileIndex(range.pageNr, range.recordNr);
            let bLength = range.length * recordSize;
            if (i === 0) { 
                fIndex += startRecord.offset; 
                bLength -= startRecord.offset; 
            }
            if (bOffset + bLength > length) {
                bLength = length - bOffset;
            }
            let p = this.storage.writeData(fIndex, binary, bOffset, bLength);
            writes.push(p);
            bOffset += bLength;
        }
        return Promise.all(writes);
    }

    // Translates requested data index and length to actual record data location and reads it
    _treeDataReader(index, length) {
        // console.log(`...read request for index ${index}, length ${length}...`);
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
        const headerLength = this.recordInfo.headerLength;
        const startRecord = {
            nr: Math.floor((headerLength + index) / recordSize),
            offset: (headerLength + index) % recordSize
        };
        const endRecord = {
            nr: Math.floor((headerLength + index + length) / recordSize),
            offset: (headerLength + index + length) % recordSize
        };
        const readRecords = this.recordInfo.allocation.addresses.slice(startRecord.nr, endRecord.nr + 1);
        if (readRecords.length === 0) {
            throw new Error('Attempt to read non-existing records');
        }
        const readRanges = NodeAllocation.fromAdresses(readRecords).ranges;
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
            let p = this.storage.readData(fIndex, binary, bOffset, bLength);
            reads.push(p);
            bOffset += bLength;
        }
        return Promise.all(reads)
        .then(() => {
            // Convert Uint8Array to byte array (as long as BinaryBPlusTree doesn't work with typed arrays)
            // let bytes = [];
            // binary.forEach(val => bytes.push(val));
            // return bytes;
            return Buffer.from(binary.buffer);
        });
    }

    readHeader() {
        this._assertLock();
        // console.error(`NodeReader.readHeader ${this.address}, tid ${this.lock.tid}`);

        const bytesPerRecord = this.storage.settings.recordSize;
        const fileIndex = this.storage.getRecordFileIndex(this.address.pageNr, this.address.recordNr);
        let data = new Uint8Array(bytesPerRecord);
        return this.storage.readData(fileIndex, data.buffer)
        .then(bytesRead => {

            const hasKeyIndex = (data[0] & FLAG_KEY_TREE) === FLAG_KEY_TREE;
            const valueType = data[0] & FLAG_VALUE_TYPE; // Last 4-bits of first byte of read data has value type

            let view = new DataView(data.buffer);
            // Read Chunk Table
            // TODO: If the CT is too big for 1 record, it needs to read more records or it will crash... 
            // UPDATE: the max amount of chunks === nr of whole pages needed + 3, so this will (probably) never happen
            // UPDATE: It does! It happened! 17 pages: 2MB of data for 1 node - 17 * 9 = 153 bytes which is > 128!

            let offset = 1;
            let firstRange = new StorageAddressRange(this.address.pageNr, this.address.recordNr, 1);

            /**
             * @type {StorageAddressRange[]}
             */
            const ranges = [firstRange];
            const allocation = new NodeAllocation(ranges);
            let readingRecordIndex = 0;

            // const assert = (length) => {
            //     if (offset + length >= view.byteLength) {
            //         // Need to read more data
            //         readingRecordIndex++;
            //         let address = allocation.addresses[readingRecordIndex];
            //         let fileIndex = this.storage.getRecordFileIndex(address.pageNr, address.recordNr);
            //         let moreData = new Uint8Array(bytesPerRecord);
            //         return this.storage.readData(fileIndex, moreData.buffer)
            //         .then(() => {
            //             data = concatTypedArrays(data, moreData);
            //             view = new DataView(data.buffer);
            //         });
            //     }
            //     else {
            //         return Promise.resolve();
            //     }
            // };

            // const readAllocation = () => {
            //     return assert(1)
            //     .then(() => {
            //         const type = view.getUint8(offset);
            //         if (type === 0) { 
            //             // No more chunks, exit
            //             offset++;
            //         }
            //         else if (type === 1) {
            //             // First chunk is longer than the 1 record already read
            //             return assert(3)
            //             .then(() => {
            //                 firstRange.length = view.getUint16(offset + 1);
            //                 offset += 3;
            //                 return readAllocation();
            //             })
            //         }
            //         else if (type === 2) {
            //             // Next chunk is location somewhere else (not contigious)
            //             return assert(9)
            //             .then(() => {
            //                 const pageNr = view.getUint32(offset + 1);
            //                 const recordNr = view.getUint16(offset + 5);
            //                 const length = view.getUint16(offset + 7);
        
            //                 const range = new StorageAddressRange(pageNr, recordNr, length);
            //                 ranges.push(range);
            //                 offset += 9;    
            //                 return readAllocation();                        
            //             });
            //         }
            //         else if (type === 3) {
            //             // NEW Next chunk is a number of contigious pages (large!)
            //             // NOT IMPLEMENTED YET
            //             return assert(7)
            //             .then(() => {
            //                 const pageNr = view.getUint32(offset + 1);
            //                 const totalPages = view.getUint16(offset + 5);
            //                 const range = new StorageAddressRange(pageNr, 0, totalPages * this.storage.settings.pageSize);
            //                 ranges.push(range);
            //                 offset += 7;
            //                 return readAllocation();                        
            //             });
            //         }
            //     })
            //     .then(() => {
            //         return assert(2)
            //         .then(() => {
            //             const lastRecordDataLength = view.getUint16(offset);
            //             offset += 2;
            //             return lastRecordDataLength;
            //         });
            //     });
            // };
            
            // return readAllocation()
            // .then(lastRecordDataLength => {

            const readAllocationTable = () => {
                return new Promise((resolve, reject) => {                    
                    while(true) {

                        if (offset + 9 + 2 >= data.length) {
                            // Read more data
                            readingRecordIndex++;
                            let address = allocation.addresses[readingRecordIndex];
                            let fileIndex = this.storage.getRecordFileIndex(address.pageNr, address.recordNr);
                            let moreData = new Uint8Array(bytesPerRecord);
                            return this.storage.readData(fileIndex, moreData.buffer)
                            .then(() => {
                                data = concatTypedArrays(data, moreData);
                                view = new DataView(data.buffer);
                                readAllocationTable().then(resolve).catch(reject);
                            });
                        }

                        const type = view.getUint8(offset);
                        if (type === 0) { 
                            // No more chunks, exit
                            offset++;
                            break;
                        }
                        else if (type === 1) {
                            // First chunk is longer than the 1 record already read
                            firstRange.length = view.getUint16(offset + 1);
                            offset += 3;
                        }
                        else if (type === 2) {
                            // Next chunk is location somewhere else (not contigious)
                            const pageNr = view.getUint32(offset + 1);
                            const recordNr = view.getUint16(offset + 5);
                            const length = view.getUint16(offset + 7);

                            const range = new StorageAddressRange(pageNr, recordNr, length);
                            ranges.push(range);
                            offset += 9;    
                        }
                        else if (type === 3) {
                            // NEW Next chunk is a number of contigious pages (large!)
                            // NOT IMPLEMENTED YET
                            const pageNr = view.getUint32(offset + 1);
                            const totalPages = view.getUint16(offset + 5);
                            const range = new StorageAddressRange(pageNr, 0, totalPages * this.storage.settings.pageSize);
                            ranges.push(range);
                            offset += 7;
                        }
                        else {
                            throw new TypeError(`Unknown chunk type ${type} while reading record at ${this.address}`);
                        }
                    }
                    resolve();
                });
            }

            return readAllocationTable()
            .then(() => {
                const lastRecordDataLength = view.getUint16(offset);
                offset += 2;

                const headerLength = offset;
                // const allocation = new NodeAllocation(ranges);
                const firstRecordDataLength = ranges.length === 1 && ranges[0].length == 1 
                    ? lastRecordDataLength 
                    : bytesPerRecord - headerLength;

                this.recordInfo = new RecordInfo(
                    this.address.path,
                    hasKeyIndex,
                    valueType,
                    allocation,
                    headerLength,
                    lastRecordDataLength,
                    bytesPerRecord,
                    data.slice(headerLength, headerLength + firstRecordDataLength)
                );

                return this.recordInfo;
            });
        });
    }

    getChildTree() {
        if (this.recordInfo === null) { throw new Error(`record info hasn't been read yet`); }
        if (!this.recordInfo.hasKeyIndex) { throw new Error(`record has no key index tree`); }
        return new BinaryBPlusTree(
            this._treeDataReader.bind(this), 
            1024 * 100, // 100KB reads/writes
            this._treeDataWriter.bind(this),
            'record@' + this.recordInfo.address.toString()
        );
    }
}

class NodeChange {
    static get CHANGE_TYPE() {
        return {
            UPDATE: 'update',
            DELETE: 'delete',
            INSERT: 'insert'
        };
    }

    /**
     * 
     * @param {string|number} keyOrIndex 
     * @param {string} changeType 
     * @param {any} oldValue 
     * @param {any} newValue 
     */
    constructor(keyOrIndex, changeType, oldValue, newValue) {
        this.keyOrIndex = keyOrIndex;
        this.changeType = changeType;
        this.oldValue = oldValue;
        this.newValue = newValue;
    }
}

class NodeChangeTracker {
    /**
     * 
     * @param {string} path 
     */
    constructor(path) {
        this.path = path;
        /** @type {NodeChange[]} */ 
        this._changes = [];
        /** @type {object|Array} */ 
        this._oldValue = undefined;
        this._newValue = undefined;
    }

    addDelete(keyOrIndex, oldValue) {
        const change = new NodeChange(keyOrIndex, NodeChange.CHANGE_TYPE.DELETE, oldValue, null);
        this._changes.push(change);
        return change;
    }
    addUpdate(keyOrIndex, oldValue, newValue) {
        const change = new NodeChange(keyOrIndex, NodeChange.CHANGE_TYPE.UPDATE, oldValue, newValue)
        this._changes.push(change);
        return change;
    }
    addInsert(keyOrIndex, newValue) {
        const change = new NodeChange(keyOrIndex, NodeChange.CHANGE_TYPE.INSERT, null, newValue)
        this._changes.push(change);
        return change;
    }
    add(keyOrIndex, currentValue, newValue) {
        if (currentValue === null) {
            if (newValue === null) { 
                throw new Error(`Wrong logic for node change on "${this.nodeInfo.path}/${keyOrIndex}" - both old and new values are null`);
            }
            return this.addInsert(keyOrIndex, newValue);
        }
        else if (newValue === null) {
            return this.addDelete(keyOrIndex, currentValue);
        }
        else {
            return this.addUpdate(keyOrIndex, currentValue, newValue);
        }            
    }

    get updates() {
        return this._changes.filter(change => change.changeType === NodeChange.CHANGE_TYPE.UPDATE);
    }
    get deletes() {
        return this._changes.filter(change => change.changeType === NodeChange.CHANGE_TYPE.DELETE);
    }
    get inserts() {
        return this._changes.filter(change => change.changeType === NodeChange.CHANGE_TYPE.INSERT);
    }
    get all() {
        return this._changes;
    }
    get totalChanges() {
        return this._changes.length;
    }
    get(keyOrIndex) {
        return this._changes.find(change => change.keyOrIndex === keyOrIndex);
    }
    hasChanged(keyOrIndex) {
        return !!this.get(keyOrIndex);
    }

    get newValue() {
        if (typeof this._newValue === 'object') { return this._newValue; }
        if (typeof this._oldValue === 'undefined') { throw new TypeError(`oldValue is not set`); }
        let newValue = {};
        Object.keys(this.oldValue).forEach(key => newValue[key] = oldValue[key]);
        this.deletes.forEach(change => delete newValue[change.key]);
        this.updates.forEach(change => newValue[change.key] = change.newValue);
        this.inserts.forEach(change => newValue[change.key] = change.newValue);
        return newValue;
    }
    set newValue(value) {
        this._newValue = value;
    }

    get oldValue() {
        if (typeof this._oldValue === 'object') { return this._oldValue; }
        if (typeof this._newValue === 'undefined') { throw new TypeError(`newValue is not set`); }
        let oldValue = {};
        Object.keys(this.newValue).forEach(key => oldValue[key] = newValue[key]);
        this.deletes.forEach(change => oldValue[change.key] = change.oldValue);
        this.updates.forEach(change => oldValue[change.key] = change.oldValue);
        this.inserts.forEach(change => delete oldValue[change.key]);
        return oldValue;
    }
    set oldValue(value) {
        this._oldValue = value;
    }

    get typeChanged() {
        return typeof this.oldValue !== typeof this.newValue 
            || (this.oldValue instanceof Array && !(this.newValue instanceof Array))
            || (this.newValue instanceof Array && !(this.oldValue instanceof Array));
    }

    static create(path, oldValue, newValue) {
        const changes = new NodeChangeTracker(path);
        changes.oldValue = oldValue;
        changes.newValue = newValue;

        typeof oldValue === 'object' && Object.keys(oldValue).forEach(key => {
            if (typeof newValue === 'object' && key in newValue && newValue !== null) {
                changes.add(key, oldValue[key], newValue[key]);
            }
            else {
                changes.add(key, oldValue[key], null);
            }
        });
        typeof newValue === 'object' && Object.keys(newValue).forEach(key => {
            if (typeof oldValue !== 'object' || !(key in oldValue) || oldValue[key] === null) {
                changes.add(key, null, newValue[key]);
            }
        });
        return changes;
    }
}

/**
 * 
 * @param {AceBaseStorage} storage 
 * @param {NodeInfo} nodeInfo 
 * @param {object} newValue 
 * @param {NodeLock} lock
 * @returns {RecordInfo}
 */
function _mergeNode(storage, nodeInfo, updates, lock) {
    if (typeof updates !== "object") {
        throw new TypeError(`updates parameter must be an object`);
    }

    const nodeReader = new NodeReader(storage, nodeInfo.address, lock, false);
    const affectedKeys = Object.keys(updates);
    const changes = new NodeChangeTracker(nodeInfo.path);

    const newKeys = affectedKeys.slice();
    const discardAllocation = new NodeAllocation([]);
    let isArray = false;
    let isInternalUpdate = false;

    return nodeReader.readHeader()
    .then(recordInfo => {

        isArray = recordInfo.valueType === VALUE_TYPES.ARRAY;
        nodeInfo.type = recordInfo.valueType; // Set in nodeInfo too, because it might be unknown

        const childValuePromises = [];

        if (isArray) {
            // keys to update must be integers
            for (let i = 0; i < affectedKeys.length; i++) {
                if (isNaN(affectedKeys[i])) { throw new Error(`Cannot merge existing array of path "${nodeInfo.path}" with an object`); }
                affectedKeys[i] = +affectedKeys[i]; // Now an index
            }
        }
        return nodeReader.getChildStream({ keyFilter: affectedKeys })
        .next(child => {

            const keyOrIndex = isArray ? child.index : child.key;
            newKeys.splice(newKeys.indexOf(keyOrIndex), 1); // Remove from newKeys array, it exists already
            const newValue = updates[keyOrIndex];
    
            // Get current value
            if (child.address) {

                if (newValue instanceof InternalNodeReference) {
                    // This update originates from a child node update, its record location changed
                    // so we only have to update the reference to the new location

                    isInternalUpdate = true;
                    const oldAddress = child.address; //child.storedAddress || child.address;
                    const currentValue = new InternalNodeReference(child.type, oldAddress);
                    changes.add(keyOrIndex, currentValue, newValue);
                    return true; // Proceed with next (there is no next, right? - this update must has have been triggered by child node that moved, the parent node only needs to update the referennce to the child node)
                }

                // Child is stored in own record, and it is updated or deleted so we need to get
                // its allocation so we can release it when updating is done
                const promise = storage.nodeLocker.lock(child.address.path, lock.tid, false, `_mergeNode: read child "/${child.address.path}"`)
                .then(childLock => {
                    const childReader = new NodeReader(storage, child.address, childLock, false);
                    return childReader.getAllocation(true)
                    .then(allocation => {
                        childLock.release();
                        discardAllocation.ranges.push(...allocation.ranges);
                        const currentChildValue = new InternalNodeReference(child.type, child.address);
                        changes.add(keyOrIndex, currentChildValue, newValue);
                    });
                });
                childValuePromises.push(promise);
            }
            else {
                changes.add(keyOrIndex, child.value, newValue);
            }
        })
        .then(() => {
            return Promise.all(childValuePromises);            
        });
    })
    .then(() => {
        // Check which keys we haven't seen (were not in the current node), these will be added
        newKeys.forEach(key => {
            const newValue = updates[key];
            if (newValue !== null) {
                changes.add(key, null, newValue);
            }
        });

        if (changes.all.length === 0) {
            storage.debug.log(`No effective changes to update node "/${nodeInfo.path}" with`.yellow);
            return nodeReader.recordInfo;
        }

        storage.debug.log(`Node "/${nodeInfo.path}" being updated:${isInternalUpdate ? ' (internal)' : ''} adding ${changes.inserts.length} keys (${changes.inserts.map(ch => `"${ch.keyOrIndex}"`).join(',')}), updating ${changes.updates.length} keys (${changes.updates.map(ch => `"${ch.keyOrIndex}"`).join(',')}), removing ${changes.deletes.length} keys (${changes.deletes.map(ch => `"${ch.keyOrIndex}"`).join(',')})`.cyan);
        if (!isInternalUpdate) {
            // Update cache (remove entries or mark them as deleted)
            const pathInfo = PathInfo.get(nodeInfo.path);
            const invalidatePaths = changes.all
                .filter(ch => !(ch.newValue instanceof InternalNodeReference))
                .map(ch => {
                    const childPath = pathInfo.childPath(ch.keyOrIndex);
                    return { 
                        path: childPath, 
                        pathInfo: PathInfo.get(childPath), 
                        action: ch.changeType === NodeChange.CHANGE_TYPE.DELETE ? 'delete' : 'invalidate' 
                    };
                });
            storage.nodeCache.invalidate(nodeInfo.path, false, 'mergeNode');
            if (invalidatePaths.length > 0) {
                storage.nodeCache.invalidate(nodeInfo.path, path => {
                    // if (path === nodeInfo.path) { return true; }
                    const i = invalidatePaths.findIndex(inv => inv.path === path || inv.pathInfo.isAncestorOf(path));
                    if (i < 0) { return false; }
                    else if (invalidatePaths[i].action === 'invalidate') { 
                        return true; 
                    }
                    else {
                        storage.nodeCache.delete(invalidatePaths[i].path);
                    }
                    return false;
                }, 'mergeNode');
            }
        }

        // What we need to do now is make changes to the actual record data. 
        // The record is either a binary B+Tree (larger records), 
        // or a list of key/value pairs (smaller records).
        let updatePromise;
        if (nodeReader.recordInfo.hasKeyIndex) {

            // Try to have the binary B+Tree updated. If there is not enough free space for this
            // (eg, if a leaf to add to is full), we have to rebuild the whole tree and write new records

            const childPromises = [];
            changes.all.forEach(change => {
                const childPath = PathInfo.getChildPath(nodeInfo.path, change.keyOrIndex)
                if (change.oldValue !== null) {
                    let kvp = _serializeValue(storage, childPath, change.keyOrIndex, change.oldValue, null);
                    console.assert(kvp instanceof SerializedKeyValue, `return value must be of type SerializedKeyValue, it cannot be a Promise!`);
                    let bytes = _getValueBytes(kvp);
                    change.oldValue = bytes;
                }
                if (change.newValue !== null) {
                    let s = _serializeValue(storage, childPath, change.keyOrIndex, change.newValue, lock.tid);
                    let convert = (kvp) => {
                        let bytes = _getValueBytes(kvp);
                        change.newValue = bytes;
                    }
                    if (s instanceof Promise) {
                        s = s.then(convert);
                        childPromises.push(s);
                    }
                    else {
                        convert(s);
                    }
                }
            });

            let operations = [];
            let tree = nodeReader.getChildTree();
            updatePromise = Promise.all(childPromises)
            .then(() => {
                changes.deletes.forEach(change => {
                    // let oldValue = change.oldValue;
                    // if (oldValue instanceof NodeAddress) {
                    //     oldValue = new InternalNodeReference(oldValue);
                    // }
                    // oldValue = _getValueBytes(oldValue);
                    //operations.push({ type: 'remove', key: change.keyOrIndex, value: change.oldValue });
                    const op = BinaryBPlusTree.TransactionOperation.remove(change.keyOrIndex, change.oldValue);
                    operations.push(op);
                });
                changes.updates.forEach(change => {
                    // operations.push({ type: 'update', key: change.keyOrIndex, currentValue: change.oldValue, newValue: change.newValue });
                    const oldEntryValue = new BinaryBPlusTree.EntryValue(change.oldValue);
                    const newEntryValue = new BinaryBPlusTree.EntryValue(change.newValue);
                    const op = BinaryBPlusTree.TransactionOperation.update(change.keyOrIndex, newEntryValue, oldEntryValue);
                    operations.push(op);
                });
                changes.inserts.forEach(change => {
                    // operations.push({ type: 'add', key: change.keyOrIndex, value: change.newValue });
                    const op = BinaryBPlusTree.TransactionOperation.add(change.keyOrIndex, change.newValue);
                    operations.push(op);
                });

                // Changed behaviour: 
                // previously, if 1 operation failed, the tree was rebuilt. If any operation thereafter failed, it stopped processing
                // now, processOperations() will be called after each rebuild, so all operations will be processed
                const processOperations = (retry = 0, prevRecordInfo = nodeReader.recordInfo) => {
                    return tree.transaction(operations)
                    .then(() => {
                        // Successfully updated!
                        storage.debug.log(`Updated tree for node "/${nodeInfo.path}"`.green); 
                        return prevRecordInfo;
                    })
                    .catch(err => {
                        storage.debug.log(`Could not update tree for "/${nodeInfo.path}"${retry > 0 ? ` (retry ${retry})` : ''}: ${err.message}`.yellow);
                        // Failed to update the binary data, we need to recreate the whole tree
        
                        // Rebuild the tree the old-fashioned in-memory way. 
                        // TODO: rebuild tree on disk with streams. See data-index.js
                        let bytes = [];
                        let writer = BinaryWriter.forArray(bytes);
                        return tree.rebuild(writer)
                        .then(() => {
                            return _write(storage, nodeInfo.path, nodeReader.recordInfo.valueType, bytes, undefined, true, nodeReader.recordInfo);
                        })
                        .then(recordInfo => {
                            bytes = null; // Help GC
                            if (retry >= 1 && prevRecordInfo !== recordInfo) {
                                // If this is a 2nd+ call to processOperations, we have to release the previous allocation here
                                discardAllocation.ranges.push(...prevRecordInfo.allocation.ranges);
                            }
                            const newNodeReader = new NodeReader(storage, recordInfo.address, lock, false);
                            return newNodeReader.readHeader()
                            .then(info => {
                                tree = new BinaryBPlusTree(
                                    newNodeReader._treeDataReader.bind(newNodeReader), 
                                    1024 * 100, // 100KB reads/writes
                                    newNodeReader._treeDataWriter.bind(newNodeReader),
                                    'record@' + newNodeReader.recordInfo.address.toString()
                                );
                                // Retry remaining operations
                                return processOperations(retry+1, recordInfo);
                            });
                        })
                    });
                }
                return processOperations();
            });
        }
        else {
            // This is a small record. In the future, it might be nice to make changes 
            // in the record itself, but let's just rewrite it for now.

            // TODO: Do not deallocate here, pass exising allocation to _writeNode, so it can be reused
            // discardAllocation.ranges.push(...nodeReader.recordInfo.allocation.ranges);
            let mergedValue = isArray ? [] : {};

            updatePromise = nodeReader.getChildStream()
            .next(child => {
                let keyOrIndex = isArray ? child.index : child.key;
                if (child.address) { //(child.storedAddress || child.address) {
                    //mergedValue[keyOrIndex] = new InternalNodeReference(child.type, child.storedAddress || child.address);
                    mergedValue[keyOrIndex] = new InternalNodeReference(child.type, child.address);
                }
                else {
                    mergedValue[keyOrIndex] = child.value;
                }
            })
            .then(() => {
                changes.deletes.forEach(change => {
                    delete mergedValue[change.keyOrIndex];
                });
                changes.updates.forEach(change => {
                    mergedValue[change.keyOrIndex] = change.newValue;
                });
                changes.inserts.forEach(change => {
                    mergedValue[change.keyOrIndex] = change.newValue;
                });

                if (isArray) {
                    const isExhaustive = mergedValue.filter(val => typeof val !== 'undefined').length === mergedValue.length;
                    if (!isExhaustive) {
                        throw new Error(`Elements cannot be inserted beyond, or removed before the end of an array. Rewrite the whole array at path "${nodeInfo.path}" or change your schema to use an object collection instead`);
                    }
                }
                return _writeNode(storage, nodeInfo.path, mergedValue, lock, nodeReader.recordInfo);
            });
        }

        return updatePromise;
    })
    .then(recordInfo => {
        let recordMoved = false;
        if (recordInfo !== nodeReader.recordInfo) {
            // release the old record allocation
            discardAllocation.ranges.push(...nodeReader.recordInfo.allocation.ranges);
            recordMoved = true;
        }
        // Necessary?
        storage.nodeCache.update(new NodeInfo({ path: nodeInfo.path, type: nodeInfo.type, address: recordInfo.address, exists: true }), true);
        return { recordMoved, recordInfo, deallocate: discardAllocation };
    });
}

/**
 * 
 * @param {AceBaseStorage} storage 
 * @param {NodeInfo} nodeInfo 
 * @param {object} newValue 
 * @param {NodeLock} lock
 * @returns {RecordInfo}
 */
function _createNode(storage, nodeInfo, newValue, lock, invalidateCache = true) {
    storage.debug.log(`Node "/${nodeInfo.path}" is being ${nodeInfo.exists ? 'overwritten' : 'created'}`.cyan);

    /** @type {NodeAllocation} */
    let currentAllocation = null;

    let getCurrentAllocation = Promise.resolve(null);
    if (nodeInfo.exists && nodeInfo.address) {
        // Current value occupies 1 or more records we can probably reuse. 
        // For now, we'll allocate new records though, then free the old allocation
        const nodeReader = new NodeReader(storage, nodeInfo.address, lock, false); //Node.getReader(storage, nodeInfo.address, lock);
        getCurrentAllocation = nodeReader.getAllocation(true);
    }

    return getCurrentAllocation.then(allocation => {
        currentAllocation = allocation;
        if (invalidateCache) {
            storage.nodeCache.invalidate(nodeInfo.path, true, 'createNode'); // remove cache
        }
        return _writeNode(storage, nodeInfo.path, newValue, lock); 
    })
    .then(recordInfo => {
        return { recordMoved: true, recordInfo, deallocate: currentAllocation };
    });
}

/**
 * 
 * @param {AceBaseStorage} storage 
 * @param {string} path 
 * @param {any} value 
 * @param {string} parentTid 
 * @returns {Promise<RecordInfo>}
 */
function _lockAndWriteNode(storage, path, value, parentTid) {
    let lock;
    return storage.nodeLocker.lock(path, parentTid, true, `_lockAndWrite "${path}"`)
    .then(l => {
        lock = l;
        return _writeNode(storage, path, value, lock);
    })
    .then(recordInfo => {
        lock.release();
        return recordInfo;
    });
}

/**
 * 
 * @param {AceBaseStorage} storage 
 * @param {string} path 
 * @param {any} value 
 * @param {NodeLock} lock
 * @returns {Promise<RecordInfo>}
 */
function _writeNode(storage, path, value, lock, currentRecordInfo = undefined) {
    if (lock.path !== path || !lock.forWriting) {
        throw new Error(`Cannot write to node "/${path}" because lock is on the wrong path or not for writing`);
    }

    if (typeof value === "string") {
        const encoded = encodeString(value); //textEncoder.encode(value);
        return _write(storage, path, VALUE_TYPES.STRING, encoded, value, false, currentRecordInfo);
    }
    else if (value instanceof PathReference) {
        const encoded = encodeString(value.path); // textEncoder.encode(value.path);
        return _write(storage, path, VALUE_TYPES.REFERENCE, encoded, value, false, currentRecordInfo);
    }
    else if (value instanceof ArrayBuffer) {
        return _write(storage, path, VALUE_TYPES.BINARY, new Uint8Array(value), value, false, currentRecordInfo);
    }
    else if (typeof value !== "object") {
        throw new TypeError(`Unsupported type to store in stand-alone record`);
    }

    // Store array or object
    let childPromises = [];
    /** @type {SerializedKeyValue[]} */
    let serialized = [];
    let isArray = value instanceof Array;
    
    if (isArray) {
        // Store array
        const isExhaustive = value.filter(val => typeof val !== 'undefined' && val !== null).length === value.length;
        if (!isExhaustive) {
            throw new Error(`Cannot store arrays with missing entries`);
        }
        value.forEach((val, index) => {
            if (typeof val === "function") {
                throw new Error(`Array at index ${index} has invalid value. Cannot store functions`);
            }
            const childPath = `${path}[${index}]`;
            let s = _serializeValue(storage, childPath, index, val, lock.tid);
            const add = (s) => {
                serialized[index] = s; // Fixed: Array order getting messed up (with serialized.push after promises resolving)
            }
            if (s instanceof Promise) {
                s = s.then(add);
                childPromises.push(s);
            }
            else {
                add(s);
            }
        });
    }
    else {
        // Store object
        Object.keys(value).forEach(key => {
            const childPath = PathInfo.getChildPath(path, key); // `${path}/${key}`;
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
                    throw new Error(`Property "${key}" has invalid value. Cannot store undefined values. Set removeVoidProperties option to true to automatically remove undefined properties`);
                }
            }
            else {
                let s = _serializeValue(storage, childPath, key, val, lock.tid);
                const add = (s) => {
                    serialized.push(s);
                }
                if (s instanceof Promise) {
                    s = s.then(add);
                    childPromises.push(s);
                }
                else {
                    add(s);
                }
            }
        });
    }

    return Promise.all(childPromises).then(() => {
        // Append all serialized data into 1 binary array

        const minKeysPerNode = 25;
        const minKeysForTreeCreation = 100;
        if (true && serialized.length > minKeysForTreeCreation) {
            // Create a B+tree
            keyTree = true;
            let fillFactor = 
                isArray || serialized.every(kvp => typeof kvp.key === 'string' && /^[0-9]+$/.test(kvp.key))
                    ? BINARY_TREE_FILL_FACTOR_50
                    : BINARY_TREE_FILL_FACTOR_95;

            const builder = new BPlusTreeBuilder(true, fillFactor);
            serialized.forEach(kvp => {
                let binaryValue = _getValueBytes(kvp);
                builder.add(isArray ? kvp.index : kvp.key, binaryValue);
            });
            // TODO: switch from array to Uint8ArrayBuilder:
            let bytes = [];
            return builder.create().toBinary(true, BinaryWriter.forArray(bytes))
            .then(() => {
                // // Test tree
                // return BinaryBPlusTree.test(bytes)
                // .then(() => {
                return { keyTree: true, data: Uint8Array.from(bytes) };
                // })
            });
        }
        else {
            const data = serialized.reduce((binary, kvp) => {
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
                const binaryValue = _getValueBytes(kvp);
                binaryValue.forEach(val => bytes.push(val));//bytes.push(...binaryValue);
                return concatTypedArrays(binary, new Uint8Array(bytes));
            }, new Uint8Array());
            return { keyTree: false, data };
        }
    })
    .then(result => {
        // Now write the record
        return _write(storage, path, isArray ? VALUE_TYPES.ARRAY : VALUE_TYPES.OBJECT, result.data, serialized, result.keyTree, currentRecordInfo);
    });
}

class SerializedKeyValue {
    /**
     * 
     * @param {{ key?: string, index?: number, type: number, bool?: boolean, ref?: number|Array|Object, binary?:Uint8Array, record?: NodeAddress, bytes?: Array<number> }} info 
     */
    constructor(info) {
        this.key = info.key;
        this.index = info.index;
        this.type = info.type;
        this.bool = info.bool;
        this.ref = info.ref;
        this.binary = info.binary;
        this.record = info.record; // RENAME
        this.bytes = info.bytes;
    }
}

/**
 * 
 * @param {SerializedKeyValue} kvp 
 */
function _getValueBytes(kvp) {
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
        let address = kvp.record;
        
        // Set the 6 byte record address (page_nr,record_nr)
        let bin = new Uint8Array(6);
        let view = new DataView(bin.buffer);
        view.setUint32(0, address.pageNr);
        view.setUint16(4, address.recordNr);
        bin.forEach(val => bytes.push(val)); //bytes.push(...bin);
        
        // End
    }
    else {
        // Inline value
        let data = kvp.bytes || kvp.binary;
        index = bytes.length;
        bytes[index] = 128; // 10000000 --> inline value
        bytes[index] |= data.length - 1; // inline_length
        if (data instanceof ArrayBuffer) {
            data = new Uint8Array(data);
        }
        data.forEach(val => bytes.push(val)); //bytes.push(...data);
        
        // End
    }
    return bytes;
}

/**
 * 
 * @param {AceBaseStorage} storage
 * @param {string} path 
 * @param {string|number} keyOrIndex
 * @param {any} val 
 * @param {string} parentTid 
 * @returns {SerializedKeyValue}
 */
function _serializeValue (storage, path, keyOrIndex, val, parentTid) {
    const missingTidMessage = `Need to create a new record, but the parentTid is not given`;
    const create = (details) => {
        if (typeof keyOrIndex === 'number') {
            details.index = keyOrIndex;
        }
        else {
            details.key = keyOrIndex;
        }
        details.ref = val;
        return new SerializedKeyValue(details);
    }
    
    if (val instanceof Date) {
        // Store as 64-bit (8 byte) signed integer. 
        // NOTE: 53 bits seem to the max for the Date constructor in Chrome browser, 
        // although higher dates can be constructed using specific year,month,day etc
        // NOTE: Javascript Numbers seem to have a max "safe" value of (2^53)-1 (Number.MAX_SAFE_INTEGER),
        // this is because the other 12 bits are used for sign (1 bit) and exponent.
        // See https://stackoverflow.com/questions/9939760/how-do-i-convert-an-integer-to-binary-in-javascript
        const ms = val.getTime();
        const bytes = numberToBytes(ms);
        return create({ type: VALUE_TYPES.DATETIME, bytes });
    }
    else if (val instanceof Array) {
        // Create separate record for the array
        if (val.length === 0) {
            return create({ type: VALUE_TYPES.ARRAY, bytes: [] });
        }
        console.assert(parentTid, missingTidMessage);
        return _lockAndWriteNode(storage, path, val, parentTid)
        .then(recordInfo => {
            return create({ type: VALUE_TYPES.ARRAY, record: recordInfo.address });
        });
    }
    else if (val instanceof InternalNodeReference) {
        // Used internally, happens to existing external record data that is not being changed.
        return create({ type: val.type, record: val.address });
    }
    else if (val instanceof ArrayBuffer) {
        if (val.byteLength > storage.settings.maxInlineValueSize) {
            console.assert(parentTid, missingTidMessage);
            return _lockAndWriteNode(storage, path, val, parentTid)
            .then(recordInfo => {
                return create({ type: VALUE_TYPES.BINARY, record: recordInfo.address });
            });                   
        }
        else {
            return create({ type: VALUE_TYPES.BINARY, bytes: val });
        }
    }
    else if (val instanceof PathReference) {
        const encoded = encodeString(val.path); // textEncoder.encode(val.path);
        if (encoded.length > storage.settings.maxInlineValueSize) {
            // Create seperate record for this string value
            console.assert(parentTid, missingTidMessage);
            return _lockAndWriteNode(storage, path, val, parentTid)
            .then(recordInfo => {
                return create({ type: VALUE_TYPES.REFERENCE, record: recordInfo.address });
            });
        }
        else {
            // Small enough to store inline
            return create({ type: VALUE_TYPES.REFERENCE, binary: encoded });
        }
    }
    else if (typeof val === "object") {
        if (Object.keys(val).length === 0) {
            // Empty object (has no properties), can be stored inline
            return create({ type: VALUE_TYPES.OBJECT, bytes: [] });
        }
        // Create seperate record for this object
        console.assert(parentTid, missingTidMessage);
        return _lockAndWriteNode(storage, path, val, parentTid)
        .then(recordInfo => {
            return create({ type: VALUE_TYPES.OBJECT, record: recordInfo.address });
        });
    }
    else if (typeof val === "number") {
        const bytes = numberToBytes(val);
        return create({ type: VALUE_TYPES.NUMBER, bytes });
    }
    else if (typeof val === "boolean") {
        return create({ type: VALUE_TYPES.BOOLEAN, bool: val });
    }
    else {
        // This is a string or something we don't know how to serialize
        if (typeof val !== "string") {
            // Not a string, convert to one
            val = val.toString();
        }
        // Idea for later: Use string interning to store identical string values only once, 
        // using ref count to decide when to remove
        const encoded = encodeString(val); // textEncoder.encode(val);
        if (encoded.length > storage.settings.maxInlineValueSize) {
            // Create seperate record for this string value
            console.assert(parentTid, missingTidMessage);
            return _lockAndWriteNode(storage, path, val, parentTid)
            .then(recordInfo => {
                return create({ type: VALUE_TYPES.STRING, record: recordInfo.address });
            });
        }
        else {
            // Small enough to store inline
            return create({ type: VALUE_TYPES.STRING, binary: encoded });
        }
    }
};


/**
 * 
 * @param {AceBaseStorage} storage 
 * @param {string} path 
 * @param {number} type 
 * @param {Uint8Array|Number[]} bytes 
 * @param {any} debugValue 
 * @param {boolean} hasKeyTree 
 * @param {RecordInfo} currentRecordInfo
 * @returns {Promise<RecordInfo>}
 */
function _write(storage, path, type, bytes, debugValue, hasKeyTree, currentRecordInfo = undefined) {
    // Record layout:
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
    //                      3 = NEW: contigious pages (start page nr, nr of contigious pages)
    //
    // ct_entry_data    := ct_entry_type?
    //                      1: nr_records
    //                      2: start_page_nr, start_record_nr, nr_records
    //                      3: NEW: start_page_nr, nr_pages
    //
    // nr_records       := 2 byte number, (actual nr - 1)
    // nr_pages         := 2 byte number, (actual nr - 1)
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

    if (bytes instanceof Array) {
        bytes = Uint8Array.from(bytes);
    }
    else if (!(bytes instanceof Uint8Array)) {
        throw new Error(`bytes must be Uint8Array or plain byte Array`);
    }

    const bytesPerRecord = storage.settings.recordSize;
    let headerBytes, totalBytes, requiredRecords, lastChunkSize;

    const calculateStorageNeeds = (nrOfChunks) => {
        // Calculate amount of bytes and records needed
        headerBytes = 4; // Minimum length: 1 byte record_info and value_type, 1 byte CT (ct_entry_type 0), 2 bytes last_chunk_length
        totalBytes = (bytes.length + headerBytes);
        requiredRecords = Math.ceil(totalBytes / bytesPerRecord);
        if (requiredRecords > 1) {
            // More than 1 record, header size increases
            headerBytes += 3; // Add 3 bytes: 1 byte for ct_entry_type 1, 2 bytes for nr_records
            headerBytes += (nrOfChunks - 1) * 9; // Add 9 header bytes for each additional range (1 byte ct_entry_type 2, 4 bytes start_page_nr, 2 bytes start_record_nr, 2 bytes nr_records)
            // Recalc total bytes and required records
            totalBytes = (bytes.length + headerBytes);
            requiredRecords = Math.ceil(totalBytes / bytesPerRecord);
        }
        lastChunkSize = requiredRecords === 1 ? bytes.length : totalBytes % bytesPerRecord;
        if (lastChunkSize === 0 && bytes.length > 0) {
            // Data perfectly fills up the last record!
            // If we don't set it to bytesPerRecord, reading later will fail: 0 bytes will be read from the last record...
            lastChunkSize = bytesPerRecord;
        }
    };

    calculateStorageNeeds(1); // Initialize with calculations for 1 contigious chunk of data

    if (requiredRecords > 1) {
        // In the worst case scenario, we get fragmented record space for each required record.
        // Calculate with this scenario. If we claim a record too many, we'll free it again when done
        let wholePages = Math.floor(requiredRecords / storage.settings.pageSize);
        let maxChunks = Math.max(0, wholePages) + Math.min(3, requiredRecords);
        calculateStorageNeeds(maxChunks);
    }

    // Request storage space for these records
    let useExistingAllocation = currentRecordInfo && currentRecordInfo.allocation.totalAddresses === requiredRecords;
    let allocationPromise = 
        useExistingAllocation
        ? Promise.resolve(currentRecordInfo.allocation.ranges)
        : storage.FST.allocate(requiredRecords);

    return allocationPromise
    .then(ranges => {
        let allocation = new NodeAllocation(ranges);
        !useExistingAllocation && storage.debug.verbose(`Allocated ${allocation.totalAddresses} addresses for node "/${path}": ${allocation}`.gray);
        
        calculateStorageNeeds(allocation.ranges.length);
        if (requiredRecords < allocation.totalAddresses) {
            const addresses = allocation.addresses;
            const deallocate = addresses.splice(requiredRecords);
            storage.debug.verbose(`Requested ${deallocate.length} too many addresses to store node "/${path}", releasing them`.gray);
            storage.FST.release(NodeAllocation.fromAdresses(deallocate).ranges);
            allocation = NodeAllocation.fromAdresses(addresses);
            calculateStorageNeeds(allocation.ranges.length);
        }
        
        // Build the binary header data
        let header = new Uint8Array(headerBytes);
        let headerView = new DataView(header.buffer, 0, header.length);
        header.fill(0);     // Set all zeroes
        header[0] = type; // value_type
        if (hasKeyTree) {
            header[0] |= FLAG_KEY_TREE;
        }

        // Add chunk table
        const chunkTable = allocation.toChunkTable();
        let offset = 1;
        chunkTable.ranges.forEach(range => {
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
        bytes = concatTypedArrays(header, bytes);   // NEW: concat header and bytes for simplicity
        const writes = [];
        let copyOffset = 0;
        chunkTable.ranges.forEach((range, r) => {
            const chunk = {
                data: new Uint8Array(range.length * bytesPerRecord),
                get length() { return this.data.length; }
            };

            //chunk.data.fill(0); // not necessary

            // if (r === 0) {
            //     chunk.data.set(header, 0); // Copy header data into first chunk
            //     const view = new Uint8Array(bytes.buffer, 0, Math.min(bytes.length, chunk.length - header.length));
            //     chunk.data.set(view, header.length); // Copy first chunk of data into range
            //     copyOffset += view.length;
            // }
            // else {

            // Copy chunk data from source data
            const view = new Uint8Array(bytes.buffer, copyOffset, Math.min(bytes.length - copyOffset, chunk.length));
            chunk.data.set(view, 0);
            copyOffset += chunk.length;
            
            // }
            const fileIndex = storage.getRecordFileIndex(range.pageNr, range.recordNr);
            if (isNaN(fileIndex)) {
                throw new Error(`fileIndex is NaN!!`);
            }
            const promise = storage.writeData(fileIndex, chunk.data);
            writes.push(promise);
            // const p = promiseTimeout(30000, promise).catch(err => {
            //     // Timeout? 30s to write some data is quite long....
            //     storage.debug.error(`Failed to write ${chunk.data.length} byte chunk for node "/${path}" at file index ${fileIndex}: ${err}`);
            //     throw err;
            // });
            // writes.push(p);
        });

        return Promise.all(writes)
        .then((results) => {
            const bytesWritten = results.reduce((a,b) => a + b, 0);
            const chunks = results.length;
            const address = new NodeAddress(path, allocation.ranges[0].pageNr, allocation.ranges[0].recordNr);
            const nodeInfo = new NodeInfo({ path, type, exists: true, address });

            storage.nodeCache.update(nodeInfo); // NodeCache.update(address, type);
            storage.debug.log(`Node "/${address.path}" saved at address ${address.pageNr},${address.recordNr} - ${allocation.totalAddresses} addresses, ${bytesWritten} bytes written in ${chunks} chunk(s)`.green);
            // storage.logwrite({ address: address, allocation, chunks, bytesWritten });

            let recordInfo;
            if (useExistingAllocation) {
                // By using the exising info, caller knows it should not release the allocation
                recordInfo = currentRecordInfo;
                recordInfo.allocation = allocation; // Necessary?
                recordInfo.hasKeyIndex = hasKeyTree;
                recordInfo.headerLength = headerBytes;
                recordInfo.lastChunkSize = lastChunkSize;
            }
            else {
                recordInfo = new RecordInfo(address.path, hasKeyTree, type, allocation, headerBytes, lastChunkSize, bytesPerRecord);
                recordInfo.fileIndex = storage.getRecordFileIndex(address.pageNr, address.recordNr);
            }
            recordInfo.timestamp = Date.now();

            if (address.path === "") {
                return storage.rootRecord.update(address) // Wait for this, the address update has to be written to file
                .then(() => recordInfo);
            }
            else {
                return recordInfo;
            }
        })
        .catch(reason => {
            // If any write failed, what do we do?
            storage.debug.error(`Failed to write node "/${path}": ${reason}`);
            throw reason;
        });
    });
}

class InternalNodeReference {
    /**
     * @param {number} type valueType
     * @param {NodeAddress} address 
     */
    constructor(type, address) {
        this.type = type;
        this._address = address;
    }
    get address() {
        return this._address;
    }
    get path() {
        return this._address.path;
    }
    get pageNr() {
        return this._address.pageNr;
    }
    get recordNr() {
        return this._address.recordNr;
    }
}


module.exports = {
    AceBaseStorage,
    AceBaseStorageSettings
};