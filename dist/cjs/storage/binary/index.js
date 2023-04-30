"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AceBaseStorage = exports.AceBaseStorageSettings = void 0;
const fs = require("fs");
const promise_fs_1 = require("../../promise-fs");
const acebase_core_1 = require("acebase-core");
const node_changes_1 = require("../../node-changes");
const node_address_1 = require("./node-address");
const node_cache_1 = require("../../node-cache");
const node_info_1 = require("./node-info");
// import { NodeLock } from '../../node-lock';
const node_errors_1 = require("../../node-errors");
const index_1 = require("../index");
const node_value_types_1 = require("../../node-value-types");
const btree_1 = require("../../btree");
const binary_1 = require("../../binary");
const node_lock_1 = require("../../node-lock");
const { concatTypedArrays, bytesToNumber, bytesToBigint, numberToBytes, bigintToBytes, encodeString, decodeString, cloneObject } = acebase_core_1.Utils;
const REMOVED_CHILD_DATA_IMPLEMENTED = false; // not used yet - allows marking of deleted children without having to rewrite the whole node
class AceBaseStorageSettings extends index_1.StorageSettings {
    constructor(settings = {}) {
        super(settings);
        /**
         * record size in bytes, defaults to 128 (recommended). Max is 65536
         * @default 128
         */
        this.recordSize = 128;
        /**
         * page size in records, defaults to 1024 (recommended). Max is 65536
         * @default 1024
         */
        this.pageSize = 1024;
        /**
         * type of database content. Determines the name of the file within the .acebase directory
         */
        this.type = 'data';
        /**
         * Use future FST version (not implemented yet)
         */
        this.fst2 = false;
        if (typeof settings.recordSize === 'number') {
            this.recordSize = settings.recordSize;
        }
        if (typeof settings.pageSize === 'number') {
            this.pageSize = settings.pageSize;
        }
        if (typeof settings.type === 'string') {
            this.type = settings.type;
        }
        this.transactions = new AceBaseTransactionLogSettings(settings.transactions);
    }
}
exports.AceBaseStorageSettings = AceBaseStorageSettings;
class AceBaseTransactionLogSettings {
    /**
     * BETA functionality - logs mutations made to a separate database file so they can be retrieved later
     * for database syncing / replication. Implementing this into acebase itself will allow the current
     * sync implementation in acebase-client to become better: it can simply request a mutations stream from
     * the server after disconnects by passing a cursor or timestamp, instead of downloading whole nodes before
     * applying local changes. This will also enable horizontal scaling: replication with remote db instances
     * becomes possible.
     *
     * Still under development, disabled by default. See transaction-logs.spec for tests
     */
    constructor(settings = {}) {
        /**
         * Whether transaction logging is enabled.
         * @default false
         */
        this.log = false;
        /**
         * Max age of transactions to keep in logfile. Set to 0 to disable cleaning up and keep all transactions
         * @default 30
         */
        this.maxAge = 30;
        /**
         * Whether write operations wait for the transaction to be logged before resolving their promises.
         */
        this.noWait = false;
        if (typeof settings.log === 'boolean') {
            this.log = settings.log;
        }
        if (typeof settings.maxAge === 'number') {
            this.maxAge = settings.maxAge;
        }
        if (typeof settings.noWait === 'boolean') {
            this.noWait = settings.noWait;
        }
    }
}
class AceBaseStorage extends index_1.Storage {
    /**
     * Stores data in a binary file
     */
    constructor(name, settings, env) {
        console.assert(settings instanceof AceBaseStorageSettings, 'settings must be an instance of AceBaseStorageSettings');
        super(name, settings, env);
        this._ready = false;
        this.nodeCache = new node_cache_1.NodeCache();
        if (settings.maxInlineValueSize > 64) {
            throw new Error('maxInlineValueSize cannot be larger than 64'); // This is technically not possible because we store inline length with 6 bits: range = 0 to 2^6-1 = 0 - 63 // NOTE: lengths are stored MINUS 1, because an empty value is stored as tiny value, so "a"'s stored inline length is 0, allowing values up to 64 bytes
        }
        if (settings.recordSize > 65536) {
            throw new Error('recordSize cannot be larger than 65536'); // Technically not possible because setting in db is 16 bits
        }
        if (settings.pageSize > 65536) {
            throw new Error('pageSize cannot be larger than 65536'); // Technically not possible because record_nr references are 16 bits
        }
        this.name = name;
        this.settings = settings; // uses maxInlineValueSize, recordSize & pageSize settings from file when existing db
        this.stats = {
            writes: 0,
            reads: 0,
            bytesRead: 0,
            bytesWritten: 0,
        };
        this.type = settings.type;
        if (this.type === 'data' && settings.transactions.log === true) {
            // Get/create storage for mutations logging
            const txSettings = new AceBaseStorageSettings({ type: 'transaction', path: settings.path, removeVoidProperties: true, transactions: settings.transactions, ipc: settings.ipc });
            this.txStorage = new AceBaseStorage(name, txSettings, { logLevel: 'error' });
        }
        this.once('ready', () => {
            this._ready = true;
        });
        // Setup cluster functionality
        this.ipc.on('request', async (message) => {
            // Master functionality: handle requests from workers
            console.assert(this.ipc.isMaster, 'Workers should not receive requests');
            const request = message.data;
            const reply = (result) => {
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
                        const index = this.KIT.getOrAdd(request.key);
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
                        if (!index) {
                            return reply({ ok: false, reason: `Index ${request.fileName} not found` });
                        }
                        await index.handleRecordUpdate(request.path, request.oldValue, request.newValue);
                        return reply({ ok: true });
                    }
                    default: {
                        throw new Error(`Unknown ipc request "${request.type}"`);
                    }
                }
            }
            catch (err) {
                reply({ ok: false, reason: err.message });
            }
        });
        this.ipc.on('notification', message => {
            const notification = message.data;
            switch (notification.type) {
                case 'kit.new_key': {
                    this.KIT.keys[notification.index] = notification.key;
                    break;
                }
                case 'root.update': {
                    return this.rootRecord.update(notification.address, false);
                }
                case 'cache.update': {
                    const nodeInfo = new node_info_1.BinaryNodeInfo(notification.info);
                    nodeInfo.address = new node_address_1.BinaryNodeAddress(nodeInfo.address.path, nodeInfo.address.pageNr, nodeInfo.address.recordNr);
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
        // const storage = this;
        // TODO @appy-one move
        const KIT = {
            get fileIndex() { return 64; },
            get length() { return 65536 - 64; },
            bytesUsed: 0,
            keys: [],
        };
        this.KIT = {
            get fileIndex() { return KIT.fileIndex; },
            get length() { return KIT.length; },
            get bytesUsed() { return KIT.bytesUsed; },
            get keys() { return KIT.keys; },
            getOrAdd: (key) => {
                if (key.length > 15 || key.length === 1) {
                    return -1;
                }
                if (/^[0-9]+$/.test(key)) {
                    return -1; //storage.debug.error(`Adding KIT key "${key}"?!!`);
                }
                let index = KIT.keys.indexOf(key);
                if (index < 0) {
                    if (!this.ipc.isMaster) {
                        // Forward request to cluster master. Response will be too late for us, but it will be cached for future calls
                        this.ipc.sendRequest({ type: 'kit.add', key })
                            .then(result => {
                            KIT.keys[result.index] = key; // Add to our local array
                        });
                        return -1;
                    }
                    index = KIT.keys.push(key) - 1;
                    if (this.ipc.isMaster) {
                        // Notify all workers
                        this.ipc.sendNotification({ type: 'kit.new_key', key, index });
                    }
                }
                else {
                    return index;
                }
                this.KIT.write().catch((err) => {
                    // Not being able to save the new KIT to file would be a serious issue.
                    // Because getOrAdd is not async, there is no way we can tell caller there is a problem with the key they are using.
                    // On the other hand, if writing the KIT data failed (IO error), the calling code will most likely also have
                    // issues writing the data they needed the new key for.
                    throw new Error(`CRITICAL: Unable to write KIT to database file: ${err.message}`);
                    // this.keys.pop(); // Remove the key
                    // index = -1;
                });
                return index;
            },
            write: async () => {
                if (!this.ipc.isMaster) {
                    throw new Error('DEV ERROR: KIT.write not allowed to run if it is a cluster worker!!');
                }
                // Key Index Table starts at index 64, and is 2^16 (65536) bytes long
                const data = Buffer.alloc(KIT.length);
                const view = new DataView(data.buffer);
                let index = 0;
                for (let i = 0; i < KIT.keys.length; i++) {
                    const key = KIT.keys[i];
                    // Now supports storage of keys with Unicode characters
                    const binary = encodeString(key);
                    const keyLength = binary.byteLength;
                    if (index + keyLength >= KIT.length) {
                        throw new Error(`Too many keys to store in KIT, size limit of ${KIT.length} has been reached; current amount of keys is ${KIT.keys.length}`);
                    }
                    // Add 1-byte key length
                    view.setUint8(index, keyLength);
                    index++;
                    // Add key
                    data.set(binary, index);
                    index += keyLength;
                }
                const bytesToWrite = Math.max(KIT.bytesUsed, index); // Determine how many bytes should be written to overwrite current KIT
                KIT.bytesUsed = index;
                await this.writeData(KIT.fileIndex, data, 0, bytesToWrite);
            },
            load: async () => {
                const data = Buffer.alloc(KIT.length);
                const { bytesRead } = await promise_fs_1.pfs.read(this.file, data, 0, data.length, KIT.fileIndex).catch(err => {
                    this.debug.error('Error reading KIT from file: ', err);
                    throw err;
                });
                // Interpret the read data
                const view = new DataView(data.buffer, 0, bytesRead);
                const keys = [];
                let index = 0;
                let keyLength = 0;
                while ((keyLength = view.getUint8(index)) > 0) {
                    index++;
                    // Now supports Unicode keys
                    const buffer = new Uint8Array(data.buffer, index, keyLength);
                    const key = decodeString(buffer);
                    keys.push(key);
                    index += keyLength;
                }
                KIT.bytesUsed = index;
                KIT.keys = keys;
                this.debug.log(`KIT read, ${KIT.keys.length} keys indexed`.colorize(acebase_core_1.ColorStyle.bold));
                //storage.debug.log(keys);
                return keys;
            },
        };
        // Setup Free Space Table object and functions
        const FST = {
            get fileIndex() { return 65536; },
            length: 65536,
            bytesUsed: 0,
            pages: 0,
            ranges: [],
            getMaxScraps: () => {
                if (!this.ipc.isMaster) {
                    return 10;
                }
                return FST.ranges.length > 7500 ? 10 : 3;
            },
        };
        this.FST = {
            get fileIndex() { return FST.fileIndex; },
            get length() { return FST.length; },
            get bytesUsed() { return FST.bytesUsed; },
            get pages() { return FST.pages; },
            get ranges() { return FST.ranges; },
            get maxScraps() { return FST.getMaxScraps(); },
            allocate: async (requiredRecords) => {
                if (!this.ipc.isMaster) {
                    const result = await this.ipc.sendRequest({ type: 'fst.allocate', records: requiredRecords });
                    return result.allocation;
                }
                if (this.isLocked(true)) {
                    throw new Error('database is locked');
                }
                // First, try to find a range that fits all requested records sequentially
                const recordsPerPage = this.settings.pageSize;
                const allocation = [];
                let pageAdded = false;
                const ret = async (comment) => {
                    // console.error(`ALLOCATED ${comment}: ${allocation.map(a => `${a.pageNr},${a.recordNr}+${a.length-1}`).join('; ')}`);
                    await this.FST.write(pageAdded);
                    return allocation;
                };
                let totalFree = FST.ranges.reduce((t, r) => t + r.end - r.start, 0);
                while (totalFree < requiredRecords) {
                    // There is't enough free space, we'll have to create new page(s)
                    const newPageNr = FST.pages;
                    FST.pages++;
                    const newRange = { page: newPageNr, start: 0, end: recordsPerPage };
                    FST.ranges.push(newRange);
                    totalFree += recordsPerPage;
                    pageAdded = true;
                }
                if (requiredRecords <= recordsPerPage) {
                    // Find exact range
                    let r = FST.ranges.find(r => r.end - r.start === requiredRecords);
                    if (r) {
                        allocation.push({ pageNr: r.page, recordNr: r.start, length: requiredRecords });
                        const i = FST.ranges.indexOf(r);
                        FST.ranges.splice(i, 1);
                        return ret('exact_range');
                    }
                    // Find first fitting range
                    r = FST.ranges.find(r => r.end - r.start > requiredRecords);
                    if (r) {
                        allocation.push({ pageNr: r.page, recordNr: r.start, length: requiredRecords });
                        r.start += requiredRecords;
                        return ret('first_fitting');
                    }
                }
                // If we get here, we'll have to deal with the scraps
                // Check how many ranges would be needed to store record (sort from large to small)
                const sortedRanges = FST.ranges.slice().sort((a, b) => {
                    const l1 = a.end - a.start;
                    const l2 = b.end - b.start;
                    if (l1 < l2) {
                        return 1;
                    }
                    if (l1 > l2) {
                        return -1;
                    }
                    if (a.page < b.page) {
                        return -1;
                    }
                    if (a.page > b.page) {
                        return 1;
                    }
                    return 0;
                });
                const MAX_RANGES = FST.getMaxScraps();
                const test = {
                    ranges: [],
                    totalRecords: 0,
                    wholePages: 0,
                    additionalRanges: 0,
                };
                for (let i = 0; test.totalRecords < requiredRecords && i < sortedRanges.length && test.additionalRanges <= MAX_RANGES; i++) {
                    const r = sortedRanges[i];
                    test.ranges.push(r);
                    const nrOfRecords = r.end - r.start;
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
                        const range = test.ranges[i];
                        console.assert(range.start === 0 && range.end === recordsPerPage, 'Available ranges were not sorted correctly, this range MUST be a whole page!!');
                        const rangeIndex = FST.ranges.indexOf(range);
                        FST.ranges.splice(rangeIndex, 1);
                        allocation.push({ pageNr: range.page, recordNr: 0, length: recordsPerPage });
                        requiredRecords -= recordsPerPage;
                    }
                    // Now create remaining needed pages
                    for (let i = 0; i < pagesToCreate; i++) {
                        const newPageNr = FST.pages;
                        FST.pages++;
                        const useRecords = Math.min(requiredRecords, recordsPerPage);
                        allocation.push({ pageNr: newPageNr, recordNr: 0, length: useRecords });
                        if (useRecords < recordsPerPage) {
                            FST.ranges.push({ page: newPageNr, start: useRecords, end: recordsPerPage });
                        }
                        requiredRecords -= useRecords;
                        pageAdded = true;
                    }
                }
                else {
                    // Use the ranges found
                    test.ranges.forEach((r, i) => {
                        const length = r.end - r.start;
                        if (length > requiredRecords) {
                            console.assert(i === test.ranges.length - 1, 'DEV ERROR: This MUST be the last range or logic is not right!');
                            allocation.push({ pageNr: r.page, recordNr: r.start, length: requiredRecords });
                            r.start += requiredRecords;
                            requiredRecords = 0;
                        }
                        else {
                            allocation.push({ pageNr: r.page, recordNr: r.start, length });
                            const rangeIndex = FST.ranges.indexOf(r);
                            FST.ranges.splice(rangeIndex, 1);
                            requiredRecords -= length;
                        }
                    });
                }
                console.assert(requiredRecords === 0, 'DEV ERROR: requiredRecords MUST be zero now!');
                return ret('scraps');
            },
            release: async (ranges) => {
                if (!this.ipc.isMaster) {
                    await this.ipc.sendRequest({ type: 'fst.release', ranges });
                    return;
                }
                if (this.isLocked(true)) {
                    throw new Error('database is locked');
                }
                // Add freed ranges
                ranges.forEach(range => {
                    FST.ranges.push({ page: range.pageNr, start: range.recordNr, end: range.recordNr + range.length });
                });
                this.FST.sort();
                // Now normalize the ranges
                for (let i = 0; i < FST.ranges.length; i++) {
                    const range = FST.ranges[i];
                    let adjRange;
                    for (let j = i + 1; j < FST.ranges.length; j++) {
                        const otherRange = FST.ranges[j];
                        if (otherRange.page !== range.page) {
                            continue;
                        }
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
                        FST.ranges.splice(i, 1);
                        i--;
                    }
                }
                this.FST.sort(); // Do we have to? Already sorted, right?
                this.FST.write();
            },
            sort: () => {
                FST.ranges.sort((a, b) => {
                    if (a.page < b.page) {
                        return -1;
                    }
                    if (a.page > b.page) {
                        return 1;
                    }
                    if (a.start < b.start) {
                        return -1;
                    }
                    if (a.start > b.start) {
                        return 1;
                    }
                    return 0; // Impossible!
                });
            },
            write: async (updatedPageCount = false) => {
                // Free Space Table starts at index 2^16 (65536), and is 2^16 (65536) bytes long.
                // Each range needs 8 bytes to be stored, and the FST has 6 header bytes, so that means
                // a maximum of 8191 FST ranges can be stored. If this amount is exceeded, we'll have to
                // remove the smallest ranges from the FST. See https://github.com/appy-one/acebase/issues/69
                const MAX_FST_RANGES = 8191;
                if (FST.ranges.length > MAX_FST_RANGES) {
                    // Remove smallest ranges
                    const n = FST.ranges.length - MAX_FST_RANGES;
                    const ranges = FST.ranges.slice()
                        .sort((a, b) => a.end - a.start < b.end - b.start ? -1 : 1)
                        .slice(0, n);
                    const totalRecords = ranges.reduce((records, range) => records + (range.end - range.start), 0);
                    this.debug.warn(`FST grew too big to store in the database file, removing ${n} entries for ${totalRecords} records`);
                    ranges.forEach(range => {
                        const i = FST.ranges.indexOf(range);
                        FST.ranges.splice(i, 1);
                    });
                    if (FST.ranges.length > MAX_FST_RANGES) {
                        throw new Error('DEV ERROR: Still too many entries in the FST!');
                    }
                }
                const data = Buffer.alloc(FST.length);
                const view = new DataView(data.buffer);
                // Add 4-byte page count
                view.setUint32(0, FST.pages);
                // Add 2-byte number of free ranges
                view.setUint16(4, FST.ranges.length);
                let index = 6;
                for (let i = 0; i < FST.ranges.length; i++) {
                    const range = FST.ranges[i];
                    // Add 4-byte page nr
                    view.setUint32(index, range.page);
                    // Add 2-byte start record nr, 2-byte end record nr
                    view.setUint16(index + 4, range.start);
                    view.setUint16(index + 6, range.end);
                    index += 8;
                }
                const bytesToWrite = Math.max(FST.bytesUsed, index); // Determine how many bytes should be written to overwrite current FST
                FST.bytesUsed = index;
                const promise = this.writeData(FST.fileIndex, data, 0, bytesToWrite).catch(err => {
                    this.debug.error('Error writing FST: ', err);
                });
                const writes = [promise];
                if (updatedPageCount === true) {
                    // Update the file size
                    const newFileSize = this.rootRecord.fileIndex + (FST.pages * settings.pageSize * settings.recordSize);
                    const promise = promise_fs_1.pfs.ftruncate(this.file, newFileSize);
                    writes.push(promise);
                }
                await Promise.all(writes);
                //this.debug.log(`FST saved, ${this.bytesUsed} bytes used for ${FST.ranges.length} ranges`);
            },
            load: async () => {
                if (!this.ipc.isMaster) {
                    return [];
                }
                const data = Buffer.alloc(FST.length);
                const { bytesRead } = await promise_fs_1.pfs.read(this.file, data, 0, data.length, this.FST.fileIndex).catch(err => {
                    this.debug.error('Error reading FST from file');
                    this.debug.error(err);
                    throw err;
                });
                // Interpret the read data
                const view = new DataView(data.buffer, 0, bytesRead);
                const allocatedPages = view.getUint32(0); //new DataView(data.buffer, 0, 4).getUint32(0);
                const freeRangeCount = view.getUint16(4); //new DataView(data.buffer, 4, 2).getUint16(0);
                const ranges = [];
                let index = 6;
                for (let i = 0; i < freeRangeCount; i++) {
                    //let view = new DataView(data.buffer, index, 8);
                    const range = {
                        page: view.getUint32(index),
                        start: view.getUint16(index + 4),
                        end: view.getUint16(index + 6),
                    };
                    ranges.push(range);
                    index += 8;
                }
                FST.pages = allocatedPages;
                FST.bytesUsed = index;
                FST.ranges = ranges;
                this.debug.log(`FST read, ${allocatedPages} pages allocated, ${freeRangeCount} free ranges`.colorize(acebase_core_1.ColorStyle.bold));
                return ranges;
            },
        };
        // TODO @appy-one move
        const rootRecord = {
            get fileIndex() { return 131072; },
            pageNr: 0,
            recordNr: 0,
            exists: false,
        };
        this.rootRecord = {
            get fileIndex() { return rootRecord.fileIndex; },
            get pageNr() { return rootRecord.pageNr; },
            get recordNr() { return rootRecord.recordNr; },
            get exists() { return rootRecord.exists; },
            get address() {
                return new node_address_1.BinaryNodeAddress('', rootRecord.pageNr, rootRecord.recordNr);
            },
            update: async (address, fromIPC = false) => {
                // Root address changed
                console.assert(address.path === '');
                if (address.pageNr === rootRecord.pageNr && address.recordNr === rootRecord.recordNr) {
                    // No need to update
                    return;
                }
                rootRecord.pageNr = address.pageNr;
                rootRecord.recordNr = address.recordNr;
                rootRecord.exists = true;
                // this.debug.log(`Root record address updated to ${address.pageNr}, ${address.recordNr}`.colorize(ColorStyle.bold));
                if (!fromIPC) {
                    // Notify others
                    this.ipc.sendNotification({ type: 'root.update', address });
                    // Save to file, or it didn't happen
                    const bytes = new Uint8Array(6);
                    const view = new DataView(bytes.buffer);
                    view.setUint32(0, address.pageNr);
                    view.setUint16(4, address.recordNr);
                    const bytesWritten = await this.writeData(HEADER_INDEXES.ROOT_RECORD_ADDRESS, bytes, 0, bytes.length);
                    this.debug.log(`Root record address updated to ${address.pageNr}, ${address.recordNr}`.colorize(acebase_core_1.ColorStyle.bold));
                }
            },
        };
        const descriptor = encodeString('AceBase⚡');
        const baseIndex = descriptor.length;
        const HEADER_INDEXES = {
            VERSION_NR: baseIndex,
            DB_LOCK: baseIndex + 1,
            ROOT_RECORD_ADDRESS: baseIndex + 2,
            RECORD_SIZE: baseIndex + 8,
            PAGE_SIZE: baseIndex + 10,
            MAX_INLINE_VALUE_SIZE: baseIndex + 12,
        };
        const openDatabaseFile = async (justCreated = false) => {
            const handleError = (err, txt) => {
                this.debug.error(txt);
                this.debug.error(err);
                if (this.file) {
                    promise_fs_1.pfs.close(this.file).catch(err => {
                        // ...
                    });
                }
                this.emit('error', err);
                throw err;
            };
            try {
                this.file = await promise_fs_1.pfs.open(this.fileName, settings.readOnly === true ? 'r' : 'r+', 0);
            }
            catch (err) {
                handleError(err, 'Failed to open database file');
            }
            // const logfile = fs.openSync(`${this.settings.path}/${this.name}.acebase/log`, 'as');
            // this.logwrite = (action) => {
            //     fs.appendFile(logfile, JSON.stringify(action), () => {});
            // };
            const data = Buffer.alloc(64);
            let bytesRead = 0;
            try {
                const result = await promise_fs_1.pfs.read(this.file, data, 0, data.length, 0);
                bytesRead = result.bytesRead;
            }
            catch (err) {
                handleError(err, 'Could not read database header');
            }
            // Cast Buffer to Uint8Array
            const header = new Uint8Array(data);
            // Check descriptor
            const hasAceBaseDescriptor = () => {
                for (let i = 0; i < descriptor.length; i++) {
                    if (header[i] !== descriptor[i]) {
                        return false;
                    }
                }
                return true;
            };
            if (bytesRead < 64 || !hasAceBaseDescriptor()) {
                return handleError('unsupported_db', 'This is not a supported database file');
            }
            // Version should be 1
            let index = descriptor.length;
            if (header[index] !== 1) {
                return handleError('unsupported_db', 'This database version is not supported, update your source code');
            }
            index++;
            // Read flags
            const flagsIndex = index;
            const flags = header[flagsIndex]; // flag bits: [r, r, r, r, r, r, FST2, LOCK]
            const lock = {
                enabled: ((flags & 0x1) > 0),
                forUs: true,
            };
            this.isLocked = (forUs = false) => {
                return lock.enabled && lock.forUs === forUs;
            };
            this.lock = async (forUs = false) => {
                await promise_fs_1.pfs.write(this.file, new Uint8Array([flags | 0x1]), 0, 1, flagsIndex);
                lock.enabled = true;
                lock.forUs = forUs;
                this.emit('locked', { forUs });
            };
            this.unlock = async () => {
                await promise_fs_1.pfs.write(this.file, new Uint8Array([flags & 0xfe]), 0, 1, flagsIndex);
                lock.enabled = false;
                this.emit('unlocked');
            };
            this.settings.fst2 = (flags & 0x2) > 0;
            if (this.settings.fst2) {
                throw new Error('FST2 is not supported by this version yet');
            }
            index++;
            // Read root record address
            const view = new DataView(header.buffer, index, 6);
            rootRecord.pageNr = view.getUint32(0);
            rootRecord.recordNr = view.getUint16(4);
            if (!justCreated) {
                rootRecord.exists = true;
            }
            index += 6;
            // Read saved settings
            this.settings.recordSize = header[index] << 8 | header[index + 1];
            this.settings.pageSize = header[index + 2] << 8 | header[index + 3];
            this.settings.maxInlineValueSize = header[index + 4] << 8 | header[index + 5];
            // Fix issue #110: (see https://github.com/appy-one/acebase/issues/110)
            if (this.settings.recordSize === 0) {
                this.settings.recordSize = 65536;
            }
            if (this.settings.pageSize === 0) {
                this.settings.pageSize = 65536;
            }
            if (this.settings.maxInlineValueSize === 0) {
                this.settings.maxInlineValueSize = 65536;
            }
            const intro = acebase_core_1.ColorStyle.dim;
            this.debug.log(`Database "${name}" details:`.colorize(intro));
            this.debug.log('- Type: AceBase binary'.colorize(intro));
            this.debug.log(`- Record size: ${this.settings.recordSize} bytes`.colorize(intro));
            this.debug.log(`- Page size: ${this.settings.pageSize} records (${this.settings.pageSize * this.settings.recordSize} bytes)`.colorize(intro));
            this.debug.log(`- Max inline value size: ${this.settings.maxInlineValueSize} bytes`.colorize(intro));
            this.debug.log(`- Root record address: ${this.rootRecord.pageNr}, ${this.rootRecord.recordNr}`.colorize(intro));
            await this.KIT.load(); // Read Key Index Table
            await this.FST.load(); // Read Free Space Table
            await this.indexes.load(); // Load indexes
            !justCreated && this.emitOnce('ready');
            return this.file;
        };
        const createDatabaseFile = async () => {
            // Create the file with 64 byte header (settings etc), KIT, FST & root record
            const version = 1;
            const headerBytes = 64;
            const flags = 0; // When implementing settings.fst2 ? 0x2 : 0x0;
            const stats = new Uint8Array([
                version,
                flags,
                0, 0, 0, 0,
                0, 0,
                settings.recordSize >> 8 & 0xff,
                settings.recordSize & 0xff,
                settings.pageSize >> 8 & 0xff,
                settings.pageSize & 0xff,
                settings.maxInlineValueSize >> 8 & 0xff,
                settings.maxInlineValueSize & 0xff,
            ]);
            let header = concatTypedArrays(descriptor, stats);
            const padding = new Uint8Array(headerBytes - header.byteLength);
            padding.fill(0);
            header = concatTypedArrays(header, padding);
            // Create object Key Index Table (KIT) to allow very small record creation.
            // key_index uses 2 bytes, so max 65536 keys could technically be indexed.
            // Using an average key length of 7 characters, the index would become
            // 7 chars + 1 delimiter * 65536 keys = 520KB. That would be total overkill.
            // The table should be at most 64KB so that means approx 8192 keys can
            // be indexed. With shorter keys, this will be more. With longer keys, less.
            const kit = new Uint8Array(65536 - header.byteLength);
            let uint8 = concatTypedArrays(header, kit);
            // Create empty 64KB FST ("Free space table")
            // Each FST record is 8 bytes:
            //    Page nr: 4 bytes
            //    Record start nr: 2 bytes
            //    Record end nr: 2 bytes
            // Using a 64KB FST (minus 64B header size) allows 8184 entries: (65536-64) / 8
            // Defragmentation should kick in when FST is becoming full!
            const fst = new Uint8Array(65536);
            uint8 = concatTypedArrays(uint8, fst);
            const dir = this.fileName.slice(0, this.fileName.lastIndexOf('/'));
            if (dir !== '.') {
                await promise_fs_1.pfs.mkdir(dir).catch(err => {
                    if (err.code !== 'EEXIST') {
                        throw err;
                    }
                });
            }
            await promise_fs_1.pfs.writeFile(this.fileName, Buffer.from(uint8.buffer));
            await openDatabaseFile(true);
            // Now create the root record
            await this.setNode('', {});
            rootRecord.exists = true;
            this.emitOnce('ready');
        };
        // Open or create database
        const exists = fs.existsSync(this.fileName);
        if (exists) {
            // Open
            openDatabaseFile(false);
        }
        else if (settings.readOnly) {
            throw new Error(`Cannot create readonly database "${name}"`);
        }
        else if (!this.ipc.isMaster) {
            // Prevent race condition - let master process create database, poll for existance
            const poll = () => {
                setTimeout(async () => {
                    const exists = await promise_fs_1.pfs.exists(this.fileName);
                    if (exists) {
                        openDatabaseFile();
                    }
                    else {
                        poll();
                    }
                }, 1000); // Wait 1s before trying again
            };
            poll();
        }
        else {
            // Create new file
            createDatabaseFile();
        }
        this.ipc.once('exit', code => {
            // Close database file
            this.debug.log(`Closing db ${this.ipc.dbname}`);
            promise_fs_1.pfs.close(this.file).catch(err => {
                this.debug.error('Could not close database:', err);
            });
        });
    }
    get isReady() { return this._ready; }
    get fileName() { return `${this.settings.path}/${this.name}.acebase/${this.type}.db`; }
    async writeData(fileIndex, buffer, offset = 0, length = -1) {
        if (this.settings.readOnly) {
            const err = new Error(`Cannot write to readonly database ${this.fileName}`);
            err.code = 'EPERM'; // This is what NodeJS would throw below
            throw err;
        }
        if (buffer.constructor === Uint8Array) { //buffer instanceof Uint8Array) {
            // If the passsed buffer is of type Uint8Array (which is essentially the same as Buffer),
            // convert it to a Buffer instance or fs.write will FAIL.
            buffer = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        }
        console.assert(buffer instanceof Buffer, 'buffer argument must be a Buffer or Uint8Array');
        if (length === -1) {
            length = buffer.byteLength;
        }
        const { bytesWritten } = await promise_fs_1.pfs.write(this.file, buffer, offset, length, fileIndex).catch(err => {
            this.debug.error('Error writing to file', err);
            throw err;
        });
        this.stats.writes++;
        this.stats.bytesWritten += bytesWritten;
        return bytesWritten;
    }
    /**
     *
     * @param fileIndex Index of the file to read
     * @param buffer Buffer object, ArrayBuffer or TypedArray (Uint8Array, Int8Array, Uint16Array etc) to read data into
     * @param offset byte offset in the buffer to read data into, default is 0
     * @param length total bytes to read (if omitted or -1, it will use buffer.byteLength)
     * @returns returns the total bytes read
     */
    async readData(fileIndex, buffer, offset = 0, length = -1) {
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
                throw new Error('When using a TypedArray as buffer, its byteOffset MUST be 0.');
            }
        }
        try {
            const { bytesRead } = await promise_fs_1.pfs.read(this.file, buffer, offset, length, fileIndex);
            this.stats.reads++;
            this.stats.bytesRead += bytesRead;
            return bytesRead;
        }
        catch (err) {
            this.debug.error('Error reading record', buffer, offset, length, fileIndex);
            this.debug.error(err);
            throw err;
        }
    }
    /**
     * Use this method to update cache, instead of through `this.nodeCache`
     * @param fromIPC Whether this update came from an IPC notification to prevent infinite loop
     * @param nodeInfo
     * @param hasMoved set to false when reading a record's children - not because the address is actually changing
     */
    updateCache(fromIPC, nodeInfo, hasMoved = true) {
        this.nodeCache.update(nodeInfo); // , hasMoved
        if (!fromIPC && hasMoved) {
            this.ipc.sendNotification({ type: 'cache.update', info: nodeInfo });
        }
    }
    invalidateCache(fromIPC, path, recursive, reason) {
        this.nodeCache.invalidate(path, recursive, reason);
        this.indexes.getAll(path, { parentPaths: true, childPaths: true }).forEach((index) => {
            index.clearCache(path);
        });
        if (!fromIPC) {
            this.ipc.sendNotification({ type: 'cache.invalidate', path, recursive, reason });
        }
    }
    async close() {
        const p1 = super.close();
        const p2 = this.txStorage && this.txStorage.close(); // Also close transaction db
        await Promise.all([p1, p2]);
    }
    get pageByteSize() {
        return this.settings.pageSize * this.settings.recordSize;
    }
    getRecordFileIndex(pageNr, recordNr) {
        const index = this.rootRecord.fileIndex
            + (pageNr * this.pageByteSize)
            + (recordNr * this.settings.recordSize);
        return index;
    }
    /**
     * Repairs a broken record by removing the reference to it from the parent node. It does not overwrite the target record to prevent possibly breaking other data.
     * Example: repairNode('books/l74fm4sg000009jr1iyt93a5/reviews') will remove the reference to the 'reviews' record in 'books/l74fm4sg000009jr1iyt93a5'
     */
    async repairNode(targetPath, options = {
        ignoreIntact: false,
        markAsRemoved: true,
    }) {
        if (typeof options.ignoreIntact !== 'boolean') {
            options.ignoreIntact = false;
        }
        if (typeof options.markAsRemoved !== 'boolean') {
            options.markAsRemoved = true;
        }
        const targetPathInfo = acebase_core_1.PathInfo.get(targetPath);
        const { parentPath: path, key, parent: pathInfo } = targetPathInfo;
        const tid = this.createTid();
        let lock = await this.nodeLocker.lock(path, tid.toString(), true, 'fixRecord');
        try {
            // Make sure cache for parent and all children is removed
            this.invalidateCache(false, path, true);
            // Check if the target node is really broken first
            let targetNodeInfo = null;
            try {
                targetNodeInfo = await this.getNodeInfo(targetPath, { tid });
            }
            finally {
                if (targetNodeInfo) {
                    const msg = `Node at path "${targetPath}" is not broken: it is a(n) ${targetNodeInfo.valueTypeName} stored ${targetNodeInfo.address ? `@${targetNodeInfo.address.pageNr},${targetNodeInfo.address.recordNr}` : 'inline'}${targetNodeInfo.value ? ` with value ${targetNodeInfo.value}` : ''}`;
                    this.debug.warn(msg);
                    if (!options.ignoreIntact) {
                        throw new Error(msg);
                    }
                }
            }
            let nodeInfo;
            try {
                nodeInfo = await this.getNodeInfo(path, { tid });
            }
            catch (err) {
                throw new Error(`Can't read parent node ${path}: ${err}`);
            }
            if (!nodeInfo.exists) {
                throw new Error(`Node at path ${path} does not exist`);
            }
            else if (!nodeInfo.address) {
                throw new Error(`Node at ${path} is not stored in its own record`);
            }
            const removedValueIndicator = '[[removed]]';
            const isArray = nodeInfo.valueType === node_value_types_1.VALUE_TYPES.ARRAY;
            if (isArray && !options.markAsRemoved) {
                this.debug.warn(`Node at path "${path}" is an Array, cannot remove entry at index ${key}: marking it as "${removedValueIndicator}" instead`);
                options.markAsRemoved = true;
            }
            const nodeReader = new NodeReader(this, nodeInfo.address, lock, false);
            const recordInfo = await nodeReader.readHeader();
            let childInfo;
            try {
                childInfo = await nodeReader.getChildInfo(key);
            }
            catch (err) {
                throw new Error(`Can't get info about child "${key}" in node "${path}: ${err}`);
            }
            if (!childInfo.address) {
                throw new Error(`Can't fix node "${targetPath}" because it is not stored in its own record`);
            }
            if (recordInfo.hasKeyIndex) {
                // This node has an index for the child keys
                // Easy update: update this child only
                const oldKV = _serializeValue(this, targetPath, key, new InternalNodeReference(childInfo.valueType, childInfo.address), tid);
                const oldVal = _getValueBytes(oldKV);
                const newKV = _serializeValue(this, targetPath, key, removedValueIndicator, tid);
                const newVal = _getValueBytes(newKV);
                const tree = nodeReader.getChildTree();
                const oldEntryValue = new btree_1.BinaryBPlusTree.EntryValue(oldVal);
                const newEntryValue = new btree_1.BinaryBPlusTree.EntryValue(newVal);
                const op = options.markAsRemoved
                    ? btree_1.BinaryBPlusTree.TransactionOperation.update(key, newEntryValue, oldEntryValue)
                    : btree_1.BinaryBPlusTree.TransactionOperation.remove(key, oldEntryValue.recordPointer);
                try {
                    await tree.transaction([op]);
                }
                catch (err) {
                    throw new Error(`Could not update tree for "${path}": ${err}`);
                }
            }
            else {
                // This is a small record. Rewrite the entire node
                const mergedValue = (isArray ? [] : {});
                await nodeReader.getChildStream().next(child => {
                    const keyOrIndex = isArray ? child.index : child.key;
                    if (keyOrIndex === key) {
                        // This is the target key to update/delete
                        if (options.markAsRemoved) {
                            mergedValue[key] = removedValueIndicator;
                        }
                    }
                    else if (child.address) { //(child.storedAddress || child.address) {
                        mergedValue[keyOrIndex] = new InternalNodeReference(child.valueType, child.address);
                    }
                    else {
                        mergedValue[keyOrIndex] = child.value;
                    }
                });
                const newRecordInfo = await _writeNode(this, path, mergedValue, lock, nodeReader.recordInfo);
                if (newRecordInfo !== nodeReader.recordInfo) {
                    // _writeNode allocated new records: its location moved and the parent has to be updated.
                    if (pathInfo.parent) {
                        lock = await lock.moveToParent();
                        await this._updateNode(pathInfo.parentPath, { [pathInfo.key]: new InternalNodeReference(newRecordInfo.valueType, newRecordInfo.address) }, { merge: true, tid, _internal: true });
                    }
                    try {
                        await this.FST.release(nodeReader.recordInfo.allocation.ranges);
                    }
                    catch (err) {
                        this.debug.error(`Could not release previously allocated ranges for "/${path}": ${err}`);
                    }
                    // throw new Error(`Node at path "/${path}" was not rewritten at the same location. Fix failed`);
                }
            }
            this.debug.log(`Successfully fixed node at path "${targetPath}" by ${options.markAsRemoved ? `marking key "${key}" of parent node "${path}" as removed ("${removedValueIndicator}")` : `removing key "${key}" from parent node "${path}"`}`);
            // Make sure cached address is removed.
            this.invalidateCache(false, targetPath, true);
        }
        finally {
            await lock.release();
        }
    }
    /**
     * Repairs a broken B+Tree key index of an object collection. Use this if you are unable to load every child of an object collection.
     * @param path
     */
    async repairNodeTree(path) {
        this.debug.warn(`Starting node tree repair for path "/${path}"`);
        const tid = this.createTid();
        let lock = await this.nodeLocker.lock(path, tid.toString(), true, 'repairNodeTree');
        try {
            // Make sure cache for parent and all children is removed
            this.invalidateCache(false, path, true);
            const nodeInfo = await (async () => {
                try {
                    return await this.getNodeInfo(path, { tid });
                }
                catch (err) {
                    throw new Error(`Can't read parent node ${path}: ${err}`);
                }
            })();
            if (!nodeInfo.exists) {
                throw new Error(`Node at path ${path} does not exist`);
            }
            else if (!nodeInfo.address) {
                throw new Error(`Node at ${path} is not stored in its own record`);
            }
            // Get the tree
            const nodeReader = new NodeReader(this, nodeInfo.address, lock, false);
            const recordInfo = await nodeReader.readHeader();
            if (!recordInfo.hasKeyIndex) {
                throw new Error(`Node at ${path} does not have a B+Tree key index`);
            }
            const tree = new btree_1.BinaryBPlusTree({
                readFn: nodeReader._treeDataReader.bind(nodeReader),
                debug: this.debug,
                id: `path:${path}`,
            });
            const newRecordInfo = await _rebuildKeyTree(tree, nodeReader, { repairMode: true });
            if (newRecordInfo !== recordInfo) {
                // deallocate old storage space & update parent address
                const deallocate = new NodeAllocation(recordInfo.allocation.ranges);
                const pathInfo = acebase_core_1.PathInfo.get(path);
                if (pathInfo.parentPath !== null) {
                    lock = await lock.moveToParent();
                    await this._updateNode(pathInfo.parentPath, { [pathInfo.key]: new InternalNodeReference(newRecordInfo.valueType, newRecordInfo.address) }, { merge: true, tid, _internal: true, context: { acebase_repair: { path, method: 'node-tree' } } });
                }
                if (deallocate.totalAddresses > 0) {
                    // Release record allocation marked for deallocation
                    deallocate.normalize();
                    this.debug.verbose(`Releasing ${deallocate.totalAddresses} addresses (${deallocate.ranges.length} ranges) previously used by node "/${path}" and/or descendants: ${deallocate}`.colorize(acebase_core_1.ColorStyle.grey));
                    await this.FST.release(deallocate.ranges);
                }
            }
            this.debug.warn(`Successfully repaired node tree for path "/${path}"`);
        }
        catch (err) {
            this.debug.error(`Failed to repair node tree for path "/${path}": ${err.stack}`);
        }
        finally {
            lock.release();
        }
    }
    get transactionLoggingEnabled() {
        return this.settings.transactions && this.settings.transactions.log === true;
    }
    logMutation(type, path, value, context, mutations) {
        // Add to transaction log
        if (!['set', 'update'].includes(type)) {
            throw new TypeError('type must be either "set" or "update"');
        }
        if (!this.transactionLoggingEnabled) {
            throw new Error('transaction logging is not enabled on database');
        }
        if (!context.acebase_cursor) {
            throw new Error('context.acebase_cursor must have been set');
        }
        if (mutations.list.length === 0) {
            // There were no changes, nothing to log.
            return;
        }
        if (path.startsWith('__')) {
            // Don't log mutations on private paths
            return;
        }
        if (this.type === 'data') {
            return this.txStorage.logMutation(type, path, value, context, mutations);
        }
        else if (this.type !== 'transaction') {
            throw new Error('Wrong database type');
        }
        if (value === null) {
            // Target path was deleted. Log the mutation on parent node: prevents 2 different delete flows and allows for uniform getMutations logic
            const pathInfo = acebase_core_1.PathInfo.get(path);
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
            mutations,
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
                await this._updateNode('history', { [cursor]: item }, { merge: true, _internal: true });
            }
            catch (err) {
                this.debug.error('Failed to add to transaction log: ', err);
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
     */
    async getMutations(filter) {
        if (this.type === 'data') {
            if (!this.transactionLoggingEnabled) {
                throw new Error('Transaction logging is not enabled');
            }
            return this.txStorage.getMutations(filter);
        }
        else if (this.type !== 'transaction') {
            throw new Error('Wrong database type');
        }
        if (!this.isReady) {
            await this.once('ready');
        }
        const cursor = // Use given cursor, timestamp or nothing to filter on
         (filter.cursor && filter.cursor.slice(0, 8))
            || (filter.timestamp && (new Date(filter.timestamp).getTime()).toString(36).padStart(8, '0'))
            || '00000000';
        const since = (typeof filter.timestamp === 'number' && filter.timestamp)
            || (cursor && parseInt(cursor, 36))
            || 0;
        // Check if cursor is not too old
        if (since !== 0 && cursor < this.oldestValidCursor) {
            throw new Error('Cursor too old');
        }
        if (!filter.for || filter.for.length === 0) {
            filter.for = [{ path: typeof filter.path === 'string' ? filter.path : '', events: ['value'] }]; // Use filter.path, or root node as single path
        }
        // Get filter paths, filter out paths that are descendants of another path
        const filterPaths = filter.for.filter(t1 => {
            const pathInfo = acebase_core_1.PathInfo.get(t1.path);
            return !filter.for.some(t2 => pathInfo.isDescendantOf(t2.path));
        }).map(item => item.path);
        const tid = this.createTid(); //ID.generate();
        const lock = await this.nodeLocker.lock('history', tid.toString(), false, 'getMutations');
        try {
            let mutations = [];
            const checkQueue = [];
            let done;
            const donePromise = new Promise(resolve => done = resolve);
            let allEnumerated = false;
            const hasValue = (val) => ![undefined, null].includes(val);
            const hasPropertyValue = (val, prop) => hasValue(val) && typeof val === 'object' && hasValue(val[prop]);
            // const filterPathInfo = PathInfo.get(filter.path || '');
            const check = async (key) => {
                checkQueue.push(key);
                const { value: mutation } = await this.getNode(`history/${key}`, { tid, include: ['path', 'updated', 'deleted', 'type', 'timestamp'] }); // Not including 'value'
                mutation.keys = mutation.updated.concat(mutation.deleted);
                const mutationPathInfo = acebase_core_1.PathInfo.get(mutation.path);
                // Find the path in filter.paths on this trail, there can only be 1 (descendants were filtered out above)
                const filterPath = (() => {
                    const path = filterPaths.find(path => mutationPathInfo.isOnTrailOf(path));
                    return typeof path === 'string' ? path : null;
                })();
                const filterPathInfo = filterPath === null ? null : acebase_core_1.PathInfo.get(filterPath);
                const load = (() => {
                    /**
                     * When to include a mutation & what data to include.
                     * - mutation.path starts with __ (private path)
                     *      - ignore
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
                    if (mutation.path.startsWith('__')) {
                        return 'none';
                    }
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
                    const { value: tx } = await this.getNode(`history/${key}`, { tid, include: ['context', 'mutations', valueKey] });
                    const targetPath = mutation.path;
                    let targetValue = tx.value, targetOp = mutation.type;
                    if (typeof targetValue === 'undefined') {
                        targetValue = null;
                    }
                    else {
                        // Add removed properties to the target value again
                        mutation.deleted.forEach(key => targetValue[key] = null);
                    }
                    for (const m of tx.mutations.list) {
                        if (typeof m.val === 'undefined') {
                            m.val = null;
                        }
                        if (typeof m.prev === 'undefined') {
                            m.prev = null;
                        }
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
                            targetPath = acebase_core_1.PathInfo.getChildPath(targetPath, childKey);
                            targetValue = targetValue !== null && childKey in targetValue ? targetValue[childKey] : null;
                            if (trailKeys.length === 0) {
                                // console.log(`Adding mutation on "${targetPath}" to history of "${filterPathInfo.path}"`)
                                // Check if the targeted value actually changed
                                const targetPathInfo = acebase_core_1.PathInfo.get(targetPath);
                                const hasTargetMutation = tx.mutations.list.some(m => {
                                    const mTargetPathInfo = acebase_core_1.PathInfo.get(tx.mutations.path).child(m.target);
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
                        };
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
            const oldestValidCursor = this.oldestValidCursor, expiredTransactions = [], inspectFurther = [];
            try {
                await this.getChildren('history', { tid }).next(childInfo => {
                    const txCursor = childInfo.key.slice(0, cursor.length);
                    if (txCursor < oldestValidCursor) {
                        expiredTransactions.push(childInfo.key);
                    }
                    if (txCursor < cursor) {
                        return;
                    }
                    if (txCursor === cursor) {
                        // cuid timestamp bytes are equal - perform extra check on this mutation later to find out if we have to include it in the results
                        inspectFurther.push(childInfo.key);
                    }
                    count++;
                    check(childInfo.key);
                });
            }
            catch (err) {
                if (!(err instanceof node_errors_1.NodeNotFoundError)) {
                    throw err;
                }
            }
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
            if (inspectFurther.length === 1 && inspectFurther[0] === filter.cursor) {
                // This is the exact cursor the caller used as filter, remove this mutation from results
                const index = mutations.findIndex(m => m.id === filter.cursor);
                index >= 0 && mutations.splice(index, 1);
            }
            else if (inspectFurther.length > 1) {
                // More than one mutation was performed within the same millisecond of the used cursor filter.
                // We can't reliably use the counter bytes of the cuid to check which mutation came before or after,
                // because the cuid counter number rolls over (later cuid might have smaller counter), and they might
                // have been generated by other threads (both using a different counter).
                // Include all these mutations.
                // NOTE that it is practically impossible to have more than 1 mutation in the same millisecond that
                // could conflict with another because of the currently used locking mechanism - this will *probably* never
                // happen.
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
                    const basePathInfo = acebase_core_1.PathInfo.get(item.changes.path);
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
                            const trailKeys = acebase_core_1.PathInfo.get(item.path).keys.slice(basePathInfo.keys.length);
                            // Remove mutation from list if it's not on the target
                            const onTarget = ch.target.every((key, index) => key === trailKeys[index]);
                            if (!onTarget) {
                                item.changes.list.splice(i, 1);
                                i--;
                                continue;
                            }
                            // Remove target keys from trail
                            trailKeys.splice(0, ch.target.length);
                            const val = !hasValue(ch.val) ? null : trailKeys.reduce((val, key) => hasPropertyValue(val, key) ? val[key] : null, ch.val);
                            const prev = !hasValue(ch.prev) ? null : trailKeys.reduce((prev, key) => hasPropertyValue(prev, key) ? prev[key] : null, ch.prev);
                            if (val === prev) {
                                // This mutation has no changes on target path
                                item.changes.list.splice(i, 1);
                                i--;
                                continue;
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
                            val: hasValue(m.val) ? m.val : null,
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
                            && hasEvent(target.events, ['value', 'child_changed', 'mutated', 'mutations'])) {
                            return true;
                        }
                        else if (ch.pathInfo.equals(target.path)) {
                            // mutation on target: value is being overwritten.
                            if (hasEvent(target.events, ['value', 'child_changed', 'mutated', 'mutations'])) {
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
                            if (hasEvent(target.events, ['child_added', 'child_removed'])) {
                                if (!ch.pathInfo.isChildOf(target.path)) {
                                    return false;
                                }
                                if (hasEvent(target.events, ['child_added']) && ch.prev === null) {
                                    return true;
                                }
                                if (hasEvent(target.events, ['child_removed']) && ch.val === null) {
                                    return true;
                                }
                            }
                        }
                        else {
                            // Mutation on higher than target path.
                            // eg mutation on path 'books/book1', child_changed on target 'books/book1/authors'
                            // Get values at target path
                            const trailKeys = acebase_core_1.PathInfo.getPathKeys(target.path).slice(ch.pathInfo.keys.length);
                            const prev = trailKeys.reduce((prev, key) => hasValue(prev) && hasPropertyValue(prev, key) ? prev[key] : null, ch.prev);
                            const val = trailKeys.reduce((val, key) => hasValue(val) && hasPropertyValue(val, key) ? val[key] : null, ch.val);
                            if (prev === val) {
                                return false;
                            }
                            if (hasEvent(target.events, ['value', 'mutated', 'mutations'])) {
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
            return { mutations, used_cursor: filter.cursor, new_cursor: acebase_core_1.ID.generate() };
        }
        finally {
            lock.release();
        }
    }
    /**
     * Gets all effective changes from a given cursor or timestamp on a given path, or on multiple paths that are relevant for given events.
     * Multiple mutations will be merged so the returned changes will not have their original updating contexts and order of the original timeline.
     */
    async getChanges(filter) {
        const mutationsResult = await this.getMutations(filter);
        const { used_cursor, new_cursor, mutations } = mutationsResult;
        const hasValue = (val) => ![undefined, null].includes(val);
        // Get effective changes to the target paths
        const arr = mutations.reduce((all, item) => {
            // 1. Add all effective mutations as 'set' operations on their target paths, removing previous 'set' mutations on the same or descendant paths
            const basePathInfo = acebase_core_1.PathInfo.get(item.changes.path);
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
                    val: hasValue(m.val) ? m.val : null,
                });
            });
            return all;
        }, []).reduce((all, item) => {
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
                        context: item.context,
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
        const changes = arr.map(item => ({
            id: item.id,
            type: item.type,
            path: item.path,
            context: { acebase_cursor: item.context.acebase_cursor },
            value: item.val,
            previous: item.prev,
        }));
        return { used_cursor, new_cursor, changes };
    }
    get oldestValidCursor() {
        if (this.settings.transactions.maxAge <= 0) {
            return '';
        }
        const msPerDay = 86400000, // 24 * 60 * 60 * 1000
        maxAgeMs = this.settings.transactions.maxAge * msPerDay, limit = Date.now() - maxAgeMs, cursor = limit.toString(36);
        return cursor;
    }
    /**
     * Enumerates all children of a given Node for reflection purposes
     * @param path
     * @param options optional options used by implementation for recursive calls
     * @returns returns a generator object that calls .next for each child until the .next callback returns false
     */
    getChildren(path, options = {
        async: false,
    }) {
        if (typeof options.async !== 'boolean') {
            options.async = false;
        }
        const generator = {
            /**
             *
             * @param valueCallback callback function to run for each child. Return false to stop iterating
             * @returns returns a promise that resolves with a boolean indicating if all children have been enumerated, or was canceled by the valueCallback function
             */
            async next(valueCallback, useAsync = options.async) {
                return start(valueCallback, useAsync);
            },
        };
        const start = async (callback, isAsync = false) => {
            const tid = this.createTid(); //ID.generate();
            let canceled = false;
            const lock = await this.nodeLocker.lock(path, tid.toString(), false, `storage.getChildren "/${path}"`);
            try {
                const nodeInfo = await this.getNodeInfo(path, { tid });
                if (!nodeInfo.exists) {
                    throw new node_errors_1.NodeNotFoundError(`Node "/${path}" does not exist`);
                }
                else if (!nodeInfo.address) {
                    // Node does not have its own record, so it has no children
                    return;
                }
                const reader = new NodeReader(this, nodeInfo.address, lock, true);
                const nextCallback = isAsync
                    ? async (childInfo) => {
                        canceled = (await callback(childInfo)) === false;
                        return !canceled;
                    }
                    : (childInfo) => {
                        canceled = callback(childInfo) === false;
                        return !canceled;
                    };
                await reader.getChildStream({ keyFilter: options.keyFilter })
                    .next(nextCallback, isAsync);
                return canceled;
            }
            catch (err) {
                if (!(err instanceof node_errors_1.NodeNotFoundError)) {
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
     * @param path
     * @param options optional options that can limit the amount of (sub)data being loaded, and any other implementation specific options for recusrsive calls
     */
    async getNode(path, options = { child_objects: true }) {
        const tid = options.tid || this.createTid();
        const lock = await this.nodeLocker.lock(path, tid.toString(), false, `storage.getNode "/${path}"`);
        try {
            const cursor = this.transactionLoggingEnabled ? acebase_core_1.ID.generate() : undefined;
            const nodeInfo = await this.getNodeInfo(path, { tid });
            let value = nodeInfo.value;
            if (!nodeInfo.exists) {
                value = null;
            }
            else if (nodeInfo.address) {
                const reader = new NodeReader(this, nodeInfo.address, lock, true);
                value = await reader.getValue({
                    include: options.include,
                    exclude: options.exclude,
                    child_objects: options.child_objects,
                });
            }
            return {
                revision: null,
                value,
                cursor,
            };
        }
        catch (err) {
            if (err instanceof CorruptRecordError) {
                // err.record points to the broken record address (path, pageNr, recordNr)
                // err.key points to the property causing the issue
                // To fix this, the record needs to be rewritten without the violating key
                // No need to console.error here, should have already been done
                // TODO: release acebase-cli with ability to do that
            }
            else {
                this.debug.error('DEBUG THIS: getNode error:', err);
            }
            throw err;
        }
        finally {
            lock.release();
        }
    }
    /**
     * Retrieves info about a node (existence, wherabouts etc)
     * @param path
     * @param options optional options used by implementation for recursive calls
     */
    async getNodeInfo(path, options = {
        no_cache: false,
        include_child_count: false,
        allow_expand: false,
    }) {
        options.no_cache = options.no_cache === true;
        options.include_child_count = options.include_child_count === true;
        options.allow_expand = false; // Don't use yet! // options.allow_expand !== false;
        const tid = options.tid || this.createTid();
        const getChildCount = async (nodeInfo) => {
            let childCount = 0;
            if ([node_value_types_1.VALUE_TYPES.ARRAY, node_value_types_1.VALUE_TYPES.OBJECT].includes(nodeInfo.valueType) && nodeInfo.address) {
                // Get number of children
                const childLock = await this.nodeLocker.lock(path, tid.toString(), false, `storage.getNodeInfo "/${path}"`);
                try {
                    const childReader = new NodeReader(this, nodeInfo.address, childLock, true);
                    childCount = await childReader.getChildCount();
                }
                finally {
                    childLock.release(`storage.getNodeInfo: done with path "/${path}"`);
                }
            }
            return childCount;
        };
        if (path === '') {
            // Root record requires a little different strategy
            const rootLock = await this.nodeLocker.lock('', tid.toString(), false, 'storage.getNodeInfo "/"');
            try {
                if (!this.rootRecord.exists) {
                    return new node_info_1.BinaryNodeInfo({ path, exists: false });
                }
                const info = new node_info_1.BinaryNodeInfo({ path, address: this.rootRecord.address, exists: true, type: node_value_types_1.VALUE_TYPES.OBJECT });
                if (options.include_child_count) {
                    info.childCount = await getChildCount(info);
                }
                return info;
            }
            finally {
                rootLock.release();
            }
        }
        const allowCachedInfo = options.no_cache !== true && options.include_child_count !== true;
        if (allowCachedInfo) {
            // Check if the info has been cached
            const cachedInfo = this.nodeCache.find(path, true);
            if (cachedInfo) {
                // cached, or announced
                return cachedInfo;
            }
        }
        // Cache miss. Find it by reading parent node
        const pathInfo = acebase_core_1.PathInfo.get(path);
        const parentPath = pathInfo.parentPath;
        // Achieve a read lock on the parent node and read it
        const lock = await this.nodeLocker.lock(parentPath, tid.toString(), false, `storage.getNodeInfo "/${parentPath}"`);
        try {
            // We have a lock, check if the lookup has been cached by another "thread" in the meantime.
            let childInfo = this.nodeCache.find(path, true);
            if (childInfo instanceof Promise) {
                // It was previously announced, wait for it
                childInfo = await childInfo;
            }
            if (childInfo && !options.include_child_count) {
                // Return cached info
                return childInfo;
            }
            if (!childInfo) {
                // announce the lookup now
                this.nodeCache.announce(path);
                const parentInfo = await this.getNodeInfo(parentPath, { tid, no_cache: options.no_cache });
                if (parentInfo.exists && parentInfo.valueType === node_value_types_1.VALUE_TYPES.REFERENCE && options.allow_expand) {
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
                    const childPath = acebase_core_1.PathInfo.getChildPath(pathReference.path, pathInfo.key);
                    childInfo = await this.getNodeInfo(childPath, { tid, no_cache: options.no_cache });
                }
                else if (!parentInfo.exists || ![node_value_types_1.VALUE_TYPES.OBJECT, node_value_types_1.VALUE_TYPES.ARRAY].includes(parentInfo.valueType) || !parentInfo.address) {
                    // Parent does not exist, is not an object or array, or has no children (object not stored in own address)
                    // so child doesn't exist
                    childInfo = new node_info_1.BinaryNodeInfo({ path, exists: false });
                }
                else {
                    const reader = new NodeReader(this, parentInfo.address, lock, true);
                    childInfo = await reader.getChildInfo(pathInfo.key);
                }
            }
            if (options.include_child_count) {
                childInfo.childCount = await getChildCount(childInfo);
            }
            this.updateCache(false, childInfo, false); // Always cache lookups
            return childInfo;
        }
        catch (err) {
            this.debug.error('DEBUG THIS: getNodeInfo error', err);
            throw err;
        }
        finally {
            lock.release(`storage.getNodeInfo: done with path "/${parentPath}"`);
        }
    }
    /**
     * Delegates to legacy update method that handles everything
     * @param options optional options used by implementation for recursive calls
     * @returns Returns a new cursor if transaction logging is enabled
     */
    async setNode(path, value, options = {
        suppress_events: false,
        context: null,
    }) {
        options.context = options.context || {};
        if (this.txStorage) {
            options.context.acebase_cursor = acebase_core_1.ID.generate();
        }
        const context = cloneObject(options.context); // copy context to prevent changes while code proceeds async
        const mutations = await this._updateNode(path, value, { merge: false, tid: options.tid, suppress_events: options.suppress_events, context });
        if (this.txStorage && mutations) {
            const p = this.logMutation('set', path, value, context, mutations);
            if (p instanceof Promise) {
                await p;
            }
        }
        return options.context.acebase_cursor;
    }
    /**
     * Delegates to legacy update method that handles everything
     * @param options optional options used by implementation for recursive calls
     * @returns Returns a new cursor if transaction logging is enabled
     */
    async updateNode(path, updates, options = {
        suppress_events: false,
        context: null,
    }) {
        options.context = options.context || {};
        if (this.txStorage) {
            options.context.acebase_cursor = acebase_core_1.ID.generate();
        }
        const context = cloneObject(options.context); // copy context to prevent changes while code proceeds async
        const mutations = await this._updateNode(path, updates, { merge: true, tid: options.tid, suppress_events: options.suppress_events, context });
        if (this.txStorage && mutations) {
            const p = this.logMutation('update', path, updates, context, mutations);
            if (p instanceof Promise) {
                await p;
            }
        }
        return options.context.acebase_cursor;
    }
    /**
     * Updates or overwrite an existing node, or creates a new node. Handles storing of subnodes,
     * freeing old node and subnodes allocation, updating/creation of parent nodes, and removing
     * old cache entries. Triggers event notifications and index updates after the update succeeds.
     *
     * @param path
     * @param value object with key/value pairs
     * @param options optional options used by implementation for recursive calls
     * @returns If transaction logging is enabled, returns a promise that resolves with the applied mutations
     */
    async _updateNode(path, value, options = {
        merge: true,
        _internal: false,
        suppress_events: false,
        context: null,
    }) {
        // this.debug.log(`Update request for node "/${path}"`);
        const tid = options.tid || this.createTid(); // ID.generate();
        const pathInfo = acebase_core_1.PathInfo.get(path);
        if (value === null) {
            // Deletion of node is requested. Update parent
            return this._updateNode(pathInfo.parentPath, { [pathInfo.key]: null }, { merge: true, tid, suppress_events: options.suppress_events, context: options.context });
        }
        if (path !== '' && this.valueFitsInline(value)) {
            // Simple value, update parent instead
            return this._updateNode(pathInfo.parentPath, { [pathInfo.key]: value }, { merge: true, tid, suppress_events: options.suppress_events, context: options.context });
        }
        // const impact = super.getUpdateImpact(path, options.suppress_events);
        // const topLock = impact.topEventPath !== path
        //     ? await this.nodeLocker.lock(impact.topEventPath, tid, true, '_updateNode:topLock')
        //     : null;
        let lock = await this.nodeLocker.lock(path, tid.toString(), true, '_updateNode');
        try {
            const nodeInfo = await this.getNodeInfo(path, { tid });
            if (!nodeInfo.exists && path !== '') {
                // Node doesn't exist, update parent instead
                lock = await lock.moveToParent();
                return await this._updateNode(pathInfo.parentPath, { [pathInfo.key]: value }, { merge: true, tid, suppress_events: options.suppress_events, context: options.context });
            }
            // Exists, or root record
            const merge = nodeInfo.exists && nodeInfo.address && options.merge;
            const write = async () => {
                if (merge) {
                    // Node exists already, is stored in its own record, and it must be updated (merged)
                    // TODO: pass current value along if we have it - to prevent _mergeNode loading it again!
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
                await this._updateNode(pathInfo.parentPath, { [pathInfo.key]: new InternalNodeReference(recordInfo.valueType, recordInfo.address) }, { merge: true, tid, _internal: true, context: options.context });
                parentUpdated = true;
            }
            if (parentUpdated && pathInfo.parentPath !== '') {
                console.assert(this.nodeCache.has(pathInfo.parentPath), 'Not cached?!!');
            }
            if (deallocate && deallocate.totalAddresses > 0) {
                // Release record allocation marked for deallocation
                deallocate.normalize();
                this.debug.verbose(`Releasing ${deallocate.totalAddresses} addresses (${deallocate.ranges.length} ranges) previously used by node "/${path}" and/or descendants: ${deallocate}`.colorize(acebase_core_1.ColorStyle.grey));
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
                list: mutations,
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
exports.AceBaseStorage = AceBaseStorage;
const BINARY_TREE_FILL_FACTOR_50 = 50;
const BINARY_TREE_FILL_FACTOR_95 = 95;
const FLAG_WRITE_LOCK = 0x10;
const FLAG_READ_LOCK = 0x20;
const FLAG_KEY_TREE = 0x40;
const FLAG_VALUE_TYPE = 0xf;
class StorageAddressRange {
    constructor(pageNr, recordNr, length) {
        this.pageNr = pageNr;
        this.recordNr = recordNr;
        this.length = length;
    }
}
class StorageAddress {
    constructor(pageNr, recordNr) {
        this.pageNr = pageNr;
        this.recordNr = recordNr;
    }
}
class NodeAllocation {
    constructor(ranges) {
        this.ranges = ranges;
    }
    get addresses() {
        const addresses = [];
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
    toChunkTable() {
        const ranges = this.ranges.map(range => new NodeChunkTableRange(0, range.pageNr, range.recordNr, range.length));
        if (ranges.length === 1 && ranges[0].length === 1) {
            ranges[0].type = 0; // No CT (Chunk Table)
        }
        else {
            ranges.forEach((range, index) => {
                if (index === 0) {
                    range.type = 1; // 1st range CT record
                }
                else {
                    range.type = 2; // CT record with pageNr, recordNr, length
                }
                // TODO: Implement type 3 (contigious pages)
            });
        }
        return new NodeChunkTable(ranges);
    }
    static fromAdresses(records) {
        if (records.length === 0) {
            throw new Error('Cannot create allocation for 0 addresses');
        }
        let range = new StorageAddressRange(records[0].pageNr, records[0].recordNr, 1);
        const ranges = [range];
        for (let i = 1; i < records.length; i++) {
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
            return `${range.pageNr},${range.recordNr}+${range.length - 1}`;
        }).join('; ');
    }
    normalize() {
        // Appends ranges
        const total = this.totalAddresses;
        for (let i = 0; i < this.ranges.length; i++) {
            const range = this.ranges[i];
            let adjRange;
            for (let j = i + 1; j < this.ranges.length; j++) {
                const otherRange = this.ranges[j];
                if (otherRange.pageNr !== range.pageNr) {
                    continue;
                }
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
        console.assert(this.totalAddresses === total, 'the amount of addresses changed during normalization');
    }
}
class NodeChunkTable {
    constructor(ranges) {
        this.ranges = ranges;
    }
}
class NodeChunkTableRange {
    constructor(type, pageNr, recordNr, length) {
        this.type = type;
        this.pageNr = pageNr;
        this.recordNr = recordNr;
        this.length = length;
    }
}
class RecordInfo {
    constructor(path, hasKeyIndex, valueType, allocation, headerLength, lastRecordLength, bytesPerRecord, startData) {
        this.path = path;
        this.hasKeyIndex = hasKeyIndex;
        this.valueType = valueType;
        this.allocation = allocation;
        this.headerLength = headerLength;
        this.lastRecordLength = lastRecordLength;
        this.bytesPerRecord = bytesPerRecord;
        this.startData = startData;
        this.lastChunkSize = -1;
        this.fileIndex = -1;
        this.timestamp = -1;
    }
    get totalByteLength() {
        if (this.allocation.ranges.length === 1 && this.allocation.ranges[0].length === 1) {
            // Only 1 record used for storage
            return this.lastRecordLength;
        }
        const byteLength = (((this.allocation.totalAddresses - 1) * this.bytesPerRecord) + this.lastRecordLength) - this.headerLength;
        return byteLength;
    }
    get address() {
        const firstRange = this.allocation.ranges[0];
        return new node_address_1.BinaryNodeAddress(this.path, firstRange.pageNr, firstRange.recordNr);
    }
}
class AdditionalDataRequest extends Error {
    constructor() { super('More data needs to be loaded from the source'); }
}
class CorruptRecordError extends Error {
    constructor(record, key, message) {
        super(message);
        this.record = record;
        this.key = key;
    }
}
class NodeReader {
    constructor(storage, address, lock, updateCache = false, stack = {}) {
        this.storage = storage;
        this.address = address;
        this.lock = lock;
        this.updateCache = updateCache;
        this.stack = stack;
        this.recordInfo = null;
        if (!(address instanceof node_address_1.BinaryNodeAddress)) {
            throw new TypeError('address argument must be a BinaryNodeAddress');
        }
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
            const pathInfo = acebase_core_1.PathInfo.get(address.path);
            const parentAddress = stack[Object.keys(stack).find(key => stack[key].path === pathInfo.parentPath)];
            // const error = new CorruptRecordError(stack.slice(-1)[0], pathInfo.key, `Recursive read of record address ${clash.pageNr},${clash.recordNr}. Record "/${pathInfo.parentPath}" is corrupt: property "${pathInfo.key}" refers to the address belonging to path "/${clash.path}"`);
            const error = new CorruptRecordError(parentAddress, pathInfo.key, `CORRUPT RECORD: key "${pathInfo.key}" in "/${parentAddress.path}" (@${parentAddress.pageNr},${parentAddress.recordNr}) refers to address @${clash.pageNr},${clash.recordNr} which was already used to read "/${clash.path}". Recursive or repeated reading has been prevented.`);
            this.storage.debug.error(error.message);
            throw error;
        }
        stack[key] = address;
        this.stack = stack;
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
        const expired = this.storage.ipc.isMaster ? this.lock.state !== node_lock_1.NodeLock.LOCK_STATE.LOCKED : this.lock.expires <= Date.now();
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
    async getAllocation(includeChildNodes = false) {
        this._assertLock();
        if (!includeChildNodes && this.recordInfo !== null) {
            return this.recordInfo.allocation;
        }
        let allocation = null;
        await this.readHeader();
        allocation = this.recordInfo.allocation;
        if (!includeChildNodes) {
            return [{ path: this.address.path, allocation }];
        }
        const childPromises = [];
        await this.getChildStream()
            .next(child => {
            const address = child.address;
            if (address) {
                // Get child Allocation
                const promise = this.storage.nodeLocker.lock(child.path, this.lock.tid, false, `NodeReader:getAllocation:child "/${child.path}"`)
                    .then(async (childLock) => {
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
        });
        //console.log(childAllocations);
        return allocation;
    }
    /**
     * Reads all data for this node. Only do this when a stream won't do (eg if you need all data because the record contains a string)
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
     * @param options when omitted retrieves all nested data. If include is set to an array of keys it will only return those children. If exclude is set to an array of keys, those values will not be included
     * @returns returns the stored object, array or string
     */
    async getValue(options = {
        child_objects: true,
        no_cache: false,
    }) {
        if (typeof options.include !== 'undefined' && !(options.include instanceof Array)) {
            throw new TypeError('options.include must be an array of key names');
        }
        if (typeof options.exclude !== 'undefined' && !(options.exclude instanceof Array)) {
            throw new TypeError('options.exclude must be an array of key names');
        }
        if (['undefined', 'boolean'].indexOf(typeof options.child_objects) < 0) {
            throw new TypeError('options.child_objects must be a boolean');
        }
        this._assertLock();
        if (this.recordInfo === null) {
            await this.readHeader();
        }
        this.storage.debug.log(`Reading node "/${this.address.path}" from address ${this.address.pageNr},${this.address.recordNr}`.colorize(acebase_core_1.ColorStyle.magenta));
        switch (this.recordInfo.valueType) {
            case node_value_types_1.VALUE_TYPES.STRING: {
                const binary = await this.getAllData();
                const str = decodeString(binary);
                return str;
            }
            case node_value_types_1.VALUE_TYPES.REFERENCE: {
                const binary = await this.getAllData();
                const path = decodeString(binary);
                return new acebase_core_1.PathReference(path);
            }
            case node_value_types_1.VALUE_TYPES.BINARY: {
                const binary = await this.getAllData();
                return binary.buffer;
            }
            case node_value_types_1.VALUE_TYPES.ARRAY:
            case node_value_types_1.VALUE_TYPES.OBJECT: {
                // We need ALL data, including from child sub records
                const isArray = this.recordInfo.valueType === node_value_types_1.VALUE_TYPES.ARRAY;
                /**
                 * Convert include & exclude filters to PathInfo instances for easier handling
                 */
                const convertFilterArray = (arr) => {
                    const isNumber = (key) => /^[0-9]+$/.test(key);
                    return arr.map(path => acebase_core_1.PathInfo.get(isArray && isNumber(path) ? `[${path}]` : path));
                };
                const includeFilter = options.include ? options.include.some(item => item instanceof acebase_core_1.PathInfo) ? options.include : convertFilterArray(options.include) : [];
                const excludeFilter = options.exclude ? options.exclude.some(item => item instanceof acebase_core_1.PathInfo) ? options.exclude : convertFilterArray(options.exclude) : [];
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
                const isWildcardKey = (key) => typeof key === 'string' && (key === '*' || key[0] === '$');
                const hasWildcardInclude = includeFilter.length > 0 && includeFilter.some(pathInfo => pathInfo.keys.length === 1 && isWildcardKey(pathInfo.keys[0]));
                const hasChildIncludes = includeFilter.length > 0 && includeFilter.some(pathInfo => pathInfo.keys.length === 1 && !isWildcardKey(pathInfo.keys[0]));
                const isFiltered = (includeFilter.length > 0 && !hasWildcardInclude && includeFilter.some(pathInfo => pathInfo.keys.length === 1)) || (excludeFilter.length > 0 && excludeFilter.some(pathInfo => pathInfo.keys.length === 1)) || options.child_objects === false;
                const obj = isArray ? isFiltered ? new acebase_core_1.PartialArray() : [] : {};
                const streamOptions = {};
                if (includeFilter.length > 0 && !hasWildcardInclude && hasChildIncludes) {
                    const keyFilter = includeFilter
                        .filter(pathInfo => !isWildcardKey(pathInfo.keys[0])) // pathInfo.keys.length === 1 &&
                        .map(pathInfo => pathInfo.keys[0])
                        .reduce((keys, key) => (keys.includes(key) || keys.push(key)) && keys, []);
                    if (keyFilter.length > 0) {
                        streamOptions.keyFilter = keyFilter;
                    }
                }
                const loadChildValue = async (child) => {
                    let childLock;
                    try {
                        childLock = await this.storage.nodeLocker.lock(child.address.path, this.lock.tid, false, `NodeReader.getValue:child "/${child.address.path}"`);
                        // Are there any relevant nested includes / excludes?
                        // Fixed: nested bracket (index) include/exclude handling like '[3]/name'
                        const childOptions = {};
                        const getChildFilter = (filter) => {
                            return filter
                                .filter((pathInfo) => {
                                const key = pathInfo.keys[0];
                                return pathInfo.keys.length > 1 && (isWildcardKey(key) || (isArray && key === child.index) || (!isArray && key === child.key));
                            })
                                .map(pathInfo => acebase_core_1.PathInfo.get(pathInfo.keys.slice(1)));
                        };
                        if (includeFilter.length > 0) {
                            const include = getChildFilter(includeFilter);
                            if (include.length > 0) {
                                childOptions.include = include;
                            }
                        }
                        if (excludeFilter.length > 0) {
                            const exclude = getChildFilter(excludeFilter);
                            if (exclude.length > 0) {
                                childOptions.exclude = exclude;
                            }
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
                        this.storage.debug.error('NodeReader.getValue:child error: ', reason);
                        throw reason;
                    }
                    finally {
                        childLock && childLock.release();
                    }
                };
                try {
                    await this.getChildStream(streamOptions)
                        .next(child => {
                        const keyOrIndex = isArray ? child.index : child.key;
                        if (options.child_objects === false && [node_value_types_1.VALUE_TYPES.OBJECT, node_value_types_1.VALUE_TYPES.ARRAY].includes(child.type)) {
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
                        else if (typeof child.value !== 'undefined') {
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
             * @param callback callback function that is called with each chunk read. Reading will stop immediately when false is returned
             * @returns returns a promise that resolves when all data is read
             */
            async next(callback) {
                return read(callback);
            },
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
                    length: range.length,
                };
                let chunkLength = (chunk.length * bytesPerRecord);
                if (i === ranges.length - 1) {
                    chunkLength -= bytesPerRecord;
                    chunkLength += recordInfo.lastRecordLength;
                }
                totalBytes += chunkLength;
                if (i === 0 && chunk.length > 1) {
                    // Split, first chunk contains start data only
                    const remaining = chunk.length - 1;
                    chunk.length = 1;
                    chunks.push(chunk);
                    chunk = {
                        pageNr: chunk.pageNr,
                        recordNr: chunk.recordNr + 1,
                        length: remaining,
                    };
                }
                while (chunk.length > maxRecordsPerChunk) {
                    // Split so the chunk has maxRecordsPerChunk
                    const remaining = chunk.length - maxRecordsPerChunk;
                    chunk.length = maxRecordsPerChunk;
                    chunks.push(chunk);
                    chunk = {
                        pageNr: chunk.pageNr,
                        recordNr: chunk.recordNr + maxRecordsPerChunk,
                        length: remaining,
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
                headerLength,
            }) !== false);
            if (isLastChunk) {
                proceed = false;
            }
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
                    chunkIndex: index,
                    totalBytes,
                    hasKeyTree: hasKeyIndex,
                    fileIndex,
                    headerLength,
                }) !== false;
                if (isLastChunk) {
                    proceed = false;
                }
                index++;
            }
            return { valueType, chunks };
        };
        return generator;
    }
    /**
     * Starts reading this record, returns a generator that fires `.next` for each child key until the callback function returns false. The generator (.next) returns a promise that resolves when all child keys have been processed, or was cancelled because false was returned in the generator callback
     * @param options optional options: keyFilter specific keys to get, offers performance and memory improvements when searching specific keys
     * @returns returns a generator that is called for each child. return false from your `.next` callback to stop iterating
     */
    getChildStream(options = {}) {
        this._assertLock();
        let callback;
        let isAsync = false;
        let childCount = 0;
        const generator = {
            async next(cb, useAsync = false) {
                callback = cb;
                isAsync = useAsync;
                return start();
            },
        };
        let isArray = false;
        const start = async () => {
            if (this.recordInfo === null) {
                await this.readHeader();
            }
            isArray = this.recordInfo.valueType === node_value_types_1.VALUE_TYPES.ARRAY;
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
                    const isLastChunk = chunkIndex === chunks.length - 1;
                    return createStreamFromLinearData(data, isLastChunk); //, fileIndex
                });
            }
        };
        // Gets children from a indexed binary tree of key/value data
        const createStreamFromBinaryTree = async () => {
            const tree = new btree_1.BinaryBPlusTree({
                readFn: this._treeDataReader.bind(this),
                debug: this.storage.debug,
                id: `path:${this.address.path}`, // Prefix to fix #168
            });
            let canceled = false;
            if (options.keyFilter) {
                // Only get children for requested keys
                // for (let i = 0; i < options.keyFilter.length; i++) {
                //     const key = options.keyFilter[i];
                //     const value = await tree.find(key).catch(err => {
                //         console.error(`Error reading tree for node ${this.address}: ${err.message}`, err);
                //         throw err;
                //     });
                //     if (value === null) { continue; /* Key not found? */ }
                //     const childInfo = isArray ? new NodeInfo({ path: `${this.address.path}[${key}]`, index: key }) : new NodeInfo({ path: `${this.address.path}/${key}`, key });
                //     const res = getValueFromBinary(childInfo, value.recordPointer, 0);
                //     if (!res.skip) {
                //         let result = callback(childInfo, i);
                //         if (isAsync && result instanceof Promise) { result = await result; }
                //         canceled = result === false; // Keep going until callback returns false
                //         if (canceled) { break; }
                //     }
                // }
                // NEW: let B+Tree lookup all requested keys for drastic performance improvement, especially when all keys are new (> last key in tree)
                const results = await tree.findAll(options.keyFilter, { existingOnly: true });
                let i = 0;
                for (const { key, value } of results) {
                    const childInfo = isArray
                        ? new node_info_1.BinaryNodeInfo({ path: `${this.address.path}[${key}]`, index: key })
                        : new node_info_1.BinaryNodeInfo({ path: `${this.address.path}/${key}`, key: key });
                    const res = getValueFromBinary(childInfo, value.recordPointer, 0);
                    if (!res.skip) {
                        let result = callback(childInfo, i++);
                        if (isAsync && result instanceof Promise) {
                            result = await result;
                        }
                        canceled = result === false; // Keep going until callback returns false
                        if (canceled) {
                            break;
                        }
                    }
                }
            }
            else {
                // Loop the tree leafs, run callback for each child
                let leaf = await tree.getFirstLeaf();
                while (leaf) {
                    const children = leaf.entries.reduce((nodes, entry) => {
                        const child = isArray
                            ? new node_info_1.BinaryNodeInfo({ path: `${this.address.path}[${entry.key}]`, index: entry.key })
                            : new node_info_1.BinaryNodeInfo({ path: `${this.address.path}/${entry.key}`, key: entry.key });
                        const res = getValueFromBinary(child, entry.value.recordPointer, 0);
                        if (!res.skip) {
                            nodes.push(child);
                        }
                        return nodes;
                    }, []);
                    for (let i = 0; !canceled && i < children.length; i++) {
                        let result = callback(children[i], i);
                        if (isAsync && result instanceof Promise) {
                            result = await result;
                        }
                        canceled = result === false; // Keep going until callback returns false
                    }
                    leaf = !canceled && leaf.getNext ? await leaf.getNext() : null;
                }
            }
            return !canceled;
        };
        // To get values from binary data:
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
                    throw new Error('corrupt: removed child data isn\'t implemented yet');
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
                if (child.type === node_value_types_1.VALUE_TYPES.BOOLEAN) {
                    child.value = tinyValue === 1;
                }
                else if (child.type === node_value_types_1.VALUE_TYPES.NUMBER) {
                    child.value = tinyValue;
                }
                else if (child.type === node_value_types_1.VALUE_TYPES.BIGINT) {
                    child.value = BigInt(tinyValue);
                }
                else if (child.type === node_value_types_1.VALUE_TYPES.STRING) {
                    child.value = '';
                }
                else if (child.type === node_value_types_1.VALUE_TYPES.ARRAY) {
                    child.value = [];
                }
                else if (child.type === node_value_types_1.VALUE_TYPES.OBJECT) {
                    child.value = {};
                }
                else if (child.type === node_value_types_1.VALUE_TYPES.BINARY) {
                    child.value = new ArrayBuffer(0);
                }
                else if (child.type === node_value_types_1.VALUE_TYPES.REFERENCE) {
                    child.value = new acebase_core_1.PathReference('');
                }
                else {
                    throw new Error(`Tiny value deserialization method missing for value type ${child.type}`);
                }
            }
            else if (isInlineValue) {
                const length = (valueInfo & 63) + 1;
                assert(length);
                const bytes = binary.slice(index, index + length);
                if (child.type === node_value_types_1.VALUE_TYPES.NUMBER) {
                    child.value = bytesToNumber(bytes);
                }
                else if (child.type === node_value_types_1.VALUE_TYPES.BIGINT) {
                    child.value = bytesToBigint(bytes);
                }
                else if (child.type === node_value_types_1.VALUE_TYPES.STRING) {
                    child.value = decodeString(bytes); // textDecoder.decode(Uint8Array.from(bytes));
                }
                else if (child.type === node_value_types_1.VALUE_TYPES.DATETIME) {
                    const time = bytesToNumber(bytes);
                    child.value = new Date(time);
                }
                //else if (type === VALUE_TYPES.ID) { value = new ID(bytes); }
                else if (child.type === node_value_types_1.VALUE_TYPES.ARRAY) {
                    throw new Error('Inline array deserialization not implemented');
                }
                else if (child.type === node_value_types_1.VALUE_TYPES.OBJECT) {
                    throw new Error('Inline object deserialization not implemented');
                }
                else if (child.type === node_value_types_1.VALUE_TYPES.BINARY) {
                    child.value = new Uint8Array(bytes).buffer;
                }
                else if (child.type === node_value_types_1.VALUE_TYPES.REFERENCE) {
                    const path = decodeString(bytes); // textDecoder.decode(Uint8Array.from(bytes));
                    child.value = new acebase_core_1.PathReference(path);
                }
                else {
                    throw new Error(`Inline value deserialization method missing for value type ${child.type}`);
                }
                index += length;
            }
            else if (isRecordValue) {
                // Record address
                assert(6);
                if (typeof binary.buffer === 'undefined') {
                    binary = new Uint8Array(binary);
                }
                const view = new DataView(binary.buffer, binary.byteOffset + index, 6);
                const pageNr = view.getUint32(0);
                const recordNr = view.getUint16(4);
                const childPath = isArray ? `${this.address.path}[${child.index}]` : this.address.path === '' ? child.key : `${this.address.path}/${child.key}`;
                child.address = new node_address_1.BinaryNodeAddress(childPath, pageNr, recordNr);
                // Cache anything that comes along
                // TODO: Consider moving this to end of function so it caches small values as well
                if (this.updateCache) {
                    this.storage.updateCache(false, child, false);
                }
                if (child.address && child.address.equals(this.address)) {
                    throw new Error('Circular reference in record data');
                }
                index += 6;
            }
            else {
                throw new Error('corrupt');
            }
            //child.file.length = index - startIndex;
            return { index };
        };
        // Gets children from a chunk of data, linear key/value pairs:
        let incompleteData = null;
        const getChildrenFromChunk = (valueType, binary) => {
            if (incompleteData !== null) {
                //chunkStartIndex -= incompleteData.length;
                binary = concatTypedArrays(incompleteData, binary);
                incompleteData = null;
            }
            const children = [];
            if (valueType === node_value_types_1.VALUE_TYPES.OBJECT || valueType === node_value_types_1.VALUE_TYPES.ARRAY) {
                isArray = valueType === node_value_types_1.VALUE_TYPES.ARRAY;
                let index = 0;
                const assert = (bytes) => {
                    if (index + bytes > binary.length) { // binary.byteOffset + ... >
                        throw new AdditionalDataRequest();
                    }
                };
                // Index child keys or array indexes
                while (index < binary.length) {
                    const startIndex = index;
                    const child = new node_info_1.BinaryNodeInfo({});
                    try {
                        if (isArray) {
                            const childIndex = childCount; // childCount is now incremented at the end of try block, to avoid missing index(es) upon TruncatedDataErrors
                            child.path = acebase_core_1.PathInfo.getChildPath(this.address.path, childIndex);
                            child.index = childIndex;
                        }
                        else {
                            assert(2);
                            const keyIndex = (binary[index] & 128) === 0 ? -1 : (binary[index] & 127) << 8 | binary[index + 1];
                            if (keyIndex >= 0) {
                                child.key = this.storage.KIT.keys[keyIndex];
                                child.path = acebase_core_1.PathInfo.getChildPath(this.address.path, child.key);
                                index += 2;
                            }
                            else {
                                const keyLength = (binary[index] & 127) + 1;
                                index++;
                                assert(keyLength);
                                const key = decodeString(binary.slice(index, index + keyLength));
                                child.key = key;
                                child.path = acebase_core_1.PathInfo.getChildPath(this.address.path, key);
                                index += keyLength;
                            }
                        }
                        const res = getValueFromBinary(child, binary, index);
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
                    catch (err) {
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
        };
        const createStreamFromLinearData = async (chunkData, isLastChunk) => {
            const children = getChildrenFromChunk(this.recordInfo.valueType, chunkData); //, chunkStartIndex);
            let canceled = false;
            for (let i = 0; !canceled && i < children.length; i++) {
                const child = children[i];
                let result = callback(child, i);
                if (isAsync && result instanceof Promise) {
                    result = await result;
                }
                canceled = result === false; // Keep going until callback returns false
            }
            if (canceled || isLastChunk) {
                return false;
            }
        };
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
     * @param key key name or index number
     * @returns returns a Promise that resolves with BinaryNodeInfo of the child
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
        const childPath = acebase_core_1.PathInfo.getChildPath(this.address.path, key);
        return new node_info_1.BinaryNodeInfo(Object.assign(Object.assign(Object.assign({ path: childPath }, (typeof key === 'string' && { key: key })), (typeof key === 'number' && { index: key })), { exists: false }));
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
            offset: (headerLength + index) % recordSize,
        };
        const endRecord = {
            nr: Math.floor((headerLength + index + length) / recordSize),
            offset: (headerLength + index + length) % recordSize,
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
            const p = this.storage.writeData(fIndex, binary, bOffset, bLength);
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
            offset: (headerLength + index) % recordSize,
        };
        const endRecord = {
            nr: Math.floor((headerLength + index + length) / recordSize),
            offset: (headerLength + index + length) % recordSize,
        };
        const readRecords = this.recordInfo.allocation.addresses.slice(startRecord.nr, endRecord.nr + 1);
        if (readRecords.length === 0) {
            throw new Error(`Attempt to read non-existing records of path "/${this.recordInfo.path}": ${startRecord.nr} to ${endRecord.nr + 1} ` +
                `for index ${index} + ${length} bytes. Node has ${this.recordInfo.allocation.addresses.length} allocated records ` +
                `in the following ranges: ` + this.recordInfo.allocation.toString());
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
            const p = this.storage.readData(fIndex, binary, bOffset, bLength);
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
        if (bytesRead < bytesPerRecord) {
            throw new Error(`Not enough bytes read from file at index ${fileIndex}, expected ${bytesPerRecord} but got ${bytesRead}`);
        }
        const hasKeyIndex = (data[0] & FLAG_KEY_TREE) === FLAG_KEY_TREE;
        const valueType = (data[0] & FLAG_VALUE_TYPE); // Last 4-bits of first byte of read data has value type
        // Read Chunk Table
        let view = new DataView(data.buffer);
        let offset = 1;
        const firstRange = new StorageAddressRange(this.address.pageNr, this.address.recordNr, 1);
        /** @type {StorageAddressRange[]} */
        const ranges = [firstRange];
        const allocation = new NodeAllocation(ranges);
        let readingRecordIndex = 0;
        let done = false;
        while (!done) {
            if (offset + 9 + 2 >= data.length) {
                // Read more data (next record)
                readingRecordIndex++;
                const address = allocation.addresses[readingRecordIndex];
                const fileIndex = this.storage.getRecordFileIndex(address.pageNr, address.recordNr);
                const moreData = new Uint8Array(bytesPerRecord);
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
        this.recordInfo = new RecordInfo(this.address.path, hasKeyIndex, valueType, allocation, headerLength, lastRecordDataLength, bytesPerRecord, data.slice(headerLength, headerLength + firstRecordDataLength));
        return this.recordInfo;
    }
    getChildTree() {
        if (this.recordInfo === null) {
            throw new Error('record info hasn\'t been read yet');
        }
        if (!this.recordInfo.hasKeyIndex) {
            throw new Error('record has no key index tree');
        }
        return new btree_1.BinaryBPlusTree({
            readFn: this._treeDataReader.bind(this),
            chunkSize: 1024 * 100,
            writeFn: this._treeDataWriter.bind(this),
            debug: this.storage.debug,
            id: 'record@' + this.recordInfo.address.toString(),
        });
    }
}
/**
 * Merges an existing node with given updates
 */
async function _mergeNode(storage, nodeInfo, updates, lock) {
    if (typeof updates !== 'object') {
        throw new TypeError('updates parameter must be an object');
    }
    let nodeReader = new NodeReader(storage, nodeInfo.address, lock, false);
    const affectedKeys = Object.keys(updates);
    const changes = new node_changes_1.NodeChangeTracker(nodeInfo.path);
    const discardAllocation = new NodeAllocation([]);
    let isArray = false;
    let isInternalUpdate = false;
    let recordInfo = await nodeReader.readHeader();
    isArray = recordInfo.valueType === node_value_types_1.VALUE_TYPES.ARRAY;
    nodeInfo.type = recordInfo.valueType; // Set in nodeInfo too, because it might be unknown
    let recordMoved = false;
    const done = (newRecordInfo) => {
        if (newRecordInfo !== nodeReader.recordInfo) {
            // release the old record allocation
            discardAllocation.ranges.push(...nodeReader.recordInfo.allocation.ranges);
            recordMoved = true;
        }
        // Necessary?
        storage.updateCache(false, new node_info_1.BinaryNodeInfo({ path: nodeInfo.path, type: nodeInfo.type, address: newRecordInfo.address, exists: true }), recordMoved);
        return { recordMoved, recordInfo: newRecordInfo, deallocate: discardAllocation };
    };
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
                .then(async (childLock) => {
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
        storage.debug.log(`No effective changes to update node "/${nodeInfo.path}" with`.colorize(acebase_core_1.ColorStyle.yellow));
        return done(nodeReader.recordInfo);
    }
    if (isArray) {
        // Check if resulting array is dense: every item must have a value, no gaps allowed
        const getSequenceInfo = (changes) => {
            const indice = changes.map(ch => ch.keyOrIndex).sort(); // sorted from low index to high index
            const gaps = indice.map((_, i, arr) => i === 0 ? 0 : arr[i - 1] - arr[i]);
            return { indice, hasGaps: gaps.some(g => g > 1) };
        };
        const deleteSeqInfo = getSequenceInfo(changes.deletes);
        const insertSeqInfo = getSequenceInfo(changes.inserts);
        let isSparse = deleteSeqInfo.hasGaps || deleteSeqInfo.hasGaps;
        if (!isSparse && changes.deletes.length > 0) {
            // Only allow deletes at the end of an array, check if is there's an entry with a higher index
            const highestIndex = deleteSeqInfo.indice.slice(-1)[0];
            const nextEntryInfo = await nodeReader.getChildInfo(highestIndex + 1);
            if (nextEntryInfo.exists) {
                isSparse = true;
            }
        }
        if (!isSparse && changes.inserts.length > 0) {
            // Only allow inserts at the end of an array, check if there's an entry with a lower index
            const lowestIndex = insertSeqInfo.indice[0];
            if (lowestIndex > 0) {
                const prevEntryInfo = await nodeReader.getChildInfo(lowestIndex - 1);
                if (!prevEntryInfo.exists) {
                    isSparse = true;
                }
            }
        }
        if (isSparse) {
            throw new Error(`Elements cannot be inserted beyond, or removed before the end of an array. Rewrite the whole array at path "${nodeInfo.path}" or change your schema to use an object collection instead`);
        }
    }
    const maxDebugItems = 10;
    storage.debug.log(`Node "/${nodeInfo.path}" being updated:${isInternalUpdate ? ' (internal)' : ''} adding ${changes.inserts.length} keys (${changes.inserts.slice(0, maxDebugItems).map(ch => `"${ch.keyOrIndex}"`).join(',')}${changes.inserts.length > maxDebugItems ? '...' : ''}), updating ${changes.updates.length} keys (${changes.updates.slice(0, maxDebugItems).map(ch => `"${ch.keyOrIndex}"`).join(',')}${changes.updates.length > maxDebugItems ? '...' : ''}), removing ${changes.deletes.length} keys (${changes.deletes.slice(0, maxDebugItems).map(ch => `"${ch.keyOrIndex}"`).join(',')}${changes.deletes.length > maxDebugItems ? '...' : ''})`.colorize(acebase_core_1.ColorStyle.cyan));
    if (!isInternalUpdate) {
        // Update cache (remove entries or mark them as deleted)
        // const pathInfo = PathInfo.get(nodeInfo.path);
        // const invalidatePaths = changes.all
        //     .filter(ch => !(ch.newValue instanceof InternalNodeReference))
        //     .map(ch => {
        //         const childPath = pathInfo.childPath(ch.keyOrIndex);
        //         return {
        //             path: childPath,
        //             pathInfo: PathInfo.get(childPath),
        //             action: ch.changeType === NodeChange.CHANGE_TYPE.DELETE ? 'delete' : 'invalidate'
        //         };
        //     });
        // storage.invalidateCache(false, nodeInfo.path, false, 'mergeNode');
        // invalidatePaths.forEach(item => {
        //     if (item.action === 'invalidate') { storage.invalidateCache(false, item.path, true, 'mergeNode'); }
        //     else { storage.nodeCache.delete(item.path); }
        // });
        const inv = changes.all
            .filter(ch => !(ch.newValue instanceof InternalNodeReference))
            .reduce((obj, ch) => {
            obj[ch.keyOrIndex] = ch.changeType === node_changes_1.NodeChange.CHANGE_TYPE.DELETE ? 'delete' : 'invalidate';
            return obj;
        }, {});
        storage.invalidateCache(false, nodeInfo.path, inv, 'mergeNode');
    }
    // What we need to do now is make changes to the actual record data.
    // The record is either a binary B+Tree (larger records),
    // or a list of key/value pairs (smaller records).
    // let updatePromise;
    let newRecordInfo;
    if (nodeReader.recordInfo.hasKeyIndex) {
        // Try to have the binary B+Tree updated. If there is not enough free space for this
        // (eg, if a leaf to add to is full), we have to rebuild the whole tree and write new records
        const pathInfo = acebase_core_1.PathInfo.get(nodeInfo.path);
        const childPromises = [];
        for (const change of changes.all) {
            // changes.all.forEach(change => {
            const childPath = pathInfo.childPath(change.keyOrIndex); //PathInfo.getChildPath(nodeInfo.path, change.keyOrIndex);
            if (change.oldValue !== null) {
                const kvp = _serializeValue(storage, childPath, change.keyOrIndex, change.oldValue, null);
                if (!(kvp instanceof SerializedKeyValue)) {
                    throw new Error('return value must be of type SerializedKeyValue, it cannot be a Promise!');
                }
                const bytes = _getValueBytes(kvp);
                change.oldValue = bytes;
            }
            if (change.newValue !== null) {
                const s = _serializeValue(storage, childPath, change.keyOrIndex, change.newValue, lock.tid);
                const convert = (kvp) => {
                    const bytes = _getValueBytes(kvp);
                    change.newValue = bytes;
                };
                if (s instanceof Promise) {
                    childPromises.push(s.then(convert));
                }
                else {
                    convert(s);
                }
            }
            // if (childPromises.length === 100) {
            //     // Too many promises. Wait before continuing?
            //     await Promise.all(childPromises.splice(0));
            // }
        } //);
        const operations = [];
        let tree = nodeReader.getChildTree();
        await Promise.all(childPromises);
        changes.deletes.forEach(change => {
            const op = btree_1.BinaryBPlusTree.TransactionOperation.remove(change.keyOrIndex, change.oldValue);
            operations.push(op);
        });
        changes.updates.forEach(change => {
            const oldEntryValue = new btree_1.BinaryBPlusTree.EntryValue(change.oldValue);
            const newEntryValue = new btree_1.BinaryBPlusTree.EntryValue(change.newValue);
            const op = btree_1.BinaryBPlusTree.TransactionOperation.update(change.keyOrIndex, newEntryValue, oldEntryValue);
            operations.push(op);
        });
        changes.inserts.forEach(change => {
            const op = btree_1.BinaryBPlusTree.TransactionOperation.add(change.keyOrIndex, change.newValue);
            operations.push(op);
        });
        // Changed behaviour:
        // previously, if 1 operation failed, the tree was rebuilt. If any operation thereafter failed, it stopped processing
        // now, processOperations() will be called after each rebuild, so all operations will be processed
        const opCountsLog = [], fixHistory = [];
        const processOperations = async (retry = 0) => {
            if (retry > 2 && operations.length === opCountsLog[opCountsLog.length - 1]) {
                // Number of pending operations did not decrease after 2 possible tree fixes
                throw new Error(`DEV: Applied tree fixes did not change ${operations.length} pending operation(s) failing to execute. Debug this, check fixHistory!`);
            }
            opCountsLog.push(operations.length);
            try {
                await tree.transaction(operations);
                storage.debug.log(`Updated tree for node "/${nodeInfo.path}"`.colorize(acebase_core_1.ColorStyle.green));
                return recordInfo; // We do our own cleanup, return current allocation which is always the same as nodeReader.recordInfo
            }
            catch (err) {
                storage.debug.log(`Could not update tree for "/${nodeInfo.path}"${retry > 0 ? ` (retry ${retry})` : ''}: ${err.message}, ${err.codes}`.colorize(acebase_core_1.ColorStyle.yellow));
                if (err.hasErrorCode && err.hasErrorCode('tree-full-no-autogrow')) {
                    storage.debug.verbose('Tree needs more space');
                    const growBytes = Math.ceil(tree.info.byteLength * 0.1); // grow 10%
                    const bytesRequired = tree.info.byteLength + growBytes;
                    fixHistory.push({ err, fix: 'grow', from: tree.info.byteLength, to: bytesRequired, growBytes });
                    // Copy from original allocation to new allocation
                    let sourceIndex = 0;
                    const originalLength = tree.info.byteLength;
                    const reader = async (length) => {
                        let data;
                        if (sourceIndex > originalLength) {
                            // 0s only
                            data = new Uint8Array(length);
                        }
                        else {
                            const readLength = sourceIndex + length < originalLength ? length : originalLength - sourceIndex;
                            data = await nodeReader._treeDataReader(sourceIndex, readLength);
                            if (data.length < length) {
                                // Append 0s
                                data = concatTypedArrays(new Uint8Array(data), new Uint8Array(length - data.length));
                            }
                            else if (data.length > length) {
                                // cut off unrequested bytes. TODO: check _treeDataReader logic
                                data = data.slice(0, length);
                            }
                        }
                        if (sourceIndex === 0) {
                            // Overwrite allocation bytes with new sizes.
                            // Doing this in-memory helps prevent issue #183, if writing the new tree fails because of a storage issue
                            tree.setAllocationBytes(data, bytesRequired, tree.info.freeSpace + growBytes);
                        }
                        sourceIndex += data.byteLength;
                        return data;
                    };
                    recordInfo = await _write(storage, nodeInfo.path, nodeReader.recordInfo.valueType, bytesRequired, true, reader, nodeReader.recordInfo);
                }
                else {
                    // Failed to update the binary data, we need to rebuild the tree
                    storage.debug.verbose(`B+Tree for path ${nodeInfo.path} needs rebuild`);
                    fixHistory.push({ err, fix: 'rebuild' });
                    recordInfo = await _rebuildKeyTree(tree, nodeReader, { reserveSpaceForNewEntries: changes.inserts.length - changes.deletes.length });
                }
                if (recordInfo !== nodeReader.recordInfo) {
                    // release previous allocation
                    discardAllocation.ranges.push(...nodeReader.recordInfo.allocation.ranges);
                    recordMoved = true;
                }
                // Create new node reader and new tree
                nodeReader = new NodeReader(storage, recordInfo.address, lock, false);
                recordInfo = await nodeReader.readHeader();
                tree = new btree_1.BinaryBPlusTree({
                    readFn: nodeReader._treeDataReader.bind(nodeReader),
                    chunkSize: 1024 * 100,
                    writeFn: nodeReader._treeDataWriter.bind(nodeReader),
                    debug: storage.debug,
                    id: 'record@' + nodeReader.recordInfo.address.toString(),
                });
                // // Retry remaining operations
                return processOperations(retry + 1);
            }
        };
        newRecordInfo = await processOperations();
    }
    else {
        // This is a small record. In the future, it might be nice to make changes
        // in the record itself, but let's just rewrite it for now.
        // Record (de)allocation is managed by _writeNode
        const mergedValue = isArray ? [] : {};
        await nodeReader.getChildStream()
            .next(child => {
            const keyOrIndex = isArray ? child.index : child.key;
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
 * Creates or overwrites a node
 */
async function _createNode(storage, nodeInfo, newValue, lock, invalidateCache = true) {
    storage.debug.log(`Node "/${nodeInfo.path}" is being ${nodeInfo.exists ? 'overwritten' : 'created'}`.colorize(acebase_core_1.ColorStyle.cyan));
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
async function _lockAndWriteNode(storage, path, value, parentTid) {
    const lock = await storage.nodeLocker.lock(path, parentTid.toString(), true, `_lockAndWrite "${path}"`);
    try {
        const recordInfo = await _writeNode(storage, path, value, lock);
        return recordInfo;
    }
    finally {
        lock.release();
    }
}
async function _writeNode(storage, path, value, lock, currentRecordInfo) {
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
    if (typeof value === 'string') {
        return write(node_value_types_1.VALUE_TYPES.STRING, encodeString(value));
    }
    else if (typeof value === 'bigint') {
        return write(node_value_types_1.VALUE_TYPES.BIGINT, bigintToBytes(value)); // better called "HugeInt" if it has to be stored in its own record!
    }
    else if (value instanceof acebase_core_1.PathReference) {
        return write(node_value_types_1.VALUE_TYPES.REFERENCE, encodeString(value.path));
    }
    else if (value instanceof ArrayBuffer) {
        return write(node_value_types_1.VALUE_TYPES.BINARY, new Uint8Array(value));
    }
    else if (typeof value !== 'object') {
        throw new TypeError('Unsupported type to store in stand-alone record');
    }
    // Store array or object
    const childPromises = [];
    const serialized = [];
    const isArray = value instanceof Array;
    if (isArray) {
        // Store array
        const isExhaustive = Object.keys(value).every((key, i) => +key === i && value[i] !== null); // Test if there are no gaps in the array
        if (!isExhaustive) {
            throw new Error('Cannot store arrays with missing entries');
        }
        value.forEach((val, index) => {
            if (typeof val === 'function') {
                throw new Error(`Array at index ${index} has invalid value. Cannot store functions`);
            }
            const childPath = `${path}[${index}]`;
            const s = _serializeValue(storage, childPath, index, val, lock.tid);
            const add = (s) => {
                serialized[index] = s; // Fixed: Array order getting messed up (with serialized.push after promises resolving)
            };
            if (s instanceof Promise) {
                childPromises.push(s.then(add));
            }
            else {
                add(s);
            }
        });
    }
    else {
        // Store object
        Object.keys(value).forEach(key => {
            if (/[\x00-\x08\x0b\x0c\x0e-\x1f/[\]\\]/.test(key)) {
                throw new Error(`Invalid key "${key}" for object to store at path "${path}". Keys cannot contain control characters or any of the following characters: \\ / [ ]`);
            }
            if (key.length > 128) {
                throw new Error(`Key "${key}" is too long to store for object at path "${path}". Max key length is 128`);
            }
            if (key.length === 0) {
                throw new Error(`Child key for path "${path}" is not allowed be empty`);
            }
            const childPath = acebase_core_1.PathInfo.getChildPath(path, key); // `${path}/${key}`;
            const val = value[key];
            if (typeof val === 'function' || val === null) {
                return; // Skip functions and null values
            }
            else if (typeof val === 'undefined') {
                if (storage.settings.removeVoidProperties === true) {
                    delete value[key]; // Kill the property in the passed object as well, to prevent differences in stored and working values
                    return;
                }
                else {
                    throw new Error(`Property "${key}" has invalid value. Cannot store undefined values. Set removeVoidProperties option to true to automatically remove undefined properties`);
                }
            }
            else {
                const s = _serializeValue(storage, childPath, key, val, lock.tid);
                const add = (s) => {
                    serialized.push(s);
                };
                if (s instanceof Promise) {
                    childPromises.push(s.then(add));
                }
                else {
                    add(s);
                }
            }
        });
    }
    await Promise.all(childPromises);
    // Append all serialized data into 1 binary array
    let result;
    const minKeysForTreeCreation = 100;
    if (serialized.length > minKeysForTreeCreation) {
        // Create a B+tree
        const fillFactor = isArray || serialized.every(kvp => typeof kvp.key === 'string' && /^[0-9]+$/.test(kvp.key))
            ? BINARY_TREE_FILL_FACTOR_50
            : BINARY_TREE_FILL_FACTOR_95;
        const treeBuilder = new btree_1.BPlusTreeBuilder(true, fillFactor);
        serialized.forEach(kvp => {
            const binaryValue = _getValueBytes(kvp);
            treeBuilder.add(isArray ? kvp.index : kvp.key, binaryValue);
        });
        const builder = new binary_1.Uint8ArrayBuilder();
        await treeBuilder.create().toBinary(true, btree_1.BinaryWriter.forUint8ArrayBuilder(builder));
        // // Test tree
        // await BinaryBPlusTree.test(bytes)
        result = { keyTree: true, data: builder.data };
    }
    else {
        const builder = new binary_1.Uint8ArrayBuilder();
        serialized.forEach(kvp => {
            if (!isArray) {
                const keyIndex = storage.KIT.getOrAdd(kvp.key); // Gets KIT index for this key
                // key_info:
                if (keyIndex >= 0) {
                    // Cached key name
                    builder.writeByte(128 // key_indexed = 1
                        | ((keyIndex >> 8) & 127));
                    builder.writeByte(keyIndex & 255);
                }
                else {
                    // Inline key name
                    const keyBytes = encodeString(kvp.key);
                    builder.writeByte(keyBytes.byteLength - 1); // key_length
                    builder.append(keyBytes); // key_name
                }
            }
            // const binaryValue = _getValueBytes(kvp);
            // builder.append(binaryValue);
            _writeBinaryValue(kvp, builder);
        });
        result = { keyTree: false, data: builder.data };
    }
    // Now write the record
    return write(isArray ? node_value_types_1.VALUE_TYPES.ARRAY : node_value_types_1.VALUE_TYPES.OBJECT, result.data, result.keyTree);
}
// TODO @appy-one consider converting to interface
class SerializedKeyValue {
    constructor(info) {
        this.key = info.key;
        this.index = info.index;
        this.type = info.type;
        this.bool = info.bool;
        this.ref = info.ref;
        this.binary = info.binary;
        this.record = info.record; // TODO @appy-one RENAME to address
        this.bytes = info.bytes;
    }
}
function _getValueBytes(kvp) {
    return _writeBinaryValue(kvp).data;
}
/**
 * @param builder optional builder to append data to
 * @returns returns the used builder
 */
function _writeBinaryValue(kvp, builder = new binary_1.Uint8ArrayBuilder(null, 64)) {
    const startIndex = builder.length;
    // value_type:
    builder.push(kvp.type << 4); // tttt0000
    // tiny_value?:
    let tinyValue = -1;
    if (kvp.type === node_value_types_1.VALUE_TYPES.BOOLEAN) {
        tinyValue = kvp.bool ? 1 : 0;
    }
    else if (kvp.type === node_value_types_1.VALUE_TYPES.NUMBER && kvp.ref >= 0 && kvp.ref <= 15 && Math.floor(kvp.ref) === kvp.ref) {
        tinyValue = kvp.ref;
    }
    else if (kvp.type === node_value_types_1.VALUE_TYPES.BIGINT && kvp.ref >= BigInt(0) && kvp.ref <= BigInt(15)) {
        tinyValue = Number(kvp.ref);
    }
    else if (kvp.type === node_value_types_1.VALUE_TYPES.STRING && kvp.binary && kvp.binary.length === 0) {
        tinyValue = 0;
    }
    else if (kvp.type === node_value_types_1.VALUE_TYPES.ARRAY && kvp.ref.length === 0) {
        tinyValue = 0;
    }
    else if (kvp.type === node_value_types_1.VALUE_TYPES.OBJECT && Object.keys(kvp.ref).length === 0) {
        tinyValue = 0;
    }
    else if (kvp.type === node_value_types_1.VALUE_TYPES.BINARY && kvp.ref.byteLength === 0) {
        tinyValue = 0;
    }
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
        const length = 'byteLength' in data ? data.byteLength : data.length;
        builder.push(128 // 10000000 --> inline value
            | (length - 1));
        if (data instanceof ArrayBuffer) {
            data = new Uint8Array(data);
        }
        builder.append(data);
        // End
    }
    return builder;
}
function _serializeValue(storage, path, keyOrIndex, val, parentTid) {
    const missingTidMessage = 'Need to create a new record, but the parentTid is not given';
    const create = (details) => {
        if (typeof keyOrIndex === 'number') {
            details.index = keyOrIndex;
        }
        else {
            details.key = keyOrIndex;
        }
        details.ref = val;
        return new SerializedKeyValue(details);
    };
    if (val instanceof Date) {
        // Store as 64-bit (8 byte) signed integer.
        // NOTE: 53 bits seem to the max for the Date constructor in Chrome browser,
        // although higher dates can be constructed using specific year,month,day etc
        // NOTE: Javascript Numbers seem to have a max "safe" value of (2^53)-1 (Number.MAX_SAFE_INTEGER),
        // this is because the other 12 bits are used for sign (1 bit) and exponent.
        // See https://stackoverflow.com/questions/9939760/how-do-i-convert-an-integer-to-binary-in-javascript
        const ms = val.getTime();
        const bytes = numberToBytes(ms);
        return create({ type: node_value_types_1.VALUE_TYPES.DATETIME, bytes });
    }
    else if (val instanceof Array) {
        // Create separate record for the array
        if (val.length === 0) {
            return create({ type: node_value_types_1.VALUE_TYPES.ARRAY, bytes: [] });
        }
        console.assert(parentTid, missingTidMessage);
        return _lockAndWriteNode(storage, path, val, parentTid)
            .then(recordInfo => {
            return create({ type: node_value_types_1.VALUE_TYPES.ARRAY, record: recordInfo.address });
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
                return create({ type: node_value_types_1.VALUE_TYPES.BINARY, record: recordInfo.address });
            });
        }
        else {
            return create({ type: node_value_types_1.VALUE_TYPES.BINARY, bytes: val });
        }
    }
    else if (val instanceof acebase_core_1.PathReference) {
        const encoded = encodeString(val.path); // textEncoder.encode(val.path);
        if (encoded.length > storage.settings.maxInlineValueSize) {
            // Create seperate record for this string value
            console.assert(parentTid, missingTidMessage);
            return _lockAndWriteNode(storage, path, val, parentTid)
                .then(recordInfo => {
                return create({ type: node_value_types_1.VALUE_TYPES.REFERENCE, record: recordInfo.address });
            });
        }
        else {
            // Small enough to store inline
            return create({ type: node_value_types_1.VALUE_TYPES.REFERENCE, binary: encoded });
        }
    }
    else if (typeof val === 'object') {
        if (Object.keys(val).length === 0) {
            // Empty object (has no properties), can be stored inline
            return create({ type: node_value_types_1.VALUE_TYPES.OBJECT, bytes: [] });
        }
        // Create seperate record for this object
        console.assert(parentTid, missingTidMessage);
        return _lockAndWriteNode(storage, path, val, parentTid)
            .then(recordInfo => {
            return create({ type: node_value_types_1.VALUE_TYPES.OBJECT, record: recordInfo.address });
        });
    }
    else if (typeof val === 'number') {
        const bytes = numberToBytes(val);
        return create({ type: node_value_types_1.VALUE_TYPES.NUMBER, bytes });
    }
    else if (typeof val === 'bigint') {
        const bytes = bigintToBytes(val);
        return create({ type: node_value_types_1.VALUE_TYPES.BIGINT, bytes });
    }
    else if (typeof val === 'boolean') {
        return create({ type: node_value_types_1.VALUE_TYPES.BOOLEAN, bool: val });
    }
    else {
        // This is a string or something we don't know how to serialize
        if (typeof val !== 'string') {
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
                return create({ type: node_value_types_1.VALUE_TYPES.STRING, record: recordInfo.address });
            });
        }
        else {
            // Small enough to store inline
            return create({ type: node_value_types_1.VALUE_TYPES.STRING, binary: encoded });
        }
    }
}
async function _write(storage, path, type, length, hasKeyTree, reader, currentRecordInfo) {
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
    let headerByteLength = 0, totalBytes = 0, requiredRecords = 0, lastChunkSize = 0;
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
        const wholePages = Math.floor(requiredRecords / storage.settings.pageSize);
        const remainingRecords = requiredRecords % storage.settings.pageSize;
        const maxChunks = Math.max(0, wholePages) + Math.min(storage.FST.maxScraps, remainingRecords);
        calculateStorageNeeds(maxChunks);
    }
    // Request storage space for these records
    const useExistingAllocation = currentRecordInfo && currentRecordInfo.allocation.totalAddresses === requiredRecords;
    const ranges = useExistingAllocation
        ? currentRecordInfo.allocation.ranges
        : await storage.FST.allocate(requiredRecords);
    let allocation = new NodeAllocation(ranges);
    !useExistingAllocation && storage.debug.verbose(`Allocated ${allocation.totalAddresses} addresses for node "/${path}": ${allocation}`.colorize(acebase_core_1.ColorStyle.grey));
    calculateStorageNeeds(allocation.ranges.length);
    if (requiredRecords < allocation.totalAddresses) {
        const addresses = allocation.addresses;
        const deallocate = addresses.splice(requiredRecords);
        storage.debug.verbose(`Requested ${deallocate.length} too many addresses to store node "/${path}", releasing them`.colorize(acebase_core_1.ColorStyle.grey));
        storage.FST.release(NodeAllocation.fromAdresses(deallocate).ranges);
        allocation = NodeAllocation.fromAdresses(addresses);
        calculateStorageNeeds(allocation.ranges.length);
    }
    // Build the binary header data
    const header = new Uint8Array(headerByteLength);
    const headerView = new DataView(header.buffer, 0, header.length);
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
            throw 'Unsupported range type';
        }
    });
    headerView.setUint8(offset, 0); // ct_type 0 (end of CT), 1 byte
    offset++;
    headerView.setUint16(offset, lastChunkSize); // last_chunk_size, 2 bytes
    offset += 2;
    let bytesRead = 0;
    const readChunk = async (length) => {
        let headerBytes;
        if (bytesRead < header.byteLength) {
            headerBytes = header.slice(bytesRead, bytesRead + length);
            bytesRead += headerBytes.byteLength;
            length -= headerBytes.byteLength;
            if (length === 0) {
                return headerBytes;
            }
        }
        let dataBytes = reader(length);
        if (dataBytes instanceof Promise) {
            dataBytes = await dataBytes;
        }
        if (dataBytes instanceof Array) {
            dataBytes = Uint8Array.from(dataBytes);
        }
        else if (!(dataBytes instanceof Uint8Array)) {
            throw new Error('bytes must be Uint8Array or plain byte Array');
        }
        bytesRead += dataBytes.byteLength;
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
                throw new Error('fileIndex is NaN!!');
            }
            let bytesWritten = promise ? await promise : 0;
            const data = await readChunk(range.length * bytesPerRecord);
            bytesWritten += data.byteLength;
            await storage.writeData(fileIndex, data);
            return bytesWritten;
        }, null);
        const chunks = chunkTable.ranges.length;
        const address = new node_address_1.BinaryNodeAddress(path, allocation.ranges[0].pageNr, allocation.ranges[0].recordNr);
        const nodeInfo = new node_info_1.BinaryNodeInfo({ path, type, exists: true, address });
        storage.updateCache(false, nodeInfo, true); // hasMoved?
        storage.debug.log(`Node "/${address.path}" saved at address ${address.pageNr},${address.recordNr} - ${allocation.totalAddresses} addresses, ${bytesWritten} bytes written in ${chunks} chunk(s)`.colorize(acebase_core_1.ColorStyle.green));
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
        if (address.path === '') {
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
async function _rebuildKeyTree(tree, nodeReader, options) {
    const storage = nodeReader.storage;
    const path = nodeReader.address.path;
    const tempFilepath = `${storage.settings.path}/${storage.name}.acebase/tree-${acebase_core_1.ID.generate()}.tmp`;
    let bytesWritten = 0;
    const fd = await promise_fs_1.pfs.open(tempFilepath, promise_fs_1.pfs.flags.readAndWriteAndCreate);
    const writer = btree_1.BinaryWriter.forFunction(async (data, index) => {
        await promise_fs_1.pfs.write(fd, data, 0, data.length, index);
        bytesWritten += data.length;
    });
    await tree.rebuild(writer, options);
    // Now write the record with data read from the temp file
    let readOffset = 0;
    const reader = async (length) => {
        const buffer = new Uint8Array(length);
        const { bytesRead } = await promise_fs_1.pfs.read(fd, buffer, 0, buffer.length, readOffset);
        readOffset += bytesRead;
        if (bytesRead < length) {
            return buffer.slice(0, bytesRead); // throw new Error(`Failed to read ${length} bytes from file, only got ${bytesRead}`);
        }
        return buffer;
    };
    const newRecordInfo = await _write(storage, path, nodeReader.recordInfo.valueType, bytesWritten, true, reader, nodeReader.recordInfo);
    console.assert(newRecordInfo.allocation.totalAddresses * newRecordInfo.bytesPerRecord >= bytesWritten, `insufficient space allocated for tree of path ${path}: ${newRecordInfo.allocation.totalAddresses} records for ${bytesWritten} bytes`);
    // Close and remove the tmp file, don't wait for this
    promise_fs_1.pfs.close(fd)
        .then(() => promise_fs_1.pfs.rm(tempFilepath))
        .catch(err => {
        // Error removing the file?
        storage.debug.error(`Can't remove temp rebuild file ${tempFilepath}: `, err);
    });
    return newRecordInfo;
}
class InternalNodeReference {
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
//# sourceMappingURL=index.js.map