import * as fs from 'fs';
import { NodeCache } from '../../node-cache.js';
import { AceBaseStorageSettings } from './binary-storage-settings.js';
import { InternalDataRetrievalOptions, IWriteNodeResult, Storage, StorageEnv } from '../index.js';
import { BinaryNodeInfo } from './node-info.js';
import { ID, PathInfo, Utils, ColorStyle } from 'acebase-core';
import { StorageAddressRange } from './binary-storage-address-range.js';
import { BinaryNodeAddress } from './node-address.js';
import { pfs } from '../../promise-fs/index.js';
import { VALUE_TYPES } from '../../node-value-types.js';
import { CorruptRecordError, NodeReader } from './node-reader.js';
import { _serializeValue } from './node-writer/serialize-value.js';
import { InternalNodeReference } from './internal-node-reference.js';
import { _getValueBytes } from './node-writer/get-value-bytes.js';
import { BinaryBPlusTree } from '../../btree/index.js';
import { _writeNode } from './node-writer/write-node.js';
import { _rebuildKeyTree } from './node-writer/rebuild-key-tree.js';
import { NodeAllocation } from './node-allocation.js';
import { SerializedKeyValue } from './serialized-key-value.js';
import { NodeNotFoundError } from '../../node-errors.js';
import { _mergeNode } from './node-writer/merge-node.js';
import { _createNode } from './node-writer/create-node.js';

const { concatTypedArrays, encodeString, decodeString, cloneObject } = Utils;

export interface IAppliedMutations {
    path: string;
    list: Array<{ target: (string|number)[], prev: any, val: any }>;
}

export class AceBaseStorage extends Storage {

    settings: AceBaseStorageSettings;
    stats: {
        writes: number;
        reads: number;
        bytesRead: number;
        bytesWritten: number;
    };

    type: AceBaseStorageSettings['type'];

    private txStorage?: AceBaseStorage;
    private _ready = false;
    private file: number;

    nodeCache: NodeCache = new NodeCache();

    /**
     * Stores data in a binary file
     */
    constructor(name: string, settings: AceBaseStorageSettings, env: StorageEnv) {
        console.assert(settings instanceof AceBaseStorageSettings, 'settings must be an instance of AceBaseStorageSettings');
        super(name, settings, env);

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
            this.txStorage = new AceBaseStorage(name, txSettings, { logLevel: 'error', logColors: false, logger: this.logger });
        }

        this.once('ready', () => {
            this._ready = true;
        });

