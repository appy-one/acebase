import { PathInfo, Utils, ID, ColorStyle, Transport } from 'acebase-core';
import { ThreadSafe } from '../thread-safe.js';
import { pfs } from '../promise-fs/index.js';
import { BPlusTreeBuilder, BPlusTree, BinaryBPlusTree, BinaryWriter, BinaryReader, BlacklistingSearchOperator } from '../btree/index.js';
import { getValueType, VALUE_TYPES } from '../node-value-types.js';
import quickSort from '../quicksort.js';
import { IndexQueryStats } from './query-stats.js';
import { IndexQueryResult, IndexQueryResults } from './query-results.js';
import { assert } from '../assert.js';
const { compareValues, getChildValues, numberToBytes, bytesToNumber, encodeString, decodeString } = Utils;
const DISK_BLOCK_SIZE = 4096; // use 512 for older disks
const FILL_FACTOR = 50; // leave room for inserts
const INDEX_INFO_VALUE_TYPE = {
    UNDEFINED: 0,
    STRING: 1,
    NUMBER: 2,
    BOOLEAN: 3,
    ARRAY: 4,
    // Maybe in the future:
    // OBJECT: 5,
};
function _createRecordPointer(wildcards, keyOrIndex) {
    // binary layout:
    // record_pointer   = wildcards_info, key_info, DEPRECATED: record_location
    // wildcards_info   = wildcards_length, wildcards
    // wildcards_length = 1 byte (nr of wildcard values)
    // wildcards        = wilcard[wildcards_length]
    // wildcard         = wilcard_length, wilcard_bytes
    // wildcard_length  = 1 byte
    // wildcard_value   = byte[wildcard_length] (ASCII char codes)
    // key_info         = key_length, key_bytes
    // key_length       = 1 byte
    // key_bytes        = byte[key_length] (ASCII char codes)
    // NOT USED, DEPRECATED:
    // record_location  = page_nr, record_nr
    // page_nr          = 4 byte number
    // record_nr        = 2 byte number
    const recordPointer = [wildcards.length]; // wildcards_length
    for (let i = 0; i < wildcards.length; i++) {
        const wildcard = wildcards[i];
        recordPointer.push(wildcard.length); // wildcard_length
        // wildcard_bytes:
        for (let j = 0; j < wildcard.length; j++) {
            recordPointer.push(wildcard.charCodeAt(j));
        }
    }
    const key = typeof keyOrIndex === 'number' ? `[${keyOrIndex}]` : keyOrIndex;
    recordPointer.push(key.length); // key_length
    // key_bytes:
    for (let i = 0; i < key.length; i++) {
        recordPointer.push(key.charCodeAt(i));
    }
    // // page_nr:
    // recordPointer.push((address.pageNr >> 24) & 0xff);
    // recordPointer.push((address.pageNr >> 16) & 0xff);
    // recordPointer.push((address.pageNr >> 8) & 0xff);
    // recordPointer.push(address.pageNr & 0xff);
    // // record_nr:
    // recordPointer.push((address.recordNr >> 8) & 0xff);
    // recordPointer.push(address.recordNr & 0xff);
    return recordPointer;
}
function _parseRecordPointer(path, recordPointer) {
    if (recordPointer.length === 0) {
        throw new Error('Invalid record pointer length');
    }
    const wildcardsLength = recordPointer[0];
    const wildcards = [];
    let index = 1;
    for (let i = 0; i < wildcardsLength; i++) {
        let wildcard = '';
        const length = recordPointer[index];
        for (let j = 0; j < length; j++) {
            wildcard += String.fromCharCode(recordPointer[index + j + 1]);
        }
        wildcards.push(wildcard);
        index += length + 1;
    }
    const keyLength = recordPointer[index];
    let key = '';
    for (let i = 0; i < keyLength; i++) {
        key += String.fromCharCode(recordPointer[index + i + 1]);
    }
    index += keyLength + 1;
    // const pageNr = recordPointer[index] << 24 | recordPointer[index+1] << 16 | recordPointer[index+2] << 8 | recordPointer[index+3];
    // index += 4;
    // const recordNr = recordPointer[index] << 8 | recordPointer[index+1];
    if (wildcards.length > 0) {
        let i = 0;
        path = path.replace(/\*/g, () => {
            const wildcard = wildcards[i];
            i++;
            return wildcard;
        });
    }
    // return { key, pageNr, recordNr, address: new NodeAddress(`${path}/${key}`, pageNr, recordNr) };
    const keyOrIndex = key[0] === '[' && key.slice(-1) === ']' ? parseInt(key.slice(1, -1)) : key;
    return { key: keyOrIndex, path: `${path}/${key}`, wildcards };
}
export class DataIndex {
    static get STATE() {
        return {
            INIT: 'init',
            READY: 'ready',
            BUILD: 'build',
            REBUILD: 'rebuild',
            ERROR: 'error',
            REMOVED: 'removed',
            CLOSED: 'closed',
        };
    }
    /**
     * Creates a new index
     */
    constructor(storage, path, key, options = {}) {
        this.storage = storage;
        this.state = DataIndex.STATE.INIT;
        this._buildError = null;
        this._cache = new Map();
        this._cacheTimeoutSettings = {
            // default: 1 minute query cache
            duration: 60 * 1000,
            sliding: true,
        };
        if (['string', 'undefined'].indexOf(typeof options.include) < 0 && !(options.include instanceof Array)) {
            throw new Error(`includeKeys argument must be a string, an Array of strings, or undefined. Passed type=${typeof options.include}`);
        }
        if (typeof options.include === 'string') {
            options.include = [options.include];
        }
        const pathKeys = PathInfo.getPathKeys(path).map(key => typeof key === 'string' && key.startsWith('$') ? '*' : key);
        this.path = (new PathInfo(pathKeys)).path; // path.replace(/\/\*$/, ""); // Remove optional trailing "/*"
        this.key = key;
        this.caseSensitive = options.caseSensitive === true;
        this.textLocale = options.textLocale || 'en';
        this.textLocaleKey = options.textLocaleKey;
        this.includeKeys = options.include || [];
        // this.enableReverseLookup = false;
        this.indexMetadataKeys = [];
        this._buildError = null;
        this._updateQueue = [];
        this.trees = {
            'default': {
                fileIndex: 0,
                byteLength: 0,
                class: 'BPlusTree',
                version: 1,
                entries: 0,
                values: 0,
            },
        };
    }
    get allMetadataKeys() {
        return this.includeKeys.concat(this.indexMetadataKeys);
    }
    setCacheTimeout(seconds, sliding = false) {
        this._cacheTimeoutSettings = {
            duration: seconds * 1000,
            sliding,
        };
    }
    cache(op, param, results) {
        const val = JSON.stringify(Transport.serialize2(param)); // Make object and array params cachable too
        if (typeof results === 'undefined') {
            // Get from cache
            let cache;
            if (this._cache.has(op) && this._cache.get(op).has(val)) {
                cache = this._cache.get(op).get(val);
            }
            if (cache) {
                cache.reads++;
                if (this._cacheTimeoutSettings.sliding) {
                    cache.extendLife();
                }
                return cache.results;
            }
            return null;
        }
        else {
            // Set cache
            let opCache = this._cache.get(op);
            if (!opCache) {
                opCache = new Map();
                this._cache.set(op, opCache);
            }
            // let clear = () => {
            //     // this.storage.debug.log(`Index ${this.description}, cache clean for ${op} "${val}"`);
            //     opCache.delete(val);
            // }
            const scheduleClear = () => {
                const timeout = setTimeout(() => opCache.delete(val), this._cacheTimeoutSettings.duration);
                timeout.unref && timeout.unref();
                return timeout;
            };
            const cache = {
                results,
                added: Date.now(),
                reads: 0,
                timeout: scheduleClear(),
                extendLife: () => {
                    // this.storage.debug.log(`Index ${this.description}, cache lifetime extended for ${op} "${val}". reads: ${cache.reads}`);
                    clearTimeout(cache.timeout);
                    cache.timeout = scheduleClear();
                },
            };
            opCache.set(val, cache);
            // this.storage.debug.log(`Index ${this.description}, cached ${results.length} results for ${op} "${val}"`);
        }
    }
    async delete() {
        const idx = await this._getTree('exclusive');
        await idx.close();
        const filePath = this.fileName; // `${this.storage.settings.path}/${this.storage.name}.acebase/${this.fileName}`;
        await pfs.rm(filePath);
        this.state = DataIndex.STATE.REMOVED;
        idx.release();
    }
    async close() {
        const idx = await this._getTree('exclusive');
        await idx.close();
        this.state = DataIndex.STATE.CLOSED;
        idx.release();
    }
    /**
     * Reads an existing index from a file
     * @param storage Used storage engine
     * @param fileName
     */
    static async readFromFile(storage, fileName) {
        // Read an index from file
        const filePath = fileName.includes('/') ? fileName : `${storage.settings.path}/${storage.name}.acebase/${fileName}`;
        const fd = await pfs.open(filePath, pfs.flags.read);
        try {
            // Read signature
            let result = await pfs.read(fd, Buffer.alloc(10));
            // Check signature
            if (result.buffer.toString() !== 'ACEBASEIDX') {
                throw new Error(`File "${filePath}" is not an AceBase index. If you get this error after updating acebase, delete the index file and rebuild it`);
            }
            // Read layout_version
            result = await pfs.read(fd, Buffer.alloc(1));
            const versionNr = result.buffer[0];
            if (versionNr !== 1) {
                throw new Error(`Index "${filePath}" version ${versionNr} is not supported by this version of AceBase. npm update your acebase packages`);
            }
            // Read header_length
            result = await pfs.read(fd, Buffer.alloc(4));
            const headerLength = (result.buffer[0] << 24) | (result.buffer[1] << 16) | (result.buffer[2] << 8) | result.buffer[3];
            // Read header
            result = await pfs.read(fd, Buffer.alloc(headerLength - 11));
            // Process header
            const header = Uint8Array.from(result.buffer);
            let index = 0;
            const readKey = () => {
                const keyLength = header[index];
                let keyName = '';
                index++;
                for (let j = 0; j < keyLength; j++) {
                    keyName += String.fromCharCode(header[index + j]);
                }
                index += keyLength;
                return keyName;
            };
            const readValue = () => {
                const valueType = header[index];
                index++;
                let valueLength = 0;
                if (valueType === INDEX_INFO_VALUE_TYPE.UNDEFINED) {
                    valueLength = 0;
                }
                else if (valueType === INDEX_INFO_VALUE_TYPE.BOOLEAN) {
                    // boolean has no value_length
                    valueLength = 1;
                }
                else {
                    valueLength = (header[index] << 8) | header[index + 1];
                    index += 2;
                }
                let value;
                if (valueType === INDEX_INFO_VALUE_TYPE.STRING) {
                    value = decodeString(header.slice(index, index + valueLength));
                }
                else if (valueType === INDEX_INFO_VALUE_TYPE.NUMBER) {
                    value = bytesToNumber(header.slice(index, index + valueLength));
                }
                else if (valueType === INDEX_INFO_VALUE_TYPE.BOOLEAN) {
                    value = header[index] === 1;
                }
                else if (valueType === INDEX_INFO_VALUE_TYPE.ARRAY) {
                    const arr = [];
                    for (let j = 0; j < valueLength; j++) {
                        arr.push(readValue());
                    }
                    return arr;
                }
                // Maybe in the future:
                // else if (valueType === INDEX_INFO_VALUE_TYPE.OBJECT) {
                //     const obj = {} as Record<string, IndexInfoPrimitiveValue>;
                //     for (let j = 0; j < valueLength; j++) {
                //         const prop = readKey();
                //         const val = readValue() as IndexInfoPrimitiveValue;
                //         obj[prop] = val;
                //     }
                //     return obj;
                // }
                index += valueLength;
                return value;
            };
            const readInfo = () => {
                const infoCount = header[index];
                index++;
                const info = {};
                for (let i = 0; i < infoCount; i++) {
                    const key = readKey();
                    const value = readValue();
                    info[key] = value;
                }
                return info;
            };
            const indexInfo = readInfo();
            const indexOptions = {
                caseSensitive: indexInfo.cs,
                textLocale: indexInfo.locale,
                textLocaleKey: indexInfo.localeKey,
                include: indexInfo.include,
            };
            if (!(indexInfo.type in DataIndex.KnownIndexTypes)) {
                throw new Error(`Unknown index type ${indexInfo.type}`);
            }
            const Index = DataIndex.KnownIndexTypes[indexInfo.type];
            const dataIndex = new Index(storage, indexInfo.path, indexInfo.key, indexOptions);
            dataIndex._fileName = filePath;
            // trees_info:
            const treesCount = header[index];
            index++;
            for (let i = 0; i < treesCount; i++) {
                // tree_name:
                const treeName = readKey();
                // treeName is "default"
                const treeInfo = dataIndex.trees[treeName] = {};
                // file_index:
                treeInfo.fileIndex = (header[index] << 24) | (header[index + 1] << 16) | (header[index + 2] << 8) | header[index + 3];
                index += 4;
                // byte_length:
                treeInfo.byteLength = (header[index] << 24) | (header[index + 1] << 16) | (header[index + 2] << 8) | header[index + 3];
                index += 4;
                const info = readInfo();
                // info has: class, version, entries, values
                Object.assign(treeInfo, info); //treeInfo.info = info;
            }
            await pfs.close(fd);
            dataIndex.state = DataIndex.STATE.READY;
            return dataIndex;
        }
        catch (err) {
            storage.debug.error(err);
            pfs.close(fd);
            throw err;
        }
    }
    get type() {
        return 'normal';
    }
    get fileName() {
        if (this._fileName) {
            // Set by readFromFile
            return this._fileName;
        }
        const dir = `${this.storage.settings.path}/${this.storage.name}.acebase`;
        const storagePrefix = this.storage.settings.type !== 'data' ? `[${this.storage.settings.type}]-` : '';
        const escape = (key) => key.replace(/\//g, '~').replace(/\*/g, '#');
        const escapedPath = escape(this.path);
        const escapedKey = escape(this.key);
        const includes = this.includeKeys.length > 0
            ? ',' + this.includeKeys.map(key => escape(key)).join(',')
            : '';
        const extension = (this.type !== 'normal' ? `${this.type}.` : '') + 'idx';
        return `${dir}/${storagePrefix}${escapedPath}-${escapedKey}${includes}.${extension}`;
    }
    get description() {
        const keyPath = `/${this.path}/*/${this.key}`;
        const includedKeys = this.includeKeys.length > 0 ? '+' + this.includeKeys.join(',') : '';
        let description = `${keyPath}${includedKeys}`;
        if (this.type !== 'normal') {
            description += ` (${this.type})`;
        }
        return description;
    }
    _getWildcardKeys(path) {
        const pathKeys = PathInfo.getPathKeys(path);
        const indexKeys = PathInfo.getPathKeys(this.path);
        return indexKeys.reduce((wildcards, key, i) => {
            if (key === '*') {
                wildcards.push(pathKeys[i]);
            }
            return wildcards;
        }, []);
    }
    // _getRevLookupKey(path) {
    //     const key = getPathInfo(path).key;
    //     const wildcardKeys = this._getWildcardKeys(path);
    //     return `:${wildcardKeys.join(':')}${wildcardKeys.length > 0 ? ':' : ''}${key}:`;
    // }
    // _updateReverseLookupKey(path, oldData, newData, metadata) {
    //     if (!this.enableReverseLookup) {
    //         throw new Error(`This index does not support reverse lookups`)
    //     }
    //     function areEqual(val1, val2) {
    //         return val1.length === val2.length && val1.every((byte, index) => val2[index] === byte);
    //     }
    //     if (areEqual(oldData, newData)) {
    //         // Everything remains the same
    //         return;
    //     }
    //     const revLookupKey = this._getRevLookupKey(path);
    //     return this._updateTree(path, revLookupKey, revLookupKey, oldData, newData, metadata);
    // }
    _updateTree(path, oldValue, newValue, oldRecordPointer, newRecordPointer, metadata) {
        const canBeIndexed = ['number', 'boolean', 'string', 'bigint'].indexOf(typeof newValue) >= 0 || newValue instanceof Date;
        const operations = [];
        if (oldValue !== null) {
            const op = BinaryBPlusTree.TransactionOperation.remove(oldValue, oldRecordPointer);
            operations.push(op);
        }
        if (newValue !== null && canBeIndexed) {
            const op = BinaryBPlusTree.TransactionOperation.add(newValue, newRecordPointer, metadata);
            operations.push(op);
        }
        return this._processTreeOperations(path, operations);
    }
    async _rebuild(idx) {
        // Rebuild by writing to temp file
        const newIndexFile = this.fileName + '.tmp';
        const fd = await pfs.open(newIndexFile, pfs.flags.write);
        const treeStatistics = {
            byteLength: 0,
            totalEntries: 0,
            totalValues: 0,
        };
        const headerStats = {
            written: false,
            length: 0,
            promise: null,
            updateTreeLength: undefined, //Awaited<ReturnType<this['_writeIndexHeader']>>['treeLengthCallback'],
        };
        const writer = async (data, index) => {
            if (!headerStats.written) {
                // Write header first, or wait until done
                if (!headerStats.promise) {
                    headerStats.promise = this._writeIndexHeader(fd, treeStatistics).then(result => {
                        headerStats.written = true;
                        headerStats.length = result.length;
                        headerStats.updateTreeLength = result.treeLengthCallback;
                    });
                }
                await headerStats.promise;
            }
            await pfs.write(fd, data, 0, data.length, headerStats.length + index);
        };
        this.state = DataIndex.STATE.REBUILD;
        try {
            // this._fst = []; // Reset fst memory
            await idx.tree.rebuild(BinaryWriter.forFunction(writer), { treeStatistics });
            await idx.close();
            await headerStats.updateTreeLength(treeStatistics.byteLength);
            await pfs.close(fd);
            const renameFile = async (retry = 0) => {
                try {
                    // rename new file, overwriting the old file
                    await pfs.rename(newIndexFile, this.fileName);
                }
                catch (err) {
                    // Occasionally getting EPERM "operation not permitted" errors lately with Node 16.
                    // Fix: try again after 100ms, up to 10 times
                    if (err.code === 'EPERM' && retry < 10) {
                        await new Promise(resolve => setTimeout(resolve, 100));
                        await renameFile(retry + 1);
                    }
                    throw err;
                }
            };
            await renameFile();
            this.state = DataIndex.STATE.READY;
            idx.release();
        }
        catch (err) {
            this.storage.debug.error('Index rebuild error: ', err);
            this.state = DataIndex.STATE.ERROR;
            this._buildError = err;
            idx.release();
            throw err;
        }
    }
    async _processTreeOperations(path, operations) {
        const startTime = Date.now();
        if (this._buildError) {
            throw new Error('Cannot update index because there was an error building it');
        }
        let idx = await this._getTree('exclusive');
        // const oldEntry = tree.find(keyValues.oldValue);
        const go = async (retry = 0) => {
            const opsCount = operations.length;
            try {
                await idx.tree.transaction(operations);
                // Index updated
                idx.release();
                return false; // "not rebuilt"
            }
            catch (err) {
                // Could not update index --> leaf full?
                this.storage.debug.verbose(`Could not update index ${this.description}: ${err.message}`.colorize(ColorStyle.yellow));
                if (retry > 0 && opsCount === operations.length) {
                    throw new Error(`DEV ERROR: unable to process operations because tree was rebuilt, and that didn't help?! --> ${err.stack}`);
                }
                await this._rebuild(idx); // rebuild calls idx.close() and .release()
                // Process left-over operations
                this.storage.debug.verbose('Index was rebuilt, retrying pending operations');
                idx = await this._getTree('exclusive');
                await go(retry + 1);
                return true; // "rebuilt"
            }
        };
        const rebuilt = await go();
        // this.storage.debug.log(`Released update lock on index ${this.description}`.colorize(ColorStyle.blue));
        const doneTime = Date.now();
        const ms = doneTime - startTime;
        const duration = ms < 5000 ? ms + 'ms' : Math.round(ms / 1000) + 's';
        this.storage.debug.verbose(`Index ${this.description} was ${rebuilt ? 'rebuilt' : 'updated'} successfully for "/${path}", took ${duration}`.colorize(ColorStyle.green));
        // Process any queued updates
        return await this._processUpdateQueue();
    }
    clearCache(forPath) {
        this._cache.clear(); // TODO: check which cache results should be adjusted intelligently
    }
    async _processUpdateQueue() {
        const queue = this._updateQueue.splice(0);
        if (queue.length === 0) {
            return;
        }
        // Invalidate query cache
        this._cache.clear(); // TODO: check which cache results should be adjusted intelligently
        // Process all queued items
        const promises = queue.map(update => {
            return this._updateTree(update.path, update.oldValue, update.newValue, update.recordPointer, update.recordPointer, update.metadata)
                .then(() => {
                update.resolve(); // Resolve waiting promise
            })
                .catch(err => {
                update.reject(err); // Reject waiting promise
                // Do not throw again
            });
        });
        await Promise.all(promises);
    }
    async handleRecordUpdate(path, oldValue, newValue, indexMetadata) {
        this.storage.debug.verbose(`Handling index ${this.description} update request for "/${path}"`);
        const getValues = (key, oldValue, newValue) => PathInfo.getPathKeys(key).reduce((values, key) => getChildValues(key, values.oldValue, values.newValue), { oldValue, newValue });
        const updatedKey = PathInfo.get(path).key;
        if (typeof updatedKey === 'number') {
            throw new Error('Not implemented: updated key is a number!');
        }
        const keyValues = this.key === '{key}'
            ? { oldValue: oldValue === null ? null : updatedKey, newValue: newValue === null ? null : updatedKey }
            : getValues(this.key, oldValue, newValue);
        const includedValues = this.includeKeys.map(key => getValues(key, oldValue, newValue));
        if (!this.caseSensitive) {
            // Convert to locale aware lowercase
            const allValues = [keyValues].concat(includedValues);
            allValues.forEach(values => {
                if (typeof values.oldValue === 'string') {
                    values.oldValue = values.oldValue.toLocaleLowerCase(this.textLocale);
                }
                if (typeof values.newValue === 'string') {
                    values.newValue = values.newValue.toLocaleLowerCase(this.textLocale);
                }
            });
        }
        const keyValueChanged = compareValues(keyValues.oldValue, keyValues.newValue) !== 'identical';
        const includedValuesChanged = includedValues.some(values => compareValues(values.oldValue, values.newValue) !== 'identical');
        if (!keyValueChanged && !includedValuesChanged) {
            this.storage.debug.verbose(`Update on "/${path}" has no effective changes for index ${this.description}`);
            return;
        }
        const wildcardKeys = this._getWildcardKeys(path);
        const recordPointer = _createRecordPointer(wildcardKeys, updatedKey);
        const metadata = (() => {
            const obj = {};
            indexMetadata && Object.assign(obj, indexMetadata);
            if (typeof newValue === 'object' && newValue !== null) {
                this.includeKeys.forEach(key => obj[key] = newValue[key]);
            }
            return obj;
        })();
        if (this.state === DataIndex.STATE.ERROR) {
            throw new Error(`Cannot update index ${this.description}: it's in the error state: ${this._buildError?.stack}`);
        }
        else if (this.state === DataIndex.STATE.READY) {
            // Invalidate query cache
            this._cache.clear();
            // Update the tree
            this.storage.debug.verbose(`Updating index ${this.description} tree for "/${path}"`);
            return await this._updateTree(path, keyValues.oldValue, keyValues.newValue, recordPointer, recordPointer, metadata);
        }
        else {
            this.storage.debug.log(`Queueing index ${this.description} update for "/${path}"`);
            // Queue the update
            const update = {
                path,
                oldValue: keyValues.oldValue,
                newValue: keyValues.newValue,
                recordPointer,
                metadata,
                resolve: null,
                reject: null,
            };
            // Create a promise that resolves once the queued item has processed
            const p = new Promise((resolve, reject) => {
                update.resolve = resolve;
                update.reject = reject;
            }).catch(err => {
                this.storage.debug.error(`Unable to process queued update for "/${path}" on index ${this.description}:`, err);
            });
            this._updateQueue.push(update);
            //return p; // Don't wait for p, prevents deadlock when tree is rebuilding
        }
    }
    async _lock(mode = 'exclusive', timeout = 60000) {
        return ThreadSafe.lock(this.fileName, { shared: mode === 'shared', timeout }); //, timeout: 15 * 60000 (for debugging)
    }
    async count(op, val) {
        if (!this.caseSensitive) {
            // Convert to locale aware lowercase
            if (typeof val === 'string') {
                val = val.toLocaleLowerCase(this.textLocale);
            }
            else if (val instanceof Array) {
                val = val.map(val => {
                    if (typeof val === 'string') {
                        return val.toLocaleLowerCase(this.textLocale);
                    }
                    return val;
                });
            }
        }
        const cacheKey = op + '{count}';
        const cache = this.cache(cacheKey, val);
        if (cache) {
            // Cached count, saves time!
            return cache;
        }
        const idx = await this._getTree('shared');
        const result = await idx.tree.search(op, val, { count: true, keys: true, values: false });
        idx.release();
        this.cache(cacheKey, val, result.valueCount);
        return result.valueCount;
    }
    async take(skip, take, options = {}) {
        const ascending = options.ascending !== false;
        const sort = options.metadataSort?.length > 0 ? options.metadataSort : [];
        sort.forEach(s => {
            if (!this.allMetadataKeys.includes(s.key)) {
                throw new Error(`Cannot sort on metadata key ${s.key} because it is not present in index ${this.fileName}`);
            }
        });
        const cacheKey = JSON.stringify({ skip, take, options });
        const cache = this.cache('take', cacheKey);
        if (cache) {
            return cache;
        }
        const stats = new IndexQueryStats('take', { skip, take, ascending }, true);
        const idx = await this._getTree('shared');
        const results = new IndexQueryResults(); //[];
        results.filterKey = this.key;
        let skipped = 0;
        let leaf = await (ascending ? idx.tree.getFirstLeaf() : idx.tree.getLastLeaf());
        do {
            if (!ascending) {
                leaf.entries.reverse();
            }
            for (let i = 0; i < leaf.entries.length && results.length < take; i++) {
                const entry = leaf.entries[i];
                const value = entry.key;
                if (sort.length > 0 && entry.totalValues > 1 && skipped + entry.totalValues > skip) {
                    // Sort values on given metadata first
                    if (leaf.hasExtData && !leaf.extData.loaded) {
                        await leaf.extData.load();
                    }
                    const applySort = (index, a, b) => {
                        const { key, ascending } = sort[index];
                        if (a.metadata[key] < b.metadata[key]) {
                            return ascending ? -1 : 1;
                        }
                        else if (a.metadata[key] > b.metadata[key]) {
                            return ascending ? 1 : -1;
                        }
                        else if (index + 1 === sort.length) {
                            return 1;
                        }
                        return applySort(index + 1, a, b);
                    };
                    entry.values.sort((a, b) => applySort(0, a, b));
                }
                for (let j = 0; j < entry.totalValues && results.length < take; j++) {
                    if (skipped < skip) {
                        skipped++;
                        continue;
                    }
                    if (leaf.hasExtData && !leaf.extData.loaded) {
                        await leaf.extData.load();
                    }
                    const entryValue = entry.values[j];
                    const recordPointer = _parseRecordPointer(this.path, entryValue.recordPointer);
                    const metadata = entryValue.metadata;
                    const result = new IndexQueryResult(recordPointer.key, recordPointer.path, value, metadata);
                    results.push(result);
                }
            }
            leaf = results.length === take
                ? null
                : await (ascending ? leaf.getNext?.() : leaf.getPrevious?.());
        } while (leaf);
        idx.release();
        stats.stop(results.length);
        results.stats = stats;
        this.cache('take', cacheKey, results);
        return results;
    }
    static get validOperators() {
        return ['<', '<=', '==', '!=', '>=', '>', 'exists', '!exists', 'between', '!between', 'like', '!like', 'matches', '!matches', 'in', '!in'];
    }
    get validOperators() {
        return DataIndex.validOperators;
    }
    async query(op, val, options = {}) {
        if (!(op instanceof BlacklistingSearchOperator) && !DataIndex.validOperators.includes(op)) {
            throw new TypeError(`Cannot use operator "${op}" to query index "${this.description}"`);
        }
        if (!this.caseSensitive) {
            // Convert to locale aware lowercase
            if (typeof val === 'string') {
                val = val.toLocaleLowerCase(this.textLocale);
            }
            else if (val instanceof Array) {
                val = val.map(val => {
                    if (typeof val === 'string') {
                        return val.toLocaleLowerCase(this.textLocale);
                    }
                    return val;
                });
            }
        }
        const stats = new IndexQueryStats('query', { op, val }, true);
        let entries; // ;
        const isCacheable = !(op instanceof BlacklistingSearchOperator);
        const cache = isCacheable && this.cache(op, val);
        if (cache) {
            entries = cache;
        }
        else {
            const idx = await this._getTree('shared');
            const searchOptions = {
                entries: true,
                // filter: options.filter && options.filter.treeEntries // Don't let tree apply filter, so we can cache results before filtering ourself
            };
            const result = await idx.tree.search(op, val, searchOptions);
            entries = result.entries;
            idx.release();
            // Cache entries
            isCacheable && this.cache(op, val, entries);
        }
        const results = new IndexQueryResults();
        results.filterKey = this.key;
        results.entryValues = [];
        if (options.filter) {
            const filterStep = new IndexQueryStats('filter', {
                entries: entries.length,
                entryValues: entries.reduce((total, entry) => total + entry.values.length, 0),
                filterValues: options.filter.entryValues.length,
            }, true);
            stats.steps.push(filterStep);
            let values = [];
            const valueEntryIndexes = [];
            entries.forEach(entry => {
                valueEntryIndexes.push(values.length);
                values = values.concat(entry.values);
            });
            const filterValues = options.filter.entryValues;
            // Pre-process recordPointers to speed up matching
            const preProcess = (values, tree = false) => {
                if (tree && values.rpTree) {
                    return;
                }
                const builder = tree ? new BPlusTreeBuilder(true, 100) : null;
                for (let i = 0; i < values.length; i++) {
                    const val = values[i];
                    let rp = val.rp || '';
                    if (rp === '') {
                        for (let j = 0; j < val.recordPointer.length; j++) {
                            rp += val.recordPointer[j].toString(36);
                        }
                        val.rp = rp;
                    }
                    if (tree && !builder.list.has(rp)) {
                        builder.add(rp, [i]);
                    }
                }
                if (tree) {
                    values.rpTree = builder.create();
                }
            };
            // preProcess(values);
            // preProcess(filterValues);
            // Loop through smallest set
            const smallestSet = filterValues.length < values.length ? filterValues : values;
            preProcess(smallestSet, false);
            const otherSet = smallestSet === filterValues ? values : filterValues;
            preProcess(otherSet, true);
            // TODO: offload filtering from event loop to stay responsive
            for (let i = 0; i < smallestSet.length; i++) {
                const value = smallestSet[i];
                // Find in other set
                let match = null;
                let matchIndex;
                const tree = otherSet.rpTree;
                const rpEntryValue = tree.find(value.rp);
                if (rpEntryValue) {
                    const j = rpEntryValue.recordPointer[0];
                    match = smallestSet === values ? value : otherSet[j];
                    matchIndex = match === value ? i : j;
                }
                if (match) {
                    const recordPointer = _parseRecordPointer(this.path, match.recordPointer);
                    const metadata = match.metadata;
                    const entry = entries[valueEntryIndexes.findIndex((entryIndex, i, arr) => i + 1 === arr.length || (entryIndex <= matchIndex && arr[i + 1] > matchIndex))];
                    const result = new IndexQueryResult(recordPointer.key, recordPointer.path, entry.key, metadata);
                    // result.entry = entry;
                    results.push(result);
                    results.entryValues.push(match);
                }
            }
            filterStep.stop({ results: results.length, values: results.entryValues.length });
        }
        else {
            // No filter, add all (unique) results
            const uniqueRecordPointers = new Set();
            entries.forEach(entry => {
                entry.values.forEach(value => {
                    const recordPointer = _parseRecordPointer(this.path, value.recordPointer);
                    if (!uniqueRecordPointers.has(recordPointer.path)) {
                        // If a single recordPointer exists in multiple entries (can happen with eg 'like' queries),
                        // only add the first one, ignore others (prevents duplicate results!)
                        uniqueRecordPointers.add(recordPointer.path);
                        const metadata = value.metadata;
                        const result = new IndexQueryResult(recordPointer.key, recordPointer.path, entry.key, metadata);
                        // result.entry = entry;
                        results.push(result);
                        results.entryValues.push(value);
                    }
                });
            });
            uniqueRecordPointers.clear(); // Help GC
        }
        stats.stop(results.length);
        results.stats = stats;
        return results;
    }
    async build(options) {
        if ([DataIndex.STATE.BUILD, DataIndex.STATE.REBUILD].includes(this.state)) {
            throw new Error('Index is already being built');
        }
        this.state = this.state === DataIndex.STATE.READY
            ? DataIndex.STATE.REBUILD // Existing index file has to be overwritten in the last phase
            : DataIndex.STATE.BUILD;
        this._buildError = null;
        const path = this.path;
        const wildcardNames = Array.from(path.match(/\*|\$[a-z0-9_]+/gi) ?? []);
        // const hasWildcards = wildcardNames.length > 0;
        const wildcardsPattern = '^' + path.replace(/\*|\$[a-z0-9_]+/gi, '([a-z0-9_]+)') + '/';
        const wildcardRE = new RegExp(wildcardsPattern, 'i');
        // let treeBuilder = new BPlusTreeBuilder(false, FILL_FACTOR, this.allMetadataKeys); //(30, false);
        // let idx; // Once using binary file to write to
        const tid = ID.generate();
        const keys = PathInfo.getPathKeys(path);
        const indexableTypes = [VALUE_TYPES.STRING, VALUE_TYPES.NUMBER, VALUE_TYPES.BOOLEAN, VALUE_TYPES.DATETIME, VALUE_TYPES.BIGINT];
        const allowedKeyValueTypes = options && options.valueTypes
            ? options.valueTypes
            : indexableTypes;
        this.storage.debug.log(`Index build ${this.description} started`.colorize(ColorStyle.blue));
        let indexedValues = 0;
        // let addPromise;
        // let flushed = false;
        // const __DEV_UNIQUE_SET = new Set();
        // const __DEV_CHECK_UNIQUE = (key) => {
        //     if (__DEV_UNIQUE_SET.has(key)) {
        //         console.warn(`Duplicate key: ${key}`);
        //     }
        //     else {
        //         __DEV_UNIQUE_SET.add(key);
        //     }
        // };
        const buildFile = this.fileName + '.build';
        const createBuildFile = () => {
            return new Promise((resolve, reject) => {
                const buildWriteStream = pfs.fs.createWriteStream(buildFile, { flags: pfs.flags.readAndAppendAndCreate });
                const streamState = { wait: false, chunks: [] };
                buildWriteStream.on('error', (err) => {
                    console.error(err);
                    reject(err);
                });
                buildWriteStream.on('open', async () => {
                    await getAll('', 0);
                    // if (indexedValues === 0) {
                    //     const err = new Error('No values found to index');
                    //     err.code = 'NO_DATA';
                    //     buildWriteStream.close(() => {
                    //         pfs.rm(buildFile)
                    //         .then(() => {
                    //             reject(err);
                    //         })
                    //         return reject(err);
                    //     });
                    //     return;
                    // }
                    this.storage.debug.log(`done writing values to ${buildFile}`);
                    if (streamState.wait) {
                        buildWriteStream.once('drain', () => {
                            buildWriteStream.end(resolve);
                        });
                    }
                    else {
                        buildWriteStream.end(resolve);
                    }
                });
                buildWriteStream.on('drain', () => {
                    // Write queued chunks
                    const totalBytes = streamState.chunks.reduce((total, bytes) => total + bytes.length, 0);
                    const buffer = new Uint8Array(totalBytes);
                    let offset = 0;
                    streamState.chunks.forEach(bytes => {
                        buffer.set(bytes, offset);
                        offset += bytes.length;
                    });
                    // Write!
                    streamState.chunks = [];
                    streamState.wait = !buildWriteStream.write(buffer, err => {
                        assert(!err, `Failed to write to stream: ${err && err.message}`);
                    });
                });
                const writeToStream = (bytes) => {
                    if (streamState.wait) {
                        streamState.chunks.push(bytes);
                        assert(streamState.chunks.length < 100000, 'Something going wrong here');
                    }
                    else {
                        streamState.wait = !buildWriteStream.write(Buffer.from(bytes), err => {
                            assert(!err, `Failed to write to stream: ${err && err.message}`);
                        });
                    }
                };
                const isWildcardKey = (key) => typeof key === 'string' && (key === '*' || key.startsWith('$'));
                const getAll = async (currentPath, keyIndex) => {
                    // "users/*/posts"
                    // --> Get all children of "users",
                    // --> get their "posts" children,
                    // --> get their children to index
                    let path = currentPath;
                    while (keys[keyIndex] && !isWildcardKey(keys[keyIndex])) {
                        path = PathInfo.getChildPath(path, keys[keyIndex]); // += keys[keyIndex];
                        keyIndex++;
                    }
                    const isTargetNode = keyIndex === keys.length;
                    const getChildren = async () => {
                        const childKeys = [];
                        try {
                            await this.storage.getChildren(path).next(child => {
                                const keyOrIndex = typeof child.index === 'number' ? child.index : child.key;
                                if (!child.address || child.type !== VALUE_TYPES.OBJECT) {
                                    return; // This child cannot be indexed because it is not an object with properties
                                }
                                else {
                                    childKeys.push(keyOrIndex);
                                }
                            });
                        }
                        catch (reason) {
                            // Record doesn't exist? No biggy
                            this.storage.debug.warn(`Could not get children of "/${path}": ${reason.message}`);
                        }
                        // Iterate through the children in batches of max n nodes
                        // should be determined by amount of * wildcards in index path
                        // If there are 0 wildcards, batch size of 500 is ok
                        // if there is 1 wildcard, use batch size 22 (sqrt of 500, 500^0.5),
                        // 2 wildcards: batch size 5 (2v500 or 500^0.25),
                        // 3 wildcards: batch size 2 (3v500 or 500^00.125)
                        // Algebra refresh:
                        // a = Math.pow(b, c)
                        // c = Math.log(a) / Math.log(b)
                        // b = Math.pow(a, Math.pow(0.5, c))
                        // a is our max batch size, we'll use 500
                        // c is our depth (nrOfWildcards) so we know this
                        // b is our unknown start number
                        const maxBatchSize = Math.round(Math.pow(500, Math.pow(0.5, wildcardNames.length)));
                        const batches = [];
                        while (childKeys.length > 0) {
                            const batchChildren = childKeys.splice(0, maxBatchSize);
                            batches.push(batchChildren);
                        }
                        while (batches.length > 0) {
                            const batch = batches.shift();
                            await Promise.all(batch.map(async (childKey) => {
                                const childPath = PathInfo.getChildPath(path, childKey);
                                // do it
                                if (!isTargetNode) {
                                    // Go deeper
                                    return getAll(childPath, keyIndex + 1);
                                }
                                else {
                                    // We have to index this child, get all required values for the entry
                                    const wildcardValues = childPath.match(wildcardRE).slice(1);
                                    const neededKeys = [this.key].concat(this.includeKeys);
                                    const keyFilter = neededKeys.filter(key => key !== '{key}' && !wildcardNames.includes(key));
                                    if (this.textLocaleKey) {
                                        keyFilter.push(this.textLocaleKey);
                                    }
                                    let keyValue = null; // initialize to null so we can check if it had a valid indexable value
                                    let locale = this.textLocale;
                                    const metadata = (() => {
                                        // create properties for each included key, if they are not set by the loop they will still be in the metadata (which is required for B+Tree metadata)
                                        const obj = {};
                                        this.includeKeys.forEach(key => obj[key] = undefined);
                                        return obj;
                                    })();
                                    const addValue = (key, value) => {
                                        if (key === this.key) {
                                            keyValue = value;
                                        }
                                        else if (key === this.textLocaleKey && typeof value === 'string') {
                                            locale = value;
                                        }
                                        else {
                                            metadata[key] = value;
                                        }
                                    };
                                    const gotNamedWildcardKeys = ['{key}'].concat(wildcardNames).filter(key => key !== '*');
                                    // Add special indexable key values from the current path, such as '{key}' for the current key,
                                    // and named wildcards such as '$id'. This allows parts of the path to be indexed, or included in the index.
                                    //
                                    // Imagine an index on path 'users/$userId/posts/$postId/comments'
                                    //
                                    // - indexing on special key '{key}' allows quick lookups on a specific commentId without the need to know
                                    //   the userId or postId it belongs to:
                                    //
                                    //   db.query('users/*/posts/*/comments').filter('{key}', '==', 'l6ukhzd6000009lgcuvm7nef');
                                    //
                                    // - indexing on wildcard key '$postId' allows quick lookups on all comments of a specific postId
                                    //   without the need to know the userId it belongs to:
                                    //
                                    //   db.query('users/*/posts/$postId/comments').filter('$postId', '==', 'l6ukv0ru000009l42rbf7hn5');
                                    //
                                    // - including any of the special keys to the index allows quick filtering in queries:
                                    //   (assume key 'text' was indexed:)
                                    //
                                    //   db.query('users/*/posts/$postId/comments')
                                    //      .filter('text', 'like', '*hello*')
                                    //      .filter('$postId', '==', 'l6ukv0ru000009l42rbf7hn5')
                                    //
                                    neededKeys.filter(key => gotNamedWildcardKeys.includes(key)).forEach(key => {
                                        if (key === '{key}') {
                                            keyValue = childKey;
                                        }
                                        else {
                                            const index = wildcardNames.indexOf(key);
                                            if (index < 0) {
                                                throw new Error(`Requested key variable "${key}" not found in index path`);
                                            }
                                            const value = wildcardValues[index];
                                            addValue(key, value);
                                        }
                                    });
                                    const gotAllData = neededKeys.every(key => gotNamedWildcardKeys.includes(key));
                                    if (!gotAllData) {
                                        // Fetch node value, we need more data
                                        // Get child values
                                        const keyPromises = [];
                                        const seenKeys = gotNamedWildcardKeys.slice();
                                        // NEW: Use getNode to get data, enables indexing of subkeys
                                        const { value: obj } = await this.storage.getNode(childPath, { include: keyFilter, tid });
                                        keyFilter.forEach(key => {
                                            // What can be indexed?
                                            // strings, numbers, booleans, dates, undefined
                                            const val = PathInfo.getPathKeys(key).reduce((val, key) => typeof val === 'object' && key in val ? val[key] : undefined, obj);
                                            if (typeof val === 'undefined') {
                                                // Key not present
                                                return;
                                            }
                                            seenKeys.push(key);
                                            const type = getValueType(val);
                                            if (key === this.key && !allowedKeyValueTypes.includes(type)) {
                                                // Key value isn't allowed to be this type, mark it as null so it won't be indexed
                                                keyValue = null;
                                                return;
                                            }
                                            else if (key !== this.key && !indexableTypes.includes(type)) {
                                                // Metadata that can't be indexed because it has the wrong type
                                                return;
                                            }
                                            // Index this value
                                            addValue(key, val);
                                        });
                                        // If the key value wasn't present, set it to undefined (so it'll be indexed)
                                        if (!seenKeys.includes(this.key)) {
                                            keyValue = undefined;
                                        }
                                        await Promise.all(keyPromises);
                                    }
                                    const addIndexValue = (value, recordPointer, metadata) => {
                                        if (typeof value === 'string' && value.length > 255) {
                                            // Make sure strings are not too large to store. Use first 255 chars only
                                            console.warn(`Truncating key value "${value}" because it is too large to index`);
                                            value = value.slice(0, 255);
                                        }
                                        if (!this.caseSensitive) {
                                            // Store lowercase key and metadata values
                                            if (typeof value === 'string') {
                                                value = value.toLocaleLowerCase(locale);
                                            }
                                            Object.keys(metadata).forEach(key => {
                                                const value = metadata[key];
                                                if (typeof value === 'string') {
                                                    metadata[key] = value.toLocaleLowerCase(locale);
                                                }
                                            });
                                        }
                                        // NEW: write value to buildStream
                                        const bytes = [
                                            0, 0, 0, 0,
                                            0, // processed
                                        ];
                                        // key:
                                        const keyBytes = BinaryWriter.getBytes(value);
                                        bytes.push(...keyBytes);
                                        // rp_length:
                                        bytes.push(recordPointer.length);
                                        // rp_data:
                                        bytes.push(...recordPointer);
                                        // metadata:
                                        this.allMetadataKeys && this.allMetadataKeys.forEach(key => {
                                            let metadataValue = metadata[key];
                                            if (typeof metadataValue === 'string' && metadataValue.length > 255) {
                                                // Make sure strings are not too large to store. Use first 255 chars only
                                                console.warn(`Truncating "${key}" metadata value "${metadataValue}" because it is too large to index`);
                                                metadataValue = metadataValue.slice(0, 255);
                                            }
                                            const valueBytes = BinaryWriter.getBytes(metadataValue); // metadata_value
                                            bytes.push(...valueBytes);
                                        });
                                        // update entry_length:
                                        BinaryWriter.writeUint32(bytes.length, bytes, 0);
                                        writeToStream(bytes);
                                        indexedValues++;
                                    };
                                    if (keyValue !== null) {
                                        // Add it to the index, using value as the index key, a record pointer as the value
                                        // Create record pointer
                                        const recordPointer = _createRecordPointer(wildcardValues, childKey); //, child.address);
                                        // const entryValue = new BinaryBPlusTree.EntryValue(recordPointer, metadata)
                                        // Add it to the index
                                        if (options?.addCallback) {
                                            keyValue = options.addCallback(addIndexValue, keyValue, recordPointer, metadata, { path: childPath, wildcards: wildcardValues, key: childKey, locale });
                                        }
                                        else {
                                            addIndexValue(keyValue, recordPointer, metadata);
                                        }
                                        this.storage.debug.log(`Indexed "/${childPath}/${this.key}" value: '${keyValue}' (${typeof keyValue})`.colorize(ColorStyle.cyan));
                                    }
                                    // return addPromise; // Do we really have to wait for this?
                                }
                            }));
                        }
                    };
                    return getChildren();
                };
            });
        };
        const mergeFile = `${buildFile}.merge`;
        const createMergeFile = async () => {
            // start by grouping the keys:
            // take the first n keys in the .build file, read through the entire file
            // to find other occurences of the same key.
            // Group them and write to .build.n files in batches of 10.000 keys
            if (indexedValues === 0) {
                // Remove build file, nothing else to do
                // eslint-disable-next-line @typescript-eslint/no-empty-function
                return await pfs.rm(buildFile).catch(err => { });
            }
            try {
                const exists = await pfs.exists(mergeFile);
                if (exists) {
                    const err = new Error('File already exists');
                    err.code = 'EEXIST';
                    throw err;
                }
                const fd = await pfs.open(buildFile, pfs.flags.readAndWrite);
                const writer = BinaryWriter.forFunction(async (data, position) => {
                    const buffer = data instanceof Buffer ? data : Buffer.from(data);
                    await pfs.write(fd, buffer, 0, buffer.byteLength, position);
                });
                const reader = new BinaryReader(fd, 512 * 1024); // Read 512KB chunks
                await reader.init();
                // const maxKeys = 10000; // Work with max 10.000 in-memory keys at a time
                const maxValues = 100000; // Max 100K in-memory values
                const readNext = async () => {
                    // Read next from file
                    try {
                        let processed = true;
                        /** @type {Buffer} */
                        let buffer;
                        /** @type {number} */
                        let entryIndex;
                        while (processed) {
                            entryIndex = reader.sourceIndex;
                            const entryLength = await reader.getUint32(); // entry_length
                            if (entryLength < 4) {
                                throw new Error(`Invalid entry length ${entryLength} at build file index ${entryIndex}`);
                            }
                            buffer = await reader.get(entryLength - 4);
                            // processed:
                            processed = buffer[0] === 1;
                        }
                        // key:
                        let index = 1;
                        const keyValue = BinaryReader.readValue(buffer, index);
                        index += keyValue.byteLength;
                        // value: (combine rp_length, rp_data, metadata)
                        const len = buffer.byteLength - index;
                        const val = buffer.slice(index, index + len); // Buffer.from(buffer.buffer, index, len);
                        // console.log(`Read "${keyValue.value}" @${entryIndex} with value length ${len}`);
                        return {
                            key: keyValue.value,
                            value: val,
                            index: entryIndex,
                            length: buffer.byteLength + 4,
                            flagProcessed() {
                                buffer[0] = 1;
                                buffer = null;
                                return writer.write([1], this.index + 4); // flag file
                            },
                            // flagProcessed() {
                            //     // __DEV_CHECK_UNIQUE(this.index);
                            //     buffer[0] = 1; // make sure the in-memory cache is also flagged
                            //     buffer = null; // release memory if not referenced anywhere else
                            //     return writer.write([1], this.index + 4); // flag file
                            // }
                        };
                    }
                    catch (err) {
                        if (err.code === 'EOF') {
                            return null;
                        }
                        throw err;
                    }
                };
                // Write batch files
                let batchNr = 0;
                let batchStartEntry = null;
                // Find out how many written batches there are already (if process was terminated while building, we can resume)
                const path = buildFile.slice(0, buildFile.lastIndexOf('/'));
                const entries = await pfs.readdir(path);
                let high = 0;
                const checkFile = buildFile.slice(path.length + 1) + '.';
                entries.forEach(entry => {
                    if (typeof entry === 'string' && entry.startsWith(checkFile)) {
                        const match = /\.([0-9]+)$/.exec(entry);
                        if (!match) {
                            return;
                        }
                        const nr = parseInt(match[1]);
                        high = Math.max(high, nr);
                    }
                });
                batchNr = high;
                let more = true;
                while (more) {
                    batchNr++;
                    const map = new Map();
                    let processedValues = 0;
                    if (batchStartEntry !== null) {
                        // Skip already processed entries
                        await reader.go(batchStartEntry.index);
                        batchStartEntry = null;
                    }
                    let next;
                    while ((next = await readNext()) !== null) {
                        processedValues++;
                        const isDate = next.key instanceof Date;
                        const key = isDate ? next.key.getTime() : next.key;
                        let values = map.get(key);
                        if (values) {
                            values.push(next.value);
                            next.flagProcessed();
                        }
                        else if (processedValues < maxValues) {
                            values = [next.value];
                            if (isDate) {
                                values.dateKey = true;
                            }
                            map.set(key, values);
                            next.flagProcessed();
                        }
                        else {
                            more = true;
                            batchStartEntry = next;
                            break; // Stop adding values to this batch
                        }
                    }
                    if (map.size === 0) {
                        // no entries
                        batchNr--;
                        break;
                    }
                    // sort the map keys
                    const sortedKeys = quickSort([...map.keys()], (a, b) => {
                        if (BPlusTree.typeSafeComparison.isLess(a, b)) {
                            return -1;
                        }
                        if (BPlusTree.typeSafeComparison.isMore(a, b)) {
                            return 1;
                        }
                        return 0;
                    });
                    // write batch
                    const batchStream = pfs.fs.createWriteStream(`${buildFile}.${batchNr}`, { flags: pfs.flags.appendAndCreate });
                    for (const key of sortedKeys) {
                        const values = map.get(key);
                        const isDateKey = values.dateKey === true;
                        const bytes = [
                            0, 0, 0, 0, // entry_length
                        ];
                        // key:
                        let b = BinaryWriter.getBytes(isDateKey ? new Date(key) : key);
                        bytes.push(...b);
                        // // values_byte_length:
                        // const valuesByteLengthIndex = bytes.length;
                        // bytes.push(0, 0, 0, 0);
                        // values_length:
                        b = BinaryWriter.writeUint32(values.length, [0, 0, 0, 0], 0);
                        bytes.push(...b);
                        for (let j = 0; j < values.length; j++) {
                            const value = values[j];
                            // value_length:
                            b = BinaryWriter.writeUint32(value.length, [0, 0, 0, 0], 0);
                            bytes.push(...b);
                            // value:
                            bytes.push(...value);
                        }
                        // // update values_byte_length:
                        // const valuesByteLength = bytes.length - valuesByteLengthIndex
                        // BinaryWriter.writeUint32(valuesByteLength, bytes, valuesByteLengthIndex);
                        // Update entry_length:
                        BinaryWriter.writeUint32(bytes.length, bytes, 0);
                        const ok = batchStream.write(Uint8Array.from(bytes));
                        if (!ok) {
                            await new Promise(resolve => {
                                batchStream.once('drain', resolve);
                            });
                        }
                    }
                    await new Promise(resolve => {
                        batchStream.end(resolve);
                    });
                }
                await pfs.close(fd); // Close build file
                await pfs.rm(buildFile); // Remove build file
                // Now merge-sort all keys, by reading keys from each batch,
                // taking the smallest value from each batch a time
                const batches = batchNr;
                if (batches === 0) {
                    // No batches -> no indexed entries
                    return;
                }
                // create write stream for merged data
                const outputStream = pfs.fs.createWriteStream(mergeFile, { flags: pfs.flags.writeAndCreate });
                // const outputStream = BinaryWriter.forFunction((data, position) => {
                //     return pfs.write(fd, data, 0, data.byteLength, position);
                // });
                // open readers for each batch file
                const readers = [];
                const bufferChunkSize = Math.max(10240, Math.round((10 * 1024 * 1024) / batches)); // 10MB dedicated memory to divide between readers, with a minimum of 10KB per reader
                for (let i = 0; i < batches; i++) {
                    const reader = new BinaryReader(`${buildFile}.${i + 1}`, bufferChunkSize);
                    readers.push(reader);
                }
                await Promise.all(readers.map(reader => reader.init()));
                // load entries from each batch file
                let sortedEntryIndexes = [];
                const entriesPerBatch = new Array(batches);
                const loadEntry = async (batchIndex) => {
                    const reader = readers[batchIndex];
                    try {
                        const entryLength = await reader.getUint32(); // entry_length:
                        const buffer = await reader.get(entryLength - 4);
                        // key:
                        const keyValue = BinaryReader.readValue(buffer, 0);
                        const key = keyValue.value;
                        const values = buffer.slice(keyValue.byteLength); //Buffer.from(buffer.buffer, keyValue.byteLength, buffer.byteLength - keyValue.byteLength);
                        // Check if another batch has entry with the same key
                        const existing = entriesPerBatch.find(entry => entry && entry.key === key);
                        if (existing) {
                            // Append values to existing
                            // First 4 bytes of values contains values_length
                            const currentValues = BinaryReader.readUint32(existing.values, 0);
                            const additionalValues = BinaryReader.readUint32(values, 0);
                            const concatenated = new Uint8Array(existing.values.byteLength + values.byteLength - 4);
                            concatenated.set(existing.values, 0);
                            concatenated.set(values.slice(4), existing.values.byteLength);
                            // Update values_length to total
                            BinaryWriter.writeUint32(currentValues + additionalValues, concatenated, 0);
                            existing.values = concatenated;
                            return loadEntry(batchIndex);
                        }
                        // Create new entry
                        const entry = { key, values };
                        entriesPerBatch[batchIndex] = entry;
                        // update sortedEntryIndexes (only if it has been populated already, not when loading start values)
                        if (sortedEntryIndexes.length > 0) {
                            // remove the old entry
                            const oldSortEntryIndex = sortedEntryIndexes.findIndex(sortEntry => sortEntry.index === batchIndex);
                            sortedEntryIndexes.splice(oldSortEntryIndex, 1);
                            // create new entry, insert at right sorted location
                            // const newSortEntryIndex = sortedEntryIndexes.findIndex(sortEntry => BPlusTree.typeSafeComparison.isMore(sortEntry.key, entry.key));
                            let newSortEntryIndex = oldSortEntryIndex; // The newly read value >= previous value, because they are stored sorted in the batch file
                            while (newSortEntryIndex < sortedEntryIndexes.length
                                && BPlusTree.typeSafeComparison.isMore(entry.key, sortedEntryIndexes[newSortEntryIndex].key)) {
                                newSortEntryIndex++;
                            }
                            const newSortEntry = { index: batchIndex, key: entry.key };
                            sortedEntryIndexes.splice(newSortEntryIndex, 0, newSortEntry);
                        }
                        // return entry;
                    }
                    catch (err) {
                        if (err.code === 'EOF') {
                            // No more entries in batch file, set this batch's entry to null
                            entriesPerBatch[batchIndex] = null;
                            // remove from sortedEntryIndexes
                            assert(sortedEntryIndexes.length > 0);
                            const sortEntryIndex = sortedEntryIndexes.findIndex(sortEntry => sortEntry.index === batchIndex);
                            sortedEntryIndexes.splice(sortEntryIndex, 1);
                        }
                        else {
                            throw err;
                        }
                    }
                };
                // load start entries from each batch file
                const promises = readers.map((reader, index) => loadEntry(index));
                await Promise.all(promises);
                // Populate sortedEntryIndexes
                sortedEntryIndexes = entriesPerBatch.map((entry, index) => ({ index, key: entry.key }))
                    .sort((a, b) => {
                    if (BPlusTree.typeSafeComparison.isLess(a.key, b.key)) {
                        return -1;
                    }
                    if (BPlusTree.typeSafeComparison.isMore(a.key, b.key)) {
                        return 1;
                    }
                    return 0; // happens when a key had too many values (and were split into multiple batches)
                });
                // write all entries
                while (sortedEntryIndexes.length > 0) {
                    // take smallest (always at index 0 in sorted array)
                    const smallestDetails = sortedEntryIndexes[0];
                    const batchIndex = smallestDetails.index;
                    const smallestEntry = entriesPerBatch[batchIndex];
                    const bytes = [
                        0, 0, 0, 0, // entry_length
                    ];
                    // key:
                    const keyBytes = BinaryWriter.getBytes(smallestEntry.key);
                    bytes.push(...keyBytes);
                    // update entry_length
                    const byteLength = bytes.length + smallestEntry.values.byteLength;
                    BinaryWriter.writeUint32(byteLength, bytes, 0);
                    // build buffer
                    const buffer = new Uint8Array(byteLength);
                    buffer.set(bytes, 0);
                    // values:
                    buffer.set(smallestEntry.values, bytes.length);
                    // write to stream
                    // console.log(`writing entry "${smallestEntry.key}"`);
                    // return outputStream.append(buffer)
                    // .then(() => {
                    //     return loadEntry(batchIndex);
                    // })
                    // .then(writeSmallestEntry);
                    const ok = outputStream.write(buffer, err => {
                        assert(!err, 'Error while writing?');
                    });
                    if (!ok) {
                        await new Promise(resolve => {
                            outputStream.once('drain', resolve);
                        });
                    }
                    // load next entry from the batch we used
                    await loadEntry(batchIndex);
                }
                // Wait until output stream is done writing
                await new Promise(resolve => {
                    outputStream.end(resolve);
                });
                // Close all batch files
                const crPromises = readers.map(reader => reader.close());
                await Promise.all(crPromises);
                // Delete all batch files
                const dbfPromises = [];
                for (let i = 1; i <= batches; i++) {
                    dbfPromises.push(pfs.rm(`${buildFile}.${i}`));
                }
                await Promise.all(dbfPromises);
            }
            catch (err) {
                // EEXIST error is ok because that means the .merge file was already built
                if (err?.code !== 'EEXIST') {
                    throw err;
                }
            }
        };
        const startTime = Date.now();
        const lock = await this._lock('exclusive', 24 * 60 * 60 * 1000); // Allow 24hrs to build the index max
        try {
            try {
                await createBuildFile();
            }
            catch (err) {
                // If the .build file already existed, use it!
                if (err.code !== 'EEXIST') {
                    throw err;
                }
            }
            // Done writing values to build file.
            // Now we have to group all values per key, sort them.
            // then create the binary B+tree.
            this.storage.debug.log(`done writing build file ${buildFile}`);
            await createMergeFile();
            // Open merge file for reading, index file for writing
            this.storage.debug.log(`done writing merge file ${mergeFile}`);
            const [readFD, writeFD] = await Promise.all([
                indexedValues === 0 ? -1 : pfs.open(mergeFile, pfs.flags.read),
                pfs.open(this.fileName, pfs.flags.write),
            ]);
            // create index from entry stream
            const treeStatistics = {
                totalEntries: 0,
                totalValues: 0,
            };
            const headerStats = {
                written: false,
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                updateTreeLength: (treeByteLength) => {
                    throw new Error('header hasn\'t been written yet');
                },
                length: DISK_BLOCK_SIZE,
                promise: undefined,
            };
            const writer = BinaryWriter.forFunction(async (data, index) => {
                if (!headerStats.written) {
                    // Write header first, or wait until done
                    if (!headerStats.promise) {
                        headerStats.promise = this._writeIndexHeader(writeFD, treeStatistics).then(async (result) => {
                            headerStats.written = true;
                            headerStats.length = result.length;
                            headerStats.updateTreeLength = result.treeLengthCallback;
                            if (this.state === DataIndex.STATE.REBUILD) {
                                await pfs.truncate(this.fileName, headerStats.length);
                            }
                        });
                    }
                    await headerStats.promise;
                }
                await pfs.write(writeFD, data, 0, data.length, headerStats.length + index);
            });
            const reader = indexedValues > 0
                ? new BinaryReader(readFD)
                : new BinaryReader(async (index, length) => Buffer.from([]));
            await BinaryBPlusTree.createFromEntryStream(reader, writer, {
                treeStatistics,
                fillFactor: FILL_FACTOR,
                maxEntriesPerNode: 255,
                isUnique: false,
                keepFreeSpace: true,
                metadataKeys: this.allMetadataKeys,
                debug: this.storage.debug,
            });
            await Promise.all([
                pfs.fsync(writeFD).then(() => pfs.close(writeFD)),
                indexedValues > 0 && pfs.close(readFD),
            ]);
            if (indexedValues > 0) {
                await pfs.rm(mergeFile);
            }
            const doneTime = Date.now();
            const duration = Math.round((doneTime - startTime) / 1000 / 60);
            this.storage.debug.log(`Index ${this.description} was built successfully, took ${duration} minutes`.colorize(ColorStyle.green));
            this.state = DataIndex.STATE.READY;
        }
        catch (err) {
            this.storage.debug.error(`Error building index ${this.description}: ${err?.message || err}`);
            this.state = DataIndex.STATE.ERROR;
            this._buildError = err;
            throw err;
        }
        finally {
            lock.release(); // release index lock
        }
        this._processUpdateQueue(); // Process updates queued during build
        return this;
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    test(obj, op, val) { throw new Error('test method must be overridden by subclass'); }
    _getIndexHeaderBytes(treeStatistics) {
        const indexEntries = treeStatistics.totalEntries;
        const indexedValues = treeStatistics.totalValues;
        const addNameBytes = (bytes, name) => {
            // name_length:
            bytes.push(name.length);
            // name_data:
            for (let i = 0; i < name.length; i++) {
                bytes.push(name.charCodeAt(i));
            }
        };
        const addValueBytes = (bytes, value) => {
            let valBytes = [];
            if (typeof value === 'undefined') {
                // value_type:
                bytes.push(INDEX_INFO_VALUE_TYPE.UNDEFINED);
                // no value_length or value_data
                return;
            }
            else if (typeof value === 'string') {
                // value_type:
                bytes.push(INDEX_INFO_VALUE_TYPE.STRING);
                valBytes = Array.from(encodeString(value)); // textEncoder.encode(value)
            }
            else if (typeof value === 'number') {
                // value_type:
                bytes.push(INDEX_INFO_VALUE_TYPE.NUMBER);
                valBytes = numberToBytes(value);
            }
            else if (typeof value === 'boolean') {
                // value_type:
                bytes.push(INDEX_INFO_VALUE_TYPE.BOOLEAN);
                // no value_length
                // value_data:
                bytes.push(value ? 1 : 0);
                // done
                return;
            }
            else if (value instanceof Array) {
                // value_type:
                bytes.push(INDEX_INFO_VALUE_TYPE.ARRAY);
                // value_length:
                if (value.length > 0xffff) {
                    throw new Error('Array is too large to store. Max length is 0xffff');
                }
                bytes.push((value.length >> 8) & 0xff);
                bytes.push(value.length & 0xff);
                // value_data:
                value.forEach(val => {
                    addValueBytes(bytes, val);
                });
                // done
                return;
            }
            // Maybe in the future:
            // else if (value !== null && typeof value === 'object') {
            //     // value_type:
            //     bytes.push(INDEX_INFO_VALUE_TYPE.OBJECT);
            //     // value_length:
            //     const keys = Object.keys(value);
            //     if (keys.length > 0xffff) {
            //         throw new Error('Object is too large to store. Max properties is 0xffff');
            //     }
            //     bytes.push((keys.length >> 8) & 0xff);
            //     bytes.push(keys.length & 0xff);
            //     // value_data:
            //     keys.forEach(key => {
            //         const val = value[key];
            //         addNameBytes(bytes, key);
            //         addValueBytes(bytes, val);
            //     });
            //     // done
            //     return;
            // }
            else {
                throw new Error(`Invalid value type "${typeof value}"`);
            }
            // value_length:
            bytes.push((valBytes.length >> 8) & 0xff);
            bytes.push(valBytes.length & 0xff);
            // value_data:
            bytes.push(...valBytes);
        };
        const addInfoBytes = (bytes, obj) => {
            const keys = Object.keys(obj);
            // info_count:
            bytes.push(keys.length);
            // info, [info, [info...]]
            keys.forEach(key => {
                addNameBytes(bytes, key); // name
                const value = obj[key];
                addValueBytes(bytes, value);
            });
        };
        const header = [
            // signature:
            65, 67, 69, 66, 65, 83, 69, 73, 68, 88,
            // layout_version:
            1,
            // header_length:
            0, 0, 0, 0,
        ];
        // info:
        const indexInfo = {
            type: this.type,
            version: 1,
            path: this.path,
            key: this.key,
            include: this.includeKeys,
            cs: this.caseSensitive,
            locale: this.textLocale,
            localeKey: this.textLocaleKey,
            // Don't store:
            // config: this.config,
        };
        addInfoBytes(header, indexInfo);
        // const treeNames = Object.keys(this.trees);
        // trees_info:
        header.push(1); // trees_count
        const treeName = 'default';
        const treeDetails = this.trees[treeName];
        // tree_info:
        addNameBytes(header, treeName); // tree_name
        const treeRefIndex = header.length;
        header.push(0, 0, 0, 0); // file_index
        header.push(0, 0, 0, 0); // byte_length
        treeDetails.entries = indexEntries;
        treeDetails.values = indexedValues;
        const extraTreeInfo = {
            class: treeDetails.class,
            version: treeDetails.version,
            entries: indexEntries,
            values: indexedValues,
        };
        addInfoBytes(header, extraTreeInfo);
        // align header bytes to block size
        while (header.length % DISK_BLOCK_SIZE !== 0) {
            header.push(0);
        }
        // end of header
        const headerLength = header.length;
        treeDetails.fileIndex = headerLength;
        // treeDetails.byteLength = binary.length;
        // Update header_length:
        header[11] = (headerLength >> 24) & 0xff;
        header[12] = (headerLength >> 16) & 0xff;
        header[13] = (headerLength >> 8) & 0xff;
        header[14] = headerLength & 0xff;
        // Update default tree file_index:
        header[treeRefIndex] = (headerLength >> 24) & 0xff;
        header[treeRefIndex + 1] = (headerLength >> 16) & 0xff;
        header[treeRefIndex + 2] = (headerLength >> 8) & 0xff;
        header[treeRefIndex + 3] = headerLength & 0xff;
        // // Update default tree byte_length:
        // header[treeRefIndex+4] = (binary.byteLength >> 24) & 0xff;
        // header[treeRefIndex+5] = (binary.byteLength >> 16) & 0xff;
        // header[treeRefIndex+6] = (binary.byteLength >> 8) & 0xff;
        // header[treeRefIndex+7] = binary.byteLength & 0xff;
        // anything else?
        return { header, headerLength, treeRefIndex, treeDetails };
    }
    async _writeIndexHeader(fd, treeStatistics) {
        const { header, headerLength, treeRefIndex } = this._getIndexHeaderBytes(treeStatistics);
        await pfs.write(fd, Buffer.from(header));
        return {
            length: headerLength,
            treeLengthCallback: async (treeByteLength) => {
                const bytes = [
                    (treeByteLength >> 24) & 0xff,
                    (treeByteLength >> 16) & 0xff,
                    (treeByteLength >> 8) & 0xff,
                    treeByteLength & 0xff,
                ];
                // treeDetails.byteLength = treeByteLength;
                await pfs.write(fd, Buffer.from(bytes), 0, bytes.length, treeRefIndex + 4);
            },
        };
    }
    async _writeIndex(builder) {
        // Index v1 layout:
        // data             = header, trees_data
        // header           = signature, layout_version, header_length, index_info, trees_info
        // signature        = 10 bytes ('ACEBASEIDX')
        // layout_version   = 1 byte number (binary layout version)
        // header_length    = byte_length
        // byte_length      = 4 byte uint
        // index_info       = info_count, info, [info, [info...]]
        // info_count       = 1 byte number
        // info             = key, info_value
        // key              = key_length, key_name
        // key_length       = 1 byte number
        // key_name         = [key_length] bytes (ASCII encoded key name)
        // info_value       = value_type, [value_length], [value_data]
        // value_type       = 1 byte number
        //                      0: UNDEFINED
        //                      1: STRING
        //                      2: NUMBER
        //                      3: BOOLEAN
        //                      4: ARRAY
        // value_length     = value_type ?
        //                      0, 3: (not present)
        //                      1, 2, 4: 2 byte number
        // value_data       = value_type ?
        //                      0: (not present)
        //                      1-3: value_length bytes
        //                      4: info_value[value_length]
        // trees_info       = trees_count, tree_info, [tree_info, [tree_info...]]
        // trees_count      = 1 byte number
        // tree_info        = tree_name, file_index, byte_length, xtree_info
        // tree_name        = key
        // file_index       = 4 byte uint
        // xtree_info       = info_count, info, [info, [info...]]
        // trees_data       = tree_data, [tree_data, [tree_date...]]
        // tree_data        = [byte_length] bytes of data (from tree_info header)
        const totalEntries = builder.list.size;
        const totalValues = builder.indexedValues;
        // const tree = builder.create();
        // const binary = new Uint8Array(tree.toBinary(true));
        const fd = await pfs.open(this.fileName, pfs.flags.write);
        const { header, headerLength, treeRefIndex, treeDetails } = this._getIndexHeaderBytes({ totalEntries, totalValues });
        try {
            await pfs.write(fd, Buffer.from(header));
            // append binary tree data
            const tree = builder.create();
            const stream = pfs.fs.createWriteStream(null, { fd, autoClose: false });
            const references = [];
            const writer = new BinaryWriter(stream, async (data, position) => {
                references.push({ data, position });
                // return pfs.write(fd, data, 0, data.byteLength, headerLength + position);
            });
            await tree.toBinary(true, writer);
            // Update all references
            while (references.length > 0) {
                const ref = references.shift();
                await pfs.write(fd, ref.data, 0, ref.data.byteLength, headerLength + ref.position);
            }
            // Update default tree byte_length:
            const treeByteLength = writer.length;
            const bytes = [
                (treeByteLength >> 24) & 0xff,
                (treeByteLength >> 16) & 0xff,
                (treeByteLength >> 8) & 0xff,
                treeByteLength & 0xff,
            ];
            treeDetails.byteLength = treeByteLength;
            await pfs.write(fd, Buffer.from(bytes), 0, bytes.length, treeRefIndex + 4);
            // return pfs.write(fd, binary);
            await pfs.close(fd);
        }
        catch (err) {
            this.storage.debug.error(err);
            throw err;
        }
    }
    async _getTree(lockMode = 'exclusive') {
        // File is now opened the first time it is requested, only closed when it needs to be rebuilt or removed
        // This enables the tree to keep its FST state in memory.
        // Also enabled "autoGrow" again, this allows the tree to grow instead of being rebuilt every time it needs
        // more storage space
        if ([DataIndex.STATE.ERROR, DataIndex.STATE.CLOSED, DataIndex.STATE.REMOVED].includes(this.state)) {
            throw new Error(`Can't open index ${this.description} with state "${this.state}"`);
        }
        const lock = await this._lock(lockMode);
        if (!this._idx) {
            // File being opened for the first time (or after a rebuild)
            const fd = await pfs.open(this.fileName, pfs.flags.readAndWrite);
            const reader = async (index, length) => {
                const buffer = Buffer.alloc(length);
                const { bytesRead } = await pfs.read(fd, buffer, 0, length, this.trees.default.fileIndex + index);
                if (bytesRead < length) {
                    return buffer.slice(0, bytesRead);
                }
                return buffer;
            };
            const writer = async (data, index) => {
                const buffer = data.constructor === Uint8Array
                    ? Buffer.from(data.buffer, data.byteOffset, data.byteLength)
                    : Buffer.from(data);
                const result = await pfs.write(fd, buffer, 0, data.length, this.trees.default.fileIndex + index);
                return result;
            };
            const tree = new BinaryBPlusTree({
                readFn: reader,
                chunkSize: DISK_BLOCK_SIZE,
                writeFn: writer,
                debug: this.storage.debug,
                id: ID.generate(), // For tree locking
            });
            tree.autoGrow = true; // Allow the tree to grow. DISABLE THIS IF THERE ARE MULTIPLE TREES IN THE INDEX FILE LATER! (which is not implemented yet)
            this._idx = { fd, tree };
        }
        return {
            tree: this._idx.tree,
            /** Closes the index file, does not release the lock! */
            close: async () => {
                const fd = this._idx.fd;
                this._idx = null;
                await pfs.close(fd)
                    .catch(err => {
                    this.storage.debug.warn(`Could not close index file "${this.fileName}":`, err);
                });
            },
            /** Releases the acquired tree lock */
            release() {
                lock.release();
            },
        };
    }
}
//# sourceMappingURL=data-index.js.map