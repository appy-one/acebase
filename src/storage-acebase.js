const fs = require('fs');
const { pfs } = require('./promise-fs');
const { ID, PathInfo, PathReference, Utils, ColorStyle, PartialArray } = require('acebase-core');
const { concatTypedArrays, bytesToNumber, numberToBytes, encodeString, decodeString, cloneObject } = Utils;
const { Node, NodeChangeTracker, NodeChange } = require('./node');
const { NodeAddress } = require('./node-address');
const { NodeCache } = require('./node-cache');
const { NodeInfo } = require('./node-info');
const { NodeLock } = require('./node-lock');
const { Storage, StorageSettings, NodeNotFoundError } = require('./storage');
const { VALUE_TYPES } = require('./node-value-types');
const { BinaryBPlusTree, BPlusTreeBuilder, BinaryWriter } = require('./btree');
const { Uint8ArrayBuilder } = require('./binary');

const REMOVED_CHILD_DATA_IMPLEMENTED = false; // not used yet - allows marking of deleted children without having to rewrite the whole node

/**
 * @property {string} path
 * @property {Array<{ key:string|number, prev: any, val: any }>} list
 * @interface
 */
class IAppliedMutations {}

class AceBaseStorageSettings extends StorageSettings {
    /**
     * 
     * @param {AceBaseStorageSettings} settings 
     * @param {number} [settings.recordSize=128] record size in bytes, defaults to 128 (recommended)
     * @param {number} [settings.pageSize=1024] page size in records, defaults to 1024 (recommended). Max is 65536
     * @param {'data'|'transaction'|'auth'} [settings.type='data'] type of database content. Determines the name of the file within the .acebase directory
     * @param {AceBaseTransactionLogSettings} [settings.transactions] ssettings to use for transaction logging
     */
    constructor(settings) {
        super(settings);
        settings = settings || {};
        this.recordSize = settings.recordSize || 128;
        this.pageSize = settings.pageSize || 1024;
        this.type = settings.type || 'data';
        this.transactions = new AceBaseTransactionLogSettings(settings.transactions);
    }
}

