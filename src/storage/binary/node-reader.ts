import { ColorStyle, LoggerPlugin, PartialArray, PathInfo, PathReference, Utils } from 'acebase-core';
import { NodeValueType, VALUE_TYPES } from '../../node-value-types.js';
import { NodeLock } from '../../node-lock.js';
import { BinaryBPlusTree } from '../../btree/index.js';
import { BinaryNodeAddress } from './node-address.js';
import { RecordInfo } from './record-info.js';
import { AceBaseStorage } from './binary-storage.js';
import { IAceBaseIPCLock } from '../../ipc/ipc';
import { NodeAllocation } from './node-allocation.js';
import { BinaryNodeInfo } from './node-info.js';
import { StorageAddressRange } from './binary-storage-address-range.js';
import { FLAG_KEY_TREE, FLAG_VALUE_TYPE, REMOVED_CHILD_DATA_IMPLEMENTED } from './flags.js';

const { concatTypedArrays, bytesToNumber, bytesToBigint, decodeString } = Utils;

export class AdditionalDataRequest extends Error {
    constructor() { super('More data needs to be loaded from the source'); }
}

export class CorruptRecordError extends Error {
    constructor(public record: BinaryNodeAddress, public key: string | number, message: string) {
        super(message);
    }
}

export class NodeReader {
    recordInfo: RecordInfo = null;
    logger: LoggerPlugin;

