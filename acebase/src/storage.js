const fs = require('fs');
const { EventEmitter } = require('events');
const uuid62 = require('uuid62');
const { Record, RecordAddress, RecordLock, RecordReference, UNCHANGED, VALUE_TYPES } = require('./record');
const { TextEncoder } = require('text-encoding');
const { concatTypedArrays, getPathKeys, getPathInfo, getChildPath } = require('./utils');
const { DataIndex } = require('./data-index');
const debug = require('./debug');

const textEncoder = new TextEncoder();

class StorageOptions {
    constructor(options) {
        this.recordSize = options.recordSize || 128;
        this.pageSize = options.pageSize || 1024;
        this.maxInlineValueSize = options.maxInlineValueSize || 16;
        this.removeVoidProperties = options.removeVoidProperties === true;
        this.cluster = options.cluster || { enabled: false };
        //Object.assign(this, options);
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

        options = options || {};
        options.recordSize = options.recordSize || 128; // record size in bytes
        options.pageSize = options.pageSize || 1024;    // page size in records
        options.maxInlineValueSize = options.maxInlineValueSize || 16;  // in bytes, max amount of child data to store within a parent record before moving to a dedicated record
        options.removeVoidProperties = options.removeVoidProperties === true; // Instead of throwing errors on null or undefined values, remove the properties automatically
        options.cluster = options.cluster || { enabled: false }; // When running in a cluster, managing record allocation, key indixes and record locking must be done by the cluster master

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

        const filename = `${this.name}-data.db`;
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
                        reject(err)
                    }
                    else {
                        stats.writes++;
                        stats.bytesWritten += bytesWritten;
                        resolve(bytesWritten);
                    }
                    writingNow = false;
                    if (writeQueue.length > 0) {
                        let next = writeQueue.shift();
                        // Execute fs.write again, so refactor to function
                        ({ fileIndex, buffer, offset, length, resolve, reject } = next);
                        work(fileIndex, buffer, offset, length, resolve, reject);
                    }
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