class AceBaseTransactionLogSettings {
    /**
     * ALPHA functionality - logs mutations made to a separate database file so they can be retrieved later
     * for database syncing / replication. Implementing this into acebase itself will allow the current 
     * sync implementation in acebase-client to become better: it can simply request a mutations stream from
     * the server after disconnects by passing a cursor or timestamp, instead of downloading whole nodes before
     * applying local changes. This will also enable horizontal scaling: replication with remote db instances
     * becomes possible.
     * 
     * Still under development, disabled by default. See transaction-logs.spec for tests
     * 
     * @param {AceBaseTransactionLogSettings} settings 
     * @param {boolean} [settings.log=false] 
     * @param {number} [settings.maxAge=30] Max age of transactions to keep in logfile. Set to 0 to disable cleaning up and keep all transactions
     * @param {boolean} [settings.noWait=false]
     */
    constructor(settings) {
        settings = settings || {};
        this.log = settings.log === true; //!== false;
        this.maxAge = typeof settings.maxAge === 'number' ? settings.maxAge : 30; // 30 days
        this.noWait = settings.noWait === true;
    }
}

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

        this.name = name;
        this.settings = settings; // uses maxInlineValueSize, recordSize & pageSize settings from file when existing db
        const stats = {
            writes: 0,
            reads: 0,
            bytesRead: 0,
            bytesWritten: 0
        };
        this.stats = stats;

        this.type = settings.type;
        if (this.type === 'data' && settings.transactions.log === true) {
            // Get/create storage for mutations logging
            const txSettings = new AceBaseStorageSettings({ type: 'transaction', logLevel: 'error', path: settings.path, removeVoidProperties: true, transactions: settings.transactions });
            this.txStorage = new AceBaseStorage(name, txSettings);
        }

        this._ready = false;
        this.once('ready', () => {
            this._ready = true;
        });

        this.nodeCache = new NodeCache();
        /**
         * Use this method to update cache, instead of through this.nodeCache
         * @param {boolean} fromIPC Whether this update came from an IPC notification to prevent infinite loop
         * @param {NodeInfo} nodeInfo 
         * @param {boolean} [overwrite=true] Consider renaming to `hasMoved`, because that is what we seem to be using this flag for: it is set to false when reading a record's children - not because the address is actually changing
         */
        this.updateCache = (fromIPC, nodeInfo, hasMoved = true) => {
            this.nodeCache.update(nodeInfo, hasMoved);
            if (!fromIPC && hasMoved) {
                this.ipc.sendNotification({ type: 'cache.update', info: nodeInfo });
            }
        };
        this.invalidateCache = (fromIPC, path, recursive, reason) => {
            this.nodeCache.invalidate(path, recursive, reason);
            if (!fromIPC) {
                this.ipc.sendNotification({ type: 'cache.invalidate', path, recursive, reason });
            }
        };

        const filename = `${this.settings.path}/${this.name}.acebase/${this.type}.db`;
        let fd = null;

        const writeData = async (fileIndex, buffer, offset = 0, length = -1) => {
            if (buffer.constructor === Uint8Array) { //buffer instanceof Uint8Array) {
                // If the passsed buffer is of type Uint8Array (which is essentially the same as Buffer),
                // convert it to a Buffer instance or fs.write will FAIL.
                buffer = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
            }
            console.assert(buffer instanceof Buffer, 'buffer argument must be a Buffer or Uint8Array');
            if (length === -1) {
                length = buffer.byteLength;
            }
            const { bytesWritten } = await pfs.write(fd, buffer, offset, length, fileIndex).catch(err => {
                this.debug.error(`Error writing to file`, err);
                throw err;
            });
            stats.writes++;
            stats.bytesWritten += bytesWritten;
            return bytesWritten;
        };
        this.writeData = writeData; // Make available to external classes

        /**
         * 
         * @param {number} fileIndex Index of the file to read
         * @param {Buffer|ArrayBuffer|ArrayBufferView} buffer Buffer object, ArrayBuffer or TypedArray (Uint8Array, Int8Array, Uint16Array etc) to read data into
         * @param {number} offset byte offset in the buffer to read data into, default is 0
         * @param {number} length total bytes to read (if omitted or -1, it will use buffer.byteLength)
         * @returns {Promise<number>} returns the total bytes read
         */
        const readData = async (fileIndex, buffer, offset = 0, length = -1) => {
            if (length === -1) {
                length = buffer.byteLength;
            }
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
            const { bytesRead } = await pfs.read(fd, buffer, offset, length, fileIndex).catch(err => {
                this.debug.error(`Error reading record`, buffer, offset, length, fileIndex);
                this.debug.error(err);
                throw err;
            });
            stats.reads++;
            stats.bytesRead += bytesRead;
            return bytesRead;
        }
        this.readData = readData;

        // Setup cluster functionality
        this.ipc.on('request', async message => {
            // Master functionality: handle requests from workers

            console.assert(this.ipc.isMaster, `Workers should not receive requests`);
            const request = message.data;
            const reply = result => {
                // const reply = { type: 'result', id: message.id, ok: true, from: this.ipc.id, to: message.from, data: result };
                // this.ipc.sendMessage(reply);
                this.ipc.replyRequest(message, result);
            };
            try {
                switch (request.type) {
                    // FST (free space table / allocation) requests:
                    case 'fst.allocate': {
                        const allocation = await this.FST.allocate(request.records);
                        return reply({ ok: true, allocation });
                    }
                    case 'fst.release': {
                        this.FST.release(request.ranges);
                        return reply({ ok: true });
                    }
                    // KIT (key index table) requests:
                    case 'kit.add': {
                        let index = this.KIT.getOrAdd(request.key);
                        return reply({ ok: true, index });
                    }
                    // Indexing requests:
                    // Room for improvement: implement distributed index locks 
                    // so they can be created & updated by any worker, instead of
                    // putting the master to work for this.
                    case 'index.create': {
                        const index = await this.indexes.create(request.path, request.key, request.options);
                        return reply({ ok: true, fileName: index.fileName });
                    }
                    case 'index.update': {
                        const index = this.indexes.list().find(index => index.fileName === request.fileName);
                        if (!index) { return reply({ ok: false, reason: `Index ${request.fileName} not found` }); }
                        await index.handleRecordUpdate(request.path, request.oldValue, request.newValue);
                        return reply({ ok: true });
                    }
                    default: {
                        throw new Error(`Unknown ipc request "${request.type}"`);
                    }
                }
            }
            catch(err) {
                reply({ ok: false, reason: err.message });
            }
        });
        this.ipc.on('notification', message => {
            const notification = message.data;
            switch(notification.type) {
                case 'kit.new_key': {
                    this.KIT.keys[notification.index] = notification.key;
                    break;
                }
                case 'root.update': {
                    return this.rootRecord.update(notification.address, false);
                }
                case 'cache.update': {                    
                    const nodeInfo = new NodeInfo(notification.info);
                    nodeInfo.address = new NodeAddress(nodeInfo.address.path, nodeInfo.address.pageNr, nodeInfo.address.recordNr);
                    return this.updateCache(true, nodeInfo, true);
                }
                case 'cache.invalidate': {
                    return this.invalidateCache(true, notification.path, notification.recursive, notification.reason);
                }
                case 'index.created': {
                    return this.indexes.add(notification.fileName);
                }
                case 'index.deleted': {
                    return this.indexes.remove(notification.fileName);
                }
                default: {
                    throw new Error(`Unknown ipc notification "${notification.type}"`);
                }
            }
        });

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
                    if (!storage.ipc.isMaster) {
                        // Forward request to cluster master. Response will be too late for us, but it will be cached for future calls
                        storage.ipc.sendRequest({ type: 'kit.add', key })
                        .then(result => {
                            this.keys[result.index] = key; // Add to our local array
                        });
                        return -1;
                    }
                    index = this.keys.push(key) - 1;
                    if (storage.ipc.isMaster) {
                        // Notify all workers
                        storage.ipc.sendNotification({ type: 'kit.new_key', key, index });
                    }
                }
                else {
                    return index;
                }
                try {
                    this.write().catch(err => {
                        // Not being able to save the new KIT to file would be a serious issue.
                        // Because getOrAdd is not async, there is no way we can tell caller there is a problem with the key they are using.
                        // On the other hand, if writing the KIT data failed (IO error), the calling code will most likely also have 
                        // issues writing the data they needed the new key for.
                        storage.debug.error(`CRITICAL: Unable to write KIT to database file: ${err.message}`);
                    });
                }
                catch(err) {
                    this.keys.pop(); // Remove the key
                    index = -1;
                }
                return index;
            },

            write() {
                if (!storage.ipc.isMaster) {
                    throw new Error(`DEV ERROR: KIT.write not allowed to run if it is a cluster worker!!`);
                }
                // Key Index Table starts at index 64, and is 2^16 (65536) bytes long
                const data = Buffer.alloc(this.length);
                const view = new DataView(data.buffer);
                let index = 0;
                for(let i = 0; i < this.keys.length; i++) {
                    const key = this.keys[i];

                    // Now supports storage of keys with Unicode characters

                    /** @type {Uint8Array} */
                    const binary = encodeString(key);
                    const keyLength = binary.byteLength;

                    if (index + keyLength >= this.length) {
                        throw new Error(`Too many keys to store in KIT, size limit of ${this.length} has been reached; current amount of keys is ${this.keys.length}`);
                    }

                    // Add 1-byte key length
                    view.setUint8(index, keyLength);
                    index++;

                    // Add key
                    data.set(binary, index);
                    index += keyLength;
                }
                const bytesToWrite = Math.max(this.bytesUsed, index);    // Determine how many bytes should be written to overwrite current KIT
                this.bytesUsed = index;

                return writeData(this.fileIndex, data, 0, bytesToWrite)
                // .then(bytesWritten => {
                //     storage.debug.log(`KIT saved, ${bytesWritten} bytes written`);
                // })
                .catch(err => {
                    storage.debug.error(`Error writing KIT: `, err);
                });
            },

            async load() {
                let data = Buffer.alloc(this.length);
                const { bytesRead } = await pfs.read(fd, data, 0, data.length, this.fileIndex).catch(err => {
                    storage.debug.error(`Error reading KIT from file: `, err);
                    throw err;
                });

                // Interpret the read data
                let view = new DataView(data.buffer, 0, bytesRead);
                let keys = [];
                let index = 0;
                let keyLength = 0;
                while((keyLength = view.getUint8(index)) > 0) {
                    index++;
                    // Now supports Unicode keys
                    const buffer = new Uint8Array(data.buffer, index, keyLength);
                    const key = decodeString(buffer);
                    keys.push(key);
                    index += keyLength;
                }
                this.bytesUsed = index;
                this.keys = keys;
                storage.debug.log(`KIT read, ${this.keys.length} keys indexed`.colorize(ColorStyle.bold));
                //storage.debug.log(keys);
                return keys;
            }
        };

        // Setup Free Space Table object and functions        
        if (!this.ipc.isMaster) {
            // We are a worker in a Node cluster, FST requests must be handled by the master via IPC
            this.FST = {
                /**
                 * 
                 * @param {number} requiredRecords 
                 * @returns {Promise<Array<{ pageNr: number, recordNr: number, length: number }>>}
                 */
                async allocate(requiredRecords) {
                    const result = await storage.ipc.sendRequest({ type: 'fst.allocate', records: requiredRecords })
                    return result.allocation;
                },
                async release(ranges) {
                    await storage.ipc.sendRequest({ type: 'fst.release', ranges });
                },
                async load() {
                    return []; // Fake loader
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
                async allocate(requiredRecords) {
                    // First, try to find a range that fits all requested records sequentially
                    const recordsPerPage = storage.settings.pageSize;
                    let allocation = [];
                    let pageAdded = false;
                    const ret = async (comment) => {
                        // console.error(`ALLOCATED ${comment}: ${allocation.map(a => `${a.pageNr},${a.recordNr}+${a.length-1}`).join('; ')}`);
                        await this.write(pageAdded);
                        return allocation;
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

                async write(updatedPageCount = false) {
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

                    const promise = writeData(this.fileIndex, data, 0, bytesToWrite).catch(err => {
                        storage.debug.error(`Error writing FST: `, err);
                    });
                    const writes = [promise];
                    if (updatedPageCount === true) {
                        // Update the file size
                        const newFileSize = storage.rootRecord.fileIndex + (this.pages * settings.pageSize * settings.recordSize);
                        const promise = pfs.ftruncate(fd, newFileSize);
                        writes.push(promise);
                    }
                    await Promise.all(writes);
                    //storage.debug.log(`FST saved, ${this.bytesUsed} bytes used for ${this.ranges.length} ranges`);
                },

                async load() {
                    let data = Buffer.alloc(this.length);
                    const { bytesRead } = await pfs.read(fd, data, 0, data.length, this.fileIndex).catch(err => {
                        storage.debug.error(`Error reading FST from file`);
                        storage.debug.error(err);
                        throw err;
                    })
                    // Interpret the read data
                    let view = new DataView(data.buffer, 0, bytesRead);
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
                    storage.debug.log(`FST read, ${allocatedPages} pages allocated, ${freeRangeCount} free ranges`.colorize(ColorStyle.bold));
                    return ranges;
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
             * @param {boolean} [write=true] whether this update comes from an IPC notification, prevent infinite loopbacks
             */
            async update (address, fromIPC = false) {
                // Root address changed
                console.assert(address.path === "");
                if (address.pageNr === this.pageNr && address.recordNr === this.recordNr) {
                    // No need to update
                    return;
                }
                this.pageNr = address.pageNr;
                this.recordNr = address.recordNr;
                this.exists = true;
                // storage.debug.log(`Root record address updated to ${address.pageNr}, ${address.recordNr}`.colorize(ColorStyle.bold));

                if (!fromIPC) {
                    // Notify others
                    storage.ipc.sendNotification({ type: 'root.update', address });

                    // Save to file, or it didn't happen
                    const bytes = new Uint8Array(6);
                    const view = new DataView(bytes.buffer);
                    view.setUint32(0, address.pageNr);
                    view.setUint16(4, address.recordNr);
                    
                    const bytesWritten = await writeData(HEADER_INDEXES.ROOT_RECORD_ADDRESS, bytes, 0, bytes.length);
                    storage.debug.log(`Root record address updated to ${address.pageNr}, ${address.recordNr}`.colorize(ColorStyle.bold));
                }
            }
        }

        const descriptor = encodeString('AceBase⚡');
        const baseIndex = descriptor.length;
        const HEADER_INDEXES = {
            VERSION_NR: baseIndex,
            DB_LOCK: baseIndex + 1,
            ROOT_RECORD_ADDRESS: baseIndex + 2,
            RECORD_SIZE: baseIndex + 8,
            PAGE_SIZE: baseIndex + 10,
            MAX_INLINE_VALUE_SIZE: baseIndex + 12
        };

        const openDatabaseFile = async (justCreated) => {
            const handleError = (err, txt) => {
                this.debug.error(txt);
                this.debug.error(err);
                if (this.file) {
                    pfs.close(this.file).catch(err => {
                        // ...
                    });
                }
                this.emit("error", err);
                throw err;
            };

            this.file = fd = await pfs.open(filename, 'r+', 0).catch(err => {
                handleError(err, `Failed to open database file`);
            });

            // const logfile = fs.openSync(`${this.settings.path}/${this.name}.acebase/log`, 'as');
            // this.logwrite = (action) => {
            //     fs.appendFile(logfile, JSON.stringify(action), () => {});
            // }; 
    
            const data = Buffer.alloc(64);
            const { bytesRead } = await pfs.read(fd, data, 0, data.length, 0).catch(err => {
                handleError(err, `Could not read database header`);
            });

            // Cast Buffer to Uint8Array
            const header = new Uint8Array(data);

            // Check descriptor
            const hasAceBaseDescriptor = () => {
                for(let i = 0; i < descriptor.length; i++) {
                    if (header[i] !== descriptor[i]) {
                        return false;
                    }
                }
                return true;
            }
            if (bytesRead < 64 || !hasAceBaseDescriptor()) {
                return handleError(`unsupported_db`, `This is not a supported database file`); 
            }
            
            // Version should be 1
            let index = descriptor.length;
            if (header[index] !== 1) {
                return handleError(`unsupported_db`, `This database version is not supported, update your source code`);
            }
            index++;
            
            // File should not be locked
            if (header[index] !== 0) {
                return handleError(`locked_db`, `The database is locked`);
            }
            index++;

            // Read root record address
            const view = new DataView(header.buffer, index, 6);
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

            const intro = ColorStyle.dim;
            this.debug.log(`Database "${name}" details:`.colorize(intro));
            this.debug.log(`- Type: AceBase binary`.colorize(intro));
            this.debug.log(`- Record size: ${this.settings.recordSize} bytes`.colorize(intro));
            this.debug.log(`- Page size: ${this.settings.pageSize} records (${this.settings.pageSize * this.settings.recordSize} bytes)`.colorize(intro));
            this.debug.log(`- Max inline value size: ${this.settings.maxInlineValueSize} bytes`.colorize(intro));
            this.debug.log(`- Root record address: ${this.rootRecord.pageNr}, ${this.rootRecord.recordNr}`.colorize(intro));

            await this.KIT.load();  // Read Key Index Table
            await this.FST.load();  // Read Free Space Table
            await this.indexes.load(); // Load indexes
            !justCreated && this.emitOnce('ready');
            return fd;
        };

        // Open or create database 
        fs.exists(filename, async (exists) => {
            if (exists) {
                // Open
                openDatabaseFile(false);
            }
            else if (!this.ipc.isMaster) {
                // Prevent race condition - let master process create database, poll for existance
                const poll = () => {
                    setTimeout(async () => {
                        exists = await pfs.exists(filename);
                        if (exists) { openDatabaseFile(); }
                        else { poll(); }
                    }, 10); // Wait 10ms before trying again
                }
                poll();
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
                if (dir !== '.') {
                    await pfs.mkdir(dir).catch(err => {
                        if (err.code !== 'EEXIST') { throw err; }
                    });
                }
                
                await pfs.writeFile(filename, Buffer.from(uint8.buffer)); 
                await openDatabaseFile(true);
                // Now create the root record
                await Node.set(this, '', {});
                this.rootRecord.exists = true;
                this.emitOnce('ready');
            }
        });

        this.ipc.once('exit', code => {
            // Close database file
            this.debug.log(`Closing db ${this.ipc.dbname}`);
            pfs.close(this.file).catch(err => {
                this.debug.error(`Could not close database:`, err);
            });
        });
    }

    get isReady() { return this._ready; }

    async close() {
        const p1 = super.close();
        const p2 = this.txStorage && this.txStorage.close(); // Also close transaction db
        await Promise.all([p1, p2]);
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

    get transactionLoggingEnabled() {
        return this.settings.transactions && this.settings.transactions.log === true;
    }

    logMutation(type, path, value, context, mutations) {
        // Add to transaction log
        if (!['set','update'].includes(type)) { throw new TypeError('op must be either "set" or "update"'); }
        if (!this.transactionLoggingEnabled) { throw new Error('transaction logging is not enabled on database'); }
        if (!context.acebase_cursor) { throw new Error('context.acebase_cursor must have been set'); }
        if (mutations.list.length === 0) {
            // There were no changes, nothing to log.
            return;
        }
        if (this.type === 'data') {
            return this.txStorage.logMutation(type, path, value, context, mutations);
        }
        else if (this.type !== 'transaction') {
            throw new Error(`Wrong database type`);
        }

        if (value === null) {
            // Target path was deleted. Log the mutation on parent node: prevents 2 different delete flows and allows for uniform getMutations logic
            const pathInfo = PathInfo.get(path);
            type = 'update';
            path = pathInfo.parentPath;
            value = { [pathInfo.key]: null };
        }

        const updatedKeys = mutations.path === path
            ? mutations.list.filter(ch => ch.target.length > 0 && ch.val !== null).map(ch => ch.target[0]) 
            : value instanceof Array ? Object.keys(value).map(key => +key) : Object.keys(value).filter(key => value[key] !== null);
        const deletedKeys = mutations.path === path 
            ? mutations.list.filter(ch => ch.target.length === 1 && ch.val === null).map(ch => ch.target[0]) 
            : [];
        const item = { 
            path, 
            updated: updatedKeys,
            deleted: deletedKeys,
            timestamp: Date.now(), 
            type, 
            value,
            context,
            mutations
        };
        // console.log(`Logging mutations on "/${path}": ${JSON.stringify(item.mutations)}`);

        const cursor = context.acebase_cursor;
        const store = async () => {
            if (!this.isReady) {
                await this.once('ready');
            }
            try {
                // const info = await this.getNodeInfo(`history/${cursor}`);
                // if (info.exists) {
                //     throw new Error('Another transaction using the same cursor found');
                // }
                await this._updateNode(`history`, { [cursor]: item }, { merge: true, _internal: true });
            }
            catch(err) {
                this.debug.error(`Failed to add to transaction log: `, err);
            }
        };

        const promise = store();
        if (!this.settings.transactions.noWait) {
            return promise.then(() => cursor);
        }
        return cursor;
    }

    /**
     * Gets all mutations from a given cursor or timestamp on a given path, or on multiple paths that are relevant for given events
     * @param {object} filter 
     * @param {string} [filter.cursor] cursor is a generated key (ID.generate) that represents a point of time
     * @param {number} [filter.timestamp] earliest transaction to include, will be converted to a cursor
     * @param {string} [filter.path] top-most paths to include. Can include wildcards to facilitate wildcard event listeners. Only used if `for` filter is not used, equivalent to `for: { path, events: ['value] }
     * @param {Array<{ path: string, events:string[] }>} [filter.for] Specifies which paths and events to get all relevant mutations for
     * @returns {Promise<{ used_cursor: string, new_cursor: string, mutations: Array<{ path: string, value: any, context: any, id: string, timestamp: number, changes: { path: string, list: Array<{ target: Array<string|number>, prev: any, val: any }>} }> }>}
     */
    async getMutations(filter) {
        if (this.type === 'data') {
            if (!this.transactionLoggingEnabled) { throw new Error('Transaction logging is not enabled'); }
            return this.txStorage.getMutations(filter);
        }
        else if (this.type !== 'transaction') {
            throw new Error(`Wrong database type`);
        }
        if (!this.isReady) {
            await this.once('ready');
        }
        const cursor = // Use given cursor, timestamp or nothing to filter on
            (filter.cursor && filter.cursor.slice(0, 8)) // .slice(0, 12)
            || (filter.timestamp && (new Date(filter.timestamp).getTime()).toString(36).padStart(8, '0')) //  + '0000'
            || '00000000';
        const since = 
            (typeof filter.timestamp === 'number' && filter.timestamp)
            || (cursor && parseInt(cursor, 36))
            || 0;

        // Check if cursor is not too old
        if (since !== 0 && cursor < this.oldestValidCursor) {
            throw new Error(`Cursor too old`);
        }

        if (!filter.for || filter.for.length === 0) {
            filter.for = [{ path: typeof filter.path === 'string' ? filter.path : '', events: ['value'] }]; // Use filter.path, or root node as single path
        }

        // Get filter paths, filter out paths that are descendants of another path
        const filterPaths = filter.for.filter(t1 => {
            const pathInfo = PathInfo.get(t1.path);
            return !filter.for.some(t2 => pathInfo.isDescendantOf(t2.path));
        }).map(item => item.path);

        const tid = this.createTid(); //ID.generate();
        const lock = await this.nodeLocker.lock('history', tid, false, `getMutations`);
        try {
            const checkQueue = [];
            let mutations = [];
            let done, donePromise = new Promise(resolve => done = resolve);
            let allEnumerated = false;

            const hasValue = val => ![undefined,null].includes(val);
            const hasPropertyValue = (val, prop) => hasValue(val) && typeof val === 'object' && hasValue(val[prop]);

            // const filterPathInfo = PathInfo.get(filter.path || '');
            const check = async key => {
                checkQueue.push(key);
                const mutation = await this.getNodeValue(`history/${key}`, { tid, include: ['path', 'updated', 'deleted', 'type', 'timestamp'] }); // Not including 'value' 
                mutation.keys = mutation.updated.concat(mutation.deleted);
                const mutationPathInfo = PathInfo.get(mutation.path);
                
                // Find the path in filter.paths on this trail, there can only be 1 (descendants were filtered out above)
                const filterPath = (() => {
                    const path = filterPaths.find(path => mutationPathInfo.isOnTrailOf(path));
                    return typeof path === 'string' ? path : null;
                })();
                const filterPathInfo = filterPath === null ? null : PathInfo.get(filterPath);
                const load = (() => {
                    /**
                     * When to include a mutation & what data to include.
                     * - filterPath === null if no filter paths were on the same trail as mutation.path
                     *      - eg: filterPaths on ["books/book1", "books/book2"], mutation.path === "books/book3"
                     *      - ignore
                     * - filterPath equals mutation.path
                     *      - eg: filterPath === mutation.path === "books/book1"
                     *      - use entire mutation
                     * - filterPath is an ancestor of mutation.path
                     *      - eg: filterPath === "books", mutation.path === "books/book1"
                     *      - use entire mutation
                     * - filterPath is a descendant of mutation.path
                     *      - eg: filterPath === "books/book1/title", mutation.path === "books"
                     *      - ignore if mutation.type === 'update' and mutation.keys does NOT include first trailing key of filterPath (eg only book2 is updated)
                     *      - if filterPath has wildcard (*, $var) keys, repeat following step recursively:
                     *      - use target (trailing) data in mutation value (value/books/book1/title) or null
                     */
                    if (mutation.timestamp < since || filterPath === null) {
                        return 'none';
                    }
                    if (!filterPathInfo.isDescendantOf(mutationPathInfo)) {
                        return 'all';
                    }
                    if (mutation.type === 'set' || mutation.keys.concat('*').includes(filterPathInfo.keys[mutationPathInfo.keys.length]) || filterPathInfo.keys[mutationPathInfo.keys.length].toString().startsWith('$')) {
                        return 'target';
                    }
                    return 'none';
                })();

                if (load !== 'none') {
                    const valueKey = 'value' + (load === 'target' ? (mutation.path.length === 0 ? '/' : '') + filterPath.slice(mutation.path.length) : '');
                    const tx = await this.getNodeValue(`history/${key}`, { tid, include: ['context', 'mutations', valueKey] }); // , ...loadKeys

                    let targetPath = mutation.path, targetValue = tx.value, targetOp = mutation.type;
                    if (typeof targetValue === 'undefined') {
                        targetValue = null;
                    }
                    else {
                        // Add removed properties to the target value again
                        mutation.deleted.forEach(key => targetValue[key] = null);
                    }
                    for (let m of tx.mutations.list) {
                        if (typeof m.val === 'undefined') { m.val = null; }
                        if (typeof m.prev === 'undefined') { m.prev = null; }
                    }
                    if (load === 'target') {
                        targetOp = 'set';
                        const trailKeys = filterPathInfo.keys.slice(mutationPathInfo.keys.length);
                        const process = (targetPath, targetValue, trailKeys) => {
                            const childKey = trailKeys[0];
                            trailKeys = trailKeys.slice(1);
                            if (childKey === '*' || childKey.toString().startsWith('$')) {
                                // Wildcard. Process all child keys
                                return Object.keys(targetValue).forEach(childKey => {
                                    process(targetPath, targetValue, [childKey, ...trailKeys]);
                                });
                            }
                            targetPath = PathInfo.getChildPath(targetPath, childKey);
                            targetValue = targetValue !== null && childKey in targetValue ? targetValue[childKey] : null;
                            if (trailKeys.length === 0) {
                                // console.log(`Adding mutation on "${targetPath}" to history of "${filterPathInfo.path}"`)
                                // Check if the targeted value actually changed
                                const targetPathInfo = PathInfo.get(targetPath);
                                const hasTargetMutation = tx.mutations.list.some(m => {
                                    const mTargetPathInfo = PathInfo.get(tx.mutations.path).child(m.target);
                                    if (mTargetPathInfo.isAncestorOf(targetPathInfo)) {
                                        // Mutation on higher path, check if target mutation prev and val are different
                                        const trailKeys = targetPathInfo.keys.slice(mTargetPathInfo.keys.length);
                                        const val = !hasValue(m.val) ? null : trailKeys.reduce((val, key) => hasPropertyValue(val, key) ? val[key] : null, m.val);
                                        const prev = !hasValue(m.prev) ? null : trailKeys.reduce((prev, key) => hasPropertyValue(prev, key) ? prev[key] : null, m.prev);
                                        return (val !== prev);
                                    }
                                    return mTargetPathInfo.isOnTrailOf(targetPathInfo);
                                });
                                hasTargetMutation && mutations.push({ id: key, path: targetPath, type: targetOp, timestamp: mutation.timestamp, value: targetValue, context: tx.context, changes: tx.mutations });
                            }
                            else {
                                process(targetPath, targetValue, trailKeys); // Deeper
                            }
                        }
                        process(targetPath, targetValue, trailKeys);
                    }
                    else {
                        // console.log(`Adding mutation on "${targetPath}" to history of "${filterPathInfo.path}"`)
                        mutations.push({ id: key, path: targetPath, type: targetOp, timestamp: mutation.timestamp, value: targetValue, context: tx.context, changes: tx.mutations }); // TODO remove __mutation__: mutation
                    }
                }

                checkQueue.splice(checkQueue.indexOf(key), 1);
                if (allEnumerated && checkQueue.length === 0) {
                    done();
                }
            };

            let count = 0;
            const oldestValidCursor = this.oldestValidCursor, expiredTransactions = [];
            await this.getChildren('history', { tid })
            .next(childInfo => {
                const txCursor = childInfo.key.slice(0, cursor.length);
                if (txCursor < oldestValidCursor) { expiredTransactions.push(childInfo.key); }
                if (txCursor < cursor) { return; }
                count++;
                check(childInfo.key);
            });

            allEnumerated = true;
            if (count > 0) {
                await donePromise;
            }

            if (expiredTransactions.length > 0) {
                // Remove expired transactions
                const expiredUpdate = expiredTransactions.reduce((updates, key) => {
                    updates[key] = null;
                    return updates;
                }, {});
                this.updateNode('history', expiredUpdate); // No need to await this, will be processed once we've released our read lock
            }

            // Make sure they are sorted
            mutations.sort((a, b) => a.timestamp - b.timestamp);

            // Toss all mutations the caller is not interested in
            const hasNewKeys = (val, prev) => Object.keys(val || {}).some(key => !(key in (prev || {})));
            const hasRemovedKeys = (val, prev) => Object.keys(prev || {}).some(key => !(key in (val || {})));
            const allEventsFor = (...events) => events.concat(...events.map(e => `notify_${e}`));
            const hasEvent = (events, check) => allEventsFor(...check).some(e => events.includes(e));
            mutations = mutations.filter(item => {

                // Get all changes as 'set' operations so we can compare
                const changes = (() => {
                    const basePathInfo = PathInfo.get(item.changes.path);
                    if (basePathInfo.isAncestorOf(item.path)) {
                        // Mutation has been recorded on higher path. 
                        // - Remove changes that are not on the requested target, caller might not have rights to read them
                        // - Modify relevant changes to be on target path
                        for (let i = 0; i < item.changes.list.length; i++) {
                            const ch = item.changes.list[i];
                            // item.path === 'library/books/book1'
                            // item.changes.path === 'library/books'
                            // m.target === ['book1']
                            // m.value === { ... }
                            const trailKeys = PathInfo.get(item.path).keys.slice(basePathInfo.keys.length);
                            
                            // Remove mutation from list if it's not on the target
                            const onTarget = ch.target.every((key, index) => key === trailKeys[index]);
                            if (!onTarget) {
                                item.changes.list.splice(i, 1); 
                                i--; continue;
                            }
        
                            // Remove target keys from trail
                            trailKeys.splice(0, ch.target.length);
        
                            const val = !hasValue(ch.val) ? null : trailKeys.reduce((val, key) => hasPropertyValue(val, key) ? val[key] : null, ch.val);
                            const prev = !hasValue(ch.prev) ? null : trailKeys.reduce((prev, key) => hasPropertyValue(prev, key) ? prev[key] : null, ch.prev);
                            if (val === prev) {
                                // This mutation has no changes on target path
                                item.changes.list.splice(i, 1); 
                                i--; continue;
                            }
                            ch.val = val;
                            ch.prev = prev;
                            ch.target.push(...trailKeys); // Adjust target
                        }
                        if (item.changes.list.length === 0) {
                            // Skip, no changes on target path
                            return [];
                        }
                    }
                    // Return all changes as individual 'set' operations
                    return item.changes.list.map(m => {
                        const targetPathInfo = m.target.length === 0 ? basePathInfo : basePathInfo.child(m.target);
                        return {
                            id: item.id,
                            type: 'set',
                            path: targetPathInfo.path,
                            pathInfo: targetPathInfo, 
                            timestamp: item.timestamp,
                            context: item.context,
                            prev: hasValue(m.prev) ? m.prev : null,
                            val: hasValue(m.val) ? m.val : null
                        };
                    });
                })();

                // Now, are any of these changes relevant to any of the requested path/event combinations?
                return changes.some(ch => {
                    return filter.for.some(target => {

                        if (!ch.pathInfo.isOnTrailOf(target.path)) {
                            return false; 
                        }
                        else if ((ch.pathInfo.equals(target.path) || ch.pathInfo.isDescendantOf(target.path)) 
                            && hasEvent(target.events, ['value','child_changed','mutated','mutations'])) {
                            return true;
                        }
                        else if (ch.pathInfo.equals(target.path)) {
                            // mutation on target: value is being overwritten.
                            if (hasEvent(target.events, ['value','child_changed','mutated','mutations'])) {
                                return true;
                            }
                            if (hasEvent(target.events, ['child_added']) && hasNewKeys(ch.val, ch.prev)) {
                                return true;
                            }
                            if (hasEvent(target.events, ['child_removed']) && hasRemovedKeys(ch.val, ch.prev)) {
                                return true;
                            }
                        }
                        else if (ch.pathInfo.isDescendantOf(target.path)) {
                            // mutation on deeper than target path
                            // eg: mutation on path 'books/book1/title', child_added target on 'books'
                            // Events [child_changed, value, mutated, mutations] will already have returned true above
                            if(hasEvent(target.events, ['child_added','child_removed'])) {
                                if (!ch.pathInfo.isChildOf(target.path)) { return false; }
                                if (hasEvent(target.events, ['child_added']) && ch.prev === null) { return true; }
                                if (hasEvent(target.events, ['child_removed']) && ch.val === null) { return true; }
                            }
                        }
                        else {
                            // Mutation on higher than target path.
                            // eg mutation on path 'books/book1', child_changed on target 'books/book1/authors'
                            // Get values at target path
                            const trailKeys = PathInfo.getPathKeys(target.path).slice(ch.pathInfo.keys.length);
                            const prev = trailKeys.reduce((prev, key) => hasValue(prev) && hasPropertyValue(prev, key) ? prev[key] : null, ch.prev);
                            const val = trailKeys.reduce((val, key) => hasValue(val) && hasPropertyValue(val, key) ? val[key] : null, ch.val);
                            if (prev === val) { return false; }
                            if (hasEvent(target.events, ['value','mutated','mutations'])) { 
                                return true; 
                            }
                            if (hasEvent(target.events, ['child_added']) && hasNewKeys(val, prev)) {
                                return true;
                            }
                            if (hasEvent(target.events, ['child_removed']) && hasRemovedKeys(val, prev)) {
                                return true;
                            }
                        }
                        return false;
                    });
                });
            });

            return { mutations, used_cursor: filter.cursor, new_cursor: ID.generate() };
        }
        finally {
            lock.release();
        }
    }

    /**
     * Gets all effective changes from a given cursor or timestamp on a given path, or on multiple paths that are relevant for given events.
     * Multiple mutations will be merged so the returned changes will not have their original updating contexts and order of the original timeline.
     * @param {object} filter 
     * @param {string} [filter.cursor] cursor is a generated key (ID.generate) that represents a point of time
     * @param {number} [filter.timestamp] earliest transaction to include, will be converted to a cursor
     * @param {string} [filter.path] top-most paths to include. Can include wildcards to facilitate wildcard event listeners. Only used if `for` filter is not used, equivalent to `for: { path, events: ['value] }
     * @param {Array<{ path: string, events:string[] }>} [filter.for] Specifies which paths and events to get all relevant mutations for
     * @returns {Promise<{ used_cursor: string, new_cursor: string, changes: Array<{ path: string, type: 'set'|'update', previous: any, value: any, context: any }> }>}
     */
    async getChanges(filter) {
        const mutationsResult = await this.getMutations(filter);
        const { used_cursor, new_cursor, mutations } = mutationsResult;
        
        const hasValue = val => ![undefined,null].includes(val);

        // Get effective changes to the target paths
        let changes = mutations.reduce((all, item) => {

            // 1. Add all effective mutations as 'set' operations on their target paths, removing previous 'set' mutations on the same or descendant paths
            const basePathInfo = PathInfo.get(item.changes.path);
            item.changes.list.forEach(m => {
                const targetPathInfo = m.target.length === 0 ? basePathInfo : basePathInfo.child(m.target);

                // Remove previous 'set' mutations on the same and descendant paths
                all = all.filter(prev => !prev.pathInfo.equals(targetPathInfo) && !prev.pathInfo.isDescendantOf(targetPathInfo));

                all.push({
                    id: item.id,
                    type: 'set',
                    path: targetPathInfo.path,
                    pathInfo: targetPathInfo, 
                    timestamp: item.timestamp,
                    context: item.context,
                    prev: hasValue(m.prev) ? m.prev : null,
                    val: hasValue(m.val) ? m.val : null
                });
            });
            return all;
        }, [])
        .reduce((all, item) => {
            // 2. Merge successive 'set' mutations on the same parent to single parent 'update's, using last used context
            if (item.path === '') {
                // 'set' on the root path. Don't change
                all.push(item);
            }
            else {
                const pathInfo = item.pathInfo;
                const parentPath = pathInfo.parentPath;
                const parentUpdate = all.find(u => u.path === parentPath);
                if (!parentUpdate) {
                    // Create new parent update
                    all.push({ 
                        id: item.id, 
                        type: 'update',
                        path: parentPath, 
                        pathInfo: pathInfo.parent,
                        val: { [pathInfo.key]: item.val }, 
                        prev: { [pathInfo.key]: item.prev },
                        context: item.context
                    });
                }
                else {
                    // Add this change to parent update
                    parentUpdate.val[pathInfo.key] = item.val;
                    if (parentUpdate.prev !== null) { // previous === null on very first root 'set' only
                        parentUpdate.prev[pathInfo.key] = item.prev;
                    }
                    parentUpdate.context = item.context;                            
                }
            }
            return all;
        }, []);


        // Transform results to desired output
        changes.forEach(item => {
            // Remove tmp pathInfo
            delete item.pathInfo;

            // Replace original context
            // delete item.context;
            item.context = { acebase_cursor: item.context.acebase_cursor };

            // Rename val property
            item.value = item.val;
            delete item.val;

            // Rename prev property
            item.previous = item.prev;
            delete item.prev;
        });

        return { used_cursor, new_cursor, changes };
    }

    get oldestValidCursor() {
        if (this.settings.transactions.maxAge <= 0) {
            return '';
        }
        const msPerDay = 86400000, // 24 * 60 * 60 * 1000
            maxAgeMs = this.settings.transactions.maxAge * msPerDay, 
            limit = Date.now() - maxAgeMs,
            cursor = limit.toString(36);
        return cursor;
    }

    /**
     * Enumerates all children of a given Node for reflection purposes
     * @param {string} path 
     * @param {object} [options] optional options used by implementation for recursive calls
     * @param {string[]|number[]} [options.keyFilter] specify the child keys to get callbacks for, skips .next callbacks for other keys
     * @param {string} [options.tid] optional transaction id for node locking purposes
     * @returns {{ next((child: NodeInfo) => boolean) => Promise<boolean>}} returns a generator object that calls .next for each child until the .next callback returns false
     */
    getChildren(path, options = { keyFilter: undefined, tid: undefined }) {
        options = options || {};
        const generator = {
            /**
             * 
             * @param {(child: NodeInfo) => boolean} valueCallback callback function to run for each child. Return false to stop iterating
             * @oldparam {(child: { key?: string, index?: number, valueType: number, value?: any }) => boolean} valueCallback callback function to run for each child. Return false to stop iterating
             * @returns {Promise<bool>} returns a promise that resolves with a boolean indicating if all children have been enumerated, or was canceled by the valueCallback function
             */
            async next(valueCallback, useAsync = false) {
                return start(valueCallback, useAsync);
            }
        };
        const start = async (callback, isAsync = false) => {
            const tid = this.createTid(); //ID.generate();
            let canceled = false;
            const lock = await this.nodeLocker.lock(path, tid, false, `Node.getChildren "/${path}"`);
            try {
                const nodeInfo = await this.getNodeInfo(path, { tid });
                if (!nodeInfo.exists) {
                    throw new NodeNotFoundError(`Node "/${path}" does not exist`);
                }
                else if (!nodeInfo.address) {
                    // Node does not have its own record, so it has no children
                    return;
                }
                let reader = new NodeReader(this, nodeInfo.address, lock, true);
                const nextCallback = isAsync 
                    ? async childInfo => {
                        canceled = (await callback(childInfo)) === false;
                        return !canceled;
                    }
                    : childInfo => {
                        canceled = callback(childInfo) === false;
                        return !canceled;
                    };
                await reader.getChildStream({ keyFilter: options.keyFilter })
                .next(nextCallback, isAsync);
                return canceled;
            }
            catch(err) {
                if (!(err instanceof NodeNotFoundError)) {
                    this.debug.error(`Error getting children: ${err.stack}`);
                }
                throw err;
            }
            finally {
                lock.release();
            }
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
    async getNode(path, options = { include: undefined, exclude: undefined, child_objects: true, tid: undefined }) {
        const tid = options.tid || this.createTid(); // ID.generate();
        const lock = await this.nodeLocker.lock(path, tid, false, `Node.getValue "/${path}"`);
        try {
            const nodeInfo = await this.getNodeInfo(path, { tid });
            let value = nodeInfo.value;
            if (!nodeInfo.exists) {
                value = null;
            }
            else if (nodeInfo.address) {
                const reader = new NodeReader(this, nodeInfo.address, lock, true);
                value = await reader.getValue({ include: options.include, exclude: options.exclude, child_objects: options.child_objects });
            }
            return {
                revision: null, // TODO: implement (or maybe remove from other storage backends because we're not using it anywhere)
                value
            };
        }
        catch(err) {
            if (err instanceof CorruptRecordError) {
                // err.record points to the broken record address (path, pageNr, recordNr)
                // err.key points to the property causing the issue
                // To fix this, the record needs to be rewritten without the violating key
                // No need to console.error here, should have already been done
                // TODO: release acebase-cli with ability to do that
            }
            else {
                this.debug.error(`DEBUG THIS: getNode error:`, err);
            }
            throw err;
        }
        finally {
            lock.release();
        }
    }

    /**
     * Retrieves info about a node (existence, wherabouts etc)
     * @param {string} path 
     * @param {object} [options] optional options used by implementation for recursive calls
     * @param {string} [options.tid] optional transaction id for node locking purposes
     * @param {boolean} [options.no_cache=false] 
     * @param {boolean} [options.include_child_count=false] whether to include child count if node is an object or array
     * @param {boolean} [options.allow_expand=true] whether to allow expansion of path references (follow "symbolic links")
     * @returns {Promise<NodeInfo>}
     */
    async getNodeInfo(path, options = { tid: undefined, no_cache: false, include_child_count: false, allow_expand: true }) {
        options = options || {};
        options.no_cache = options.no_cache === true;
        options.allow_expand = false; // Don't use yet! // options.allow_expand !== false;

        if (path === '') {
            if (!this.rootRecord.exists) {
                return new NodeInfo({ path, exists: false });
            }
            return new NodeInfo({ path, address: this.rootRecord.address, exists: true, type: VALUE_TYPES.OBJECT });
        }

        if (!options.include_child_count) {
            // Check if the info has been cached
            let cachedInfo = this.nodeCache.find(path, true);
            if (cachedInfo) {
                // cached, or announced
                return cachedInfo;
            }
        }

        // Cache miss. Find it by reading parent node
        const pathInfo = PathInfo.get(path);
        const parentPath = pathInfo.parentPath;
        const tid = options.tid || this.createTid();

        // Achieve a read lock on the parent node and read it
        let lock = await this.nodeLocker.lock(parentPath, tid, false, `Node.getInfo "/${parentPath}"`);
        try {
            // We have a lock, check if the lookup has been cached by another "thread" in the meantime. 
            let childInfo = this.nodeCache.find(path, true);
            if (childInfo && !options.include_child_count) {
                // Return cached info, or promise thereof (announced)
                return childInfo;
            }
            if (!childInfo) {
                // announce the lookup now
                this.nodeCache.announce(path);

                let parentInfo = await this.getNodeInfo(parentPath, { tid, no_cache: options.no_cache });
                if (parentInfo.exists && parentInfo.valueType === VALUE_TYPES.REFERENCE && options.allow_expand) {
                    // NEW (but not used yet): This is a path reference. Expand to get new parentInfo.
                    let pathReference;
                    if (parentInfo.address) {
                        // Must read target address to get target path
                        const reader = new NodeReader(this, parentInfo.address, lock, true);
                        pathReference = await reader.getValue();
                    }
                    else {
                        // We have the path already
                        pathReference = parentInfo.value;
                    }
                    // TODO: implement relative path references: '../users/ewout'
                    const childPath = PathInfo.getChildPath(pathReference.path, pathInfo.key);
                    childInfo = await this.getNodeInfo(childPath, { tid, no_cache: options.no_cache });
                }
                else if (!parentInfo.exists || ![VALUE_TYPES.OBJECT, VALUE_TYPES.ARRAY].includes(parentInfo.valueType) || !parentInfo.address) {
                    // Parent does not exist, is not an object or array, or has no children (object not stored in own address)
                    // so child doesn't exist
                    childInfo = new NodeInfo({ path, exists: false });
                }
                else {
                    const reader = new NodeReader(this, parentInfo.address, lock, true);
                    childInfo = await reader.getChildInfo(pathInfo.key);
                }
            }

            if (options.include_child_count) {
                childInfo.childCount = 0;
                if ([VALUE_TYPES.ARRAY, VALUE_TYPES.OBJECT].includes(childInfo.valueType) && childInfo.address) {
                    // Get number of children
                    const childLock = await this.nodeLocker.lock(path, tid, false, `Node.getInfo "/${path}"`);
                    try {
                        const childReader = new NodeReader(this, childInfo.address, childLock, true);
                        childInfo.childCount = await childReader.getChildCount();
                    }
                    finally {
                        childLock.release(`Node.getInfo: done with path "/${path}"`);
                    }
                }
            }
            // lock.release(`Node.getInfo: done with path "/${parentPath}"`);
            this.updateCache(false, childInfo, false); // Don't have to, nodeReader will have done it already
            
            return childInfo;
        }
        catch(err) {
            this.debug.error(`DEBUG THIS: getNodeInfo error`, err);
            throw err;
        }
        finally {
            lock.release(`Node.getInfo: done with path "/${parentPath}"`);
        }
    }

    /**
     * Delegates to legacy update method that handles everything
     * @param {string} path
     * @param {any} value
     * @param {object} [options] optional options used by implementation for recursive calls
     * @param {string} [options.tid] optional transaction id for node locking purposes
     * @param {boolean} [options.suppress_events=false] whether to suppress the execution of event subscriptions
     * @param {any} [options.context=null]
     * @returns {Promise<void>}
     */
    async setNode(path, value, options = { tid: undefined, suppress_events: false, context: null }) {
        options.context = options.context || {};
        if (this.txStorage) {
            options.context.acebase_cursor = ID.generate();
        }
        const context = cloneObject(options.context); // copy context to prevent changes while code proceeds async
        const mutations = await this._updateNode(path, value, { merge: false, tid: options.tid, suppress_events: options.suppress_events, context });
        if (this.txStorage && mutations) {
            const p = this.logMutation('set', path, value, context, mutations);
            if (p instanceof Promise) { await p; }
        }
    }

    /**
     * Delegates to legacy update method that handles everything
     * @param {string} path
     * @param {any} value
     * @param {object} [options] optional options used by implementation for recursive calls
     * @param {string} [options.tid] optional transaction id for node locking purposes
     * @param {boolean} [options.suppress_events=false] whether to suppress the execution of event subscriptions
     * @param {any} [options.context=null]
     * @returns {Promise<void>}
     */
    async updateNode(path, updates, options = { tid: undefined, suppress_events: false, context: null }) {
        options.context = options.context || {};
        if (this.txStorage) {
            options.context.acebase_cursor = ID.generate();
        }
        const context = cloneObject(options.context); // copy context to prevent changes while code proceeds async
        const mutations = await this._updateNode(path, updates, { merge: true, tid: options.tid, suppress_events: options.suppress_events, context });
        if (this.txStorage && mutations) {
            const p = this.logMutation('update', path, updates, context, mutations);
            if (p instanceof Promise) { await p; }
        }
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
     * @param {boolean} [options.suppress_events=false] whether to suppress the execution of event subscriptions
     * @param {any} [options.context=null]
     * @param {boolean} [options.merge=true]
     * @returns {Promise<IAppliedMutations>} If transaction logging is enabled, returns a promise that resolves with the applied mutations
     */
    async _updateNode(path, value, options = { merge: true, tid: undefined, _internal: false, suppress_events: false, context: null }) {
        // this.debug.log(`Update request for node "/${path}"`);

        const tid = options.tid || this.createTid(); // ID.generate();
        const pathInfo = PathInfo.get(path);

        if (value === null) {
            // Deletion of node is requested. Update parent
            return this._updateNode(pathInfo.parentPath, { [pathInfo.key]: null }, { merge: true, tid, suppress_events: options.suppress_events, context: options.context });
        }

        if (path !== "" && this.valueFitsInline(value)) {
            // Simple value, update parent instead
            return this._updateNode(pathInfo.parentPath, { [pathInfo.key]: value }, { merge: true, tid, suppress_events: options.suppress_events, context: options.context });
        }

        // const impact = super.getUpdateImpact(path, options.suppress_events);
        // const topLock = impact.topEventPath !== path 
        //     ? await this.nodeLocker.lock(impact.topEventPath, tid, true, '_updateNode:topLock') 
        //     : null;

        let lock = await this.nodeLocker.lock(path, tid, true, '_updateNode');
        try {

            const nodeInfo = await this.getNodeInfo(path, { tid });
            if (!nodeInfo.exists && path !== "") {
                // Node doesn't exist, update parent instead
                lock = await lock.moveToParent();
                return await this._updateNode(pathInfo.parentPath, { [pathInfo.key]: value }, { merge: true, tid, suppress_events: options.suppress_events, context: options.context });
            }

            // Exists, or root record
            const merge = nodeInfo.exists && nodeInfo.address && options.merge;
            const write = async () => {
                if (merge) {
                    // Node exists already, is stored in its own record, and it must be updated (merged)
                    return await _mergeNode(this, nodeInfo, value, lock);
                }
                else {
                    // Node doesn't exist, isn't stored in its own record, or must be overwritten
                    return await _createNode(this, nodeInfo, value, lock, !options._internal);
                }
            };

            let result;
            if (options._internal) {
                result = await write();
            }
            else {
                result = await this._writeNodeWithTracking(path, value, { 
                    tid,
                    merge,
                    suppress_events: options.suppress_events,
                    context: options.context,
                    _customWriteFunction: write, // Will use this function instead of this._writeNode
                    // impact
                });
            }

            const { recordMoved, recordInfo, deallocate, mutations } = result;

            // Update parent if the record moved
            let parentUpdated = false;
            if (recordMoved && pathInfo.parentPath !== null) {
                lock = await lock.moveToParent();
                // console.error(`Got parent ${parentLock.forWriting ? 'WRITE' : 'read'} lock on "${pathInfo.parentPath}", tid ${lock.tid}`)
                await this._updateNode(pathInfo.parentPath, { [pathInfo.key]: new InternalNodeReference(recordInfo.valueType, recordInfo.address) }, { merge: true, tid, _internal: true, context: options.context })
                parentUpdated = true;
            }

            if (parentUpdated && pathInfo.parentPath !== '') {
                console.assert(this.nodeCache._cache.has(pathInfo.parentPath), 'Not cached?!!');
            }

            if (deallocate && deallocate.totalAddresses > 0) {
                // Release record allocation marked for deallocation
                deallocate.normalize();
                this.debug.verbose(`Releasing ${deallocate.totalAddresses} addresses (${deallocate.ranges.length} ranges) previously used by node "/${path}" and/or descendants: ${deallocate}`.colorize(ColorStyle.grey));
                
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

            return {
                path,
                list: mutations
            };
        }
        // catch(err) {
        //     // if (err instanceof SchemaValidationError) {
        //     //     !recursive && this.debug.error(`Schema validation error ${options.merge ? 'updating' : 'setting'} path "${path}": `, err.reason);
        //     // }
        //     if (!(err instanceof SchemaValidationError)) {
        //         this.debug.error(`Node.update ERROR: `, err.message);
        //     }
        //     throw err; //return false;
        // }
        finally {
            lock.release();
            // topLock && topLock.release();
        }
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

class AdditionalDataRequest extends Error {
    constructor() { super('More data needs to be loaded from the source'); }
}
class CorruptRecordError extends Error {
    /**
     * 
     * @param {NodeAddress} record 
     * @param {string|number} key 
     * @param {string} message 
     */
    constructor(record, key, message) { 
        super(message); 
        this.record = record;
        this.key = key;
    }
}
class NodeReader {
    /**
     * 
     * @param {AceBaseStorage} storage 
     * @param {NodeAddress} address 
     * @param {NodeLock} lock 
     * @param {boolean} [updateCache=false]
     */
    constructor(storage, address, lock, updateCache = false, stack = {}) { //stack = []
        if (!(address instanceof NodeAddress)) {
            throw new TypeError(`address argument must be a NodeAddress`);
        }
        this.storage = storage;
        this.address = address;
        this.lock = lock;
        this.lockTimestamp = lock.granted;
        this.updateCache = updateCache;
        
        const key = `${address.pageNr},${address.recordNr}`;        
        if (key in stack) {
            // Corrupted record. This can happen when locks have not been applied correctly during development, 
            // or if 2 separate processes accessed the database without proper inter-process communication (IPC) in place.

            // If you see this happening, make sure you are not accessing this database from multiple isolated processes! 
            // An example could be 2+ AceBase instances on the same database files in multiple isolated processes.
            // Kindly note that acebase-server does NOT support clustering YET
            
            // If you don't want to corrupt your database, here's how:
            
            // - DO NOT use multiple AceBase instances on a single database in your app
            //      Instead: use a shared AceBase instance throughout your app
            // - DO NOT let multiple apps access the same database at the same time
            //      Instead: setup an AceBaseServer and use AceBaseClients to connect to it
            // - DO NOT let multiple instances of your application (in isolated processes) access the same database at the same time
            //      Instead: Use NodeJS or pm2 clustering functionality to fork the process (IPC is available)
            // - Do NOT run multiple AceBaseServer instances on the same database files
            //      Instead: Wait until AceBaseServer's cluster functionality is ready (and documented)
            
            // See the discussion about this at https://github.com/appy-one/acebase/discussions/48

            const clash = stack[key];
            const pathInfo = PathInfo.get(address.path);
            const parentAddress = stack[Object.keys(stack).find(key => stack[key].path === pathInfo.parentPath)];
            // const error = new CorruptRecordError(stack.slice(-1)[0], pathInfo.key, `Recursive read of record address ${clash.pageNr},${clash.recordNr}. Record "/${pathInfo.parentPath}" is corrupt: property "${pathInfo.key}" refers to the address belonging to path "/${clash.path}"`);
            const error = new CorruptRecordError(parentAddress, pathInfo.key, `CORRUPT RECORD: key "${pathInfo.key}" in "/${parentAddress.path}" (@${parentAddress.pageNr},${parentAddress.recordNr}) refers to address @${clash.pageNr},${clash.recordNr} which was already used to read "/${clash.path}". Recursive or repeated reading has been prevented.`);
            this.storage.debug.error(error.message);
            throw error;
        }
        stack[key] = address;
        this.stack = stack;
        
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
        const expired = this.storage.ipc.isMaster ? this.lock.state !== NodeLock.LOCK_STATE.LOCKED : this.lock.expires <= Date.now();
        if (expired) {
            throw new Error(`No lock on node "/${this.address.path}", it may have expired`);
        }
        // if (this.lock.state !== NodeLock.LOCK_STATE.LOCKED) {
        //     throw new Error(`Node "/${this.address.path}" must be (read) locked, current state is ${this.lock.state}`);
        // }
        // if (this.lock.granted !== this.lockTimestamp) {
        //     // Lock has been renewed/changed? Will have to be read again if this happens.
        //     //this.recordInfo = null; 
        //     // Don't allow this to happen
        //     throw new Error(`Lock on node "/${this.address.path}" has changed. This is not allowed. Debug this`);
        // }
    }

    /**
     * @param {boolean} includeChildNodes
     * @returns {Promise<NodeAllocation>}
     */
    async getAllocation(includeChildNodes = false) {
        this._assertLock();

        if (!includeChildNodes && this.recordInfo !== null) {
            return this.recordInfo.allocation;
        }
        /** @type {NodeAllocation} */
        let allocation = null;

        await this.readHeader();
        allocation = this.recordInfo.allocation;
        if (!includeChildNodes) { 
            return [{ path: this.address.path, allocation }]; 
        }

        const childPromises = [];
        await this.getChildStream()
        .next(child => {
            let address = child.address;
            if (address) {
                // Get child Allocation
                let promise = this.storage.nodeLocker.lock(child.path, this.lock.tid, false, `NodeReader:getAllocation:child "/${child.path}"`)
                .then(async childLock => {
                    const reader = new NodeReader(this.storage, address, childLock, this.updateCache);
                    const childAllocation = await reader.getAllocation(true);
                    childLock.release();
                    return { path: child.path, allocation: childAllocation };
                });
                childPromises.push(promise);
            }
        });
        const arr = await Promise.all(childPromises);
        arr.forEach(result => {
            allocation.ranges.push(...result.allocation.ranges);
        })
        //console.log(childAllocations);
        return allocation;
    }

    /**
     * Reads all data for this node. Only do this when a stream won't do (eg if you need all data because the record contains a string)
     * @returns {Promise<Uint8Array>}
     */
    async getAllData() {
        this._assertLock();
        if (this.recordInfo === null) {
            await this.readHeader();
        }

        const allData = new Uint8Array(this.recordInfo.totalByteLength);
        let index = 0;
        await this.getDataStream()
        .next(({ data }) => {
            allData.set(data, index);
            index += data.length;
        });
        return allData;
    }

    /**
     * Gets the value stored in this record by parsing the binary data in this and any sub records
     * @param {{ include?: PathInfo[], exclude?: PathInfo[], child_objects?: boolean, no_cache?: boolean }} options when omitted retrieves all nested data. If include is set to an array of keys it will only return those children. If exclude is set to an array of keys, those values will not be included
     * @returns {Promise<any>} - returns the stored object, array or string
     */
    async getValue(options = { include: undefined, exclude: undefined, child_objects: true, no_cache: false }) {
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
            await this.readHeader();
        }
        
        this.storage.debug.log(`Reading node "/${this.address.path}" from address ${this.address.pageNr},${this.address.recordNr}`.colorize(ColorStyle.magenta));

        switch (this.recordInfo.valueType) {
            case VALUE_TYPES.STRING: {
                const binary = await this.getAllData();
                const str = decodeString(binary);
                return str;
            }
            case VALUE_TYPES.REFERENCE: {
                const binary = await this.getAllData();
                const path = decodeString(binary);
                return new PathReference(path);
            }
            case VALUE_TYPES.BINARY: {
                const binary = await this.getAllData();
                return binary.buffer;
            }
            case VALUE_TYPES.ARRAY:
            case VALUE_TYPES.OBJECT: {
                // We need ALL data, including from child sub records
                const isArray = this.recordInfo.valueType === VALUE_TYPES.ARRAY;

                /**
                 * Convert include & exclude filters to PathInfo instances for easier handling
                 * @param {string[]} arr 
                 * @returns {PathInfo[]}
                 */
                const convertFilterArray = (arr) => {
                    const isNumber = key => /^[0-9]+$/.test(key);
                    return arr.map(path => PathInfo.get(isArray && isNumber(path) ? `[${path}]` : path));
                };
                const includeFilter = options.include ? options.include.some(item => item instanceof PathInfo) ? options.include : convertFilterArray(options.include) : [];
                const excludeFilter = options.exclude ? options.exclude.some(item => item instanceof PathInfo) ? options.exclude : convertFilterArray(options.exclude) : [];

                // if (isArray && isFiltered && options.include && options.include.length > 0) {
                //     for (let i = 0; i < options.include.length; i++) {
                //         // Convert indexes to numbers
                //         const key = options.include[i];
                //         if (/^[0-9]+$/.test(key)) { options.include[i] = +key; }
                //     }
                // }
                // if (isArray && isFiltered && options.exclude && options.exclude.length > 0) {
                //     for (let i = 0; i < options.exclude.length; i++) {
                //         // Convert indexes to numbers
                //         const key = options.exclude[i];
                //         if (/^[0-9]+$/.test(key)) { options.exclude[i] = +key; }
                //     }
                // }
                // if (isFiltered && options.include && options.include.length > 0) {
                //     const keyFilter = options.include
                //         .map(key => typeof key === 'string' && key.includes('/') ? key.slice(0, key.indexOf('/')) : key) // TODO: handle nested brackets
                //         .reduce((keys, key) => (keys.includes(key) || keys.push(key)) && keys, []);
                //     if (keyFilter.length > 0) { 
                //         streamOptions.keyFilter = keyFilter;
                //     }
                // }

                const promises = [];
                const isWildcardKey = key => typeof key === 'string' && (key === '*' || key[0] === '$');
                const hasWildcardInclude = includeFilter.length > 0 && includeFilter.some(pathInfo => pathInfo.keys.length === 1 && isWildcardKey(pathInfo.keys[0]));
                const hasChildIncludes = includeFilter.length > 0 && includeFilter.some(pathInfo => pathInfo.keys.length === 1 && !isWildcardKey(pathInfo.keys[0]));
                const isFiltered = (includeFilter.length > 0 && !hasWildcardInclude && includeFilter.some(pathInfo => pathInfo.keys.length === 1)) || (excludeFilter.length > 0 && excludeFilter.some(pathInfo => pathInfo.keys.length === 1) ) || options.child_objects === false;
                const obj = isArray ? isFiltered ? new PartialArray() : [] : {};
                const streamOptions = { };
                if (includeFilter.length > 0 && !hasWildcardInclude && hasChildIncludes) {
                    const keyFilter = includeFilter
                        .filter(pathInfo => !isWildcardKey(pathInfo.keys[0])) // pathInfo.keys.length === 1 && 
                        .map(pathInfo => pathInfo.keys[0])
                        .reduce((keys, key) => (keys.includes(key) || keys.push(key)) && keys, []);
                    if (keyFilter.length > 0) {
                        streamOptions.keyFilter = keyFilter;
                    }
                }

                /**
                 * @param {NodeInfo} child 
                 */
                const loadChildValue = async (child) => {
                    let childLock;
                    try {
                        childLock = await this.storage.nodeLocker.lock(child.address.path, this.lock.tid, false, `NodeReader.getValue:child "/${child.address.path}"`);

                        // Are there any relevant nested includes / excludes?
                        // Fixed: nested bracket (index) include/exclude handling like '[3]/name'
                        let childOptions = {};
                        const getChildFilter = filter => {
                            return filter
                            .filter((pathInfo) => {
                                const key = pathInfo.keys[0];
                                return pathInfo.keys.length > 1 && (isWildcardKey(key) || (isArray && key === child.index) || (!isArray && key === child.key));
                            })
                            .map(pathInfo => PathInfo.get(pathInfo.keys.slice(1)));
                        }
                        if (includeFilter.length > 0) {
                            const include = getChildFilter(includeFilter);
                            if (include.length > 0) { childOptions.include = include; }
                        }
                        if (excludeFilter.length > 0) {
                            const exclude = getChildFilter(excludeFilter);
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
                        //     //     this.storage.debug.warn(`Using cached address to read child node "/${child.address.path}" from  address ${cachedAddress.pageNr},${cachedAddress.recordNr} instead of (${child.address.pageNr},${child.address.recordNr})`.colorize(ColorStyle.magenta));
                        //     //     child.address = cachedAddress;
                        //     // }
                        // }

                        // this.storage.debug.log(`Reading child node "/${child.address.path}" from ${child.address.pageNr},${child.address.recordNr}`.colorize(ColorStyle.magenta));
                        const reader = new NodeReader(this.storage, child.address, childLock, this.updateCache, this.stack);
                        const val = await reader.getValue(childOptions);
                        obj[isArray ? child.index : child.key] = val;
                    }
                    catch (reason) {
                        this.storage.debug.error(`NodeReader.getValue:child error: `, reason);
                        throw reason;
                    }
                    finally {
                        childLock && childLock.release();
                    }
                }

                try {
                    await this.getChildStream(streamOptions)
                    .next(child => {
                        const keyOrIndex = isArray ? child.index : child.key;
                        if (options.child_objects === false && [VALUE_TYPES.OBJECT, VALUE_TYPES.ARRAY].includes(child.type)) {
                            // Options specify not to include any child objects
                            return;
                        }
                        if (includeFilter.some(pathInfo => pathInfo.keys.length === 1 && !isWildcardKey(pathInfo.keys[0])) && !includeFilter.some(pathInfo => pathInfo.keys.length === 1 && keyOrIndex === pathInfo.keys[0])) { // !options.include.find(k => typeof k === 'string' && k[0] === '*') && !streamOptions.keyFilter.includes(keyOrIndex)
                            // This particular child is not in the include list
                            return;
                        }
                        if (excludeFilter.some(pathInfo => pathInfo.keys.length === 1 && pathInfo.keys[0] === keyOrIndex)) {
                            // This particular child is on the exclude list
                            return;
                        }
                        if (child.address) {
                            const childValuePromise = loadChildValue(child);
                            promises.push(childValuePromise);
                        }
                        else if (typeof child.value !== "undefined") {
                            obj[keyOrIndex] = child.value;
                        }
                        else {
                            if (isArray) {
                                throw new Error(`Value for index ${child.index} has not been set yet, find out why. Path: ${this.address.path}`);
                            }
                            else {
                                throw new Error(`Value for key ${child.key} has not been set yet, find out why. Path: ${this.address.path}`);
                            }
                        }
                    });
                    // We're done reading child info
                    await Promise.all(promises); // Wait for any child reads to complete
                    return obj;
                }
                catch (err) {
                    this.storage.debug.error(err);
                    throw err;
                }
            }
            default: {
                throw new Error(`Unsupported record value type: ${this.recordInfo.valueType}`);
            }
        }
    }

    getDataStream() {
        this._assertLock();

        const bytesPerRecord = this.storage.settings.recordSize;
        const maxRecordsPerChunk = this.storage.settings.pageSize; // Reading whole pages at a time is faster, approx 130KB with default settings (1024 records of 128 bytes each) // 200: about 25KB of data when using 128 byte records
        const generator = {
            /**
             * @param {(result: {data: Uint8Array, valueType: number, chunks: { pageNr: number, recordNr: number, length: number }[], chunkIndex: number, totalBytes: number, hasKeyTree: boolean }) => boolean} callback callback function that is called with each chunk read. Reading will stop immediately when false is returned
             * @returns {Promise<{ valueType: number, chunks: { pageNr: number, recordNr: number, length: number }[]}>} returns a promise that resolves when all data is read
             */
            async next(callback) { 
                return read(callback);
            }
        };

        const read = async (callback) => {
            const fileIndex = this.storage.getRecordFileIndex(this.address.pageNr, this.address.recordNr);

            if (this.recordInfo === null) {
                await this.readHeader();
            }
            const recordInfo = this.recordInfo;

            // Divide all allocation ranges into chunks of maxRecordsPerChunk
            const ranges = recordInfo.allocation.ranges;
            const chunks = []; // nicer approach would be: const chunks = ranges.reduce((chunks, range) => { ... }, []);
            let totalBytes = 0;
            ranges.forEach((range, i) => {
                let chunk = {
                    pageNr: range.pageNr,
                    recordNr: range.recordNr,
                    length: range.length
                };
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
            // TODO: Refactor to get additional data first, then run first callback
            const firstChunkData = recordInfo.startData;
            let headerBytesSkipped = recordInfo.bytesPerRecord - firstChunkData.length;
            const { valueType, hasKeyIndex, headerLength, lastRecordLength } = recordInfo;
            
            let proceed = firstChunkData.length === 0 || (await callback({ 
                data: firstChunkData, 
                valueType, 
                chunks, 
                chunkIndex: 0, 
                totalBytes, 
                hasKeyTree: hasKeyIndex, 
                fileIndex, 
                headerLength
            }) !== false);

            if (isLastChunk) { proceed = false; }
            let index = 1;
            while (proceed) {
                //this.storage.debug.log(address.path);
                const chunk = chunks[index];
                let fileIndex = this.storage.getRecordFileIndex(chunk.pageNr, chunk.recordNr);
                let length = chunk.length * bytesPerRecord;
                if (headerBytesSkipped < recordInfo.headerLength) {
                    // How many more header bytes to skip?
                    const remainingHeaderBytes = recordInfo.headerLength - headerBytesSkipped;
                    const skip = Math.min(remainingHeaderBytes, length);
                    fileIndex += skip;
                    length -= skip;
                    headerBytesSkipped += skip;
                    if (length == 0) { 
                        index++;
                        continue;
                    }
                }
                const isLastChunk = index + 1 === chunks.length;
                if (isLastChunk) {
                    length -= bytesPerRecord - lastRecordLength;
                }
                const data = new Uint8Array(length);
                const bytesRead = await this.storage.readData(fileIndex, data);
                proceed = await callback({ 
                    data, 
                    valueType, 
                    chunks, 
                    chunkIndex:index, 
                    totalBytes, 
                    hasKeyTree: hasKeyIndex, 
                    fileIndex, 
                    headerLength 
                }) !== false;

                if (isLastChunk) { proceed = false; }
                index++;
            }
            return { valueType, chunks };
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

        /** @type {(childInfo: NodeInfo, index: number)} */ let callback;
        let isAsync = false;
        let childCount = 0;
        const generator = {
            /**
             * 
             * @param {(childInfo: NodeInfo, index: number)} cb 
             */
            async next(cb, useAsync = false) { 
                callback = cb; 
                isAsync = useAsync;
                return start();
            }
        };

        let isArray = false;
        const start = async () => {
            if (this.recordInfo === null) {
                await this.readHeader();
            }

            isArray = this.recordInfo.valueType === VALUE_TYPES.ARRAY;
            if (this.recordInfo.hasKeyIndex) {
                return createStreamFromBinaryTree();
            }
            else if (this.recordInfo.allocation.addresses.length === 1) {
                // We have all data in memory (small record)
                return createStreamFromLinearData(this.recordInfo.startData, true);
            }
            else {
                return this.getDataStream()
                .next(({ data, chunks, chunkIndex }) => {
                    let isLastChunk = chunkIndex === chunks.length-1;
                    return createStreamFromLinearData(data, isLastChunk); //, fileIndex
                });
            }
        };

        // Gets children from a indexed binary tree of key/value data
        const createStreamFromBinaryTree = async () => {
            const tree = new BinaryBPlusTree(this._treeDataReader.bind(this));

            let canceled = false;
            if (options.keyFilter) {
                // Only get children for requested keys
                for (let i = 0; i < options.keyFilter.length; i++) {
                    const key = options.keyFilter[i];
                    const value = await tree.find(key).catch(err => {
                        console.error(`Error reading tree for node ${this.address}: ${err.message}`, err);
                        throw err;
                    });

                    if (value === null) { continue; /* Key not found? */ }
                    const childInfo = isArray ? new NodeInfo({ path: `${this.address.path}[${key}]`, index: key }) : new NodeInfo({ path: `${this.address.path}/${key}`, key });
                    const res = getValueFromBinary(childInfo, value.recordPointer, 0);
                    if (!res.skip) {
                        let result = callback(childInfo, i);
                        if (isAsync && result instanceof Promise) { result = await result; }
                        canceled = result === false; // Keep going until callback returns false
                        if (canceled) { break; }
                    }
                }
            }
            else {
                // Loop the tree leafs, run callback for each child
                let leaf = await tree.getFirstLeaf();
                while (leaf) {
                    const children = leaf.entries.reduce((nodes, entry) => {
                        const child = isArray ? new NodeInfo({ path: `${this.address.path}[${entry.key}]`, index: entry.key }) : new NodeInfo({ path: `${this.address.path}/${entry.key}`, key: entry.key });
                        const res = getValueFromBinary(child, entry.value.recordPointer, 0);
                        if (!res.skip) { nodes.push(child); }
                        return nodes;
                    }, []);
    
                    for(let i = 0; !canceled && i < children.length; i++) {
                        let result = callback(children[i], i);
                        if (isAsync && result instanceof Promise) { result = await result; }
                        canceled = result === false; // Keep going until callback returns false
                    }
                    leaf = !canceled && leaf.getNext ? await leaf.getNext() : null;
                }
            }
            return !canceled;
        }

        // To get values from binary data:
        /**
         * 
         * @param {NodeInfo} child 
         * @param {number[]} binary 
         * @param {number} index 
         */
        const getValueFromBinary = (child, binary, index) => {
            // const startIndex = index;
            const assert = (bytes) => {
                if (index + bytes > binary.length) {
                    throw new AdditionalDataRequest(); 
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
                if (!REMOVED_CHILD_DATA_IMPLEMENTED) {
                    throw new Error("corrupt: removed child data isn't implemented yet");
                }
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
                else { throw new Error(`Tiny value deserialization method missing for value type ${child.type}`); }
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
                    throw new Error(`Inline value deserialization method missing for value type ${child.type}`);
                }
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
                    this.storage.updateCache(false, child, false);
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
                        throw new AdditionalDataRequest(); 
                    }
                };

                // Index child keys or array indexes
                while(index < binary.length) {
                    let startIndex = index;
                    const child = new NodeInfo({});
    
                    try {
                        if (isArray) {
                            const childIndex = childCount; // childCount is now incremented at the end of try block, to avoid missing index(es) upon TruncatedDataErrors
                            child.path = PathInfo.getChildPath(this.address.path, childIndex);
                            child.index = childIndex;
                        }
                        else {
                            assert(2);
                            const keyIndex = (binary[index] & 128) === 0 ? -1 : (binary[index] & 127) << 8 | binary[index+1];
                            if (keyIndex >= 0) {
                                child.key = this.storage.KIT.keys[keyIndex];
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
                                child.path = PathInfo.getChildPath(this.address.path, key);
                                index += keyLength;
                            }
                        }
        
                        let res = getValueFromBinary(child, binary, index);
                        index = res.index;
                        childCount++;
                        if (res.skip) {
                            continue;
                        }
                        else if (!isArray && options.keyFilter && !options.keyFilter.includes(child.key)) {
                            continue;
                        }
                        else if (isArray && options.keyFilter && !options.keyFilter.includes(child.index)) {
                            continue;
                        }

                        children.push(child);
                    }
                    catch(err) {
                        if (err instanceof AdditionalDataRequest) {
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

        const createStreamFromLinearData = async (chunkData, isLastChunk) => { // , chunkStartIndex
            let children = getChildrenFromChunk(this.recordInfo.valueType, chunkData); //, chunkStartIndex);
            let canceled = false;
            for (let i = 0; !canceled && i < children.length; i++) {
                const child = children[i];
                let result = callback(child, i);
                if (isAsync && result instanceof Promise) { result = await result; }
                canceled = result === false; // Keep going until callback returns false
            }
            if (canceled || isLastChunk) {
                return false;
            }
        }

        return generator;
    }

    /**
     * Gets the number of children of this node. 
     * NEEDS OPTIMIZATION - currently uses getChildStream to get count, 
     * but this is quite heavy for the purpose
     */
    async getChildCount() {
        let count = 0;
        await this.getChildStream()
        .next(childInfo => {
            count++;
            return true; // next!
        });
        return count;
    }

    /**
     * Retrieves information about a specific child by key name or index
     * @param {string|number} key key name or index number
     * @returns {Promise<NodeInfo>} returns a Promise that resolves with NodeInfo of the child
     */
    async getChildInfo(key) {
        let childInfo = null;
        await this.getChildStream({ keyFilter: [key] })
        .next(info => {
            childInfo = info;
        });
        if (childInfo) {
            return childInfo;
        }
        let childPath = PathInfo.getChildPath(this.address.path, key);
        return new NodeInfo({ path: childPath, key, exists: false });
    }

    async _treeDataWriter(binary, index) {
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
    async _treeDataReader(index, length) {
        // console.log(`...read request for index ${index}, length ${length}...`);
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
        await Promise.all(reads);
        return Buffer.from(binary.buffer);
    }

    async readHeader() {
        this._assertLock();
        // console.error(`NodeReader.readHeader ${this.address}, tid ${this.lock.tid}`);

        const bytesPerRecord = this.storage.settings.recordSize;
        const fileIndex = this.storage.getRecordFileIndex(this.address.pageNr, this.address.recordNr);
        let data = new Uint8Array(bytesPerRecord);

        const bytesRead = await this.storage.readData(fileIndex, data.buffer);
        if (bytesRead < bytesPerRecord) { throw new Error(`Not enough bytes read from file at index ${fileIndex}, expected ${bytesPerRecord} but got ${bytesRead}`); }

        const hasKeyIndex = (data[0] & FLAG_KEY_TREE) === FLAG_KEY_TREE;
        const valueType = data[0] & FLAG_VALUE_TYPE; // Last 4-bits of first byte of read data has value type

        // Read Chunk Table
        let view = new DataView(data.buffer);
        let offset = 1;
        let firstRange = new StorageAddressRange(this.address.pageNr, this.address.recordNr, 1);
        /** @type {StorageAddressRange[]} */
        const ranges = [firstRange];
        const allocation = new NodeAllocation(ranges);
        let readingRecordIndex = 0;
        let done = false;
        while(!done) {

            if (offset + 9 + 2 >= data.length) {
                // Read more data (next record)
                readingRecordIndex++;
                let address = allocation.addresses[readingRecordIndex];
                let fileIndex = this.storage.getRecordFileIndex(address.pageNr, address.recordNr);
                let moreData = new Uint8Array(bytesPerRecord);
                await this.storage.readData(fileIndex, moreData.buffer);
                data = concatTypedArrays(data, moreData);
                view = new DataView(data.buffer);
            }

            const type = view.getUint8(offset);
            if (type === 0) { 
                // No more chunks, exit
                offset++;
                done = true;
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

/**
 * 
 * @param {AceBaseStorage} storage 
 * @param {NodeInfo} nodeInfo 
 * @param {object} newValue 
 * @param {NodeLock} lock
 * @returns {Promise<{ recordMoved: boolean, recordInfo: RecordInfo, deallocate: NodeAllocation }>}
 */
 async function _mergeNode(storage, nodeInfo, updates, lock) {
    if (typeof updates !== "object") {
        throw new TypeError(`updates parameter must be an object`);
    }

    const nodeReader = new NodeReader(storage, nodeInfo.address, lock, false);
    const affectedKeys = Object.keys(updates);
    const changes = new NodeChangeTracker(nodeInfo.path);

    const discardAllocation = new NodeAllocation([]);
    let isArray = false;
    let isInternalUpdate = false;

    const recordInfo = await nodeReader.readHeader();
    isArray = recordInfo.valueType === VALUE_TYPES.ARRAY;
    nodeInfo.type = recordInfo.valueType; // Set in nodeInfo too, because it might be unknown

    const done = (newRecordInfo) => {
        let recordMoved = false;
        if (newRecordInfo !== nodeReader.recordInfo) {
            // release the old record allocation
            discardAllocation.ranges.push(...nodeReader.recordInfo.allocation.ranges);
            recordMoved = true;
        }
        // Necessary?
        storage.updateCache(false, new NodeInfo({ path: nodeInfo.path, type: nodeInfo.type, address: newRecordInfo.address, exists: true }), recordMoved);
        return { recordMoved, recordInfo: newRecordInfo, deallocate: discardAllocation };
    }

    const childValuePromises = [];

    if (isArray) {
        // keys to update must be integers
        for (let i = 0; i < affectedKeys.length; i++) {
            if (isNaN(affectedKeys[i])) {
                throw new Error(`Cannot merge existing array of path "${nodeInfo.path}" with an object (properties ${Object.keys(updates).slice(0, 5).map(p => `"${p}"`).join(',')}...)`);
            }
            affectedKeys[i] = +affectedKeys[i]; // Now an index
        }
    }

    const newKeys = affectedKeys.slice();

    await nodeReader.getChildStream({ keyFilter: affectedKeys })
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
                return true; // Proceed with next (there is no next, right? - this update must has have been triggered by child node that moved, the parent node only needs to update the reference to the child node)
            }

            // Child is stored in own record, and it is updated or deleted so we need to get
            // its allocation so we can release it when updating is done
            const promise = storage.nodeLocker.lock(child.address.path, lock.tid, false, `_mergeNode: read child "/${child.address.path}"`)
            .then(async childLock => {
                const childReader = new NodeReader(storage, child.address, childLock, false);
                const allocation = await childReader.getAllocation(true);
                childLock.release();
                discardAllocation.ranges.push(...allocation.ranges);
                const currentChildValue = new InternalNodeReference(child.type, child.address);
                changes.add(keyOrIndex, currentChildValue, newValue);
            });
            childValuePromises.push(promise);
        }
        else {
            changes.add(keyOrIndex, child.value, newValue);
        }
    });
    
    await Promise.all(childValuePromises);            

    // Check which keys we haven't seen (were not in the current node), these will be added
    newKeys.forEach(key => {
        const newValue = updates[key];
        if (newValue !== null) {
            changes.add(key, null, newValue);
        }
    });

    if (changes.all.length === 0) {
        storage.debug.log(`No effective changes to update node "/${nodeInfo.path}" with`.colorize(ColorStyle.yellow));
        return done(nodeReader.recordInfo);
    }

    if (isArray) {
        // Check if resulting array is dense: every item must have a value, no gaps allowed
        const getSequenceInfo = (changes) => {
            const indice = changes.map(ch => ch.keyOrIndex).sort(); // sorted from low index to high index
            const gaps = indice.map((_, i, arr) => i === 0 ? 0 : arr[i-1] - arr[i]);
            return { indice, hasGaps: gaps.some(g => g > 1) };
        }
        const deleteSeqInfo = getSequenceInfo(changes.deletes);
        const insertSeqInfo = getSequenceInfo(changes.inserts);
        let isSparse = deleteSeqInfo.hasGaps || deleteSeqInfo.hasGaps;
        if (!isSparse && changes.deletes.length > 0) {
            // Only allow deletes at the end of an array, check if is there's an entry with a higher index
            const highestIndex = deleteSeqInfo.indice.slice(-1)[0];
            const nextEntryInfo = await nodeReader.getChildInfo(highestIndex + 1);
            if (nextEntryInfo.exists) { isSparse = true; }
        }
        if (!isSparse && changes.inserts.length > 0) {
            // Only allow inserts at the end of an array, check if there's an entry with a lower index
            const lowestIndex = insertSeqInfo.indice[0];
            if (lowestIndex > 0) {
                const prevEntryInfo = await nodeReader.getChildInfo(lowestIndex - 1);
                if (!prevEntryInfo.exists) { isSparse = true; }
            }
        }
        if (isSparse) {
            throw new Error(`Elements cannot be inserted beyond, or removed before the end of an array. Rewrite the whole array at path "${nodeInfo.path}" or change your schema to use an object collection instead`);
        }
    }

    storage.debug.log(`Node "/${nodeInfo.path}" being updated:${isInternalUpdate ? ' (internal)' : ''} adding ${changes.inserts.length} keys (${changes.inserts.map(ch => `"${ch.keyOrIndex}"`).join(',')}), updating ${changes.updates.length} keys (${changes.updates.map(ch => `"${ch.keyOrIndex}"`).join(',')}), removing ${changes.deletes.length} keys (${changes.deletes.map(ch => `"${ch.keyOrIndex}"`).join(',')})`.colorize(ColorStyle.cyan));
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
        storage.invalidateCache(false, nodeInfo.path, false, 'mergeNode');
        invalidatePaths.forEach(item => {
            if (item.action === 'invalidate') { storage.invalidateCache(false, item.path, true, 'mergeNode'); }
            else { storage.nodeCache.delete(item.path); }
        });
    }

    // What we need to do now is make changes to the actual record data. 
    // The record is either a binary B+Tree (larger records), 
    // or a list of key/value pairs (smaller records).
    // let updatePromise;
    let newRecordInfo;
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
        await Promise.all(childPromises);
        
        changes.deletes.forEach(change => {
            const op = BinaryBPlusTree.TransactionOperation.remove(change.keyOrIndex, change.oldValue);
            operations.push(op);
        });
        changes.updates.forEach(change => {
            const oldEntryValue = new BinaryBPlusTree.EntryValue(change.oldValue);
            const newEntryValue = new BinaryBPlusTree.EntryValue(change.newValue);
            const op = BinaryBPlusTree.TransactionOperation.update(change.keyOrIndex, newEntryValue, oldEntryValue);
            operations.push(op);
        });
        changes.inserts.forEach(change => {
            const op = BinaryBPlusTree.TransactionOperation.add(change.keyOrIndex, change.newValue);
            operations.push(op);
        });

        // Changed behaviour: 
        // previously, if 1 operation failed, the tree was rebuilt. If any operation thereafter failed, it stopped processing
        // now, processOperations() will be called after each rebuild, so all operations will be processed
        const debugOpCounts = [];
        const processOperations = async (retry = 0, prevRecordInfo = nodeReader.recordInfo) => {
            if (retry > 1 && operations.length === debugOpCounts[debugOpCounts.length-1]) {
                // Number of pending operations did not decrease after rebuild?!
                throw new Error(`DEV: Tree rebuild did not fix ${operations.length} pending operation(s) failing to execute. Debug this!`);
            }
            debugOpCounts.push(operations.length);
            try {
                await tree.transaction(operations);
                storage.debug.log(`Updated tree for node "/${nodeInfo.path}"`.colorize(ColorStyle.green)); 
                return prevRecordInfo;
            }
            catch (err) {
                storage.debug.log(`Could not update tree for "/${nodeInfo.path}"${retry > 0 ? ` (retry ${retry})` : ''}: ${err.message}`.colorize(ColorStyle.yellow), err.codes);
                // Failed to update the binary data, we need to recreate the whole tree

                // NEW: Rebuild tree to a temp file
                const tempFilepath = `${storage.settings.path}/${storage.name}.acebase/tree-${ID.generate()}.tmp`;
                let bytesWritten = 0;
                const fd = await pfs.open(tempFilepath, pfs.flags.readAndWriteAndCreate)
                const writer = BinaryWriter.forFunction(async (data, index) => {
                    await pfs.write(fd, data, 0, data.length, index)
                    bytesWritten += data.length;
                });
                await tree.rebuild(writer);

                // Now write the record with data read from the temp file
                let readOffset = 0;
                const reader = async length => {
                    const buffer = new Uint8Array(length);
                    const { bytesRead } = await pfs.read(fd, buffer, 0, buffer.length, readOffset);
                    readOffset += bytesRead;
                    if (bytesRead < length) { 
                        return buffer.slice(0, bytesRead); // throw new Error(`Failed to read ${length} bytes from file, only got ${bytesRead}`); 
                    }
                    return buffer;
                };
                const recordInfo = await _write(storage, nodeInfo.path, nodeReader.recordInfo.valueType, bytesWritten, true, reader, nodeReader.recordInfo);
                // Close and remove the tmp file, don't wait for this
                pfs.close(fd)
                .then(() => pfs.rm(tempFilepath))
                .catch(err => {
                    // Error removing the file?
                    storage.debug.error(`Can't remove temp rebuild file ${tempFilepath}: `, err);
                });

                if (retry >= 1 && prevRecordInfo !== recordInfo) {
                    // If this is a 2nd+ call to processOperations, we have to release the previous allocation here
                    discardAllocation.ranges.push(...prevRecordInfo.allocation.ranges);
                }
                const newNodeReader = new NodeReader(storage, recordInfo.address, lock, false);
                const info = await newNodeReader.readHeader();
                tree = new BinaryBPlusTree(
                    newNodeReader._treeDataReader.bind(newNodeReader), 
                    1024 * 100, // 100KB reads/writes
                    newNodeReader._treeDataWriter.bind(newNodeReader),
                    'record@' + newNodeReader.recordInfo.address.toString()
                );
                // Retry remaining operations
                return processOperations(retry+1, recordInfo);
            }
        }
        newRecordInfo = await processOperations();
    }
    else {
        // This is a small record. In the future, it might be nice to make changes 
        // in the record itself, but let's just rewrite it for now.
        // Record (de)allocation is managed by _writeNode

        let mergedValue = isArray ? [] : {};

        await nodeReader.getChildStream()
        .next(child => {
            let keyOrIndex = isArray ? child.index : child.key;
            if (child.address) { //(child.storedAddress || child.address) {
                //mergedValue[keyOrIndex] = new InternalNodeReference(child.type, child.storedAddress || child.address);
                mergedValue[keyOrIndex] = new InternalNodeReference(child.type, child.address);
            }
            else {
                mergedValue[keyOrIndex] = child.value;
            }
        });

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
            mergedValue.length += changes.inserts.length - changes.deletes.length;
        }

        // Check below has moved to more extensive test above which is done before the cache is altered - fixes an issue!
        // if (isArray) {
        //     const isExhaustive = Object.keys(mergedValue).every((key, i) => +key === i); // test if there are gaps in the array (eg misses value at index 3)
        //     if (!isExhaustive) {
        //         throw new Error(`Elements cannot be inserted beyond, or removed before the end of an array. Rewrite the whole array at path "${nodeInfo.path}" or change your schema to use an object collection instead`);
        //     }
        // }
        newRecordInfo = await _writeNode(storage, nodeInfo.path, mergedValue, lock, nodeReader.recordInfo);
    }

    return done(newRecordInfo);
}


/**
 * 
 * @param {AceBaseStorage} storage 
 * @param {NodeInfo} nodeInfo 
 * @param {object} newValue 
 * @param {NodeLock} lock
 * @returns {Promise<{ recordMoved: boolean, recordInfo: RecordInfo, deallocate: NodeAllocation }>}
 */
async function _createNode(storage, nodeInfo, newValue, lock, invalidateCache = true) {
    storage.debug.log(`Node "/${nodeInfo.path}" is being ${nodeInfo.exists ? 'overwritten' : 'created'}`.colorize(ColorStyle.cyan));

    /** @type {NodeAllocation} */
    let currentAllocation = null;
    if (nodeInfo.exists && nodeInfo.address) {
        // Current value occupies 1 or more records we can probably reuse. 
        // For now, we'll allocate new records though, then free the old allocation
        const nodeReader = new NodeReader(storage, nodeInfo.address, lock, false); //Node.getReader(storage, nodeInfo.address, lock);
        currentAllocation = await nodeReader.getAllocation(true);
    }

    if (invalidateCache) {
        storage.invalidateCache(false, nodeInfo.path, nodeInfo.exists, 'createNode'); // remove cache
    }
    const recordInfo = await _writeNode(storage, nodeInfo.path, newValue, lock); 
    return { recordMoved: true, recordInfo, deallocate: currentAllocation };
}

/**
 * 
 * @param {AceBaseStorage} storage 
 * @param {string} path 
 * @param {any} value 
 * @param {string} parentTid 
 * @returns {Promise<RecordInfo>}
 */
async function _lockAndWriteNode(storage, path, value, parentTid) {
    const lock = await storage.nodeLocker.lock(path, parentTid, true, `_lockAndWrite "${path}"`);
    try {
        const recordInfo = await _writeNode(storage, path, value, lock);
        return recordInfo;
    }
    finally {
        lock.release();
    }
}

/**
 * 
 * @param {AceBaseStorage} storage 
 * @param {string} path 
 * @param {any} value 
 * @param {NodeLock} lock
 * @returns {Promise<RecordInfo>}
 */
async function _writeNode(storage, path, value, lock, currentRecordInfo = undefined) {
    if (lock.path !== path || !lock.forWriting) {
        throw new Error(`Cannot write to node "/${path}" because lock is on the wrong path or not for writing`);
    }

    const write = (valueType, buffer, keyTree = false) => {
        let readOffset = 0;
        const reader = (length) => {
            const slice = buffer.slice(readOffset, readOffset + length);
            readOffset += length;
            return slice;
        };
        return _write(storage, path, valueType, buffer.length, keyTree, reader, currentRecordInfo);
    };

    if (typeof value === "string") {
        return write(VALUE_TYPES.STRING, encodeString(value));
    }
    else if (value instanceof PathReference) {
        return write(VALUE_TYPES.REFERENCE, encodeString(value.path));
    }
    else if (value instanceof ArrayBuffer) {
        return write(VALUE_TYPES.BINARY, new Uint8Array(value));
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
        const isExhaustive = Object.keys(value).every((key, i) => +key === i && value[i] !== null); // Test if there are no gaps in the array
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
            // eslint-disable-next-line no-control-regex
            if (/[\x00-\x08\x0b\x0c\x0e-\x1f/[\]\\]/.test(key)) { 
                throw new Error(`Key ${key} cannot contain control characters or any of the following characters: \\ / [ ]`); 
            }
            if (key.length > 128) { throw new Error(`Key ${key} is too long to store. Max length=128`); }

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

    await Promise.all(childPromises);
    
    // Append all serialized data into 1 binary array

    /** @type {{ keyTree: boolean, data: Uint8Array }} */
    let result;
    const minKeysPerNode = 25;
    const minKeysForTreeCreation = 100;
    if (true && serialized.length > minKeysForTreeCreation) {
        // Create a B+tree
        const fillFactor = 
            isArray || serialized.every(kvp => typeof kvp.key === 'string' && /^[0-9]+$/.test(kvp.key))
                ? BINARY_TREE_FILL_FACTOR_50
                : BINARY_TREE_FILL_FACTOR_95;

        const treeBuilder = new BPlusTreeBuilder(true, fillFactor);
        serialized.forEach(kvp => {
            let binaryValue = _getValueBytes(kvp);
            treeBuilder.add(isArray ? kvp.index : kvp.key, binaryValue);
        });

        const builder = new Uint8ArrayBuilder();
        await treeBuilder.create().toBinary(true, BinaryWriter.forUint8ArrayBuilder(builder));
        // // Test tree
        // await BinaryBPlusTree.test(bytes)
        result = { keyTree: true, data: builder.data };
    }
    else {
        const builder = new Uint8ArrayBuilder();
        serialized.forEach(kvp => {
            if (!isArray) {
                let keyIndex = storage.KIT.getOrAdd(kvp.key); // Gets KIT index for this key

                // key_info:
                if (keyIndex >= 0) {
                    // Cached key name
                    builder.writeByte(
                        128                         // key_indexed = 1
                        | ((keyIndex >> 8) & 127)   // key_nr (first 7 bits)
                    );
                    builder.writeByte(
                        keyIndex & 255              // key_nr (last 8 bits)
                    );
                }
                else {
                    // Inline key name
                    builder.writeByte(kvp.key.length - 1); // key_length
                    // key_name:
                    const keyBytes = encodeString(kvp.key);
                    builder.append(keyBytes);
                }
            }
            // const binaryValue = _getValueBytes(kvp);
            // builder.append(binaryValue);
            _writeBinaryValue(kvp, builder);
        });
        result = { keyTree: false, data: builder.data };
    }
    // Now write the record
    return write(isArray ? VALUE_TYPES.ARRAY : VALUE_TYPES.OBJECT, result.data, result.keyTree);
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
 * @returns {Uint8Array}
 */
function _getValueBytes(kvp) {
    return _writeBinaryValue(kvp).data;
}

/**
 * 
 * @param {SerializedKeyValue} kvp 
 * @param {Uint8ArrayBuilder} [builder] optional builder to append data to
 * @returns {Uint8ArrayBuilder} returns the used builder
 */
 function _writeBinaryValue(kvp, builder = new Uint8ArrayBuilder(null, 64)) {
    const startIndex = builder.length;
    // value_type:
    builder.push(kvp.type << 4);    // tttt0000

    // tiny_value?:
    let tinyValue = -1;
    if (kvp.type === VALUE_TYPES.BOOLEAN) { tinyValue = kvp.bool ? 1 : 0; }
    else if (kvp.type === VALUE_TYPES.NUMBER && kvp.ref >= 0 && kvp.ref <= 15 && Math.floor(kvp.ref) === kvp.ref) { tinyValue = kvp.ref; }
    else if (kvp.type === VALUE_TYPES.STRING && kvp.binary && kvp.binary.length === 0) { tinyValue = 0; }
    else if (kvp.type === VALUE_TYPES.ARRAY && kvp.ref.length === 0) { tinyValue = 0; }
    else if (kvp.type === VALUE_TYPES.OBJECT && Object.keys(kvp.ref).length === 0) { tinyValue = 0; }
    else if (kvp.type === VALUE_TYPES.BINARY && kvp.ref.byteLength === 0) { tinyValue = 0; }
    if (tinyValue >= 0) {
        // Tiny value
        builder.data[startIndex] |= tinyValue;
        builder.push(64); // 01000000 --> tiny value
        // The end
    }
    else if (kvp.record) {
        // External record
        builder.push(192); // 11000000 --> record value

        // Set the 6 byte record address (page_nr,record_nr)
        builder.writeUint32(kvp.record.pageNr);
        builder.writeUint16(kvp.record.recordNr);
    }
    else {
        // Inline value
        let data = kvp.bytes || kvp.binary;
        let length = 'byteLength' in data ? data.byteLength : data.length;

        builder.push(
            128             // 10000000 --> inline value
            | (length - 1)  // inline_length (last 6 bits)
        );
        if (data instanceof ArrayBuffer) {
            data = new Uint8Array(data);
        }
        builder.append(data);
        
        // End
    }
    return builder;
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
}


/**
 * 
 * @param {AceBaseStorage} storage 
 * @param {string} path 
 * @param {number} type 
 * @param {number} length 
 * @param {boolean} hasKeyTree 
 * @param {(length: number) => Uint8Array|number[]|Promise<Uint8Array|number[]>} reader
 * @param {RecordInfo} currentRecordInfo
 * @returns {Promise<RecordInfo>}
 */
async function _write(storage, path, type, length, hasKeyTree, reader, currentRecordInfo = undefined) {
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

    const bytesPerRecord = storage.settings.recordSize;
    let headerByteLength, totalBytes, requiredRecords, lastChunkSize;

    const calculateStorageNeeds = (nrOfChunks) => {
        // Calculate amount of bytes and records needed
        headerByteLength = 4; // Minimum length: 1 byte record_info and value_type, 1 byte CT (ct_entry_type 0), 2 bytes last_chunk_length
        totalBytes = (length + headerByteLength);
        requiredRecords = Math.ceil(totalBytes / bytesPerRecord);
        if (requiredRecords > 1) {
            // More than 1 record, header size increases
            headerByteLength += 3; // Add 3 bytes: 1 byte for ct_entry_type 1, 2 bytes for nr_records
            headerByteLength += (nrOfChunks - 1) * 9; // Add 9 header bytes for each additional range (1 byte ct_entry_type 2, 4 bytes start_page_nr, 2 bytes start_record_nr, 2 bytes nr_records)
            // Recalc total bytes and required records
            totalBytes = (length + headerByteLength);
            requiredRecords = Math.ceil(totalBytes / bytesPerRecord);
        }
        lastChunkSize = requiredRecords === 1 ? length : totalBytes % bytesPerRecord;
        if (lastChunkSize === 0 && length > 0) {
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
    const useExistingAllocation = currentRecordInfo && currentRecordInfo.allocation.totalAddresses === requiredRecords;
    const ranges = useExistingAllocation 
        ? currentRecordInfo.allocation.ranges
        : await storage.FST.allocate(requiredRecords);

    let allocation = new NodeAllocation(ranges);
    !useExistingAllocation && storage.debug.verbose(`Allocated ${allocation.totalAddresses} addresses for node "/${path}": ${allocation}`.colorize(ColorStyle.grey));
        
    calculateStorageNeeds(allocation.ranges.length);
    if (requiredRecords < allocation.totalAddresses) {
        const addresses = allocation.addresses;
        const deallocate = addresses.splice(requiredRecords);
        storage.debug.verbose(`Requested ${deallocate.length} too many addresses to store node "/${path}", releasing them`.colorize(ColorStyle.grey));
        storage.FST.release(NodeAllocation.fromAdresses(deallocate).ranges);
        allocation = NodeAllocation.fromAdresses(addresses);
        calculateStorageNeeds(allocation.ranges.length);
    }
        
    // Build the binary header data
    let header = new Uint8Array(headerByteLength);
    let headerView = new DataView(header.buffer, 0, header.length);
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

    let bytesRead = 0;
    const readChunk = async (length) => {
        let headerBytes;
        if (bytesRead < header.byteLength) {
            headerBytes = header.slice(bytesRead, bytesRead + length);
            bytesRead += headerBytes.byteLength;
            length -= headerBytes.byteLength;
            if (length === 0) { return headerBytes; }
        }
        let dataBytes = reader(length);
        bytesRead += length;
        if (dataBytes instanceof Promise) { dataBytes = await dataBytes; }
        if (dataBytes instanceof Array) {
            dataBytes = Uint8Array.from(dataBytes);
        }
        else if (!(dataBytes instanceof Uint8Array)) {
            throw new Error(`bytes must be Uint8Array or plain byte Array`);
        }
        if (headerBytes) {
            dataBytes = concatTypedArrays(headerBytes, dataBytes);
        }
        return dataBytes;
    };
    
    try {
        // Create and write all chunks
        const bytesWritten = await chunkTable.ranges.reduce(async (promise, range) => {
            const fileIndex = storage.getRecordFileIndex(range.pageNr, range.recordNr);
            if (isNaN(fileIndex)) {
                throw new Error(`fileIndex is NaN!!`);
            }
            let bytesWritten = promise ? await promise : 0;
            const data = await readChunk(range.length * bytesPerRecord);
            bytesWritten += data.byteLength;
            await storage.writeData(fileIndex, data);
            return bytesWritten;
        }, null);

        const chunks = chunkTable.ranges.length;
        const address = new NodeAddress(path, allocation.ranges[0].pageNr, allocation.ranges[0].recordNr);
        const nodeInfo = new NodeInfo({ path, type, exists: true, address });

        storage.updateCache(false, nodeInfo, true); // hasMoved?
        storage.debug.log(`Node "/${address.path}" saved at address ${address.pageNr},${address.recordNr} - ${allocation.totalAddresses} addresses, ${bytesWritten} bytes written in ${chunks} chunk(s)`.colorize(ColorStyle.green));
        // storage.logwrite({ address: address, allocation, chunks, bytesWritten });

        let recordInfo;
        if (useExistingAllocation) {
            // By using the exising info, caller knows it should not release the allocation
            recordInfo = currentRecordInfo;
            recordInfo.allocation = allocation; // Necessary?
            recordInfo.hasKeyIndex = hasKeyTree;
            recordInfo.headerLength = headerByteLength;
            recordInfo.lastChunkSize = lastChunkSize;
        }
        else {
            recordInfo = new RecordInfo(address.path, hasKeyTree, type, allocation, headerByteLength, lastChunkSize, bytesPerRecord);
            recordInfo.fileIndex = storage.getRecordFileIndex(address.pageNr, address.recordNr);
        }
        recordInfo.timestamp = Date.now();

        if (address.path === "") {
            await storage.rootRecord.update(address); // Wait for this, the address update has to be written to file
        }
        return recordInfo;
    }
    catch (reason) {
        // If any write failed, what do we do?
        storage.debug.error(`Failed to write node "/${path}": ${reason}`);
        throw reason;
    }
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