    constructor(
        public storage: AceBaseStorage,
        public address: BinaryNodeAddress,
        public lock: IAceBaseIPCLock,
        public updateCache = false,
        public stack = {} as Record<string, BinaryNodeAddress>,
    ) {
        if (!(address instanceof BinaryNodeAddress)) {
            throw new TypeError('address argument must be a BinaryNodeAddress');
        }
        this.logger = storage.logger;

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
            this.logger.error(error.message);
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

    async getAllocation(includeChildNodes: false): Promise<Array<{ path: string, allocation: NodeAllocation }>>;
    async getAllocation(includeChildNodes: true): Promise<NodeAllocation>;
    async getAllocation(includeChildNodes = false): Promise<NodeAllocation | Array<{ path: string, allocation: NodeAllocation }>> {
        this._assertLock();

        if (!includeChildNodes && this.recordInfo !== null) {
            return this.recordInfo.allocation;
        }
        let allocation: NodeAllocation = null;

        await this.readHeader();
        allocation = this.recordInfo.allocation;
        if (!includeChildNodes) {
            return [{ path: this.address.path, allocation }];
        }

        const childPromises = [] as Promise<any>[];
        await this.getChildStream()
            .next(child => {
                const address = child.address;
                if (address) {
                // Get child Allocation
                    const promise = this.storage.nodeLocker.lock(child.path, this.lock.tid, false, `NodeReader:getAllocation:child "/${child.path}"`)
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
        });
        //console.log(childAllocations);
        return allocation;
    }

    /**
     * Reads all data for this node. Only do this when a stream won't do (eg if you need all data because the record contains a string)
     */
    async getAllData(): Promise<Uint8Array> {
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
    async getValue(
        options: {
            include?: string[] | PathInfo[],
            exclude?: string[] | PathInfo[],
            child_objects?: boolean,
            no_cache?: boolean
        } = {
            child_objects: true,
            no_cache: false,
        },
    ): Promise<any> {
        if (typeof options.include !== 'undefined' && !(options.include instanceof Array)) {
            throw new TypeError('options.include must be an array of key names');
        }
        if (typeof options.exclude !== 'undefined' && !(options.exclude instanceof Array)) {
            throw new TypeError('options.exclude must be an array of key names');
        }
        if (['undefined','boolean'].indexOf(typeof options.child_objects) < 0) {
            throw new TypeError('options.child_objects must be a boolean');
        }

        this._assertLock();

        if (this.recordInfo === null) {
            await this.readHeader();
        }

        this.logger.info(`Reading node "/${this.address.path}" from address ${this.address.pageNr},${this.address.recordNr}`.colorize(ColorStyle.magenta));

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
                 */
                const convertFilterArray = (arr: string[]) => {
                    const isNumber = (key: string) => /^[0-9]+$/.test(key);
                    return arr.map(path => PathInfo.get(isArray && isNumber(path) ? `[${path}]` : path));
                };
                const includeFilter: PathInfo[] = options.include ? options.include.some(item => item instanceof PathInfo) ? options.include as PathInfo[] : convertFilterArray(options.include as string[]) : [];
                const excludeFilter: PathInfo[] = options.exclude ? options.exclude.some(item => item instanceof PathInfo) ? options.exclude as PathInfo[] : convertFilterArray(options.exclude as string[]) : [];

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

                const promises = [] as Promise<any>[];
                const isWildcardKey = (key: string | number) => typeof key === 'string' && (key === '*' || key[0] === '$');
                const hasWildcardInclude = includeFilter.length > 0 && includeFilter.some(pathInfo => pathInfo.keys.length === 1 && isWildcardKey(pathInfo.keys[0]));
                const hasChildIncludes = includeFilter.length > 0 && includeFilter.some(pathInfo => pathInfo.keys.length === 1 && !isWildcardKey(pathInfo.keys[0]));
                const isFiltered = (includeFilter.length > 0 && !hasWildcardInclude && includeFilter.some(pathInfo => pathInfo.keys.length === 1)) || (excludeFilter.length > 0 && excludeFilter.some(pathInfo => pathInfo.keys.length === 1) ) || options.child_objects === false;
                const obj : PartialArray | any[] | Record<string, any> = isArray ? isFiltered ? new PartialArray() : [] as any[] : {};
                const streamOptions = {} as { keyFilter?: string[] | number[] };
                if (includeFilter.length > 0 && !hasWildcardInclude && hasChildIncludes) {
                    const keyFilter = includeFilter
                        .filter(pathInfo => !isWildcardKey(pathInfo.keys[0])) // pathInfo.keys.length === 1 &&
                        .map(pathInfo => pathInfo.keys[0])
                        .reduce((keys, key) => (keys.includes(key as string) || keys.push(key as string)) && keys, [] as string[]);
                    if (keyFilter.length > 0) {
                        streamOptions.keyFilter = keyFilter;
                    }
                }

                const loadChildValue = async (child: BinaryNodeInfo) => {
                    let childLock;
                    try {
                        childLock = await this.storage.nodeLocker.lock(child.address.path, this.lock.tid, false, `NodeReader.getValue:child "/${child.address.path}"`);

                        // Are there any relevant nested includes / excludes?
                        // Fixed: nested bracket (index) include/exclude handling like '[3]/name'
                        const childOptions = {} as {
                            include?: PathInfo[];
                            exclude?: PathInfo[];
                        };
                        const getChildFilter = (filter: PathInfo[]) => {
                            return filter
                                .filter((pathInfo) => {
                                    const key = pathInfo.keys[0];
                                    return pathInfo.keys.length > 1 && (isWildcardKey(key) || (isArray && key === child.index) || (!isArray && key === child.key));
                                })
                                .map(pathInfo => PathInfo.get(pathInfo.keys.slice(1)));
                        };
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
                        //     //     this.logger.warn(`Using cached address to read child node "/${child.address.path}" from  address ${cachedAddress.pageNr},${cachedAddress.recordNr} instead of (${child.address.pageNr},${child.address.recordNr})`.colorize(ColorStyle.magenta));
                        //     //     child.address = cachedAddress;
                        //     // }
                        // }

                        // this.logger.debug(`Reading child node "/${child.address.path}" from ${child.address.pageNr},${child.address.recordNr}`.colorize(ColorStyle.magenta));
                        const reader = new NodeReader(this.storage, child.address, childLock, this.updateCache, this.stack);
                        const val = await reader.getValue(childOptions);
                        (obj as any)[isArray ? child.index : child.key] = val;
                    }
                    catch (reason) {
                        this.logger.error('NodeReader.getValue:child error: ', reason);
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
                            if (options.child_objects === false && ([VALUE_TYPES.OBJECT, VALUE_TYPES.ARRAY] as number[]).includes(child.type)) {
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
                                (obj as any)[keyOrIndex] = child.value;
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
                    this.logger.error(err);
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

        type DataCallbackFunction = (result: {data: Uint8Array, valueType: number, chunks: StorageAddressRange[], chunkIndex: number, totalBytes: number, hasKeyTree: boolean, fileIndex: number, headerLength: number }) => void | boolean | Promise<void | boolean>;
        const bytesPerRecord = this.storage.settings.recordSize;
        const maxRecordsPerChunk = this.storage.settings.pageSize; // Reading whole pages at a time is faster, approx 130KB with default settings (1024 records of 128 bytes each) // 200: about 25KB of data when using 128 byte records
        const generator = {
            /**
             * @param callback callback function that is called with each chunk read. Reading will stop immediately when false is returned
             * @returns returns a promise that resolves when all data is read
             */
            async next(callback: DataCallbackFunction) {
                return read(callback);
            },
        };

        const read = async (callback: DataCallbackFunction) => {
            const fileIndex = this.storage.getRecordFileIndex(this.address.pageNr, this.address.recordNr);

            if (this.recordInfo === null) {
                await this.readHeader();
            }
            const recordInfo = this.recordInfo;

            // Divide all allocation ranges into chunks of maxRecordsPerChunk
            const ranges = recordInfo.allocation.ranges;
            const chunks = [] as { pageNr: number; recordNr: number; length: number }[]; // nicer approach would be: const chunks = ranges.reduce((chunks, range) => { ... }, []);
            let totalBytes = 0;
            ranges.forEach((range, i) => {
                let chunk = {
                    pageNr: range.pageNr,
                    recordNr: range.recordNr,
                    length: range.length,
                };
                let chunkLength = (chunk.length * bytesPerRecord);
                if (i === ranges.length-1) {
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

            if (isLastChunk) { proceed = false; }
            let index = 1;
            while (proceed) {
                //this.logger.debug(address.path);
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
                    headerLength,
                }) !== false;

                if (isLastChunk) { proceed = false; }
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
    getChildStream(options: { keyFilter?: string[] | number[] } = {}) {
        this._assertLock();

        type ChildCallbackFunction = (childInfo: BinaryNodeInfo, index: number) => boolean | void | Promise<boolean | void>
        let callback: ChildCallbackFunction;
        let isAsync = false;
        let childCount = 0;
        const generator = {
            async next(cb: ChildCallbackFunction, useAsync = false) {
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

            isArray = this.recordInfo.valueType === VALUE_TYPES.ARRAY;
            if (this.recordInfo.hasKeyIndex) {
                return createStreamFromBinaryTree();
            }
            else if (this.recordInfo.allocation.totalAddresses === 1) {
                // We have all data in memory (small record)
                return createStreamFromLinearData(this.recordInfo.startData, true);
            }
            else {
                return this.getDataStream()
                    .next(({ data, chunks, chunkIndex }) => {
                        const isLastChunk = chunkIndex === chunks.length-1;
                        return createStreamFromLinearData(data, isLastChunk); //, fileIndex
                    });
            }
        };

        // Gets children from a indexed binary tree of key/value data
        const createStreamFromBinaryTree = async () => {
            const tree = new BinaryBPlusTree({
                readFn: this._treeDataReader.bind(this),
                logger: this.storage.logger,
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
                        ? new BinaryNodeInfo({ path: `${this.address.path}[${key}]`, index: key as number })
                        : new BinaryNodeInfo({ path: `${this.address.path}/${key}`, key: key as string });
                    const res = getValueFromBinary(childInfo, value.recordPointer, 0);
                    if (!res.skip) {
                        let result = callback(childInfo, i++);
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
                        const child = isArray
                            ? new BinaryNodeInfo({ path: `${this.address.path}[${entry.key}]`, index: entry.key as number })
                            : new BinaryNodeInfo({ path: `${this.address.path}/${entry.key}`, key: entry.key as string });
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
        };

        // To get values from binary data:
        const getValueFromBinary = (child: BinaryNodeInfo, binary: number[] | Uint8Array, index: number) => {
            // const startIndex = index;
            const assert = (bytes: number) => {
                if (index + bytes > binary.length) {
                    throw new AdditionalDataRequest();
                }
            };
            assert(2);
            child.type = binary[index] >> 4 as NodeValueType;
            //let value, address;
            const tinyValue = binary[index] & 0xf;
            const valueInfo = binary[index + 1];
            const isRemoved = child.type as number === 0;
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
                if (child.type === VALUE_TYPES.BOOLEAN) { child.value = tinyValue === 1; }
                else if (child.type === VALUE_TYPES.NUMBER) { child.value = tinyValue; }
                else if (child.type === VALUE_TYPES.BIGINT) { child.value = BigInt(tinyValue); }
                else if (child.type === VALUE_TYPES.STRING) { child.value = ''; }
                else if (child.type === VALUE_TYPES.ARRAY) { child.value = []; }
                else if (child.type === VALUE_TYPES.OBJECT) { child.value = {}; }
                else if (child.type === VALUE_TYPES.BINARY) { child.value = new ArrayBuffer(0); }
                else if (child.type === VALUE_TYPES.REFERENCE) { child.value = new PathReference(''); }
                else { throw new Error(`Tiny value deserialization method missing for value type ${child.type}`); }
            }
            else if (isInlineValue) {
                const length = (valueInfo & 63) + 1;
                assert(length);
                const bytes = binary.slice(index, index + length);
                if (child.type === VALUE_TYPES.NUMBER) { child.value = bytesToNumber(bytes); }
                else if (child.type === VALUE_TYPES.BIGINT) { child.value = bytesToBigint(bytes); }
                else if (child.type === VALUE_TYPES.STRING) {
                    child.value = decodeString(bytes); // textDecoder.decode(Uint8Array.from(bytes));
                }
                else if (child.type === VALUE_TYPES.DATETIME) { const time = bytesToNumber(bytes); child.value = new Date(time); }
                //else if (type === VALUE_TYPES.ID) { value = new ID(bytes); }
                else if (child.type === VALUE_TYPES.ARRAY) { throw new Error('Inline array deserialization not implemented'); }
                else if (child.type === VALUE_TYPES.OBJECT) { throw new Error('Inline object deserialization not implemented'); }
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
                if (typeof (binary as any).buffer === 'undefined') {
                    binary = new Uint8Array(binary);
                }
                const view = new DataView((binary as Uint8Array).buffer, (binary as Uint8Array).byteOffset + index, 6);
                const pageNr = view.getUint32(0);
                const recordNr = view.getUint16(4);
                const childPath = isArray ? `${this.address.path}[${child.index}]` : this.address.path === '' ? child.key : `${this.address.path}/${child.key}`;
                child.address = new BinaryNodeAddress(childPath, pageNr, recordNr);

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
        let incompleteData: Uint8Array = null;
        const getChildrenFromChunk = (valueType: number, binary: Uint8Array) => {  //, chunkStartIndex) => {
            if (incompleteData !== null) {
                //chunkStartIndex -= incompleteData.length;
                binary = concatTypedArrays(incompleteData, binary);
                incompleteData = null;
            }
            const children = [];
            if (valueType === VALUE_TYPES.OBJECT || valueType === VALUE_TYPES.ARRAY) {
                isArray = valueType === VALUE_TYPES.ARRAY;
                let index = 0;
                const assert = (bytes: number) => {
                    if (index + bytes > binary.length) { // binary.byteOffset + ... >
                        throw new AdditionalDataRequest();
                    }
                };

                // Index child keys or array indexes
                while(index < binary.length) {
                    const startIndex = index;
                    const child = new BinaryNodeInfo({});

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
                                const key = decodeString(binary.slice(index, index + keyLength));
                                child.key = key;
                                child.path = PathInfo.getChildPath(this.address.path, key);
                                index += keyLength;
                            }
                        }

                        const res = getValueFromBinary(child, binary, index);
                        index = res.index;
                        childCount++;
                        if (res.skip) {
                            continue;
                        }
                        else if (!isArray && options.keyFilter && !(options.keyFilter as string[]).includes(child.key)) {
                            continue;
                        }
                        else if (isArray && options.keyFilter && !(options.keyFilter as number[]).includes(child.index)) {
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
        };

        const createStreamFromLinearData = async (chunkData: Uint8Array, isLastChunk: boolean) => { // , chunkStartIndex
            const children = getChildrenFromChunk(this.recordInfo.valueType, chunkData); //, chunkStartIndex);
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
    async getChildInfo(key: string | number): Promise<BinaryNodeInfo> {
        let childInfo = null;
        await this.getChildStream({ keyFilter: [key] as string[] | number[] })
            .next(info => {
                childInfo = info;
            });
        if (childInfo) {
            return childInfo;
        }
        const childPath = PathInfo.getChildPath(this.address.path, key);
        return new BinaryNodeInfo({
            path: childPath,
            ...(typeof key === 'string' && { key: key as string }),
            ...(typeof key === 'number' && { index: key as number }), // Added 2022/10/10, also support array indexes
            exists: false,
        });
    }

    async _treeDataWriter(binary: number[] | Buffer, index: number) {
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
        const writeRecords = this.recordInfo.allocation.getAddresses(startRecord.nr, endRecord.nr + 1);
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
    async _treeDataReader(index: number, length: number) {
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
        const readRecords = this.recordInfo.allocation.getAddresses(startRecord.nr, endRecord.nr + 1);
        if (readRecords.length === 0) {
            throw new Error(
                `Attempt to read non-existing records of path "/${this.recordInfo.path}": ${startRecord.nr} to ${endRecord.nr + 1} ` +
                `for index ${index} + ${length} bytes. Node has ${this.recordInfo.allocation.totalAddresses} allocated records ` +
                `in the following ranges: ` + this.recordInfo.allocation.toString()
            );
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
        if (bytesRead < bytesPerRecord) { throw new Error(`Not enough bytes read from file at index ${fileIndex}, expected ${bytesPerRecord} but got ${bytesRead}`); }

        const hasKeyIndex = (data[0] & FLAG_KEY_TREE) === FLAG_KEY_TREE;
        const valueType = (data[0] & FLAG_VALUE_TYPE) as NodeValueType; // Last 4-bits of first byte of read data has value type

        // Read Chunk Table
        let view = new DataView(data.buffer);
        let offset = 1;
        const firstRange = new StorageAddressRange(this.address.pageNr, this.address.recordNr, 1);
        const ranges = [firstRange];
        const allocation = new NodeAllocation(ranges);
        let readingRecordIndex = 0;
        let done = false;
        while(!done) {

            if (offset + 9 + 2 >= data.length) {
                // Read more data (next record)
                readingRecordIndex++;
                const [address] = allocation.getAddresses(readingRecordIndex, readingRecordIndex + 1);
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

        this.recordInfo = new RecordInfo(
            this.address.path,
            hasKeyIndex,
            valueType,
            allocation,
            headerLength,
            lastRecordDataLength,
            bytesPerRecord,
            data.slice(headerLength, headerLength + firstRecordDataLength),
        );
        return this.recordInfo;
    }

    getChildTree() {
        if (this.recordInfo === null) { throw new Error('record info hasn\'t been read yet'); }
        if (!this.recordInfo.hasKeyIndex) { throw new Error('record has no key index tree'); }
        return new BinaryBPlusTree({
            readFn: this._treeDataReader.bind(this),
            chunkSize: 1024 * 100, // 100KB reads/writes
            writeFn: this._treeDataWriter.bind(this),
            logger: this.storage.logger,
            id: 'record@' + this.recordInfo.address.toString(),
        });
    }
}