        const readData = (fileIndex, buffer, offset = 0, length = -1) => {
            // if (!(buffer instanceof Buffer)) {
            //     throw "No Buffer used";
            // }            
            if (length === -1) {
                length = buffer.byteLength;
            }
            return new Promise((resolve, reject) => {
                if (!(buffer instanceof Buffer) && buffer.buffer) {
                    // Convert a typed array such as Uint8Array to Buffer with shared memory space
                    buffer = Buffer.from(buffer.buffer);
                }
                fs.read(fd, buffer, offset, length, fileIndex, (err, bytesRead) => {
                    if (err) {
                        debug.error(`Error reading record`);
                        debug.error(err);
                        return reject(err);
                    }
                    //buffer = new Uint8Array(buffer); // Convert to Uint8Array?
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
                            promise = storage.lock(request.path, request.tid);
                        }
                        else if (request.type === "unlock") {
                            promise = storage.unlock(request.path, request.tid);
                        }
                        else if (request.type === "add_key") {
                            let index = this.KIT.getOrAdd(request.key);
                            worker.send({ id, result: index });
                        }
                        else if (request.type === "address") {
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
                        const id = uuid62.v1();
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
                else if (data.type === "address") {
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
                .then(bytesWritten => {
                    debug.log(`KIT saved, ${bytesWritten} bytes written`);
                })
                .catch(err => {
                    debug.error(`Error writing KIT`);
                    debug.error(err);
                });
            },

            load() {
                return new Promise((resolve, reject) => {
                    let data = new Buffer(this.length);
                    fs.read(fd, data, 0, data.length, this.fileIndex, (err, bytesRead) => {
                        if (err) {
                            debug.error(`Error reading KIT from file`);
                            debug.error(err);
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
                        debug.log(`KIT read, ${this.keys.length} keys indexed`);
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

            // // Refactor: use IPC channel between child and master process!
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
                ranges: {},

                allocate(requiredRecords) {
                    // First, try to find a range that fits all requested records sequentially
                    let allocation = [];
                    let pageAdded = false;
                    const ret = () => {
                        this.write(pageAdded);
                        return Promise.resolve(allocation);
                    };

                    while (requiredRecords >= storage.settings.pageSize) {
                        let newPageNr = this.pages;
                        this.pages++;
                        allocation.push({ pageNr: newPageNr, recordNr: 0, length: storage.settings.pageSize });
                        requiredRecords -= storage.settings.pageSize;
                        pageAdded = true;
                    }

                    let totalFree = this.ranges.reduce((t, r) => t + r.end - r.start, 0);
                    if (totalFree < requiredRecords) {
                        // There is't enough free space, we'll have to create a new page anyway
                        // Prevent overfragmentation, just start with a fresh page right away
                        let newPageNr = this.pages;
                        this.pages++;
                        allocation.push({ pageNr: newPageNr, recordNr: 0, length: requiredRecords });
                        this.ranges.push({ page: newPageNr, start: requiredRecords, end: storage.settings.pageSize });
                        requiredRecords = 0;
                        pageAdded = true;
                    }

                    if (requiredRecords === 0) {
                        return ret();
                    }

                    // Find exact range
                    let r = this.ranges.find(r => r.end - r.start === requiredRecords);
                    if (r) {
                        allocation.push({ pageNr: r.page, recordNr: r.start, length: requiredRecords });
                        let i = this.ranges.indexOf(r);
                        this.ranges.splice(i, 1);
                        return ret();
                    }
                    
                    // Find first fitting range
                    r = this.ranges.find(r => r.end - r.start > requiredRecords);
                    if (r) {
                        allocation.push({ pageNr: r.page, recordNr: r.start, length: requiredRecords });
                        r.start += requiredRecords;
                        return ret();
                    }

                    // If we get here, we'll have to deal with the scraps
                    // Check how many ranges would be needed to store record
                    const sortedRanges = this.ranges.slice().sort((a,b) => {
                        let l1 = a.end - a.start;
                        let l2 = b.end - b.start;
                        if (l1 < l1) { return 1; }
                        if (l1 > l2) { return -1; }
                        return 0;
                    });

                    const MAX_RANGES = 3;
                    const test = {
                        ranges: [],
                        totalRecords: 0
                    };
                    for (let i = 0; test.totalRecords < requiredRecords && test.ranges.length <= MAX_RANGES && i < sortedRanges.length; i++) {
                        let r = sortedRanges[i];
                        test.ranges.push(r);
                        test.totalRecords += r.end - r.start;
                    }
                    if (test.ranges.length > MAX_RANGES) {
                        // Prevent overfragmentation, don't use more than 3 ranges
                        let newPageNr = this.pages;
                        this.pages++;
                        allocation.push({ pageNr: newPageNr, recordNr: 0, length: requiredRecords });
                        this.ranges.push({ page: pageNr, start: requiredRecords, end: storage.settings.pageSize });
                        requiredRecords = 0;
                        pageAdded = true;
                    }
                    else {
                        // Use the ranges found
                        test.ranges.forEach(r => {
                            let length = r.end - r.start;
                            if (length > requiredRecords) {
                                console.assert(test.ranges.indexOf(r) === test.ranges.length - 1, "DEV ERROR: This MUST be the last range or logic is not right!")
                                allocation.push({ pageNr: r.page, recordNr: r.start, length: requiredRecords });
                                r.start += requiredRecords;
                                requiredRecords = 0;
                            }
                            else {
                                allocation.push({ pageNr: r.page, recordNr: r.start, length })
                                let i = this.ranges.indexOf(r);
                                this.ranges.splice(i, 1);
                                requiredRecords -= length;
                            }
                        });
                    }
                    console.assert(requiredRecords === 0, "DEV ERROR: requiredRecords MUST be zero now!");
                    this.write(pageAdded);
                    return Promise.resolve(allocation);
                },

                // getFreeAddresses(requiredRecords, pageAdded = false) {
                //     // First, try to find a range that fits all requested records sequentially
                //     for(let i = 0; i < this.ranges.length; i++) {
                //         let range = this.ranges[i];
                //         if (range.end - range.start >= requiredRecords) {
                //             // Gotcha. Reserve this space
                //             let start = range.start;
                //             range.start += requiredRecords;
        
                //             if (range.start === range.end) {
                //                 // This range is now full, remove it from the FST
                //                 this.ranges.splice(i, 1);
                //             }
                            
                //             // Write to file
                //             this.write(pageAdded);
                            
                //             let elaborated = new Array(requiredRecords);
                //             for (let j = 0; j < requiredRecords; j++) {
                //                 elaborated[j] = { pageNr: range.page, recordNr: start + j, contiguousLength: requiredRecords-j, get bytes() { return getAddressBytes(this.pageNr, this.recordNr); } };
                //             }
                //             return elaborated;
                //         }
                //     }
                //     // If we're still here, we could try getting fragmented space.
                //     // For now, just create another page
                //     let newPageNr = this.pages;
                //     this.pages++;
                //     this.ranges.push({ page: newPageNr, start: 0, end: options.pageSize });
                //     return this.getFreeAddresses(requiredRecords, true); // Let's try again
                // },

                release(ranges) {
                    // addresses.forEach(address => {
                    //     let arr = [];
                    //     let adjacent = this.ranges.find(range => {
                    //         if (range.page !== address.pageNr) { return false; }
                    //         if (address.recordNr + 1 === range.start) {
                    //             range.start--; // Add available record at start of range
                    //             return true;
                    //         }
                    //         if (address.recordNr === range.end) {
                    //             range.end++; // Add available record at end of range
                    //             return true;
                    //         }
                    //         return false;
                    //     })
                    //     if (!adjacent) {
                    //         this.ranges.push({ page: address.pageNr, start: address.recordNr, end: address.recordNr + 1 });
                    //     }
                    // });

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

                    writeData(this.fileIndex, data, 0, bytesToWrite)
                    .then(bytesWritten => {
                        debug.log(`FST saved, ${bytesWritten} bytes written`);
                        if (updatedPageCount === true) {
                            // Update the file size
                            const newFileSize = storage.rootRecord.fileIndex + (this.pages * options.pageSize * options.recordSize);
                            fs.ftruncateSync(fd, newFileSize);
                        }
                    })
                    .catch(err => {
                        debug.error(`Error writing FST`);
                        debug.error(err);
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
                            debug.log(`FST read, ${allocatedPages} pages allocated, ${freeRangeCount} free ranges`);
                            resolve(ranges);
                        });
                    });                
                }
            };
        }

        this.rootRecord = {
            fileIndex: 131072
        };

        // Setup Path to Address cache
        const _addressCache = {
            "": new RecordAddress("", 0, 0) // Root object address
        };
        const _cacheCleanups = {};
        const _cacheExpires = 60 * 1000 * 5; // 5 minutes
        this.addressCache = {
            update(address, fromClusterMaster = false) {
                const cacheEnabled = true;
                if (cluster.enabled && !cluster.isMaster && !fromClusterMaster) {
                    cluster.request({ type: "address", address });
                }
                if (cacheEnabled || address.path.length === 0) {
                    const oldAddress = _addressCache[address.path];
                    _addressCache[address.path] = address;
                
                    if (oldAddress) {
                        address.history = oldAddress.history || [];
                        address.history.push({ pageNr: oldAddress.pageNr, recordNr: oldAddress.recordNr });
                        if (address.history.length > 5) { 
                            // Limit the amount of old addresses per path
                            address.history.shift(); 
                        }
                    }
                    else {
                        address.history = [];
                    }
                }
                if (address.path.length === 0 && !fromClusterMaster) {
                    // Root address changed, this has to be saved to the database file
                    const bytes = new Uint8Array(6);
                    const view = new DataView(bytes.buffer);
                    view.setUint32(0, address.pageNr);
                    view.setUint16(4, address.recordNr);
                    writeData(HEADER_INDEXES.ROOT_RECORD_ADDRESS, bytes, 0, bytes.length)
                    .then(bytesWritten => {
                        debug.log(`Root record address updated to ${address.pageNr}, ${address.recordNr}`);
                    });
                }
                else {
                    // Remove it from the cache after configured time
                    const path = address.path;
                    clearTimeout(_cacheCleanups[path]);
                    _cacheCleanups[path] = setTimeout(()=> { 
                        delete _addressCache[path]; 
                        delete _cacheCleanups[path];
                    }, _cacheExpires);
                }
            },
            find(path) {
                const entry = _addressCache[path];
                if (entry && path.length > 0) {
                    // Remove it from the cache after configured time
                    clearTimeout(_cacheCleanups[path]);
                    _cacheCleanups[path] = setTimeout(()=> { 
                        delete _addressCache[path]; 
                        delete _cacheCleanups[path];
                    }, _cacheExpires);
                }
                return entry;
            },
            invalidate(address) {
                const entry = _addressCache[address.path];
                if (entry && entry.pageNr === address.pageNr && entry.recordNr === address.recordNr) {
                    delete _addressCache[address.path];
                    clearTimeout(_cacheCleanups[address.path]);
                    delete _cacheCleanups[address.path];
                }
            },
            findAncestor(path) {
                let addr = this.find(path);
                while(!addr) {
                    path = path.substring(0, path.lastIndexOf("/"));
                    addr = this.find(path);
                    if (!addr && path.indexOf("[") >= 0) {
                        path = path.substring(0, path.indexOf("["));
                        addr = this.find(path);
                    }
                }
                return addr;
            },
            getLatest(address) {
                let cached = this.find(address.path);
                if (cached && (cached.pageNr !== address.pageNr || cached.recordNr !== address.recordNr)) {
                    // Find out if the given address is old
                    const isOld = cached.history.some(a => a.pageNr === address.pageNr && a.recordNr === address.recordNr);
                    if (isOld) { 
                        return cached; 
                    }
                }
                return address;
            }
        };

        // this.addressCache = {
        //     // Should be maintained by Record class when reading,writing
        //     // TODO: Refactor to use { "path/to/record": address } instead
        //     update(address) {
        //         if (address.path.length === 0) {
        //             // Root address changed, this has to be saved to the database file
        //             this.root.address = address;
        //             const bytes = new Uint8Array(6);
        //             const view = new DataView(bytes.buffer);
        //             view.setUint32(0, address.pageNr);
        //             view.setUint16(4, address.recordNr);
        //             writeData(HEADER_INDEXES.ROOT_RECORD_ADDRESS, bytes, 0, bytes.length)
        //             .then(bytesWritten => {
        //                 debug.log(`Root record address updated to ${address.pageNr}, ${address.recordNr}`);
        //             });
        //             return;
        //         }
        //         const keysPath = address.path.split("/");
        //         let parentEntry = this.root;
        //         let i = 0;
        //         while (i < keysPath.length - 1) {
        //             parentEntry = parentEntry.children[keysPath[i]];
        //             if (!parentEntry) {
        //                 debug.warn(`Cannot cache address path for "/${address.path}" because parent path "/${keysPath.slice(0, i+1).join("/")}" does not exist yet`);
        //                 return;
        //             }
        //             i++;
        //         }
        //         const entry = parentEntry.children[keysPath[i]];
        //         if (entry) { 
        //             entry.address = address;
        //         }
        //         else {
        //             parentEntry.children[keysPath[i]] = {
        //                 address: address,
        //                 children: {}
        //             };
        //         }
        //     },
        //     root: {
        //         address: new RecordAddress("", 0, 0), // Root object address
        //         children: {
        //             // eg: "users": {
        //             //     entry: new RecordAddress("users", 0, 1),
        //             //     children: {
        //             //         "ewout": {
        //             //             entry: new RecordAddress("users/ewout", 0, 2),
        //             //             children: { } // etc
        //             //         }
        //             //     }
        //             // }
        //         }  
        //     } 
        // };

        this._locks = []; //{};

        const descriptor = textEncoder.encode("JASON⚡");
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
                        let address = this.addressCache.find(""); //this.addressCache.root.address;
                        address.pageNr = view.getUint32(0);
                        address.recordNr = view.getUint16(4);
                        index += 6;

                        // Read saved settings
                        this.settings.recordSize = header[index] << 8 | header[index+1];
                        this.settings.pageSize = header[index+2] << 8 | header[index+3];
                        this.settings.maxInlineValueSize = header[index+4] << 8 | header[index+5];

                        debug.log(`Read database header\n- Record size: ${this.settings.recordSize}\n- Page size: ${this.settings.pageSize}\n- Max inline value size: ${this.settings.maxInlineValueSize}\n- Root record address: ${address.pageNr}, ${address.recordNr}`);

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
             */
            create(path, key, refresh = false) {
                path = path.replace(/\/\*$/, ""); // Remove optional trailing "/*"
                const existingIndex = _indexes.find(index => index.path === path && index.key === key)
                if (existingIndex && refresh !== true) {
                    debug.log(`Index on "${key}" in "/${path}" already exists`);
                    return Promise.resolve(existingIndex);
                }
                const index = existingIndex || new DataIndex(storage, path, key); //{ path, key, fileName }
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

            list() {
                return _indexes.slice();
            },

            load() {
                _indexes.splice(0);
                return new Promise((resolve, reject) => {
                    fs.readdir(".", (err, files) => {
                        if (err) {
                            resolve(); //reject(err);
                            return console.error(err);
                        }
                        files.forEach(fileName => {
                            if (fileName.endsWith(".idx")) {
                                const match = fileName.match(/^([a-z0-9_$]+)-([a-z0-9_$#\-]+)-([a-z0-9_$]+)\.idx$/i);
                                console.log(match);
                                if (match && match[1] === storage.name) {
                                    const path = match[2].replace(/\-/g, "/").replace(/\#/g, "*");
                                    const key = match[3];
            
                                    // We can do 2 things now:
                                    // 1. Just add it to our array
                                    // 2. Rebuild
                                    const index = new DataIndex(storage, path, key);
                                    _indexes.push(index); //_indexes.push({ fileName, path, key });  // 1
                                    //_keepIndexUpdated(index);
                                    // storage.indexes.create(path, key, true); // 2
                                }
                            }
                        });
                        resolve();
                    });
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

                fs.writeFile(filename, Buffer.from(uint8.buffer), (err) => {
                    if (err) {
                        throw err;
                    }
                    openDatabaseFile(true)
                    .then(() => {
                        // Now create the root record
                        return Record.create(this, "", {});
                    })
                    .then(rootRecord => {
                        this.emit("ready");
                    });
                });
            }
        });

        // Subscriptions
        const _subs = {};
        this.subscriptions = {
            /**
             * Adds a subscription to a node
             * @param {string} path - Path to the node to add subscription to
             * @param {string} type - Type of the subscription
             * @param {function} callback - Subscription callback function
             */
            add(path, type, callback) {
                if (["value","child_added","child_changed","child_removed"].indexOf(type) < 0) {
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
             * Triggers subscription events to run on relevant nodes
             * @param {string} event - Event that triggered execution
             * @param {string} path - Path to the node that triggered execution
             * @param {any} previous - Previous value, to determine changes
             */
            trigger(event, path, previous, updates, current, lock) {
                //const ref = new Reference(db, path); //createReference(path);
                //console.trace(`Event "${event} "on "/${path}", previous value: `, previous);
                console.warn(`Event "${event}" on "/${path}"`);
                if (event === "update") {

                    const compare = (oldVal, newVal) => {
                        const voids = [undefined, null];
                        if (oldVal === UNCHANGED || oldVal === newVal) { return "identical"; }
                        else if (voids.indexOf(oldVal) >= 0 && voids.indexOf(newVal) < 0) { return "added"; }
                        else if (voids.indexOf(oldVal) < 0 && voids.indexOf(newVal) >= 0) { return "removed"; }
                        else if (typeof oldVal !== typeof newVal) { return "changed"; }
                        else if (typeof oldVal === "object") { 
                            // Do key-by-key comparison of objects
                            const isArray = oldVal instanceof Array;
                            const oldKeys = isArray 
                                ? Object.keys(oldVal).map(v => parseInt(v)) //new Array(oldVal.length).map((v,i) => i) 
                                : Object.keys(oldVal);
                            const newKeys = isArray 
                                ? Object.keys(newVal).map(v => parseInt(v)) //new Array(newVal.length).map((v,i) => i) 
                                : Object.keys(newVal);
                            const removedKeys = oldKeys.filter(key => newKeys.indexOf(key) < 0);
                            // = oldKeys.reduce((removed, key) => { 
                            //     if (newKeys.indexOf(key) < 0) { 
                            //         removed.push(key); 
                            //     } 
                            //     return removed;
                            // }, []);
                            const addedKeys = newKeys.filter(key => oldKeys.indexOf(key) < 0);
                            // = newKeys.reduce((added, key) => { 
                            //     if (oldKeys.indexOf(key) < 0) { 
                            //         added.push(key); 
                            //     } 
                            //     return added;
                            // }, []);
                            const changedKeys = newKeys.reduce((changed, key) => { 
                                if (oldKeys.indexOf(key) >= 0) {
                                    const val1 = oldVal[key];
                                    const val2 = newVal[key];
                                    const c = compare(val1, val2);
                                    // if (typeof c === "object") {
                                    //     changed.push({ key, change: c })
                                    // }
                                    // else 
                                    if (c !== "identical") {
                                        changed.push({ key, change: c });
                                    }
                                } 
                                return changed;
                            }, []);

                            if (addedKeys.length === 0 && removedKeys.length === 0 && changedKeys.length === 0) {
                                return "identical";
                            }
                            else {
                                return {
                                    added: addedKeys,
                                    removed: removedKeys,
                                    changed: changedKeys
                                }; 
                            }
                        }
                        else if (oldVal !== newVal) { return "changed"; }
                        return "identical";
                    };

                    const changedKeys = {
                        added: Object.keys(updates).filter(key => updates[key] !== null && (typeof previous !== "object" || !(key in previous))),
                        updated: Object.keys(updates).filter(key => updates[key] !== null && typeof previous === "object" && key in previous && compare(previous[key], updates[key]) !== "identical"),
                        deleted: Object.keys(updates).filter(key => updates[key] === null && typeof previous === "object" && key in previous)
                    }
                    if (changedKeys.added.length > 0 || changedKeys.updated.length > 0 || changedKeys.deleted.length > 0) {
                        storage.emit("update", {
                            path,
                            added: changedKeys.added,
                            updated: changedKeys.updated,
                            deleted: changedKeys.deleted
                        });
                    }
                    else {
                        console.warn(`There are no real changes to path "/${path}"`);
                        return;
                    }

                    // Subscription handling logic:
                    // 1. For all subscriptions on child paths, we have all changed data
                    // 2. For all child_* subscriptions on current path or parent paths, we have all changed data
                    // 3. All child_added & child_removed events on grandparent+ paths can be ignored
                    // 4. For all value subscriptions on current or parent paths, we need to get all data

                    const subscriptions = [];
                    const addSubscriptions = (p, checkCallback = undefined) => { 
                        const subs = _subs[p];
                        subs && subs.forEach(sub => {
                            const add = checkCallback ? checkCallback({ path: p, type: sub.type }) : true;
                            add && subscriptions.push({ path: p, type: sub.type, callback: sub.callback });
                        });
                    };

                    // 1. Add all subscriptions to child paths
                    Object.keys(_subs).forEach(spath => {
                        if (spath.startsWith(path + "/") || path === "") {
                            //checkRef(createReference(spath));
                            const trailPath = spath.slice(path.length).replace(/^\//, "");
                            const firstKey = getPathKeys(trailPath)[0];
                            if (firstKey && previous[firstKey] !== UNCHANGED) {
                                addSubscriptions(spath);
                            }
                        }
                    });

                    // 2. and 4. Add all subscriptions on the updated node itself
                    let topSubscriptionPath = null;
                    let topDataPath = null;
                    let currentHasAllData = current && !Object.keys(current).some(key => current[key] instanceof RecordReference);
                    addSubscriptions(path, subscription => {
                        if (subscription.type === "value" && !currentHasAllData) {
                            topDataPath = path;
                            topSubscriptionPath = path;
                        }
                        return true;
                    });

                    // 2. 3. and 4. Check parent/grandparent+ node subscriptions
                    let currentPath = path;
                    let parentPath = getPathInfo(path).parent;
                    let isOurParent = true;
                    while (parentPath !== null) {
                        addSubscriptions(parentPath, subscription => {
                            let add = false;
                            if (subscription.type === "value") { 
                                topDataPath = parentPath;
                                add = true;
                            }
                            else if (isOurParent && subscription.type.startsWith("child_")) {
                                // This node changed, so these are the only relevant events for the parent
                                add = true;
                            }
                            else if (!isOurParent && subscription.type === "child_changed") {
                                topDataPath = currentPath;
                                add = true;
                            }
                            if (add) {
                                topSubscriptionPath = parentPath;
                            }
                            return add;
                        });
                        currentPath = parentPath;
                        parentPath = getPathInfo(parentPath).parent;
                        isOurParent = false;
                    }

                    function loadData(path) {
                        // const ref = new Reference(db, path);
                        // return ref.once("value");
                        path = path.replace(/^\/|\/$/g, "");
                        const tid = lock ? lock.tid : uuid62.v1();
                        let ourLock;
                        return storage.lock(path, tid, false, `storage.trigger:loadData "/${path}"`)
                        .then(lock => {
                            ourLock = lock;
                            return Record.get(storage, { path }, { lock: ourLock });
                        })
                        .then(record => {
                            if (!record) {
                                if (path.length === 0) { return null; }
                                const pathInfo = getPathInfo(path);
                                return loadData(pathInfo.parent)
                                .then(data => {
                                    if (typeof data !== "object") { return null; }
                                    else if (typeof data[pathInfo.key] === "undefined") { return null; }
                                    return data[pathInfo.key];
                                });
                            }
                            else {
                                return record.getValue({ lock: ourLock });
                            }
                        })
                        .then(val => {
                            ourLock.release();
                            return val;
                        });
                    }

                    // Now we know all callbacks to run, get the "top" data and run 
                    // each callback with their appropriate data
                    if (subscriptions.length === 0) { return Promise.resolve(); }

                    // Check if we have to load any data
                    const topPath = topSubscriptionPath !== null ? topSubscriptionPath : path;
                    const buildTopData = (currentData) => {
                        let topData = {
                            previous,
                            current: currentData
                        }
                        if (path.length > topPath.length) {
                            const trailPath = path.slice(topPath.length).replace(/^\//, "");
                            const trailKeys = getPathKeys(trailPath);
                            while (trailKeys.length > 0) {
                                const key = trailKeys.pop();
                                topData.previous = { [key]: topData.previous };
                            }
                        }
                        if (topDataPath.length > topPath.length) {
                            const trailPath = topDataPath.slice(topPath.length).replace(/^\//, "");
                            const trailKeys = getPathKeys(trailPath);
                            while (trailKeys.length > 0) {
                                const key = trailKeys.pop();
                                topData.current = { [key]: topData.current };
                            }
                        }
                        return topData;                    
                    };
                    let topPromise; 
                    if (topDataPath) {
                        // We have to load data
                        topPromise = loadData(topDataPath)
                        .then(topData => {
                            topData = buildTopData(topData);
                            return topData;
                        });
                    }
                    else {
                        // No need to load data, but if the top subscribed path is on a parent, we have to create the parent data
                        let topData = {};
                        Object.keys(previous).forEach(key => topData[key] = previous[key]);
                        Object.keys(updates).forEach(key => topData[key] = updates[key]);

                        topDataPath = path;
                        topData = buildTopData(topData);
                        topPromise = Promise.resolve(topData);
                    }

                    return topPromise.then(topData => {

                        const getDataAtPath = (targetPath) => {
                            const trailPath = targetPath.slice(topPath.length).replace(/^\//,"");
                            const trailKeys = getPathKeys(trailPath);
                            const data = {
                                previous: topData.previous,
                                current: topData.current
                            };
                            while (trailKeys.length > 0) {
                                const key = trailKeys.shift();
                                if (data.previous !== null) {
                                    data.previous = typeof data.previous === "object" && key in data.previous ? data.previous[key] : null;
                                }
                                if (data.current !== null) {
                                    data.current = typeof data.current === "object" && key in data.current ? data.current[key] : null;
                                }
                            }
                            return data;
                        }
                        
                        // const current = getDataAtPath(path).current;
                        // const change = compare(previous, current);
                        // //debug.log(`Data on path ${path} compare result:`);
                        // //debug.log(change);
                        // if (change === "identical") {
                        //     return; // The node was updated, but nothing changed really. No need to run any callbacks
                        // }

                        // storage.emit("datachanged", {
                        //     //type: "update",
                        //     path: path,
                        //     previous: previous,
                        //     current: current
                        // });

                        // Group callbacks by path
                        const groupedSubscriptions = subscriptions.reduce((all, sub) => {
                            let i = all.findIndex(group => group.path === sub.path);
                            let group = all[i] || { path: sub.path, subscriptions: [] };
                            group.subscriptions.push(sub);
                            if (i < 0) { all.push(group); }
                            return all;
                        }, []);

                        // Now proceed with callbacks
                        //process.nextTick(() => {
                            groupedSubscriptions.forEach(group => {
                                const refPath = group.path; //c.ref.path;
                                const dataset = getDataAtPath(refPath);
                                if (refPath.length < path.length) {
                                    // The path of the subscriber is at a higher node than the updated
                                    // object. We don't need to compare data for this
                                    group.subscriptions.forEach(c => {
                                        if (c.type === "value") {
                                            //c.callback(null, new Snapshot(c.ref, dataset.current));
                                            //c.callback(null, new Snapshot(ref, dataset.current));
                                            c.callback(null, c.path, dataset.current);
                                        }
                                        else {
                                            // const nextSlash = path.indexOf("/", refPath.length + 1);
                                            // const childKey = path.substring(
                                            //     refPath.length === 0 ? 0 : refPath.length + 1, 
                                            //     nextSlash >= 0 ? nextSlash : path.length
                                            // );
                                            // const childPath = `${c.path}/${childKey}`;
                                            const refPathKeys = getPathKeys(refPath);
                                            const pathKeys = getPathKeys(path);
                                            const childKey = pathKeys[refPathKeys.length];
                                            const childPath = getChildPath(refPath, childKey);

                                            const childData = dataset.current[childKey];
                                            const oldChildData = dataset.previous[childKey];

                                            if (c.type === "child_changed" && childData) {
                                                //c.callback(null, new Snapshot(childRef, childData));
                                                c.callback(null, childPath, childData, oldChildData);
                                            }
                                            else if (c.type === "child_removed" && !childData) {
                                                //c.callback(null, new Snapshot(childRef, null));
                                                c.callback(null, childPath, oldChildData);
                                            }
                                            // else if (c.type === "child_added" && `${refPath}/${key}` === path) {
                                            //     // Logic isn't right. Will be called on updates now too
                                            //     c.callback(null, createSnapshot(childRef, childData));
                                            // }
                                        }
                                    });
                                    return;
                                }

                                // Get data changes
                                const change = compare(dataset.previous, dataset.current);
                                if (change === "identical") {
                                    return; // next!
                                }

                                // Run with data
                                group.subscriptions.forEach(c => {
                                    if (c.type === "value") {
                                        c.callback(null, c.path, dataset.current);
                                    }
                                    else if (typeof change === "object") {
                                        if (c.type === "child_added" && change.added.length > 0) {
                                            change.added.forEach(key => {
                                                const childPath = getChildPath(c.path, key);
                                                const childData = dataset.current[key];
                                                c.callback(null, childPath, childData);
                                            });
                                        }
                                        else if (c.type === "child_removed" && change.removed.length > 0) {
                                            change.removed.forEach(key => {
                                                const childPath = getChildPath(c.path, key);
                                                const oldChildData = dataset.previous[key];
                                                c.callback(null, childPath, oldChildData);
                                            });
                                        }
                                        else if (c.type === "child_changed" && change.changed.length > 0) {
                                            change.changed.forEach(item => {
                                                const key = item.key;
                                                const childPath = getChildPath(c.path, key);
                                                const childData = dataset.current[key];
                                                const oldChildData = dataset.previous[key];
                                                c.callback(null, childPath, childData, oldChildData);
                                            });
                                        }
                                    }
                                });
                            });
                        //});
                    });
                }
            } // End of .trigger
        }

    }

    get pageByteSize() {
        return this.settings.pageSize * this.settings.recordSize;
    }

    getRecordFileIndex(pageNr, recordNr) {
        const index = 
            this.rootRecord.fileIndex 
            + (pageNr * this.pageByteSize) 
            + (recordNr * this.settings.recordSize);
        return index;
    }

    _allowLock(path, tid, forWriting) {
        // Can this lock be granted now or do we have to wait?
        let conflictLock = this._locks.find(otherLock => {
            if (otherLock.path === path && otherLock.tid !== tid && otherLock.state === RecordLock.LOCK_STATE.LOCKED) {
                return forWriting || otherLock.forWriting;
            }
            return false;
            
            // if (otherLock.tid !== tid && otherLock.state === RecordLock.LOCK_STATE.LOCKED) {
            //     const pathClash = path === "" 
            //         || otherLock.path === "" 
            //         || path === otherLock.path 
            //         || otherLock.path.startsWith(`${path}/`) 
            //         || path.startsWith(`${otherLock.path}/`);
                
            //     if (!pathClash) {
            //         // This lock is on a different path
            //         return false;
            //     } 
            //     else {
            //         // Lock is on a clashing path. If any or both locks are for write mode, 
            //         // deny the new lock.
            //         return (forWriting && (path === "" || path.startsWith(`${otherLock.path}/`))) 
            //             || (otherLock.forWriting && (otherLock.path === "" || otherLock.path.startsWith(`${path}/`)));
            //     }
            // }
        });
        if (conflictLock) {
            return false;
        }
        return true;
    }

    // _allowLock(lock) {
    //     // Can this lock be granted now or do we have to wait?
    //     const { path, tid } = lock;
    //     const isConflictingPath = (otherPath) => {
    //         if (path === "" || otherPath === "" || otherPath === path) {
    //             return true;
    //         }
    //         else if (otherPath.startsWith(`${path}/`) || path.startsWith(`${otherPath}/`)) {
    //             return true;
    //         }
    //     };
    //     const proceed = this._locks.every(otherLock => {
    //         if (otherLock.tid !== tid && otherLock.state === LOCK_STATE.LOCKED) {
    //             return !isConflictingPath(otherLock.path);
    //         }
    //         return true;
    //     });
    //     return proceed;
    // }

    /**
     * Locks a path for writing. While the lock is in place, it's value cannot be changed by other transactions.
     * @param {string} path path being locked
     * @param {any} tid a unique value to identify your transaction
     * @param {boolean} forWriting if the record will be written to. Multiple read locks can be granted access at the same time if there is no write lock. Once a write lock is granted, no others can read from or write to it.
     * @returns {Promise<RecordLock>} returns a promise with the lock object once it is granted. It's .release method can be used as a shortcut to .unlock(path, tid) to release the lock
     */
    lock(path, tid, forWriting = true, comment) {
        //const MAX_LOCK_TIME = 5 * 1000; // 5 seconds
        const MAX_LOCK_TIME = 60 * 1000 * 15; // 15 minutes FOR DEBUGGING PURPOSES ONLY

        let lock, proceed;
        if (path instanceof RecordLock) {
            lock = path;
            lock.comment = `(retry: ${lock.comment})`;
            proceed = true;
        }
        else {
            lock = new RecordLock(this, path, tid, forWriting);
            lock.comment = comment;
            this._locks.push(lock);
            proceed = this._allowLock(path, tid, forWriting);
        }

        if (proceed) {
            lock.state = RecordLock.LOCK_STATE.LOCKED;
            if (typeof lock.granted === "number") {
                //debug.warn(`lock :: ALLOWING ${lock.forWriting ? "write" : "read" } lock on path "/${lock.path}" by tid ${lock.tid}; ${lock.comment}`);
            }
            else {
                lock.granted = Date.now();
                lock.expires = Date.now() + MAX_LOCK_TIME;
                //debug.warn(`lock :: GRANTED ${lock.forWriting ? "write" : "read" } lock on path "/${lock.path}" by tid ${lock.tid}; ${lock.comment}`);
                lock.timeout = setTimeout(() => {
                    if (lock.state !== RecordLock.LOCK_STATE.LOCKED) { return; }
                    debug.error(`lock :: ${lock.forWriting ? "write" : "read" } lock on path "/${lock.path}" by tid ${lock.tid} took too long, ${lock.comment}`);
                    lock.state = RecordLock.LOCK_STATE.EXPIRED;
                    // TODO Enable again once data storing bug has been found:
                    // const i = this._locks.indexOf(lock);
                    // this._locks.splice(i, 1);
                    let allTransactionLocks = this._locks.filter(l => l.tid === lock.tid).sort((a,b) => a.requested < b.requested ? -1 : 1);
                    let transactionsDebug = allTransactionLocks.map(l => `${l.state} ${l.forWriting ? "WRITE" : "read"} ${l.comment}`).join("\n");
                    debug.warn(transactionsDebug);

                    this._processLockQueue();
                }, MAX_LOCK_TIME);
            }
            return Promise.resolve(lock);
        }
        else {
            // Keep pending until clashing lock(s) is/are removed
            //debug.warn(`lock :: QUEUED ${lock.forWriting ? "write" : "read" } lock on path "/${lock.path}" by tid ${lock.tid}; ${lock.comment}`);
            console.assert(lock.state === RecordLock.LOCK_STATE.PENDING);
            const p = new Promise((resolve, reject) => {
                lock.resolve = resolve;
                lock.reject = reject;
            });
            return p;
        }
    }

    unlock(lock, comment) {// (path, tid, comment) {
        const i = this._locks.indexOf(lock); //this._locks.findIndex(lock => lock.tid === tid && lock.path === path);
        if (i < 0) {
            const msg = `lock on "/${lock.path}" for tid ${lock.tid} wasn't found; ${comment}`;
            console.error(`unlock :: ${msg}`);
            return Promise.reject(new Error(msg));
        }
        //const lock = this._locks[i];
        lock.state = RecordLock.LOCK_STATE.DONE;
        clearTimeout(lock.timeout);
        this._locks.splice(i, 1);
        //debug.warn(`unlock :: RELEASED ${lock.forWriting ? "write" : "read" } lock on "/${lock.path}" for tid ${lock.tid}; ${lock.comment}; ${comment}`);
        this._processLockQueue();
        return Promise.resolve(lock);
    }

    _processLockQueue() {
        const pending = this._locks
            .filter(lock => lock.state === RecordLock.LOCK_STATE.PENDING)
            .sort((a,b) => {
                // Writes get higher priority so all reads get the most recent data
                if (a.forWriting === b.forWriting) { 
                    if (a.requested < b.requested) { return -1; }
                    else { return 1; }
                }
                else if (a.forWriting) { return -1; }
                else { return 1; }
            });
        pending.forEach(lock => {
            if (this._allowLock(lock.path, lock.tid, lock.forWriting)) {
                // lock.state = "cancel";
                // let index = this._locks.indexOf(lock);
                // this._locks.splice(index, 1); // Remove, it will be added again by .lock!
                this.lock(lock) //lock.path, lock.tid, lock.forWriting, `(unqueued) ${lock.comment}`)
                .then(lock.resolve)
                .catch(lock.reject);
            }
        });
    }

}

module.exports = {
    Storage,
    StorageOptions
};