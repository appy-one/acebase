const fs = require('fs');
const pfs = require('./promise-fs');
const { EventEmitter } = require('events');
const { PathInfo, ID, Utils, debug } = require('acebase-core');
const { concatTypedArrays } = Utils;
const { TextEncoder } = require('text-encoding');
const { DataIndex, ArrayIndex, FullTextIndex, GeoIndex } = require('./data-index');
const { Node, NodeAddress } = require('./node');
const { NodeCache } = require('./node-cache');
const { NodeLocker } = require('./node-lock');
const textEncoder = new TextEncoder();
const colors = require('colors');

class StorageOptions {
    constructor(options) {
        options = options || {};
        this.recordSize = options.recordSize || 128;                            // record size in bytes
        this.pageSize = options.pageSize || 1024;                               // page size in records
        this.maxInlineValueSize = options.maxInlineValueSize || 16;             // in bytes, max amount of child data to store within a parent record before moving to a dedicated record
        this.removeVoidProperties = options.removeVoidProperties === true;      // Instead of throwing errors on null or undefined values, remove the properties automatically
        this.cluster = options.cluster || { enabled: false };                   // When running in a cluster, managing record allocation, key indice and node locking must be done by the cluster master
        this.path = options.path || '.';                                        // Target path to store database files in
        if (this.path.endsWith('/')) { this.path = this.path.slice(0, -1); }
    }
};

class Storage extends EventEmitter {
    // Manages all data in a database file:
    // Key Index Table (KIT)
    // Free Space Table (FST)
    // Record storage