        // Setup cluster functionality
        this.ipc.on('request', async message => {
            // Master functionality: handle requests from workers

            console.assert(this.ipc.isMaster, 'Workers should not receive requests');
            const request = message.data;
            const reply = (result: any) => {
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
                    const nodeInfo = new BinaryNodeInfo(notification.info);
                    nodeInfo.address = new BinaryNodeAddress(nodeInfo.address.path, nodeInfo.address.pageNr, nodeInfo.address.recordNr);
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
            keys: [] as string[],
        };
        this.KIT = {
            get fileIndex() { return KIT.fileIndex; },
            get length() { return KIT.length; },
            get bytesUsed() { return KIT.bytesUsed; },
            get keys() { return KIT.keys; },

            getOrAdd: (key: string) => {
                if (key.length > 15 || key.length === 1) {
                    return -1;
                }
                if (/^[0-9]+$/.test(key)) {
                    return -1; //this.logger.error(`Adding KIT key "${key}"?!!`);
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
                this.KIT.write().catch((err: any) => {
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
                for(let i = 0; i < KIT.keys.length; i++) {
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
                const bytesToWrite = Math.max(KIT.bytesUsed, index);    // Determine how many bytes should be written to overwrite current KIT
                KIT.bytesUsed = index;

                await this.writeData(KIT.fileIndex, data, 0, bytesToWrite);
            },

            load: async () => {
                const data = Buffer.alloc(KIT.length);
                const { bytesRead } = await pfs.read(this.file, data, 0, data.length, KIT.fileIndex).catch(err => {
                    this.logger.error('Error reading KIT from file: ', err);
                    throw err;
                });

                // Interpret the read data
                const view = new DataView(data.buffer, 0, bytesRead);
                const keys = [];
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
                KIT.bytesUsed = index;
                KIT.keys = keys;
                this.logger.info(`KIT read, ${KIT.keys.length} keys indexed`.colorize(ColorStyle.bold));
                //this.logger.debug(keys);
                return keys;
            },
        };

        // Setup Free Space Table object and functions
        const FST = {
            get fileIndex() { return 65536; },  // Free Space Table starts at index 2^16 (65536)
            length: 65536,                      // and is max 2^16 (65536) bytes long
            bytesUsed: 0,                       // Current byte length of FST data
            pages: 0,
            ranges: [] as typeof this.FST.ranges,
            getMaxScraps: () => {
                if (!this.ipc.isMaster) { return 10; }
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

            allocate: async (requiredRecords: number): Promise<StorageAddressRange[]> => {
                if (!this.ipc.isMaster) {
                    const result = await this.ipc.sendRequest({ type: 'fst.allocate', records: requiredRecords });
                    return result.allocation;
                }
                if (this.isLocked(true)) {
                    throw new Error('database is locked');
                }
                // First, try to find a range that fits all requested records sequentially
                const recordsPerPage = this.settings.pageSize;
                const allocation: StorageAddressRange[] = [];
                let pageAdded = false;
                const ret = async (comment: string) => {
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
                const sortedRanges = FST.ranges.slice().sort((a,b) => {
                    const l1 = a.end - a.start;
                    const l2 = b.end - b.start;
                    if (l1 < l2) { return 1; }
                    if (l1 > l2) { return -1; }
                    if (a.page < b.page) { return -1; }
                    if (a.page > b.page) { return 1; }
                    return 0;
                });

                const MAX_RANGES = FST.getMaxScraps();
                const test = {
                    ranges: [] as typeof FST.ranges,
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

            release: async (ranges: StorageAddressRange[]) => {
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
                for(let i = 0; i < FST.ranges.length; i++) {
                    const range = FST.ranges[i];
                    let adjRange;
                    for (let j = i + 1; j < FST.ranges.length; j++) {
                        const otherRange = FST.ranges[j];
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
                        FST.ranges.splice(i, 1);
                        i--;
                    }
                }

                this.FST.sort(); // Do we have to? Already sorted, right?
                this.FST.write();
            },

            sort: () => {
                FST.ranges.sort((a,b) => {
                    if (a.page < b.page) { return -1; }
                    if (a.page > b.page) { return 1; }
                    if (a.start < b.start) { return -1; }
                    if (a.start > b.start) { return 1; }
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
                    this.logger.warn(`FST grew too big to store in the database file, removing ${n} entries for ${totalRecords} records`);
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
                for(let i = 0; i < FST.ranges.length; i++) {
                    const range = FST.ranges[i];
                    // Add 4-byte page nr
                    view.setUint32(index, range.page);
                    // Add 2-byte start record nr, 2-byte end record nr
                    view.setUint16(index + 4, range.start);
                    view.setUint16(index + 6, range.end);
                    index += 8;
                }
                const bytesToWrite = Math.max(FST.bytesUsed, index);    // Determine how many bytes should be written to overwrite current FST
                FST.bytesUsed = index;

                const promise = this.writeData(FST.fileIndex, data, 0, bytesToWrite).catch(err => {
                    this.logger.error('Error writing FST: ', err);
                });
                const writes = [promise];
                if (updatedPageCount === true) {
                    // Update the file size
                    const newFileSize = this.rootRecord.fileIndex + (FST.pages * settings.pageSize * settings.recordSize);
                    const promise = pfs.ftruncate(this.file, newFileSize);
                    writes.push(promise);
                }
                await Promise.all(writes);
                //this.logger.debug(`FST saved, ${this.bytesUsed} bytes used for ${FST.ranges.length} ranges`);
            },

            load: async () => {
                if (!this.ipc.isMaster) { return []; }
                const data = Buffer.alloc(FST.length);
                const { bytesRead } = await pfs.read(this.file, data, 0, data.length, this.FST.fileIndex).catch(err => {
                    this.logger.error('Error reading FST from file');
                    this.logger.error(err);
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
                this.logger.info(`FST read, ${allocatedPages} pages allocated, ${freeRangeCount} free ranges`.colorize(ColorStyle.bold));
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
                return new BinaryNodeAddress('', rootRecord.pageNr, rootRecord.recordNr);
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
                // this.logger.debug(`Root record address updated to ${address.pageNr}, ${address.recordNr}`.colorize(ColorStyle.bold));

                if (!fromIPC) {
                    // Notify others
                    this.ipc.sendNotification({ type: 'root.update', address });

                    // Save to file, or it didn't happen
                    const bytes = new Uint8Array(6);
                    const view = new DataView(bytes.buffer);
                    view.setUint32(0, address.pageNr);
                    view.setUint16(4, address.recordNr);

                    const bytesWritten = await this.writeData(HEADER_INDEXES.ROOT_RECORD_ADDRESS, bytes, 0, bytes.length);
                    this.logger.info(`Root record address updated to ${address.pageNr}, ${address.recordNr}`.colorize(ColorStyle.bold));
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
            const handleError = (err: any, txt: string) => {
                this.logger.error(txt);
                this.logger.error(err);
                if (this.file) {
                    pfs.close(this.file).catch(err => {
                        // ...
                    });
                }
                this.emit('error', err);
                throw err;
            };

            try {
                this.file = await pfs.open(this.fileName, settings.readOnly === true ? 'r' : 'r+', 0);
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
                const result = await pfs.read(this.file, data, 0, data.length, 0);
                bytesRead = result.bytesRead;
            }
            catch (err) {
                handleError(err, 'Could not read database header');
            }

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
                await pfs.write(this.file, new Uint8Array([flags | 0x1]), 0, 1, flagsIndex);
                lock.enabled = true;
                lock.forUs = forUs;
                this.emit('locked', { forUs });
            };
            this.unlock = async () => {
                await pfs.write(this.file, new Uint8Array([flags & 0xfe]), 0, 1, flagsIndex);
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
            this.settings.recordSize = header[index] << 8 | header[index+1];
            this.settings.pageSize = header[index+2] << 8 | header[index+3];
            this.settings.maxInlineValueSize = header[index+4] << 8 | header[index+5];
            // Fix issue #110: (see https://github.com/appy-one/acebase/issues/110)
            if (this.settings.recordSize === 0) { this.settings.recordSize = 65536; }
            if (this.settings.pageSize === 0) { this.settings.pageSize = 65536; }
            if (this.settings.maxInlineValueSize === 0) { this.settings.maxInlineValueSize = 65536; }

            const intro = ColorStyle.dim;
            this.logger.info(`Database "${name}" details:`.colorize(intro));
            this.logger.info('- Type: AceBase binary'.colorize(intro));
            this.logger.info(`- Record size: ${this.settings.recordSize} bytes`.colorize(intro));
            this.logger.info(`- Page size: ${this.settings.pageSize} records (${this.settings.pageSize * this.settings.recordSize} bytes)`.colorize(intro));
            this.logger.info(`- Max inline value size: ${this.settings.maxInlineValueSize} bytes`.colorize(intro));
            this.logger.info(`- Root record address: ${this.rootRecord.pageNr}, ${this.rootRecord.recordNr}`.colorize(intro));

            await this.KIT.load();  // Read Key Index Table
            await this.FST.load();  // Read Free Space Table
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
                version,    // Version nr
                flags,      // flags: [r,r,r,r,r,r,FST2,LOCK]
                0,0,0,0,    // Root record pageNr (32 bits)
                0,0,        // Root record recordNr (16 bits)
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
                await pfs.mkdir(dir).catch(err => {
                    if (err.code !== 'EEXIST') { throw err; }
                });
            }

            await pfs.writeFile(this.fileName, Buffer.from(uint8.buffer));
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
                    const exists = await pfs.exists(this.fileName);
                    if (exists) { openDatabaseFile(); }
                    else { poll(); }
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
            this.logger.info(`Closing db ${this.ipc.dbname}`);
            pfs.close(this.file).catch(err => {
                this.logger.error('Could not close database:', err);
            });
        });
    }

    get isReady() { return this._ready; }
    get fileName() { return `${this.settings.path}/${this.name}.acebase/${this.type}.db`; }
    isLocked: (forUs?: boolean) => boolean;
    lock: (forUs?: boolean) => Promise<void>;
    unlock: () => Promise<void>;

    public async writeData(fileIndex: number, buffer: Buffer | ArrayBuffer | ArrayBufferView | Uint8Array, offset = 0, length = -1) {
        if (this.settings.readOnly) {
            const err = new Error(`Cannot write to readonly database ${this.fileName}`);
            (err as any).code = 'EPERM'; // This is what NodeJS would throw below
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
        const { bytesWritten } = await pfs.write(this.file, buffer as Buffer, offset, length, fileIndex).catch(err => {
            this.logger.error('Error writing to file', err);
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
    public async readData(fileIndex: number, buffer: Buffer | ArrayBuffer | ArrayBufferView, offset = 0, length = -1): Promise<number> {
        if (length === -1) {
            length = buffer.byteLength;
        }
        if (buffer instanceof ArrayBuffer) {
            buffer = Buffer.from(buffer);
        }
        else if (!(buffer instanceof Buffer) && buffer.buffer instanceof ArrayBuffer) {
            // Convert a typed array such as Uint8Array to Buffer with shared memory space
            buffer = Buffer.from(buffer.buffer);
            if ((buffer as Buffer).byteOffset > 0) {
                throw new Error('When using a TypedArray as buffer, its byteOffset MUST be 0.');
            }
        }
        try {
            const { bytesRead } = await pfs.read(this.file, buffer as Buffer, offset, length, fileIndex);
            this.stats.reads++;
            this.stats.bytesRead += bytesRead;
            return bytesRead;
        }
        catch (err) {
            this.logger.error('Error reading record', buffer, offset, length, fileIndex);
            this.logger.error(err);
            throw err;
        }
    }

    /**
     * The "Key Index Table" contains key names used in the database, so they can be referenced
     * with an index in the KIT instead of with its name. This saves space, improves performance,
     * and will allow quick key "property" renaming in the future.
     */
    public KIT: {
        fileIndex: number;
        length: number;
        bytesUsed: number;
        keys: string[];

        /**
         * Gets a key's index, or attempts to add a new key to the KIT
         * @param {string} key | key to store in the KIT
         * @returns {number} | returns the index of the key in the KIT when successful, or -1 if the key could not be added
         */
        getOrAdd(key: string): number;
        write(): Promise<void>;
        load(): Promise<string[]>;
    };

    /**
     * The "Free Space Table" keeps track of areas in the db file that are available to
     * be allocated for storage.
     */
    public FST: {
        readonly fileIndex: number;
        readonly length: number;
        readonly bytesUsed: number;
        readonly pages: number;
        readonly ranges: { page: number; start: number; end: number }[];
        allocate(requiredRecords: number): Promise<StorageAddressRange[]>;
        release(ranges: StorageAddressRange[]): Promise<void>;
        sort(): void;
        write(updatedPageCount?: boolean): Promise<void>;
        load(): Promise<AceBaseStorage['FST']['ranges']>;
        readonly maxScraps: number;
    };

    public rootRecord: {
        /** This is not necessarily the ROOT record, it's the FIRST record (which _is_ the root record at very start) */
        readonly fileIndex: number;
        readonly pageNr: number;
        readonly recordNr: number;
        readonly exists: boolean;
        readonly address: BinaryNodeAddress;
        /**
         * Updates the root node address
         * @param address
         * @param fromIPC whether this update comes from an IPC notification, prevent infinite loopbacks. Default is `false`
         */
        update(address: BinaryNodeAddress, fromIPC?: boolean): Promise<void>;
    };

    /**
     * Use this method to update cache, instead of through `this.nodeCache`
     * @param fromIPC Whether this update came from an IPC notification to prevent infinite loop
     * @param nodeInfo
     * @param hasMoved set to false when reading a record's children - not because the address is actually changing
     */
    public updateCache(fromIPC: boolean, nodeInfo: BinaryNodeInfo, hasMoved = true) {
        this.nodeCache.update(nodeInfo); // , hasMoved
        if (!fromIPC && hasMoved) {
            this.ipc.sendNotification({ type: 'cache.update', info: nodeInfo });
        }
    }

    public invalidateCache(fromIPC: boolean, path: string, recursive: boolean | Record<string, 'delete' | 'invalidate'>, reason?: string) {
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

    getRecordFileIndex(pageNr: number, recordNr: number) {
        const index =
            this.rootRecord.fileIndex
            + (pageNr * this.pageByteSize)
            + (recordNr * this.settings.recordSize);
        return index;
    }

    /**
     * Repairs a broken record by removing the reference to it from the parent node. It does not overwrite the target record to prevent possibly breaking other data.
     * Example: repairNode('books/l74fm4sg000009jr1iyt93a5/reviews') will remove the reference to the 'reviews' record in 'books/l74fm4sg000009jr1iyt93a5'
     */
    async repairNode(
        targetPath: string,
        options: {
            /**
             * Included for testing purposes: whether to proceed if the target node does not appear broken.
             * @default false
             */
            ignoreIntact?: boolean;
            /**
             * Whether to mark the target as removed (getting its value will yield `"[[removed]]"`). Set to `false` to completely remove it.
             * @default true
             */
            markAsRemoved?: boolean;
        } = {
            ignoreIntact: false,
            markAsRemoved: true,
        },
    ) {
        if (typeof options.ignoreIntact !== 'boolean') {
            options.ignoreIntact = false;
        }
        if (typeof options.markAsRemoved !== 'boolean') {
            options.markAsRemoved = true;
        }
        const targetPathInfo = PathInfo.get(targetPath);
        const { parentPath: path, key, parent: pathInfo } = targetPathInfo;
        const tid = this.createTid();
        let lock = await this.nodeLocker.lock(path, tid.toString(), true, 'fixRecord');
        try {
            // Make sure cache for parent and all children is removed
            this.invalidateCache(false, path, true);

            // Check if the target node is really broken first
            let targetNodeInfo: BinaryNodeInfo = null;
            try {
                targetNodeInfo = await this.getNodeInfo(targetPath, { tid });
            }
            finally {
                if (targetNodeInfo) {
                    const msg = `Node at path "${targetPath}" is not broken: it is a(n) ${targetNodeInfo.valueTypeName} stored ${targetNodeInfo.address ? `@${targetNodeInfo.address.pageNr},${targetNodeInfo.address.recordNr}` : 'inline'}${targetNodeInfo.value ? ` with value ${targetNodeInfo.value}` : ''}`;
                    this.logger.warn(msg);
                    if (!options.ignoreIntact) {
                        throw new Error(msg);
                    }
                }
            }

            let nodeInfo: BinaryNodeInfo;
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
            const isArray = nodeInfo.valueType === VALUE_TYPES.ARRAY;
            if (isArray && !options.markAsRemoved) {
                this.logger.warn(`Node at path "${path}" is an Array, cannot remove entry at index ${key}: marking it as "${removedValueIndicator}" instead`);
                options.markAsRemoved = true;
            }
            const nodeReader = new NodeReader(this, nodeInfo.address, lock, false);
            const recordInfo = await nodeReader.readHeader();
            let childInfo: BinaryNodeInfo;
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

                const oldKV = _serializeValue(this, targetPath, key, new InternalNodeReference(childInfo.valueType, childInfo.address), tid) as SerializedKeyValue;
                const oldVal = _getValueBytes(oldKV);
                const newKV = _serializeValue(this, targetPath, key, removedValueIndicator, tid) as SerializedKeyValue;
                const newVal = _getValueBytes(newKV);
                const tree = nodeReader.getChildTree();
                const oldEntryValue = new BinaryBPlusTree.EntryValue(oldVal);
                const newEntryValue = new BinaryBPlusTree.EntryValue(newVal);
                const op = options.markAsRemoved
                    ? BinaryBPlusTree.TransactionOperation.update(key, newEntryValue, oldEntryValue)
                    : BinaryBPlusTree.TransactionOperation.remove(key, oldEntryValue.recordPointer);
                try {
                    await tree.transaction([op]);
                }
                catch (err) {
                    throw new Error(`Could not update tree for "${path}": ${err}`);
                }
            }
            else {
                // This is a small record. Rewrite the entire node
                const mergedValue = (isArray ? [] : {}) as Record<string, any>;

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
                        this.logger.error(`Could not release previously allocated ranges for "/${path}": ${err}`);
                    }
                    // throw new Error(`Node at path "/${path}" was not rewritten at the same location. Fix failed`);
                }
            }

            this.logger.info(`Successfully fixed node at path "${targetPath}" by ${options.markAsRemoved ? `marking key "${key}" of parent node "${path}" as removed ("${removedValueIndicator}")` : `removing key "${key}" from parent node "${path}"`}`);

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
    async repairNodeTree(path: string) {
        this.logger.warn(`Starting node tree repair for path "/${path}"`);
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
            const tree = new BinaryBPlusTree({
                readFn: nodeReader._treeDataReader.bind(nodeReader),
                logger: this.logger,
                id: `path:${path}`,
            });
            const newRecordInfo = await _rebuildKeyTree(tree, nodeReader, { repairMode: true });

            if (newRecordInfo !== recordInfo) {
                // deallocate old storage space & update parent address
                const deallocate = new NodeAllocation(recordInfo.allocation.ranges);
                const pathInfo = PathInfo.get(path);
                if (pathInfo.parentPath !== null) {
                    lock = await lock.moveToParent();
                    await this._updateNode(
                        pathInfo.parentPath,
                        { [pathInfo.key]: new InternalNodeReference(newRecordInfo.valueType, newRecordInfo.address) },
                        { merge: true, tid, _internal: true, context: { acebase_repair: { path, method: 'node-tree' } } },
                    );
                }
                if (deallocate.totalAddresses > 0) {
                    // Release record allocation marked for deallocation
                    deallocate.normalize();
                    this.logger.trace(`Releasing ${deallocate.totalAddresses} addresses (${deallocate.ranges.length} ranges) previously used by node "/${path}" and/or descendants: ${deallocate}`.colorize(ColorStyle.grey));
                    await this.FST.release(deallocate.ranges);
                }
            }
            this.logger.warn(`Successfully repaired node tree for path "/${path}"`);
        }
        catch (err) {
            this.logger.error(`Failed to repair node tree for path "/${path}": ${err.stack}`);
        }
        finally {
            lock.release();
        }
    }

    get transactionLoggingEnabled() {
        return this.settings.transactions && this.settings.transactions.log === true;
    }

    logMutation(
        type: 'set' | 'update',
        path: string,
        value: any,
        context: { acebase_cursor: string },
        mutations: IAppliedMutations,
    ): string | Promise<string> {
        // Add to transaction log
        if (!['set','update'].includes(type)) { throw new TypeError('type must be either "set" or "update"'); }
        if (!this.transactionLoggingEnabled) { throw new Error('transaction logging is not enabled on database'); }
        if (!context.acebase_cursor) { throw new Error('context.acebase_cursor must have been set'); }
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
            catch(err) {
                this.logger.error('Failed to add to transaction log: ', err);
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
    async getMutations(filter: {
        /**
         * cursor is a generated key (ID.generate) that represents a point of time
         */
        cursor?: string;
        /**
         * earliest transaction to include, will be converted to a cursor
         */
        timestamp?: number;
        /**
         * top-most paths to include. Can include wildcards to facilitate wildcard event listeners. Only used if `for` filter is not used, equivalent to `for: { path, events: ['value] }
         */
        path?: string;
        /**
         * Specifies which paths and events to get all relevant mutations for
         */
        for?: Array<{ path: string, events:string[] }>
    }): Promise<{
        used_cursor: string,
        new_cursor: string,
        mutations: Array<{
            path: string,
            type: 'set' | 'update',
            value: any,
            context: any,
            id: string,
            timestamp: number,
            changes: IAppliedMutations,
        }>
    }> {
        if (this.type === 'data') {
            if (!this.transactionLoggingEnabled) { throw new Error('Transaction logging is not enabled'); }
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
        const since =
            (typeof filter.timestamp === 'number' && filter.timestamp)
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
            const pathInfo = PathInfo.get(t1.path);
            return !filter.for.some(t2 => pathInfo.isDescendantOf(t2.path));
        }).map(item => item.path);

        const tid = this.createTid(); //ID.generate();
        const lock = await this.nodeLocker.lock('history', tid.toString(), false, 'getMutations');
        try {
            type MutationItem = { id: string, path: string, type: 'set'|'update', timestamp: number, value: any, context: any, changes: IAppliedMutations };
            let mutations = [] as MutationItem[];
            const checkQueue = [] as string[];
            let done: () => void;
            const donePromise = new Promise<void>(resolve => done = resolve);
            let allEnumerated = false;

            const hasValue = (val: any) => ![undefined,null].includes(val);
            const hasPropertyValue = (val: any, prop: string | number) => hasValue(val) && typeof val === 'object' && hasValue(val[prop]);

            // const filterPathInfo = PathInfo.get(filter.path || '');
            const check = async (key: string) => {
                checkQueue.push(key);
                const { value: mutation } = <{
                    value: {
                        path: string;
                        keys: (string | number)[];
                        updated: (string | number)[];
                        deleted: (string | number)[];
                        type: 'set' | 'update';
                        timestamp: number;
                    }
                }>await this.getNode(`history/${key}`, { tid, include: ['path', 'updated', 'deleted', 'type', 'timestamp'] }); // Not including 'value'
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
                    const { value: tx } = <{
                        value: {
                            context: any;
                            mutations: IAppliedMutations;
                            value: any;
                        }
                    }>await this.getNode(`history/${key}`, { tid, include: ['context', 'mutations', valueKey] });

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
                        if (typeof m.val === 'undefined') { m.val = null; }
                        if (typeof m.prev === 'undefined') { m.prev = null; }
                    }
                    if (load === 'target') {
                        targetOp = 'set';
                        const trailKeys = filterPathInfo.keys.slice(mutationPathInfo.keys.length);
                        const process = (targetPath: string, targetValue: any, trailKeys: (string | number)[]) => {
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
            const oldestValidCursor = this.oldestValidCursor, expiredTransactions: string[] = [], inspectFurther: string[] = [];
            try {
                await this.getChildren('history', { tid }).next(childInfo => {
                    const txCursor = childInfo.key.slice(0, cursor.length);
                    if (txCursor < oldestValidCursor) { expiredTransactions.push(childInfo.key); }
                    if (txCursor < cursor) { return; }
                    if (txCursor === cursor) {
                        // cuid timestamp bytes are equal - perform extra check on this mutation later to find out if we have to include it in the results
                        inspectFurther.push(childInfo.key);
                    }
                    count++;
                    check(childInfo.key);
                });
            }
            catch (err) {
                if (!(err instanceof NodeNotFoundError)) {
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
                }, {} as Record<string, null>);
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
            const hasNewKeys = (val: any, prev: any) => Object.keys(val || {}).some(key => !(key in (prev || {})));
            const hasRemovedKeys = (val: any, prev: any) => Object.keys(prev || {}).some(key => !(key in (val || {})));
            const allEventsFor = (...events: string[]) => events.concat(...events.map(e => `notify_${e}`));
            const hasEvent = (events: string[], check: string[]) => allEventsFor(...check).some(e => events.includes(e));
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
     */
    async getChanges(filter: {
        /**
         * cursor is a generated key (ID.generate) that represents a point of time
         */
        cursor?: string;
        /**
         * earliest transaction to include, will be converted to a cursor
         */
        timestamp?: number;
        /**
         * top-most paths to include. Can include wildcards to facilitate wildcard event listeners. Only used if `for` filter is not used,
         * equivalent to `for: { path, events: ['value] }
         */
        path?: string;
        /**
         * Specifies which paths and events to get all relevant mutations for
         */
        for?: Array<{ path: string; events:string[] }>;
    }): Promise<{
        used_cursor: string;
        new_cursor: string;
        changes: Array<{
            path: string;
            type: 'set' | 'update';
            previous: any;
            value: any;
            context: any;
        }>;
    }> {
        const mutationsResult = await this.getMutations(filter);
        const { used_cursor, new_cursor, mutations } = mutationsResult;

        const hasValue = (val: any) => ![undefined,null].includes(val);

        // Get effective changes to the target paths
        const arr = mutations.reduce((all, item) => {
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
                    val: hasValue(m.val) ? m.val : null,
                });
            });
            return all;
        }, [] as Array<{
            id: string;
            type: 'set';
            path: string;
            pathInfo: PathInfo;
            timestamp: number;
            context: any;
            prev: any;
            val: any;
        }>).reduce((all, item) => {
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
        }, [] as Array<{
            id: string;
            type: 'set'|'update';
            path: string;
            pathInfo: PathInfo;
            val: any;
            prev: any;
            context: any;
        }>);


        // Transform results to desired output
        const changes = arr.map(item => ({
            id: item.id,
            type: item.type,
            path: item.path,
            context: { acebase_cursor: item.context.acebase_cursor }, // Replace original context
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
            maxAgeMs = this.settings.transactions.maxAge * msPerDay,
            limit = Date.now() - maxAgeMs,
            cursor = limit.toString(36);
        return cursor;
    }

    /**
     * Enumerates all children of a given Node for reflection purposes
     * @param path
     * @param options optional options used by implementation for recursive calls
     * @returns returns a generator object that calls .next for each child until the .next callback returns false
     */
    getChildren(
        path: string,
        options: {
            /** specify the child keys to get callbacks for, skips .next callbacks for other keys */
            keyFilter?: string[] | number[];
            fromKey?: string | number;
            /** optional transaction id for node locking purposes */
            tid?: string | number;
            /**
             * whether to use an async/await flow for each `.next` call
             * @default false
             * @deprecated Uses async automatically
             */
            async?: boolean;
        } = {},
    ) {
        type ChildCallbackFunction = (child: BinaryNodeInfo) => boolean | void | Promise<boolean | void>;
        const generator = {
            /**
             *
             * @param valueCallback callback function to run for each child. Return false to stop iterating
             * @returns returns a promise that resolves with a boolean indicating if all children have been enumerated, or was canceled by the valueCallback function
             */
            async next(valueCallback: ChildCallbackFunction): Promise<boolean> {
                return start(valueCallback);
            },
        };
        const start = async (callback: ChildCallbackFunction) => {
            const tid = this.createTid(); //ID.generate();
            let canceled = false;
            const lock = await this.nodeLocker.lock(path, tid.toString(), false, `storage.getChildren`);
            try {
                const nodeInfo = await this.getNodeInfo(path, { tid });
                if (!nodeInfo.exists) {
                    throw new NodeNotFoundError(`Node "/${path}" does not exist`);
                }
                else if (!nodeInfo.address) {
                    // Node does not have its own record, so it has no children
                    return;
                }
                const reader = new NodeReader(this, nodeInfo.address, lock, true);
                await reader.getChildStream({ keyFilter: options.keyFilter, fromKey: options.fromKey })
                    .next((childInfo: BinaryNodeInfo) => {
                        const result = callback(childInfo);
                        if (result instanceof Promise) {
                            return result.then((r) => {
                                canceled = r === false;
                                return !canceled;
                            });
                        }
                        canceled = result === false;
                        return !canceled;
                    });
                return canceled;
            }
            catch(err: any) {
                if (!(err instanceof NodeNotFoundError)) {
                    this.logger.error(`Error getting children of "/${path}": ${err.message}`);
                    this.logger.trace(err);
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
    async getNode(
        path: string,
        options: InternalDataRetrievalOptions = { child_objects: true },
    ): Promise<{ revision?: string, value: any, cursor?: string }> {
        const tid = options.tid || this.createTid();
        const lock = await this.nodeLocker.lock(path, tid.toString(), false, `storage.getNode "/${path}"`);
        try {
            const cursor = this.transactionLoggingEnabled ? ID.generate() : undefined;
            const nodeInfo = await this.getNodeInfo(path, { tid });
            let value = nodeInfo.value;
            if (!nodeInfo.exists) {
                value = null;
            }
            else if (nodeInfo.address) {
                const reader = new NodeReader(this, nodeInfo.address, lock, true);
                value = await reader.getValue({
                    include: options.include as string[],
                    exclude: options.exclude as string[],
                    child_objects: options.child_objects,
                });
            }
            return {
                revision: null, // TODO: implement (or maybe remove from other storage backends because we're not using it anywhere)
                value,
                cursor,
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
                this.logger.error('DEBUG THIS: getNode error:', err);
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
    async getNodeInfo(
        path: string,
        options: {
            /**
             * optional transaction id for node locking purposes
             */
            tid?: string | number;
            no_cache?: boolean;
            /**
             * whether to include child count if node is an object or array
             * @default false
             */
            include_child_count?: boolean;
            /**
             * whether to allow expansion of path references (follow "symbolic links")
             * @default false
             * */
            allow_expand?: boolean;
        } = {
            no_cache: false,
            include_child_count: false,
            allow_expand: false,
        },
    ): Promise<BinaryNodeInfo> {
        options.no_cache = options.no_cache === true;
        options.include_child_count = options.include_child_count === true;
        options.allow_expand = false; // Don't use yet! // options.allow_expand !== false;
        const tid = options.tid || this.createTid();

        const getChildCount = async (nodeInfo: BinaryNodeInfo) => {
            let childCount = 0;
            if (([VALUE_TYPES.ARRAY, VALUE_TYPES.OBJECT] as number[]).includes(nodeInfo.valueType) && nodeInfo.address) {
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
                    return new BinaryNodeInfo({ path, exists: false });
                }
                const info = new BinaryNodeInfo({ path, address: this.rootRecord.address, exists: true, type: VALUE_TYPES.OBJECT });
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
                return cachedInfo as BinaryNodeInfo;
            }
        }

        // Cache miss. Find it by reading parent node
        const pathInfo = PathInfo.get(path);
        const parentPath = pathInfo.parentPath;

        // Achieve a read lock on the parent node and read it
        const lock = await this.nodeLocker.lock(parentPath, tid.toString(), false, `storage.getNodeInfo "/${parentPath}"`);
        try {
            // We have a lock, check if the lookup has been cached by another "thread" in the meantime.
            let childInfo = this.nodeCache.find(path, true) as BinaryNodeInfo;
            if (childInfo instanceof Promise) {
                // It was previously announced, wait for it
                childInfo = await childInfo;
            }
            if (childInfo && !options.include_child_count) {
                // Return cached info
                return childInfo as BinaryNodeInfo;
            }
            if (!childInfo) {
                // announce the lookup now
                this.nodeCache.announce(path);

                const parentInfo = await this.getNodeInfo(parentPath, { tid, no_cache: options.no_cache });
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
                else if (!parentInfo.exists || !([VALUE_TYPES.OBJECT, VALUE_TYPES.ARRAY] as number[]).includes(parentInfo.valueType) || !parentInfo.address) {
                    // Parent does not exist, is not an object or array, or has no children (object not stored in own address)
                    // so child doesn't exist
                    childInfo = new BinaryNodeInfo({ path, exists: false });
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
        catch(err) {
            this.logger.error('DEBUG THIS: getNodeInfo error', err);
            this.nodeCache.rejectAnnouncement(path, err);
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
    async setNode(
        path: string,
        value: any,
        options: {
            /** optional transaction id for node locking purposes */
            tid?: string | number;
            /**
             * whether to suppress the execution of event subscriptions
             * @default false
             * */
            suppress_events?: boolean;
            /** @default null */
            context?: any;
        } = {
            suppress_events: false,
            context: null,
        },
    ): Promise<string|void> {
        options.context = options.context || {};
        if (this.txStorage) {
            options.context.acebase_cursor = ID.generate();
        }
        const context = cloneObject(options.context); // copy context to prevent changes while code proceeds async
        const mutations = await this._updateNode(path, value, { merge: false, tid: options.tid, suppress_events: options.suppress_events, context });
        if (this.txStorage && mutations) {
            const p = this.logMutation('set', path, value, context as { acebase_cursor: string }, mutations);
            if (p instanceof Promise) { await p; }
        }
        return options.context.acebase_cursor;
    }

    /**
     * Delegates to legacy update method that handles everything
     * @param options optional options used by implementation for recursive calls
     * @returns Returns a new cursor if transaction logging is enabled
     */
    async updateNode(
        path: string,
        updates: any,
        options: {
            /** optional transaction id for node locking purposes */
            tid?: string | number;
            /**
             * whether to suppress the execution of event subscriptions
             * @default false
             */
            suppress_events?: boolean;
            /**
             * @default null
             */
            context?: any;
        } = {
            suppress_events: false,
            context: null,
        },
    ): Promise<string|void> {
        options.context = options.context || {};
        if (this.txStorage) {
            options.context.acebase_cursor = ID.generate();
        }
        const context = cloneObject(options.context); // copy context to prevent changes while code proceeds async
        const mutations = await this._updateNode(path, updates, { merge: true, tid: options.tid, suppress_events: options.suppress_events, context });
        if (this.txStorage && mutations) {
            const p = this.logMutation('update', path, updates, context as { acebase_cursor: string }, mutations);
            if (p instanceof Promise) { await p; }
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
    async _updateNode(
        path: string,
        value: any,
        options: {
            /** @default true */
            merge?: boolean;
            /** optional transaction id for node locking purposes */
            tid?: string | number;
            /**
             * whether to suppress the execution of event subscriptions
             * @default false
             */
            suppress_events?: boolean;
            /** @default null */
            context?: any;
            /** @default false */
            _internal?: boolean;
        } = {
            merge: true,
            _internal: false,
            suppress_events: false,
            context: null,
        },
    ): Promise<IAppliedMutations> {
        // this.logger.debug(`Update request for node "/${path}"`);

        const tid = options.tid || this.createTid(); // ID.generate();
        const pathInfo = PathInfo.get(path);

        if (value === null) {
            // Deletion of node is requested. Update parent
            return this._updateNode(
                pathInfo.parentPath,
                { [pathInfo.key]: null },
                { merge: true, tid, suppress_events: options.suppress_events, context: options.context },
            );
        }

        if (path !== '' && this.valueFitsInline(value)) {
            // Simple value, update parent instead
            return this._updateNode(
                pathInfo.parentPath,
                { [pathInfo.key]: value },
                { merge: true, tid, suppress_events: options.suppress_events, context: options.context },
            );
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

            let result: Partial<IWriteNodeResult> & Awaited<ReturnType<typeof write>>;
            if (options._internal) {
                result = await write();
            }
            else {
                result = <any> await this._writeNodeWithTracking(path, value, {
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
                await this._updateNode(
                    pathInfo.parentPath,
                    { [pathInfo.key]: new InternalNodeReference(recordInfo.valueType, recordInfo.address) },
                    { merge: true, tid, _internal: true, context: options.context },
                );
                parentUpdated = true;
            }

            if (parentUpdated && pathInfo.parentPath !== '') {
                console.assert(this.nodeCache.has(pathInfo.parentPath), 'Not cached?!!');
            }

            if (deallocate && deallocate.totalAddresses > 0) {
                // Release record allocation marked for deallocation
                deallocate.normalize();
                this.logger.trace(`Releasing ${deallocate.totalAddresses} addresses (${deallocate.ranges.length} ranges) previously used by node "/${path}" and/or descendants: ${deallocate}`.colorize(ColorStyle.grey));

                // Invalidate any cache entries still pointing at addresses we are about
                // to free.  If such a stale pointer is not cleared here it can cause a
                // CorruptRecordError: the freed record gets reused by a new node, the
                // stale cache entry hands the old address to a NodeReader, and when a
                // descendant NodeReader tries to use the same (now-repurposed) record
                // the stack clash is detected and the error is thrown.
                this.nodeCache.invalidateAddress(deallocate.addresses);

                this.FST.release(deallocate.ranges);
            }

            return {
                path,
                list: mutations,
            };
        }
        // catch(err) {
        //     // if (err instanceof SchemaValidationError) {
        //     //     !recursive && this.logger.error(`Schema validation error ${options.merge ? 'updating' : 'setting'} path "${path}": `, err.reason);
        //     // }
        //     if (!(err instanceof SchemaValidationError)) {
        //         this.logger.error(`Node.update ERROR: `, err.message);
        //     }
        //     throw err; //return false;
        // }
        finally {
            lock.release();
            // topLock && topLock.release();
        }
    }
}