    /**
     * 
     * @param {string} name 
     * @param {StorageOptions} options 
     */
    constructor(name, options) {
        super();
        options = new StorageOptions(options);

        if (options.maxInlineValueSize > 64) {
            throw new Error("maxInlineValueSize cannot be larger than 64"); // This is technically not possible because we store inline length with 6 bits: range = 0 to 2^6-1 = 0 - 63 // NOTE: lengths are stored MINUS 1, because an empty value is stored as tiny value, so "a"'s stored inline length is 0, allowing values up to 64 bytes
        }
        if (options.pageSize > 65536) {
            throw new Error("pageSize cannot be larger than 65536"); // Technically not possible because record_nr references are 16 bit: range = 0 - 2^16 = 0 - 65535
        }
        // if (options.clusterMaster && (typeof options.clusterMaster.host !== "string" || typeof options.clusterMaster.port !== "number")) {
        //     throw new TypeError("clusterMaster must be an object with host and port properties");
        // }

        this.name = name;
        this.settings = options; // options when new, settings from file when existing db
        const stats = {
            writes: 0,
            reads: 0,
            bytesRead: 0,
            bytesWritten: 0
        };
        this.stats = stats;
        this.nodeCache = new NodeCache();
        this.nodeLocker = new NodeLocker();

        const filename = `${this.settings.path}/${this.name}.acebase/data.db`;
        let fd = null;

        const writeQueue = [];
        let writingNow = false;
        const writeData = (fileIndex, buffer, offset = 0, length = -1) => {
            if (buffer instanceof Uint8Array) {
                // If the passsed buffer is of type Uint8Array (which is essentially the same as Buffer),
                // convert it to a Buffer instance or fs.write will FAIL.
                buffer = Buffer.from(buffer.buffer);
            }
            if (length === -1) {
                length = buffer.byteLength;
            }
            const work = (fileIndex, buffer, offset, length, resolve, reject) => {
            //     writingNow = true;
                fs.write(fd, buffer, offset, length, fileIndex, (err, bytesWritten) => {
                    if (err) {
                        debug.error(`Error writing to file`);
                        debug.error(err);
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
                        debug.error(`Error reading record`, buffer, offset, length, fileIndex);
                        debug.error(err);
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
        const cluster = this.settings.cluster;
        if (cluster.enabled) {
            if (cluster.isMaster) {
                // This is the master process, we have to respond to requests
                cluster.workers.forEach(worker => {
                    // Setup communication channel with worker
                    worker.on("message", data => {
                        const { id, request } = data;
                        let promise;
                        if (request.type === "ping") {
                            worker.send({ id, result: "pong" });
                        }
                        else if (request.type === "allocate") {
                            promise = this.FST.allocate(request.records);
                        }
                        else if (request.type === "release") {
                            this.FST.release(request.ranges);
                            worker.send({ id, result: "ok" });
                        }
                        else if (request.type === "lock") {
                            promise = this.nodeLocker.lock(request.path, request.tid, request.forWriting, request.comment, request.options);
                        }
                        else if (request.type === "unlock") {
                            promise = this.nodeLocker.unlock(request.lockId, request.comment, request.processQueue);
                        }
                        else if (request.type === "add_key") {
                            let index = this.KIT.getOrAdd(request.key);
                            worker.send({ id, result: index });
                        }
                        else if (request.type === "update_address") {
                             // Send it to all other workers
                            this.addressCache.update(request.address, true);
                            cluster.workers.forEach(otherWorker => {
                                if (otherWorker !== worker) {
                                    otherWorker.send(request);
                                }
                            });
                            worker.send({ id, result: true });
                        }
                        promise && promise.then(result => {
                            worker.send({ id, result });
                        });                           
                    });
                });
            }
            else {
                // This is a worker process, setup request/result communication
                const master = cluster.master;
                const requests = { };
                cluster.request = (msg) => {
                    return new Promise((resolve, reject) => {
                        const id = ID.generate();
                        requests[id] = resolve;
                        master.send({ id, request: msg });
                    });
                };
                master.on("message", data => {
                    let resolve = requests[data.id];
                    delete requests[data.id];
                    resolve && resolve(data.result);
                });
                // Test communication:
                cluster.request({ type: "ping" }).then(result => {
                    console.log(`PING master process result: ${result}`);
                });
            }
        }

        // Setup Key Index Table object and functions
        if (cluster.enabled && !cluster.isMaster) {
            // Subscribe to new keys added events
            cluster.master.on("message", data => {
                if (data.type === "key_added") {
                    this.KIT.keys[data.index] = data.key;
                }
                else if (data.type === "update_address") {
                    this.addressCache.update(data.address, true);
                }
            });
        };

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
                    return -1; //debug.error(`Adding KIT key "${key}"?!!`);
                }
                let index = this.keys.indexOf(key);
                if (index < 0) {
                    if (cluster.enabled && !cluster.isMaster) {
                        // Forward request to cluster master. Response will be too late for us, but it will be cached for future calls
                        cluster.request({ type: "add_key", key }).then(index => {
                            this.keys[index] = key; // Add to our local array
                        });
                        return -1;
                    }
                    index = this.keys.push(key) - 1;
                    if (cluster.enabled && cluster.isMaster) {
                        // Notify all workers
                        cluster.workers.forEach(worker => {
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
                if (cluster.enabled && !cluster.isMaster) {
                    throw new Error(`DEV ERROR: KIT.write not allowed to run if it is a cluster worker!!`);
                }
                // Key Index Table starts at index 64, and is 2^16 (65536) bytes long
                const data = new Buffer(this.length);
                data.fill(0); // Initialize with all zeroes
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
                //     debug.log(`KIT saved, ${bytesWritten} bytes written`);
                // })
                .catch(err => {
                    debug.error(`Error writing KIT: `, err);
                });
            },

            load() {
                return new Promise((resolve, reject) => {
                    let data = new Buffer(this.length);
                    fs.read(fd, data, 0, data.length, this.fileIndex, (err, bytesRead) => {
                        if (err) {
                            debug.error(`Error reading KIT from file: `, err);
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
                        debug.log(`KIT read, ${this.keys.length} keys indexed`.bold);
                        //debug.log(keys);
                        resolve(keys);
                    });
                });
            }
        };

        // Setup Free Space Table object and functions
        const storage = this;
        
        if (cluster.enabled && !cluster.isMaster) {
            this.FST = {
                allocate(requiredRecords) {
                    return cluster.request({ type: "allocate", records: requiredRecords })
                    // .then(result => {
                    //     return result;
                    // });
                },
                release(ranges) {
                    return cluster.request({ type: "release", ranges });
                },
                load() {
                    return Promise.resolve([]); // Fake loader
                }
            };

            // // Refactored: now using IPC channel between child and master process
            // const http = require('http');
            // this.FST = {
            //     allocate(requiredRecords) {
            //         return new Promise((resolve, reject) => {
            //             const master = storage.settings.clusterMaster;
            //             const url = `http://${master.host}:${master.port}/fst/allocate`;
            //             const req = http.get(url, res => {
            //                 if (res.statusCode !== 200) {
            //                     return reject("server error");
            //                 }
            //                 res.setEncoding("utf8");
            //                 let data = "";
            //                 res.on("data", chunk => { data += chunk; });
            //                 res.on("end", () => {
            //                     let val = JSON.parse(data);
            //                     resolve(val);
            //                 });
            //             });
            //             req.setHeader("Authorization", `Basic ${master.auth}`);
            //         });
            //     }
            // }
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
                    const data = new Buffer(this.length);
                    data.fill(0); //new Uint8Array(buffer).fill(0); // Initialize with all zeroes
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
                        //debug.log(`FST saved, ${this.bytesUsed} bytes used for ${this.ranges.length} ranges`);
                        if (updatedPageCount === true) {
                            // Update the file size
                            const newFileSize = storage.rootRecord.fileIndex + (this.pages * options.pageSize * options.recordSize);
                            fs.ftruncateSync(fd, newFileSize);
                        }
                    })
                    .catch(err => {
                        debug.error(`Error writing FST: `, err);
                    });
                },

                load() {
                    return new Promise((resolve, reject) => {
                        let data = new Buffer(this.length);
                        fs.read(fd, data, 0, data.length, this.fileIndex, (err, bytesRead) => {
                            if (err) {
                                debug.error(`Error reading FST from file`);
                                debug.error(err);
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
                            debug.log(`FST read, ${allocatedPages} pages allocated, ${freeRangeCount} free ranges`.bold);
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
                // debug.log(`Root record address updated to ${address.pageNr}, ${address.recordNr}`.bold);

                // Save to file, or it didn't happen
                const bytes = new Uint8Array(6);
                const view = new DataView(bytes.buffer);
                view.setUint32(0, address.pageNr);
                view.setUint16(4, address.recordNr);
                
                return writeData(HEADER_INDEXES.ROOT_RECORD_ADDRESS, bytes, 0, bytes.length)
                .then(bytesWritten => {
                    debug.log(`Root record address updated to ${address.pageNr}, ${address.recordNr}`.bold);
                });
            }
        }


        // // Setup Path to Address cache
        // const _addressCache = {
        //     "": new RecordAddress("", 0, 0) // Root object address
        // };
        // const _cacheCleanups = {};
        // const _cacheExpires = 10 * 1000; // 10 seconds // 60 * 1000 * 5; // 5 minutes
        // this.addressCache = {
        //     update(address, fromClusterMaster = false) {
        //         const cacheEnabled = true;
        //         if (cluster.enabled && !cluster.isMaster && !fromClusterMaster) {
        //             cluster.request({ type: "address", address });
        //         }
        //         if (cacheEnabled || address.path.length === 0) {
        //             const oldAddress = _addressCache[address.path];
        //             if (oldAddress && oldAddress.pageNr === address.pageNr && oldAddress.recordNr === address.recordNr) {
        //                 return; // No change
        //             }
        //             _addressCache[address.path] = address;
                
        //             if (oldAddress) {
        //                 address.history = oldAddress.history || [];
        //                 address.history.push({ pageNr: oldAddress.pageNr, recordNr: oldAddress.recordNr });
        //                 if (address.history.length > 5) { 
        //                     // Limit the amount of old addresses per path
        //                     address.history.shift(); 
        //                 }
        //             }
        //             else {
        //                 address.history = [];
        //             }
        //         }
        //         if (address.path.length === 0 && !fromClusterMaster) {
        //             // Root address changed, this has to be saved to the database file
        //             const bytes = new Uint8Array(6);
        //             const view = new DataView(bytes.buffer);
        //             view.setUint32(0, address.pageNr);
        //             view.setUint16(4, address.recordNr);
        //             writeData(HEADER_INDEXES.ROOT_RECORD_ADDRESS, bytes, 0, bytes.length)
        //             .then(bytesWritten => {
        //                 debug.log(`Root record address updated to ${address.pageNr}, ${address.recordNr}`);
        //             });
        //         }
        //         else if (cacheEnabled) {
        //             // Remove it from the cache after configured time
        //             const path = address.path;
        //             clearTimeout(_cacheCleanups[path]);
        //             _cacheCleanups[path] = setTimeout(()=> { 
        //                 delete _addressCache[path]; 
        //                 delete _cacheCleanups[path];
        //             }, _cacheExpires);
        //         }
        //     },
        //     find(path) {
        //         const entry = _addressCache[path];
        //         if (entry && path.length > 0) {
        //             // Remove it from the cache after configured time
        //             clearTimeout(_cacheCleanups[path]);
        //             _cacheCleanups[path] = setTimeout(()=> { 
        //                 delete _addressCache[path]; 
        //                 delete _cacheCleanups[path];
        //             }, _cacheExpires);
        //         }
        //         return entry;
        //     },
        //     invalidate(address) {
        //         const entry = _addressCache[address.path];
        //         if (entry && entry.pageNr === address.pageNr && entry.recordNr === address.recordNr) {
        //             delete _addressCache[address.path];
        //             clearTimeout(_cacheCleanups[address.path]);
        //             delete _cacheCleanups[address.path];
        //         }
        //     },
        //     invalidatePath(path) {
        //         Object.keys(_addressCache)
        //         .map(cachedPath => _addressCache[cachedPath])
        //         .filter(address => path === "" || address.path === path || address.path.startsWith(`${path}/`))
        //         .forEach(address => this.invalidate(address));
        //     },
        //     findAncestor(path) {
        //         let addr = this.find(path);
        //         while(!addr) {
        //             path = path.substring(0, path.lastIndexOf("/"));
        //             addr = this.find(path);
        //             if (!addr && path.indexOf("[") >= 0) {
        //                 path = path.substring(0, path.indexOf("["));
        //                 addr = this.find(path);
        //             }
        //         }
        //         return addr;
        //     },
        //     getLatest(address) {
        //         let cached = this.find(address.path);
        //         if (cached && (cached.pageNr !== address.pageNr || cached.recordNr !== address.recordNr)) {
        //             // Find out if the given address is old
        //             const isOld = cached.history.some(a => a.pageNr === address.pageNr && a.recordNr === address.recordNr);
        //             if (isOld) { 
        //                 return cached; 
        //             }
        //         }
        //         return address;
        //     }
        // };

        // this._locks = []; //{};

        const descriptor = textEncoder.encode("AceBase⚡");
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
                    debug.error(txt);
                    debug.error(err);
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
                    const data = new Buffer(64);
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

                        colors.setTheme({
                            art: ['magenta', 'bold'],
                            intro: ['dim']
                        });
                        // ASCI art: http://patorjk.com/software/taag/#p=display&f=Doom&t=AceBase
                        const logo =
                            '     ___          ______                '.art + '\n' +
                            '    / _ \\         | ___ \\               '.art + '\n' +
                            '   / /_\\ \\ ___ ___| |_/ / __ _ ___  ___ '.art + '\n' +
                            '   |  _  |/ __/ _ \\ ___ \\/ _` / __|/ _ \\'.art + '\n' +
                            '   | | | | (_|  __/ |_/ / (_| \\__ \\  __/'.art + '\n' +
                            '   \\_| |_/\\___\\___\\____/ \\__,_|___/\\___|'.art + '\n'

                        debug.log(logo);
                        debug.log(`Database "${name}" details:`.intro);
                        debug.log(`- Record size: ${this.settings.recordSize}`.intro);
                        debug.log(`- Page size: ${this.settings.pageSize}`.intro);
                        debug.log(`- Max inline value size: ${this.settings.maxInlineValueSize}`.intro);
                        debug.log(`- Root record address: ${this.rootRecord.pageNr}, ${this.rootRecord.recordNr}`.intro);

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

        /** @type {DataIndex[]} */ 
        const _indexes = [];

        this.indexes = {
            /**
             * Creates an index on specified path and key(s)
             * @param {string} path location of objects to be indexed. Eg: "users" to index all children of the "users" node; or "chats/*\/members" to index all members of all chats
             * @param {string} key for now - one key to index. Once our B+tree implementation supports nested trees, we can allow multiple fields
             * @param {object} [options]
             * @param {boolean} [options.rebuild=false]
             * @param {string} [options.type] special index to create: 'array', 'fulltext' or 'geo'
             * @param {string[]} [options.include] keys to include in index
             */
            create(path, key, options = { rebuild: false, type: undefined, include: undefined }) { //, refresh = false) {
                path = path.replace(/\/\*$/, ""); // Remove optional trailing "/*"
                const rebuild = options && options.rebuild === true;
                const indexType = (options && options.type) || 'normal';
                let includeKeys = (options && options.include) || [];
                if (typeof includeKeys === 'string') { includeKeys = [includeKeys]; }
                const existingIndex = _indexes.find(index => 
                    index.path === path && index.key === key && index.type === indexType
                    && index.includeKeys.length === includeKeys.length
                    && index.includeKeys.every((key, index) => includeKeys[index] === key)
                );
                if (existingIndex && rebuild !== true) {
                    debug.log(`Index on "/${path}/*/${key}" already exists`.inverse);
                    return Promise.resolve(existingIndex);
                }
                const index = existingIndex || (() => {
                    switch (indexType) {
                        case 'array': return new ArrayIndex(storage, path, key, { include: options.include });
                        case 'fulltext': return new FullTextIndex(storage, path, key, { include: options.include });
                        case 'geo': return new GeoIndex(storage, path, key, { include: options.include });
                        default: return new DataIndex(storage, path, key, { include: options.include });
                    }
                })();
                return index.build()
                .then(() => {
                    if (!existingIndex) {
                        _indexes.push(index);
                        //_keepIndexUpdated(path, key);
                    }
                    return index;
                });
            },

            get(path, key = null) {
                return _indexes.filter(index => index.path === path && (key === null || key === index.key));
            },

            getAll(targetPath, childPaths = true) {
                const pathKeys = PathInfo.getPathKeys(targetPath);
                return _indexes.filter(index => {
                    // index can have wildcards
                    const indexKeys = PathInfo.getPathKeys(index.path + '/*');
                    if (!childPaths && indexKeys.length !== pathKeys.length) { return false; }
                    return pathKeys.every((key, i) => {
                        return key === indexKeys[i] || indexKeys[i] === '*';
                    });
                });
            },

            list() {
                return _indexes.slice();
            },

            load() {
                _indexes.splice(0);
                // return new Promise((resolve, reject) => {
                return pfs.readdir(`${storage.settings.path}/${storage.name}.acebase`)
                .then(files => {
                    const promises = [];
                    files.forEach(fileName => {
                        if (fileName.endsWith('.idx')) {
                            // const match = fileName.match(/^([a-z0-9_$#\-]+)-([a-z0-9_$]+)(,([a-z0-9_$,]+))?(\.([a-z]+))?\.idx$/i);
                            // // console.log(match);
                            // const path = match[1].replace(/\-/g, "/").replace(/\#/g, "*");
                            // const key = match[2];
                            // const includedKeys = match[4] ? match[4].split(',') : undefined;
                            // const type = match[6] || 'normal';
                            // const index = (() => {
                            //     switch(type) {
                            //         case 'array': return new ArrayIndex(storage, path, key, { include: includedKeys });
                            //         case 'fulltext': return new FullTextIndex(storage, path, key, { include: includedKeys });
                            //         case 'geo': return new GeoIndex(storage, path, key, { include: includedKeys });
                            //         default: return new DataIndex(storage, path, key, { include: includedKeys });
                            //     }
                            // })();
                            const p = DataIndex.readFromFile(storage, fileName)
                            .then(index => {
                                _indexes.push(index);
                            })
                            .catch(err => {
                                console.error(err);
                            });
                            promises.push(p);
                        }
                    });
                    return Promise.all(promises);
                })
                .catch(err => {
                    console.error(err);
                });
            }
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
                    options.recordSize >> 8 & 0xff,
                    options.recordSize & 0xff,
                    options.pageSize >> 8 & 0xff,
                    options.pageSize & 0xff,
                    options.maxInlineValueSize >> 8 & 0xff,
                    options.maxInlineValueSize & 0xff
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

        // Subscriptions
        const _subs = {};
        const _supportedEvents = ["value","child_added","child_changed","child_removed"];
        // Add 'notify_*' event types for each event
        _supportedEvents.push(..._supportedEvents.map(event => `notify_${event}`)); 
        // to enable data-less notifications, so data retrieval becomes optional:
        //
        // ref('users')
        // .on('notify_child_changed')
        // .then(childRef => {
        //    console.log(childRef.key)
        //    return childRef.get({ exclude: ['posts', 'comments'] })
        // })
        // .then(snap => {
        //    console.log(snap.val())
        // })
        this.subscriptions = {
            /**
             * Adds a subscription to a node
             * @param {string} path - Path to the node to add subscription to
             * @param {string} type - Type of the subscription
             * @param {(err: Error, path: string, currentValue: any, previousValue: any) => void} callback - Subscription callback function
             */
            add(path, type, callback) {
                if (_supportedEvents.indexOf(type) < 0) {
                    throw new TypeError(`Invalid event type "${type}"`);
                }
                let pathSubs = _subs[path];
                if (!pathSubs) { pathSubs = _subs[path] = []; }
                // if (pathSubs.findIndex(ps => ps.type === type && ps.callback === callback)) {
                //     debug.warn(`Identical subscription of type ${type} on path "${path}" being added`);
                // }
                pathSubs.push({ created: Date.now(), type, callback });
            },

            /**
             * Removes 1 or more subscriptions from a node
             * @param {string} path - Path to the node to remove the subscription from
             * @param {string} type - Type of subscription(s) to remove (optional: if omitted all types will be removed)
             * @param {Function} callback - Callback to remove (optional: if omitted all of the same type will be removed)
             */
            remove(path, type = undefined, callback = undefined) {
                let pathSubs = _subs[path];
                if (!pathSubs) { return; }
                while(true) {
                    const i = pathSubs.findIndex(ps => 
                        type ? ps.type === type : true 
                        && callback ? ps.callback === callback : true
                    );
                    if (i < 0) { break; }
                    pathSubs.splice(i, 1);
                }
            },

            /**
             * Checks if there are any subscribers at given path that need the node's previous value when a change is triggered
             * @param {string} path 
             */
            hasValueSubscribersForPath(path) {
                const valueNeeded = this.getValueSubscribersForPath(path);
                return !!valueNeeded;
            },

            /**
             * Gets all subscribers at given path that need the node's previous value when a change is triggered
             * @param {string} path 
             * @returns {Array<{ type: string, path: string }>}
             */
            getValueSubscribersForPath(path) {
                // Subscribers that MUST have the entire previous value of a node before updating:
                //  - "value" events on the path itself, and any ancestor path
                //  - "child_added", "child_removed" events on the parent path
                //  - "child_changed" events on the parent path and its ancestors
                //  - ALL events on child/descendant paths
                const pathInfo = new PathInfo(path);
                const valueSubscribers = [];
                Object.keys(_subs).forEach(subscriptionPath => {
                    if (pathInfo.equals(subscriptionPath) || pathInfo.isDescendantOf(subscriptionPath)) {
                        let pathSubs = _subs[subscriptionPath];
                        const eventPath = PathInfo.fillVariables(subscriptionPath, path);
                        pathSubs.forEach(sub => {
                            let dataPath;
                            if (sub.type === "value" || sub.type === "notify_value") { 
                                dataPath = eventPath;
                            }
                            else if ((sub.type === "child_changed" || sub.type === "notify_child_changed") && path !== eventPath) {
                                let childKey = PathInfo.getPathKeys(path.slice(eventPath.length).replace(/^\//, ''))[0];
                                dataPath = PathInfo.getChildPath(eventPath, childKey);
                             }
                            else if (~["child_added", "child_removed", "notify_child_added", "notify_child_removed"].indexOf(sub.type) && pathInfo.isChildOf(eventPath)) { 
                                let childKey = PathInfo.getPathKeys(path.slice(eventPath.length).replace(/^\//, ''))[0];
                                dataPath = PathInfo.getChildPath(eventPath, childKey);
                            }
                            
                            if (dataPath && valueSubscribers.findIndex(s => s.type === sub.type && s.path === eventPath) < 0) {
                                valueSubscribers.push({ type: sub.type, eventPath, dataPath, subscriptionPath });
                            }
                        });
                    }
                });
                return valueSubscribers;
            },

            /**
             * Gets all subscribers at given path that could possibly be invoked after a node is updated
             * @param {string} path 
             */
            getAllSubscribersForPath(path) {
                const pathInfo = PathInfo.get(path);
                const subscribers = [];
                Object.keys(_subs).forEach(subscriptionPath => {
                    if (pathInfo.equals(subscriptionPath) //path === subscriptionPath 
                        || pathInfo.isDescendantOf(subscriptionPath) 
                        || pathInfo.isAncestorOf(subscriptionPath)
                    ) {
                        let pathSubs = _subs[subscriptionPath];
                        const eventPath = PathInfo.fillVariables(subscriptionPath, path);
                        pathSubs.forEach(sub => {
                            let dataPath = null;
                            if (sub.type === "value" || sub.type === "notify_value") { 
                                dataPath = eventPath; 
                            }
                            else if (sub.type === "child_changed" || sub.type === "notify_child_changed") { 
                                let childKey = path === eventPath || pathInfo.isAncestorOf(eventPath) 
                                    ? "*" 
                                    : PathInfo.getPathKeys(path.slice(eventPath.length).replace(/^\//, ''))[0];
                                dataPath = PathInfo.getChildPath(eventPath, childKey);
                            }
                            else if (
                                ~["child_added", "child_removed", "notify_child_added", "notify_child_removed"].indexOf(sub.type) 
                                && (
                                    pathInfo.isChildOf(eventPath) 
                                    || path === eventPath 
                                    || pathInfo.isAncestorOf(eventPath)
                                )
                            ) { 
                                let childKey = path === eventPath || pathInfo.isAncestorOf(eventPath) 
                                    ? "*" 
                                    : PathInfo.getPathKeys(path.slice(eventPath.length).replace(/^\//, ''))[0];
                                dataPath = PathInfo.getChildPath(eventPath, childKey); //NodePath(subscriptionPath).childPath(childKey); 
                            }
                            if (dataPath && subscribers.findIndex(s => s.type === sub.type && s.path === eventPath) < 0) {
                                subscribers.push({ type: sub.type, eventPath, dataPath, subscriptionPath });
                            }
                        });
                    }
                });
                return subscribers;
            },

            /**
             * Triggers subscription events to run on relevant nodes
             * @param {string} event - Event type: "value", "child_added", "child_changed", "child_removed"
             * @param {string} path - Path to the node the subscription is on
             * @param {string} dataPath - path to the node the value is stored
             * @param {any} oldValue - old value
             * @param {any} newValue - new value
             */
            trigger(event, path, dataPath, oldValue, newValue) {
                //console.warn(`Event "${event}" triggered on node "/${path}" with data of "/${dataPath}": `, newValue);
                const pathSubscriptions = _subs[path] || [];
                pathSubscriptions.filter(sub => sub.type === event)
                .forEach(sub => {
                    if (event.startsWith('notify_')) {
                        // Notify only event, run callback without data
                        sub.callback(null, dataPath);
                    }
                    else {
                        // Run callback with data
                        sub.callback(null, dataPath, newValue, oldValue);
                    }
                });
            }

        };
        
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
}

module.exports = {
    Storage,
    StorageOptions
};