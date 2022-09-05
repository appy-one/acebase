"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GeoIndex = exports.FullTextIndex = exports.ArrayIndex = exports.IndexQueryResults = exports.IndexQueryResult = exports.DataIndex = void 0;
const acebase_core_1 = require("acebase-core");
const unidecode_1 = require("unidecode");
const btree_1 = require("../btree");
const Geohash = require("../geohash");
const promise_fs_1 = require("../promise-fs");
const thread_safe_1 = require("../thread-safe");
const node_value_types_1 = require("../node-value-types");
const quicksort_1 = require("../quicksort");
const { compareValues, getChildValues, numberToBytes, bytesToNumber, encodeString, decodeString } = acebase_core_1.Utils;
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
// const _debounceTimeouts = {};
// function debounce(id, ms, callback) {
//     if (_debounceTimeouts[id]) {
//         clearTimeout(_debounceTimeouts[id]);
//     }
//     _debounceTimeouts[id] = setTimeout(() => {
//         delete _debounceTimeouts[id];
//         callback();
//     }, ms);
// }
class DataIndex {
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
        const pathKeys = acebase_core_1.PathInfo.getPathKeys(path).map(key => typeof key === 'string' && key.startsWith('$') ? '*' : key);
        this.path = (new acebase_core_1.PathInfo(pathKeys)).path; // path.replace(/\/\*$/, ""); // Remove optional trailing "/*"
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
        const val = JSON.stringify(acebase_core_1.Transport.serialize2(param)); // Make object and array params cachable too
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
        await promise_fs_1.pfs.rm(filePath);
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
        const fd = await promise_fs_1.pfs.open(filePath, promise_fs_1.pfs.flags.read);
        try {
            // Read signature
            let result = await promise_fs_1.pfs.read(fd, Buffer.alloc(10));
            // Check signature
            if (result.buffer.toString() !== 'ACEBASEIDX') {
                throw new Error(`File "${filePath}" is not an AceBase index. If you get this error after updating acebase, delete the index file and rebuild it`);
            }
            // Read layout_version
            result = await promise_fs_1.pfs.read(fd, Buffer.alloc(1));
            const versionNr = result.buffer[0];
            if (versionNr !== 1) {
                throw new Error(`Index "${filePath}" version ${versionNr} is not supported by this version of AceBase. npm update your acebase packages`);
            }
            // Read header_length
            result = await promise_fs_1.pfs.read(fd, Buffer.alloc(4));
            const headerLength = (result.buffer[0] << 24) | (result.buffer[1] << 16) | (result.buffer[2] << 8) | result.buffer[3];
            // Read header
            result = await promise_fs_1.pfs.read(fd, Buffer.alloc(headerLength - 11));
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
            let dataIndex;
            switch (indexInfo.type) {
                case 'normal': {
                    dataIndex = new DataIndex(storage, indexInfo.path, indexInfo.key, indexOptions);
                    break;
                }
                case 'array': {
                    dataIndex = new ArrayIndex(storage, indexInfo.path, indexInfo.key, indexOptions);
                    break;
                }
                case 'fulltext': {
                    dataIndex = new FullTextIndex(storage, indexInfo.path, indexInfo.key, indexOptions);
                    break;
                }
                case 'geo': {
                    dataIndex = new GeoIndex(storage, indexInfo.path, indexInfo.key, indexOptions);
                    break;
                }
                default: {
                    throw new Error(`Unknown index type ${indexInfo.type}`);
                }
            }
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
            await promise_fs_1.pfs.close(fd);
            dataIndex.state = DataIndex.STATE.READY;
            return dataIndex;
        }
        catch (err) {
            storage.debug.error(err);
            promise_fs_1.pfs.close(fd);
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
        const pathKeys = acebase_core_1.PathInfo.getPathKeys(path);
        const indexKeys = acebase_core_1.PathInfo.getPathKeys(this.path);
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
        const canBeIndexed = ['number', 'boolean', 'string'].indexOf(typeof newValue) >= 0 || newValue instanceof Date;
        const operations = [];
        if (oldValue !== null) {
            const op = btree_1.BinaryBPlusTree.TransactionOperation.remove(oldValue, oldRecordPointer);
            operations.push(op);
        }
        if (newValue !== null && canBeIndexed) {
            const op = btree_1.BinaryBPlusTree.TransactionOperation.add(newValue, newRecordPointer, metadata);
            operations.push(op);
        }
        return this._processTreeOperations(path, operations);
    }
    async _rebuild(idx) {
        // Rebuild by writing to temp file
        const newIndexFile = this.fileName + '.tmp';
        const fd = await promise_fs_1.pfs.open(newIndexFile, promise_fs_1.pfs.flags.write);
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
            await promise_fs_1.pfs.write(fd, data, 0, data.length, headerStats.length + index);
        };
        this.state = DataIndex.STATE.REBUILD;
        try {
            // this._fst = []; // Reset fst memory
            await idx.tree.rebuild(btree_1.BinaryWriter.forFunction(writer), { treeStatistics });
            await idx.close();
            await headerStats.updateTreeLength(treeStatistics.byteLength);
            await promise_fs_1.pfs.close(fd);
            const renameFile = async (retry = 0) => {
                try {
                    // rename new file, overwriting the old file
                    await promise_fs_1.pfs.rename(newIndexFile, this.fileName);
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
                this.storage.debug.verbose(`Could not update index ${this.description}: ${err.message}`.colorize(acebase_core_1.ColorStyle.yellow));
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
        this.storage.debug.verbose(`Index ${this.description} was ${rebuilt ? 'rebuilt' : 'updated'} successfully for "/${path}", took ${duration}`.colorize(acebase_core_1.ColorStyle.green));
        // Process any queued updates
        return await this._processUpdateQueue();
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
        var _a;
        const getValues = (key, oldValue, newValue) => acebase_core_1.PathInfo.getPathKeys(key).reduce((values, key) => getChildValues(key, values.oldValue, values.newValue), { oldValue, newValue });
        const updatedKey = acebase_core_1.PathInfo.get(path).key;
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
            throw new Error(`Cannot update index ${this.description}: it's in the error state: ${(_a = this._buildError) === null || _a === void 0 ? void 0 : _a.stack}`);
        }
        else if (this.state === DataIndex.STATE.READY) {
            // Invalidate query cache
            this._cache.clear();
            // Update the tree
            return await this._updateTree(path, keyValues.oldValue, keyValues.newValue, recordPointer, recordPointer, metadata);
        }
        else {
            this.storage.debug.verbose(`Queueing index ${this.description} update for "/${path}"`);
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
            })
                .catch(err => {
                this.storage.debug.error(`Unable to process queued update for "/${path}" on index ${this.description}:`, err);
            });
            this._updateQueue.push(update);
            //return p; // Don't wait for p, prevents deadlock when tree is rebuilding
        }
    }
    async _lock(mode = 'exclusive', timeout = 60000) {
        return thread_safe_1.ThreadSafe.lock(this.fileName, { shared: mode === 'shared', timeout }); //, timeout: 15 * 60000 (for debugging)
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
    async take(skip, take, ascending) {
        const cacheKey = `${skip}+${take}-${ascending ? 'asc' : 'desc'}`;
        const cache = this.cache('take', cacheKey);
        if (cache) {
            return cache;
        }
        const stats = new IndexQueryStats('take', { skip, take, ascending }, true);
        const idx = await this._getTree('shared');
        const results = new IndexQueryResults(); //[];
        results.filterKey = this.key;
        let skipped = 0;
        const processLeaf = async (leaf) => {
            if (!ascending) {
                leaf.entries.reverse();
            }
            for (let i = 0; i < leaf.entries.length; i++) {
                const entry = leaf.entries[i];
                const value = entry.key;
                for (let j = 0; j < entry.totalValues; j++) { //entry.values.length
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
                    if (results.length === take) {
                        return results;
                    }
                }
            }
            if (ascending && leaf.hasNext) {
                return leaf.getNext().then(processLeaf);
            }
            else if (!ascending && leaf.hasPrevious) {
                return leaf.getPrevious().then(processLeaf);
            }
            else {
                return results;
            }
        };
        if (ascending) {
            await idx.tree.getFirstLeaf().then(processLeaf);
        }
        else {
            await idx.tree.getLastLeaf().then(processLeaf);
        }
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
        if (!(op instanceof btree_1.BlacklistingSearchOperator) && !DataIndex.validOperators.includes(op)) {
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
        const isCacheable = !(op instanceof btree_1.BlacklistingSearchOperator);
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
                const builder = tree ? new btree_1.BPlusTreeBuilder(true, 100) : null;
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
        const wildcardNames = path.match(/\*|\$[a-z0-9_]+/gi) || [];
        // const hasWildcards = wildcardNames.length > 0;
        const wildcardsPattern = '^' + path.replace(/\*|\$[a-z0-9_]+/gi, '([a-z0-9_]+)') + '/';
        const wildcardRE = new RegExp(wildcardsPattern, 'i');
        // let treeBuilder = new BPlusTreeBuilder(false, FILL_FACTOR, this.allMetadataKeys); //(30, false);
        // let idx; // Once using binary file to write to
        const tid = acebase_core_1.ID.generate();
        const keys = acebase_core_1.PathInfo.getPathKeys(path);
        const indexableTypes = [node_value_types_1.VALUE_TYPES.STRING, node_value_types_1.VALUE_TYPES.NUMBER, node_value_types_1.VALUE_TYPES.BOOLEAN, node_value_types_1.VALUE_TYPES.DATETIME, node_value_types_1.VALUE_TYPES.BIGINT];
        const allowedKeyValueTypes = options && options.valueTypes
            ? options.valueTypes
            : indexableTypes;
        this.storage.debug.log(`Index build ${this.description} started`.colorize(acebase_core_1.ColorStyle.blue));
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
                const buildWriteStream = promise_fs_1.pfs.fs.createWriteStream(buildFile, { flags: promise_fs_1.pfs.flags.readAndAppendAndCreate });
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
                        console.assert(!err, `Failed to write to stream: ${err && err.message}`);
                    });
                });
                const writeToStream = (bytes) => {
                    if (streamState.wait) {
                        streamState.chunks.push(bytes);
                        console.assert(streamState.chunks.length < 100000, 'Something going wrong here');
                    }
                    else {
                        streamState.wait = !buildWriteStream.write(Buffer.from(bytes), err => {
                            console.assert(!err, `Failed to write to stream: ${err && err.message}`);
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
                        path = acebase_core_1.PathInfo.getChildPath(path, keys[keyIndex]); // += keys[keyIndex];
                        keyIndex++;
                    }
                    const isTargetNode = keyIndex === keys.length;
                    const getChildren = async () => {
                        const childKeys = [];
                        try {
                            await this.storage.getChildren(path).next(child => {
                                const keyOrIndex = typeof child.index === 'number' ? child.index : child.key;
                                if (!child.address || child.type !== node_value_types_1.VALUE_TYPES.OBJECT) {
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
                                const childPath = acebase_core_1.PathInfo.getChildPath(path, childKey);
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
                                            const val = acebase_core_1.PathInfo.getPathKeys(key).reduce((val, key) => typeof val === 'object' && key in val ? val[key] : undefined, obj);
                                            if (typeof val === 'undefined') {
                                                // Key not present
                                                return;
                                            }
                                            seenKeys.push(key);
                                            const type = (0, node_value_types_1.getValueType)(val);
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
                                        const keyBytes = btree_1.BinaryWriter.getBytes(value);
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
                                            const valueBytes = btree_1.BinaryWriter.getBytes(metadataValue); // metadata_value
                                            bytes.push(...valueBytes);
                                        });
                                        // update entry_length:
                                        btree_1.BinaryWriter.writeUint32(bytes.length, bytes, 0);
                                        writeToStream(bytes);
                                        indexedValues++;
                                    };
                                    if (keyValue !== null) {
                                        // Add it to the index, using value as the index key, a record pointer as the value
                                        // Create record pointer
                                        const recordPointer = _createRecordPointer(wildcardValues, childKey); //, child.address);
                                        // const entryValue = new BinaryBPlusTree.EntryValue(recordPointer, metadata)
                                        // Add it to the index
                                        if (options === null || options === void 0 ? void 0 : options.addCallback) {
                                            keyValue = options.addCallback(addIndexValue, keyValue, recordPointer, metadata, { path: childPath, wildcards: wildcardValues, key: childKey, locale });
                                        }
                                        else {
                                            addIndexValue(keyValue, recordPointer, metadata);
                                        }
                                        this.storage.debug.log(`Indexed "/${childPath}/${this.key}" value: '${keyValue}' (${typeof keyValue})`.colorize(acebase_core_1.ColorStyle.cyan));
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
                return await promise_fs_1.pfs.rm(buildFile).catch(err => { });
            }
            try {
                const exists = await promise_fs_1.pfs.exists(mergeFile);
                if (exists) {
                    const err = new Error('File already exists');
                    err.code = 'EEXIST';
                    throw err;
                }
                const fd = await promise_fs_1.pfs.open(buildFile, promise_fs_1.pfs.flags.readAndWrite);
                const writer = btree_1.BinaryWriter.forFunction(async (data, position) => {
                    const buffer = data instanceof Buffer ? data : Buffer.from(data);
                    await promise_fs_1.pfs.write(fd, buffer, 0, buffer.byteLength, position);
                });
                const reader = new btree_1.BinaryReader(fd, 512 * 1024); // Read 512KB chunks
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
                        const keyValue = btree_1.BinaryReader.readValue(buffer, index);
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
                const entries = await promise_fs_1.pfs.readdir(path);
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
                    const sortedKeys = (0, quicksort_1.default)([...map.keys()], (a, b) => {
                        if (btree_1.BPlusTree.typeSafeComparison.isLess(a, b)) {
                            return -1;
                        }
                        if (btree_1.BPlusTree.typeSafeComparison.isMore(a, b)) {
                            return 1;
                        }
                        return 0;
                    });
                    // write batch
                    const batchStream = promise_fs_1.pfs.fs.createWriteStream(`${buildFile}.${batchNr}`, { flags: promise_fs_1.pfs.flags.appendAndCreate });
                    for (const key of sortedKeys) {
                        const values = map.get(key);
                        const isDateKey = values.dateKey === true;
                        const bytes = [
                            0, 0, 0, 0, // entry_length
                        ];
                        // key:
                        let b = btree_1.BinaryWriter.getBytes(isDateKey ? new Date(key) : key);
                        bytes.push(...b);
                        // // values_byte_length:
                        // const valuesByteLengthIndex = bytes.length;
                        // bytes.push(0, 0, 0, 0);
                        // values_length:
                        b = btree_1.BinaryWriter.writeUint32(values.length, [0, 0, 0, 0], 0);
                        bytes.push(...b);
                        for (let j = 0; j < values.length; j++) {
                            const value = values[j];
                            // value_length:
                            b = btree_1.BinaryWriter.writeUint32(value.length, [0, 0, 0, 0], 0);
                            bytes.push(...b);
                            // value:
                            bytes.push(...value);
                        }
                        // // update values_byte_length:
                        // const valuesByteLength = bytes.length - valuesByteLengthIndex
                        // BinaryWriter.writeUint32(valuesByteLength, bytes, valuesByteLengthIndex);
                        // Update entry_length:
                        btree_1.BinaryWriter.writeUint32(bytes.length, bytes, 0);
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
                await promise_fs_1.pfs.close(fd); // Close build file
                await promise_fs_1.pfs.rm(buildFile); // Remove build file
                // Now merge-sort all keys, by reading keys from each batch,
                // taking the smallest value from each batch a time
                const batches = batchNr;
                if (batches === 0) {
                    // No batches -> no indexed entries
                    return;
                }
                // create write stream for merged data
                const outputStream = promise_fs_1.pfs.fs.createWriteStream(mergeFile, { flags: promise_fs_1.pfs.flags.writeAndCreate });
                // const outputStream = BinaryWriter.forFunction((data, position) => {
                //     return pfs.write(fd, data, 0, data.byteLength, position);
                // });
                // open readers for each batch file
                const readers = [];
                const bufferChunkSize = Math.max(10240, Math.round((10 * 1024 * 1024) / batches)); // 10MB dedicated memory to divide between readers, with a minimum of 10KB per reader
                for (let i = 0; i < batches; i++) {
                    const reader = new btree_1.BinaryReader(`${buildFile}.${i + 1}`, bufferChunkSize);
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
                        const keyValue = btree_1.BinaryReader.readValue(buffer, 0);
                        const key = keyValue.value;
                        const values = buffer.slice(keyValue.byteLength); //Buffer.from(buffer.buffer, keyValue.byteLength, buffer.byteLength - keyValue.byteLength);
                        // Check if another batch has entry with the same key
                        const existing = entriesPerBatch.find(entry => entry && entry.key === key);
                        if (existing) {
                            // Append values to existing
                            // First 4 bytes of values contains values_length
                            const currentValues = btree_1.BinaryReader.readUint32(existing.values, 0);
                            const additionalValues = btree_1.BinaryReader.readUint32(values, 0);
                            const concatenated = new Uint8Array(existing.values.byteLength + values.byteLength - 4);
                            concatenated.set(existing.values, 0);
                            concatenated.set(values.slice(4), existing.values.byteLength);
                            // Update values_length to total
                            btree_1.BinaryWriter.writeUint32(currentValues + additionalValues, concatenated, 0);
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
                                && btree_1.BPlusTree.typeSafeComparison.isMore(entry.key, sortedEntryIndexes[newSortEntryIndex].key)) {
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
                            console.assert(sortedEntryIndexes.length > 0);
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
                    if (btree_1.BPlusTree.typeSafeComparison.isLess(a.key, b.key)) {
                        return -1;
                    }
                    if (btree_1.BPlusTree.typeSafeComparison.isMore(a.key, b.key)) {
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
                    const keyBytes = btree_1.BinaryWriter.getBytes(smallestEntry.key);
                    bytes.push(...keyBytes);
                    // update entry_length
                    const byteLength = bytes.length + smallestEntry.values.byteLength;
                    btree_1.BinaryWriter.writeUint32(byteLength, bytes, 0);
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
                        console.assert(!err, 'Error while writing?');
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
                    dbfPromises.push(promise_fs_1.pfs.rm(`${buildFile}.${i}`));
                }
                await Promise.all(dbfPromises);
            }
            catch (err) {
                // EEXIST error is ok because that means the .merge file was already built
                if ((err === null || err === void 0 ? void 0 : err.code) !== 'EEXIST') {
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
                indexedValues === 0 ? -1 : promise_fs_1.pfs.open(mergeFile, promise_fs_1.pfs.flags.read),
                promise_fs_1.pfs.open(this.fileName, promise_fs_1.pfs.flags.write),
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
            const writer = btree_1.BinaryWriter.forFunction(async (data, index) => {
                if (!headerStats.written) {
                    // Write header first, or wait until done
                    if (!headerStats.promise) {
                        headerStats.promise = this._writeIndexHeader(writeFD, treeStatistics).then(async (result) => {
                            headerStats.written = true;
                            headerStats.length = result.length;
                            headerStats.updateTreeLength = result.treeLengthCallback;
                            if (this.state === DataIndex.STATE.REBUILD) {
                                await promise_fs_1.pfs.truncate(this.fileName, headerStats.length);
                            }
                        });
                    }
                    await headerStats.promise;
                }
                await promise_fs_1.pfs.write(writeFD, data, 0, data.length, headerStats.length + index);
            });
            const reader = indexedValues > 0
                ? new btree_1.BinaryReader(readFD)
                : new btree_1.BinaryReader(async (index, length) => Buffer.from([]));
            await btree_1.BinaryBPlusTree.createFromEntryStream(reader, writer, {
                treeStatistics,
                fillFactor: FILL_FACTOR,
                maxEntriesPerNode: 255,
                isUnique: false,
                keepFreeSpace: true,
                metadataKeys: this.allMetadataKeys,
            });
            await Promise.all([
                promise_fs_1.pfs.fsync(writeFD).then(() => promise_fs_1.pfs.close(writeFD)),
                indexedValues > 0 && promise_fs_1.pfs.close(readFD),
            ]);
            if (indexedValues > 0) {
                await promise_fs_1.pfs.rm(mergeFile);
            }
            const doneTime = Date.now();
            const duration = Math.round((doneTime - startTime) / 1000 / 60);
            this.storage.debug.log(`Index ${this.description} was built successfully, took ${duration} minutes`.colorize(acebase_core_1.ColorStyle.green));
            this.state = DataIndex.STATE.READY;
        }
        catch (err) {
            this.storage.debug.error(`Error building index ${this.description}: ${(err === null || err === void 0 ? void 0 : err.message) || err}`);
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
        await promise_fs_1.pfs.write(fd, Buffer.from(header));
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
                await promise_fs_1.pfs.write(fd, Buffer.from(bytes), 0, bytes.length, treeRefIndex + 4);
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
        const fd = await promise_fs_1.pfs.open(this.fileName, promise_fs_1.pfs.flags.write);
        const { header, headerLength, treeRefIndex, treeDetails } = this._getIndexHeaderBytes({ totalEntries, totalValues });
        try {
            await promise_fs_1.pfs.write(fd, Buffer.from(header));
            // append binary tree data
            const tree = builder.create();
            const stream = promise_fs_1.pfs.fs.createWriteStream(null, { fd, autoClose: false });
            const references = [];
            const writer = new btree_1.BinaryWriter(stream, async (data, position) => {
                references.push({ data, position });
                // return pfs.write(fd, data, 0, data.byteLength, headerLength + position);
            });
            await tree.toBinary(true, writer);
            // Update all references
            while (references.length > 0) {
                const ref = references.shift();
                await promise_fs_1.pfs.write(fd, ref.data, 0, ref.data.byteLength, headerLength + ref.position);
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
            await promise_fs_1.pfs.write(fd, Buffer.from(bytes), 0, bytes.length, treeRefIndex + 4);
            // return pfs.write(fd, binary);
            await promise_fs_1.pfs.close(fd);
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
            const fd = await promise_fs_1.pfs.open(this.fileName, promise_fs_1.pfs.flags.readAndWrite);
            const reader = async (index, length) => {
                const buffer = Buffer.alloc(length);
                const { bytesRead } = await promise_fs_1.pfs.read(fd, buffer, 0, length, this.trees.default.fileIndex + index);
                if (bytesRead < length) {
                    return buffer.slice(0, bytesRead);
                }
                return buffer;
            };
            const writer = async (data, index) => {
                const buffer = data.constructor === Uint8Array
                    ? Buffer.from(data.buffer, data.byteOffset, data.byteLength)
                    : Buffer.from(data);
                const result = await promise_fs_1.pfs.write(fd, buffer, 0, data.length, this.trees.default.fileIndex + index);
                return result;
            };
            const tree = new btree_1.BinaryBPlusTree(reader, DISK_BLOCK_SIZE, writer);
            tree.id = acebase_core_1.ID.generate(); // this.fileName; // For tree locking
            tree.autoGrow = true; // Allow the tree to grow. DISABLE THIS IF THERE ARE MULTIPLE TREES IN THE INDEX FILE LATER! (which is not implemented yet)
            this._idx = { fd, tree };
        }
        return {
            tree: this._idx.tree,
            /** Closes the index file, does not release the lock! */
            close: async () => {
                const fd = this._idx.fd;
                this._idx = null;
                await promise_fs_1.pfs.close(fd)
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
exports.DataIndex = DataIndex;
class IndexQueryResult {
    constructor(key, path, value, metadata) {
        this.key = key;
        this.path = path;
        this.value = value;
        this.metadata = metadata;
    }
}
exports.IndexQueryResult = IndexQueryResult;
class IndexQueryResults extends Array {
    constructor(...args) {
        super(...args);
        this.hints = [];
        this.stats = null;
    }
    static fromResults(results, filterKey) {
        const arr = new IndexQueryResults(results.length);
        results.forEach((result, i) => arr[i] = result);
        arr.filterKey = filterKey;
        return arr;
    }
    // /** @param {BinaryBPlusTreeLeafEntry[]} entries */
    // set treeEntries(entries) {
    //     this._treeEntries = entries;
    // }
    // /** @type {BinaryBPlusTreeLeafEntry[]} */
    // get treeEntries() {
    //     return this._treeEntries;
    // }
    // filter(callback: (result: IndexQueryResult, index: number, arr: IndexQueryResults) => boolean) {
    //     return super.filter(callback);
    // }
    filterMetadata(key, op, compare) {
        if (typeof compare === 'undefined') {
            compare = null; // compare with null so <, <=, > etc will get the right results
        }
        if (op === 'exists' || op === '!exists') {
            op = op === 'exists' ? '!=' : '==';
            compare = null;
        }
        const filtered = this.filter(result => {
            let value = key === this.filterKey ? result.value : result.metadata ? result.metadata[key] : null;
            if (typeof value === 'undefined') {
                value = null; // compare with null
            }
            if (op === '<') {
                return value < compare;
            }
            if (op === '<=') {
                return value <= compare;
            }
            if (op === '>') {
                return value > compare;
            }
            if (op === '>=') {
                return value >= compare;
            }
            if (op === '==') {
                return value == compare;
            }
            if (op === '!=') {
                return value != compare;
            }
            if (op === 'like' || op === '!like') {
                if (typeof compare !== 'string') {
                    return op === '!like';
                }
                const pattern = '^' + compare.replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
                const re = new RegExp(pattern, 'i');
                const isLike = re.test(value);
                return op === 'like' ? isLike : !isLike;
            }
            if (op === 'in' || op === '!in') {
                const isIn = compare instanceof Array && compare.includes(value);
                return op === 'in' ? isIn : !isIn;
            }
            if (op == 'between' || op === '!between') {
                if (!(compare instanceof Array)) {
                    return op === '!between';
                }
                let bottom = compare[0], top = compare[1];
                if (top < bottom) {
                    const swap = top;
                    top = bottom;
                    bottom = swap;
                }
                const isBetween = value >= bottom && value <= top;
                return op === 'between' ? isBetween : !isBetween;
            }
            if (op === 'matches' || op === '!matches') {
                if (!(compare instanceof RegExp)) {
                    return op === '!matches';
                }
                const re = compare;
                const isMatch = re.test(value);
                return op === 'matches' ? isMatch : !isMatch;
            }
        });
        return IndexQueryResults.fromResults(filtered, this.filterKey);
    }
}
exports.IndexQueryResults = IndexQueryResults;
class IndexQueryStats {
    constructor(type, args, start = false) {
        this.type = type;
        this.args = args;
        this.started = 0;
        this.stopped = 0;
        this.steps = [];
        this.result = null;
        /**
         * Used by GeoIndex: amount of queries executed to get results
         */
        this.queries = 1;
        if (start) {
            this.start();
        }
    }
    start() {
        this.started = Date.now();
    }
    stop(result = null) {
        this.stopped = Date.now();
        this.result = result;
    }
    get duration() { return this.stopped - this.started; }
}
/**
 * An array index allows all values in an array node to be indexed and searched
 */
class ArrayIndex extends DataIndex {
    constructor(storage, path, key, options) {
        if (key === '{key}') {
            throw new Error('Cannot create array index on node keys');
        }
        super(storage, path, key, options);
    }
    // get fileName() {
    //     return super.fileName.slice(0, -4) + '.array.idx';
    // }
    get type() {
        return 'array';
    }
    async handleRecordUpdate(path, oldValue, newValue) {
        const tmpOld = oldValue !== null && typeof oldValue === 'object' && this.key in oldValue ? oldValue[this.key] : null;
        const tmpNew = newValue !== null && typeof newValue === 'object' && this.key in newValue ? newValue[this.key] : null;
        let oldEntries;
        if (tmpOld instanceof Array) {
            // Only use unique values
            oldEntries = tmpOld.reduce((unique, entry) => {
                !unique.includes(entry) && unique.push(entry);
                return unique;
            }, []);
        }
        else {
            oldEntries = [];
        }
        if (oldEntries.length === 0) {
            // Add undefined entry to indicate empty array
            oldEntries.push(undefined);
        }
        let newEntries;
        if (tmpNew instanceof Array) {
            // Only use unique values
            newEntries = tmpNew.reduce((unique, entry) => {
                !unique.includes(entry) && unique.push(entry);
                return unique;
            }, []);
        }
        else {
            newEntries = [];
        }
        if (newEntries.length === 0) {
            // Add undefined entry to indicate empty array
            newEntries.push(undefined);
        }
        const removed = oldEntries.filter(entry => !newEntries.includes(entry));
        const added = newEntries.filter(entry => !oldEntries.includes(entry));
        const mutated = { old: {}, new: {} };
        Object.assign(mutated.old, oldValue);
        Object.assign(mutated.new, newValue);
        const promises = [];
        removed.forEach(entry => {
            mutated.old[this.key] = entry;
            mutated.new[this.key] = null;
            const p = super.handleRecordUpdate(path, mutated.old, mutated.new);
            promises.push(p);
        });
        added.forEach(entry => {
            mutated.old[this.key] = null;
            mutated.new[this.key] = entry;
            const p = super.handleRecordUpdate(path, mutated.old, mutated.new);
            promises.push(p);
        });
        await Promise.all(promises);
    }
    build() {
        return super.build({
            addCallback: (add, array, recordPointer, metadata) => {
                if (!(array instanceof Array) || array.length === 0) {
                    // Add undefined entry to indicate empty array
                    add(undefined, recordPointer, metadata);
                    return [];
                }
                // index unique items only
                array.reduce((unique, value) => {
                    !unique.includes(value) && unique.push(value);
                    return unique;
                }, []).forEach(value => {
                    add(value, recordPointer, metadata);
                });
                return array;
            },
            valueTypes: [node_value_types_1.VALUE_TYPES.ARRAY],
        });
    }
    static get validOperators() {
        // This is the only special index that does not use prefixed operators
        // because these can also be used to query non-indexed arrays (but slower, of course..)
        return ['contains', '!contains'];
    }
    get validOperators() {
        return ArrayIndex.validOperators;
    }
    /**
     * @param op "contains" or "!contains"
     * @param val value to search for
     */
    async query(op, val, options) {
        if (op instanceof btree_1.BlacklistingSearchOperator) {
            throw new Error(`Not implemented: Can't query array index with blacklisting operator yet`);
        }
        if (!ArrayIndex.validOperators.includes(op)) {
            throw new Error(`Array indexes can only be queried with operators ${ArrayIndex.validOperators.map(op => `"${op}"`).join(', ')}`);
        }
        if (options) {
            this.storage.debug.warn('Not implemented: query options for array indexes are ignored');
        }
        // Check cache
        const cache = this.cache(op, val);
        if (cache) {
            // Use cached results
            return cache;
        }
        const stats = new IndexQueryStats('array_index_query', val, true);
        if ((op === 'contains' || op === '!contains') && val instanceof Array && val.length === 0) {
            // Added for #135: empty compare array for contains/!contains must match all values
            stats.type = 'array_index_scan';
            const results = await super.query(new btree_1.BlacklistingSearchOperator((_) => []));
            stats.stop(results.length);
            results.filterKey = this.key;
            results.stats = stats;
            // Don't cache results
            return results;
        }
        else if (op === 'contains') {
            if (val instanceof Array) {
                // recipesIndex.query('contains', ['egg','bacon'])
                // Get result count for each value in array
                const countPromises = val.map(value => {
                    const wildcardIndex = typeof value !== 'string' ? -1 : ~(~value.indexOf('*') || ~value.indexOf('?'));
                    const valueOp = ~wildcardIndex ? 'like' : '==';
                    const step = new IndexQueryStats('count', value, true);
                    stats.steps.push(step);
                    return this.count(valueOp, value)
                        .then(count => {
                        step.stop(count);
                        return { value, count };
                    });
                });
                const counts = await Promise.all(countPromises);
                // Start with the smallest result set
                counts.sort((a, b) => {
                    if (a.count < b.count) {
                        return -1;
                    }
                    else if (a.count > b.count) {
                        return 1;
                    }
                    return 0;
                });
                let results;
                if (counts[0].count === 0) {
                    stats.stop(0);
                    this.storage.debug.log(`Value "${counts[0].value}" not found in index, 0 results for query ${op} ${val}`);
                    results = new IndexQueryResults(0);
                    results.filterKey = this.key;
                    results.stats = stats;
                    // Add query hints for each unknown item
                    counts.forEach(c => {
                        if (c.count === 0) {
                            const hint = new ArrayIndexQueryHint(ArrayIndexQueryHint.types.missingValue, c.value);
                            results.hints.push(hint);
                        }
                    });
                    // Cache the empty result set
                    this.cache(op, val, results);
                    return results;
                }
                const allValues = counts.map(c => c.value);
                // Query 1 value, then filter results further and further
                // Start with the smallest result set
                const queryValue = (value, filter) => {
                    const wildcardIndex = typeof value !== 'string' ? -1 : ~(~value.indexOf('*') || ~value.indexOf('?'));
                    const valueOp = ~wildcardIndex ? 'like' : '==';
                    return super.query(valueOp, value, { filter })
                        .then(results => {
                        stats.steps.push(results.stats);
                        return results;
                    });
                };
                let valueIndex = 0;
                // let resultsPerValue = new Array(values.length);
                const nextValue = async () => {
                    const value = allValues[valueIndex];
                    const fr = await queryValue(value, results);
                    results = fr;
                    valueIndex++;
                    if (results.length === 0 || valueIndex === allValues.length) {
                        return;
                    }
                    await nextValue();
                };
                await nextValue();
                results.filterKey = this.key;
                stats.stop(results.length);
                results.stats = stats;
                // Cache results
                delete results.entryValues; // No need to cache these. Free the memory
                this.cache(op, val, results);
                return results;
            }
            else {
                // Single value query
                const valueOp = typeof val === 'string' && (val.includes('*') || val.includes('?'))
                    ? 'like'
                    : '==';
                const results = await super.query(valueOp, val);
                stats.steps.push(results.stats);
                results.stats = stats;
                delete results.entryValues;
                return results;
            }
        }
        else if (op === '!contains') {
            // DISABLED executing super.query('!=', val) because it returns false positives
            // for arrays that "!contains" val, but does contain other values...
            // Eg: an indexed array value of: ['bacon', 'egg', 'toast', 'sausage'],
            // when executing index.query('!contains', 'bacon'),
            // it will falsely match that record because the 2nd value 'egg'
            // matches the filter ('egg' is not 'bacon')
            // NEW: BlacklistingSearchOperator will take all values in the index unless
            // they are blacklisted along the way. Our callback determines whether to blacklist
            // an entry's values, which we'll do if its key matches val
            const customOp = new btree_1.BlacklistingSearchOperator(entry => {
                const blacklist = val === entry.key
                    || (val instanceof Array && val.includes(entry.key));
                if (blacklist) {
                    return entry.values;
                }
            });
            stats.type = 'array_index_blacklist_scan';
            const results = await super.query(customOp);
            stats.stop(results.length);
            results.filterKey = this.key;
            results.stats = stats;
            // Cache results
            this.cache(op, val, results);
            return results;
        }
    }
}
exports.ArrayIndex = ArrayIndex;
class WordInfo {
    constructor(word, indexes, sourceIndexes) {
        this.word = word;
        this.indexes = indexes;
        this.sourceIndexes = sourceIndexes;
    }
    get occurs() {
        return this.indexes.length;
    }
}
// const _wordsRegex = /[\w']+/gmi; // TODO: should use a better pattern that supports non-latin characters
class TextInfo {
    constructor(text, options) {
        var _a;
        // this.text = text; // Be gone later...
        this.locale = options.locale || 'en';
        const localeSettings = TextInfo.locales.get(this.locale);
        let pattern = localeSettings.pattern;
        if (options.pattern && options.pattern instanceof RegExp) {
            pattern = options.pattern.source;
        }
        else if (typeof options.pattern === 'string') {
            pattern = options.pattern;
        }
        if (options.includeChars) {
            console.assert(pattern.indexOf('[') >= 0, 'pattern does not contain []');
            let insert = '';
            for (let i = 0; i < options.includeChars.length; i++) {
                insert += '\\' + options.includeChars[i];
            }
            let pos = -1;
            while (true) {
                const index = pattern.indexOf('[', pos + 1) + 1;
                if (index === 0) {
                    break;
                }
                pattern = pattern.slice(0, index) + insert + pattern.slice(index);
                pos = index;
            }
        }
        let flags = localeSettings.flags;
        if (typeof options.flags === 'string') {
            flags = options.flags;
        }
        const re = new RegExp(pattern, flags);
        const minLength = typeof options.minLength === 'number' ? options.minLength : 1;
        const maxLength = typeof options.maxLength === 'number' ? options.maxLength : 25;
        let blacklist = options.blacklist instanceof Array ? options.blacklist : [];
        if (localeSettings.stoplist instanceof Array && options.useStoplist === true) {
            blacklist = blacklist.concat(localeSettings.stoplist);
        }
        const whitelist = options.whitelist instanceof Array ? options.whitelist : [];
        const words = this.words = new Map();
        this.ignored = [];
        if (text === null || typeof text === 'undefined') {
            return;
        }
        if (options.prepare) {
            // Pre-process text. Allows decompression, decrypting, custom stemming etc
            text = options.prepare(text, this.locale, `"${(_a = options.includeChars) !== null && _a !== void 0 ? _a : ''}`);
        }
        // Unidecode text to get ASCII characters only
        function safe_unidecode(str) {
            // Fix for occasional multi-pass issue, copied from https://github.com/FGRibreau/node-unidecode/issues/16
            let ret;
            while (str !== (ret = (0, unidecode_1.default)(str))) {
                str = ret;
            }
            return ret;
        }
        text = safe_unidecode(text);
        // Remove any single quotes, so "don't" will be stored as "dont", "isn't" as "isnt" etc
        text = text.replace(/'/g, '');
        // Process the text
        // const wordsRegex = /[\w']+/gu;
        let wordIndex = 0;
        while (true) {
            const match = re.exec(text);
            if (match === null) {
                break;
            }
            let word = match[0];
            // TODO: use stemming such as snowball (https://www.npmjs.com/package/snowball-stemmers)
            // to convert words like "having" to "have", and "cycles", "cycle", "cycling" to "cycl"
            if (typeof options.stemming === 'function') {
                // Let callback function perform word stemming
                const stemmed = options.stemming(word, this.locale);
                if (typeof stemmed !== 'string') {
                    // Ignore this word
                    if (this.ignored.indexOf(word) < 0) {
                        this.ignored.push(word);
                    }
                    // Do not increase wordIndex
                    continue;
                }
                word = stemmed;
            }
            word = word.toLocaleLowerCase(this.locale);
            if (word.length < minLength || ~blacklist.indexOf(word)) {
                // Word does not meet set criteria
                if (!~whitelist.indexOf(word)) {
                    // Not whitelisted either
                    if (this.ignored.indexOf(word) < 0) {
                        this.ignored.push(word);
                    }
                    // Do not increase wordIndex
                    continue;
                }
            }
            else if (word.length > maxLength) {
                // Use the word, but cut it to the max length
                word = word.slice(0, maxLength);
            }
            let wordInfo = words.get(word);
            if (wordInfo) {
                wordInfo.indexes.push(wordIndex);
                wordInfo.sourceIndexes.push(match.index);
            }
            else {
                wordInfo = new WordInfo(word, [wordIndex], [match.index]);
                words.set(word, wordInfo);
            }
            wordIndex++;
        }
    }
    static get locales() {
        return {
            'default': {
                pattern: '[A-Za-z0-9\']+',
                flags: 'gmi',
            },
            'en': {
                // English stoplist from https://gist.github.com/sebleier/554280
                stoplist: ['i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', 'your', 'yours', 'yourself', 'yourselves', 'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself', 'it', 'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves', 'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those', 'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing', 'a', 'an', 'the', 'and', 'but', 'if', 'or', 'because', 'as', 'until', 'while', 'of', 'at', 'by', 'for', 'with', 'about', 'against', 'between', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'to', 'from', 'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 's', 't', 'can', 'will', 'just', 'don', 'should', 'now'],
            },
            get(locale) {
                const settings = {};
                Object.assign(settings, this.default);
                if (typeof this[locale] === 'undefined' && locale.indexOf('-') > 0) {
                    locale = locale.split('-')[1];
                }
                if (typeof this[locale] === 'undefined') {
                    return settings;
                }
                Object.keys(this[locale]).forEach(key => {
                    settings[key] = this[locale][key];
                });
                return settings;
            },
        };
    }
    getWordInfo(word) {
        return this.words.get(word);
    }
    /**
     * Reconstructs an array of words in the order they were encountered
     */
    toSequence() {
        const arr = [];
        for (const { word, indexes } of this.words.values()) {
            for (const index of indexes) {
                arr[index] = word;
            }
        }
        return arr;
    }
    /**
     * Returns all unique words in an array
     */
    toArray() {
        const arr = [];
        for (const word of this.words.keys()) {
            arr.push(word);
        }
        return arr;
    }
    get uniqueWordCount() {
        return this.words.size; //.length;
    }
    get wordCount() {
        let total = 0;
        for (const wordInfo of this.words.values()) {
            total += wordInfo.occurs;
        }
        return total;
        // return this.words.reduce((total, word) => total + word.occurs, 0);
    }
}
/**
 * A full text index allows all words in text nodes to be indexed and searched.
 * Eg: "Every word in this text must be indexed." will be indexed with every word
 * and can be queried with filters 'contains' and '!contains' a word, words or pattern.
 * Eg: 'contains "text"', 'contains "text indexed"', 'contains "text in*"' will all match the text above.
 * This does not use a thesauris or word lists (yet), so 'contains "query"' will not match.
 * Each word will be stored and searched in lowercase
 */
class FullTextIndex extends DataIndex {
    constructor(storage, path, key, options) {
        if (key === '{key}') {
            throw new Error('Cannot create fulltext index on node keys');
        }
        super(storage, path, key, options);
        // this.enableReverseLookup = true;
        this.indexMetadataKeys = ['_occurs_']; //,'_indexes_'
        this.config = options.config || {};
        if (this.config.localeKey) {
            // localeKey is supported by all indexes now
            storage.debug.warn(`fulltext index config option "localeKey" has been deprecated, as it is now supported for all indexes. Move the setting to the global index settings`);
            this.textLocaleKey = this.config.localeKey; // Do use it now
        }
    }
    // get fileName() {
    //     return super.fileName.slice(0, -4) + '.fulltext.idx';
    // }
    get type() {
        return 'fulltext';
    }
    getTextInfo(val, locale) {
        return new TextInfo(val, {
            locale: locale !== null && locale !== void 0 ? locale : this.textLocale,
            prepare: this.config.prepare,
            stemming: this.config.transform,
            blacklist: this.config.blacklist,
            whitelist: this.config.whitelist,
            useStoplist: this.config.useStoplist,
            minLength: this.config.minLength,
            maxLength: this.config.maxLength,
        });
    }
    test(obj, op, val) {
        var _a;
        if (obj === null) {
            return op === 'fulltext:!contains';
        }
        const text = obj[this.key];
        if (typeof text === 'undefined') {
            return op === 'fulltext:!contains';
        }
        const locale = (_a = obj === null || obj === void 0 ? void 0 : obj[this.textLocaleKey]) !== null && _a !== void 0 ? _a : this.textLocale;
        const textInfo = this.getTextInfo(text, locale);
        if (op === 'fulltext:contains') {
            if (~val.indexOf(' OR ')) {
                // split
                const tests = val.split(' OR ');
                return tests.some(val => this.test(text, op, val));
            }
            else if (~val.indexOf('"')) {
                // Phrase(s) used. We have to make sure the words used are not only in the text,
                // but also in that exact order.
                const phraseRegex = /"(.+?)"/g;
                const phrases = [];
                while (true) {
                    const match = phraseRegex.exec(val);
                    if (match === null) {
                        break;
                    }
                    const phrase = match[1];
                    phrases.push(phrase);
                    val = val.slice(0, match.index) + val.slice(match.index + match[0].length);
                    phraseRegex.lastIndex = 0;
                }
                if (val.length > 0) {
                    phrases.push(val);
                }
                return phrases.every(phrase => {
                    const phraseInfo = this.getTextInfo(phrase, locale);
                    // This was broken before TS port because WordInfo had an array of words that was not
                    // in the same order as the source words were.
                    // TODO: Thoroughly test this new code
                    const phraseWords = phraseInfo.toSequence();
                    const occurrencesPerWord = phraseWords.map((word, i) => {
                        // Find word in text
                        const { indexes } = textInfo.words.get(word);
                        return indexes;
                    });
                    const hasSequenceAtIndex = (wordIndex, occurrenceIndex) => {
                        var _a;
                        const startIndex = (_a = occurrencesPerWord[wordIndex]) === null || _a === void 0 ? void 0 : _a[occurrenceIndex];
                        return occurrencesPerWord.slice(wordIndex + 1).every((occurences, i) => {
                            return occurences.some((index, j) => {
                                if (index !== startIndex + 1) {
                                    return false;
                                }
                                return hasSequenceAtIndex(wordIndex + i, j);
                            });
                        });
                    };
                    // Find the existence of a sequence of words
                    // Loop: for each occurrence of the first word in text, remember its index
                    // Try to find second word in text with index+1
                    //  - found: try to find third word in text with index+2, etc (recursive)
                    //  - not found: stop, proceed with next occurrence in main loop
                    return occurrencesPerWord[0].some((occurrence, i) => {
                        return hasSequenceAtIndex(0, i);
                    });
                    // const indexes = phraseInfo.words.map(word => textInfo.words.indexOf(word));
                    // if (indexes[0] < 0) { return false; }
                    // for (let i = 1; i < indexes.length; i++) {
                    //     if (indexes[i] - indexes[i-1] !== 1) {
                    //         return false;
                    //     }
                    // }
                    // return true;
                });
            }
            else {
                // test 1 or more words
                const wordsInfo = this.getTextInfo(val, locale);
                return wordsInfo.toSequence().every(word => {
                    return textInfo.words.has(word);
                });
            }
        }
    }
    async handleRecordUpdate(path, oldValue, newValue) {
        var _a, _b;
        let oldText = oldValue !== null && typeof oldValue === 'object' && this.key in oldValue ? oldValue[this.key] : null;
        let newText = newValue !== null && typeof newValue === 'object' && this.key in newValue ? newValue[this.key] : null;
        const oldLocale = (_a = oldValue === null || oldValue === void 0 ? void 0 : oldValue[this.textLocaleKey]) !== null && _a !== void 0 ? _a : this.textLocale, newLocale = (_b = newValue === null || newValue === void 0 ? void 0 : newValue[this.textLocaleKey]) !== null && _b !== void 0 ? _b : this.textLocale;
        if (typeof oldText === 'object' && oldText instanceof Array) {
            oldText = oldText.join(' ');
        }
        if (typeof newText === 'object' && newText instanceof Array) {
            newText = newText.join(' ');
        }
        const oldTextInfo = this.getTextInfo(oldText, oldLocale);
        const newTextInfo = this.getTextInfo(newText, newLocale);
        // super._updateReverseLookupKey(
        //     path,
        //     oldText ? textEncoder.encode(oldText) : null,
        //     newText ? textEncoder.encode(newText) : null,
        //     metadata
        // );
        const oldWords = oldTextInfo.toArray(); //.words.map(w => w.word);
        const newWords = newTextInfo.toArray(); //.words.map(w => w.word);
        const removed = oldWords.filter(word => newWords.indexOf(word) < 0);
        const added = newWords.filter(word => oldWords.indexOf(word) < 0);
        const changed = oldWords.filter(word => newWords.indexOf(word) >= 0).filter(word => {
            const oldInfo = oldTextInfo.getWordInfo(word);
            const newInfo = newTextInfo.getWordInfo(word);
            return oldInfo.occurs !== newInfo.occurs || oldInfo.indexes.some((index, i) => newInfo.indexes[i] !== index);
        });
        changed.forEach(word => {
            // Word metadata changed. Simplest solution: remove and add again
            removed.push(word);
            added.push(word);
        });
        const promises = [];
        // TODO: Prepare operations batch, then execute 1 tree update.
        // Now every word is a seperate update which is not necessary!
        removed.forEach(word => {
            const p = super.handleRecordUpdate(path, { [this.key]: word }, { [this.key]: null });
            promises.push(p);
        });
        added.forEach(word => {
            const mutated = {};
            Object.assign(mutated, newValue);
            mutated[this.key] = word;
            const wordInfo = newTextInfo.getWordInfo(word);
            // const indexMetadata = {
            //     '_occurs_': wordInfo.occurs,
            //     '_indexes_': wordInfo.indexes.join(',')
            // };
            let occurs = wordInfo.indexes.join(',');
            if (occurs.length > 255) {
                console.warn(`FullTextIndex ${this.description}: word "${word}" occurs too many times in "${path}/${this.key}" to store in index metadata. Truncating occurrences`);
                const cutIndex = occurs.lastIndexOf(',', 255);
                occurs = occurs.slice(0, cutIndex);
            }
            const indexMetadata = {
                '_occurs_': occurs,
            };
            const p = super.handleRecordUpdate(path, { [this.key]: null }, mutated, indexMetadata);
            promises.push(p);
        });
        await Promise.all(promises);
    }
    build() {
        return super.build({
            addCallback: (add, text, recordPointer, metadata, env) => {
                if (typeof text === 'object' && text instanceof Array) {
                    text = text.join(' ');
                }
                if (typeof text === 'undefined') {
                    text = '';
                }
                const locale = env.locale || this.textLocale;
                const textInfo = this.getTextInfo(text, locale);
                if (textInfo.words.size === 0) {
                    this.storage.debug.warn(`No words found in "${typeof text === 'string' && text.length > 50 ? text.slice(0, 50) + '...' : text}" to fulltext index "${env.path}"`);
                }
                // const revLookupKey = super._getRevLookupKey(env.path);
                // tree.add(revLookupKey, textEncoder.encode(text), metadata);
                textInfo.words.forEach(wordInfo => {
                    // IDEA: To enable fast '*word' queries (starting with wildcard), we can also store
                    // reversed words and run reversed query 'drow*' on it. we'd have to enable storing
                    // multiple B+Trees in a single index file: a 'forward' tree & a 'reversed' tree
                    // IDEA: Following up on previous idea: being able to backtrack nodes within an index would
                    // help to speed up sorting queries on an indexed key,
                    // eg: query .take(10).filter('rating','>=', 8).sort('title')
                    // does not filter on key 'title', but can then use an index on 'title' for the sorting:
                    // it can take the results from the 'rating' index and backtrack the nodes' titles to quickly
                    // get a sorted top 10. We'd have to store a seperate 'backtrack' tree that uses recordPointers
                    // as the key, and 'title' values as recordPointers. Caveat: max string length for sorting would
                    // then be 255 ASCII chars, because that's the recordPointer size limit.
                    // The same boost can currently only be achieved by creating an index that includes 'title' in
                    // the index on 'rating' ==> db.indexes.create('movies', 'rating', { include: ['title'] })
                    // Extend metadata with more details about the word (occurrences, positions)
                    // const wordMetadata = {
                    //     '_occurs_': wordInfo.occurs,
                    //     '_indexes_': wordInfo.indexes.join(',')
                    // };
                    let occurs = wordInfo.indexes.join(',');
                    if (occurs.length > 255) {
                        console.warn(`FullTextIndex ${this.description}: word "${wordInfo.word}" occurs too many times to store in index metadata. Truncating occurrences`);
                        const cutIndex = occurs.lastIndexOf(',', 255);
                        occurs = occurs.slice(0, cutIndex);
                    }
                    const wordMetadata = {
                        '_occurs_': occurs,
                    };
                    Object.assign(wordMetadata, metadata);
                    add(wordInfo.word, recordPointer, wordMetadata);
                });
                return textInfo.toArray(); //words.map(info => info.word);
            },
            valueTypes: [node_value_types_1.VALUE_TYPES.STRING],
        });
    }
    static get validOperators() {
        return ['fulltext:contains', 'fulltext:!contains'];
    }
    get validOperators() {
        return FullTextIndex.validOperators;
    }
    async query(op, val, options) {
        if (op instanceof btree_1.BlacklistingSearchOperator) {
            throw new Error(`Not implemented: Can't query fulltext index with blacklisting operator yet`);
        }
        if (op === 'fulltext:contains' || op === 'fulltext:!contains') {
            return this.contains(op, val, options);
        }
        else {
            throw new Error(`Fulltext indexes can only be queried with operators ${FullTextIndex.validOperators.map(op => `"${op}"`).join(', ')}`);
        }
    }
    /**
     *
     * @param op Operator to use, can be either "fulltext:contains" or "fulltext:!contains"
     * @param val Text to search for. Can include * and ? wildcards, OR's for combined searches, and "quotes" for phrase searches
     */
    async contains(op, val, options = {
        phrase: false,
        locale: undefined,
        minimumWildcardWordLength: 2,
    }) {
        if (!FullTextIndex.validOperators.includes(op)) { //if (op !== 'fulltext:contains' && op !== 'fulltext:not_contains') {
            throw new Error(`Fulltext indexes can only be queried with operators ${FullTextIndex.validOperators.map(op => `"${op}"`).join(', ')}`);
        }
        // Check cache
        const cache = this.cache(op, val);
        if (cache) {
            // Use cached results
            return Promise.resolve(cache);
        }
        const stats = new IndexQueryStats(options.phrase ? 'fulltext_phrase_query' : 'fulltext_query', val, true);
        // const searchWordRegex = /[\w'?*]+/g; // Use TextInfo to find and transform words using index settings
        const getTextInfo = (text) => {
            const info = new TextInfo(text, {
                locale: options.locale || this.textLocale,
                prepare: this.config.prepare,
                stemming: this.config.transform,
                minLength: this.config.minLength,
                maxLength: this.config.maxLength,
                blacklist: this.config.blacklist,
                whitelist: this.config.whitelist,
                useStoplist: this.config.useStoplist,
                includeChars: '*?',
            });
            // Ignore any wildcard words that do not meet the set minimum length
            // This is to safeguard the system against (possibly unwanted) very large
            // result sets
            const words = info.toArray();
            let i;
            while (i = words.findIndex(w => /^[*?]+$/.test(w)), i >= 0) {
                // Word is wildcards only. Ignore
                const word = words[i];
                info.ignored.push(word);
                info.words.delete(word);
            }
            if (options.minimumWildcardWordLength > 0) {
                for (const word of words) {
                    const starIndex = word.indexOf('*');
                    // min = 2, word = 'an*', starIndex = 2, ok!
                    // min = 3: starIndex < min: not ok!
                    if (starIndex > 0 && starIndex < options.minimumWildcardWordLength) {
                        info.ignored.push(word);
                        info.words.delete(word);
                        i--;
                    }
                }
            }
            return info;
        };
        if (val.includes(' OR ')) {
            // Multiple searches in one query: 'secret OR confidential OR "don't tell"'
            // TODO: chain queries instead of running simultanious?
            const queries = val.split(' OR ');
            const promises = queries.map(q => this.query(op, q, options));
            const resultSets = await Promise.all(promises);
            stats.steps.push(...resultSets.map(results => results.stats));
            const mergeStep = new IndexQueryStats('merge_expand', { sets: resultSets.length, results: resultSets.reduce((total, set) => total + set.length, 0) }, true);
            stats.steps.push(mergeStep);
            const merged = resultSets[0];
            resultSets.slice(1).forEach(results => {
                results.forEach(result => {
                    const exists = ~merged.findIndex(r => r.path === result.path);
                    if (!exists) {
                        merged.push(result);
                    }
                });
            });
            const results = IndexQueryResults.fromResults(merged, this.key);
            mergeStep.stop(results.length);
            stats.stop(results.length);
            results.stats = stats;
            results.hints.push(...resultSets.reduce((hints, set) => { hints.push(...set.hints); return hints; }, []));
            return results;
        }
        if (val.includes('"')) {
            // Phrase(s) used. We have to make sure the words used are not only in the text,
            // but also in that exact order.
            const phraseRegex = /"(.+?)"/g;
            const phrases = [];
            while (true) {
                const match = phraseRegex.exec(val);
                if (match === null) {
                    break;
                }
                const phrase = match[1];
                phrases.push(phrase);
                val = val.slice(0, match.index) + val.slice(match.index + match[0].length);
                phraseRegex.lastIndex = 0;
            }
            const phraseOptions = {};
            Object.assign(phraseOptions, options);
            phraseOptions.phrase = true;
            const promises = phrases.map(phrase => this.query(op, phrase, phraseOptions));
            // Check if what is left over still contains words
            if (val.length > 0 && getTextInfo(val).wordCount > 0) { //(val.match(searchWordRegex) !== null) {
                // Add it
                const promise = this.query(op, val, options);
                promises.push(promise);
            }
            const resultSets = await Promise.all(promises);
            stats.steps.push(...resultSets.map(results => results.stats));
            // Take shortest set, only keep results that are matched in all other sets
            const mergeStep = new IndexQueryStats('merge_reduce', { sets: resultSets.length, results: resultSets.reduce((total, set) => total + set.length, 0) }, true);
            resultSets.length > 1 && stats.steps.push(mergeStep);
            const shortestSet = resultSets.sort((a, b) => a.length < b.length ? -1 : 1)[0];
            const otherSets = resultSets.slice(1);
            const matches = shortestSet.reduce((matches, match) => {
                // Check if the key is present in the other result sets
                const path = match.path;
                const matchedInAllSets = otherSets.every(set => set.findIndex(match => match.path === path) >= 0);
                if (matchedInAllSets) {
                    matches.push(match);
                }
                return matches;
            }, new IndexQueryResults());
            matches.filterKey = this.key;
            mergeStep.stop(matches.length);
            stats.stop(matches.length);
            matches.stats = stats;
            matches.hints.push(...resultSets.reduce((hints, set) => { hints.push(...set.hints); return hints; }, []));
            return matches;
        }
        const info = getTextInfo(val);
        /**
         * Add ignored words to the result hints
         */
        function addIgnoredWordHints(results) {
            // Add hints for ignored words
            info.ignored.forEach(word => {
                const hint = new FullTextIndexQueryHint(FullTextIndexQueryHint.types.ignoredWord, word);
                results.hints.push(hint);
            });
        }
        const words = info.toArray();
        if (words.length === 0) {
            // Resolve with empty array
            stats.stop(0);
            const results = IndexQueryResults.fromResults([], this.key);
            results.stats = stats;
            addIgnoredWordHints(results);
            return results;
        }
        if (op === 'fulltext:!contains') {
            // NEW: Use BlacklistingSearchOperator that uses all (unique) values in the index,
            // besides the ones that get blacklisted along the way by our callback function
            const wordChecks = words.map(word => {
                if (word.includes('*') || word.includes('?')) {
                    const pattern = '^' + word.replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
                    const re = new RegExp(pattern, 'i');
                    return re;
                }
                return word;
            });
            const customOp = new btree_1.BlacklistingSearchOperator(entry => {
                const blacklist = wordChecks.some(word => {
                    if (word instanceof RegExp) {
                        return word.test(entry.key);
                    }
                    return entry.key === word;
                });
                if (blacklist) {
                    return entry.values;
                }
            });
            stats.type = 'fulltext_blacklist_scan';
            const results = await super.query(customOp);
            stats.stop(results.length);
            results.filterKey = this.key;
            results.stats = stats;
            addIgnoredWordHints(results);
            // Cache results
            this.cache(op, val, results);
            return results;
        }
        // op === 'fulltext:contains'
        // Get result count for each word
        const countPromises = words.map(word => {
            const wildcardIndex = ~(~word.indexOf('*') || ~word.indexOf('?')); // TODO: improve readability
            const wordOp = wildcardIndex >= 0 ? 'like' : '==';
            const step = new IndexQueryStats('count', { op: wordOp, word }, true);
            stats.steps.push(step);
            return super.count(wordOp, word)
                .then(count => {
                step.stop(count);
                return { word, count };
            });
        });
        const counts = await Promise.all(countPromises);
        // Start with the smallest result set
        counts.sort((a, b) => {
            if (a.count < b.count) {
                return -1;
            }
            else if (a.count > b.count) {
                return 1;
            }
            return 0;
        });
        let results;
        if (counts[0].count === 0) {
            stats.stop(0);
            this.storage.debug.log(`Word "${counts[0].word}" not found in index, 0 results for query ${op} "${val}"`);
            results = new IndexQueryResults(0);
            results.filterKey = this.key;
            results.stats = stats;
            addIgnoredWordHints(results);
            // Add query hints for each unknown word
            counts.forEach(c => {
                if (c.count === 0) {
                    const hint = new FullTextIndexQueryHint(FullTextIndexQueryHint.types.missingWord, c.word);
                    results.hints.push(hint);
                }
            });
            // Cache the empty result set
            this.cache(op, val, results);
            return results;
        }
        const allWords = counts.map(c => c.word);
        // Sequentual method: query 1 word, then filter results further and further
        // More or less performs the same as parallel, but uses less memory
        // NEW: Start with the smallest result set
        // OLD: Use the longest word to search with, then filter those results
        // const allWords = words.slice().sort((a,b) => {
        //     if (a.length < b.length) { return 1; }
        //     else if (a.length > b.length) { return -1; }
        //     return 0;
        // });
        const queryWord = async (word, filter) => {
            const wildcardIndex = ~(~word.indexOf('*') || ~word.indexOf('?')); // TODO: improve readability
            const wordOp = wildcardIndex >= 0 ? 'like' : '==';
            // const step = new IndexQueryStats('query', { op: wordOp, word }, true);
            // stats.steps.push(step);
            const results = await super.query(wordOp, word, { filter });
            stats.steps.push(results.stats);
            // step.stop(results.length);
            return results;
        };
        let wordIndex = 0;
        const resultsPerWord = new Array(words.length);
        const nextWord = async () => {
            const word = allWords[wordIndex];
            const t1 = Date.now();
            const fr = await queryWord(word, results);
            const t2 = Date.now();
            this.storage.debug.log(`fulltext search for "${word}" took ${t2 - t1}ms`);
            resultsPerWord[words.indexOf(word)] = fr;
            results = fr;
            wordIndex++;
            if (results.length === 0 || wordIndex === allWords.length) {
                return;
            }
            await nextWord();
        };
        await nextWord();
        if (options.phrase === true && allWords.length > 1) {
            // Check which results have the words in the right order
            const step = new IndexQueryStats('phrase_check', val, true);
            stats.steps.push(step);
            results = results.reduce((matches, match) => {
                // the order of the resultsPerWord is in the same order as the given words,
                // check if their metadata._occurs_ say the same about the indexed content
                const path = match.path;
                const wordMatches = resultsPerWord.map(results => {
                    return results.find(result => result.path === path);
                });
                // Convert the _occurs_ strings to arrays we can use
                wordMatches.forEach(match => {
                    match.metadata._occurs_ = match.metadata._occurs_.split(',').map(parseInt);
                });
                const check = (wordMatchIndex, prevWordIndex) => {
                    const sourceIndexes = wordMatches[wordMatchIndex].metadata._occurs_;
                    if (typeof prevWordIndex !== 'number') {
                        // try with each sourceIndex of the first word
                        for (let i = 0; i < sourceIndexes.length; i++) {
                            const found = check(1, sourceIndexes[i]);
                            if (found) {
                                return true;
                            }
                        }
                        return false;
                    }
                    // We're in a recursive call on the 2nd+ word
                    if (sourceIndexes.includes(prevWordIndex + 1)) {
                        // This word came after the previous word, hooray!
                        // Proceed with next word, or report success if this was the last word to check
                        if (wordMatchIndex === wordMatches.length - 1) {
                            return true;
                        }
                        return check(wordMatchIndex + 1, prevWordIndex + 1);
                    }
                    else {
                        return false;
                    }
                };
                if (check(0)) {
                    matches.push(match); // Keep!
                }
                return matches;
            }, new IndexQueryResults());
            step.stop(results.length);
        }
        results.filterKey = this.key;
        stats.stop(results.length);
        results.stats = stats;
        addIgnoredWordHints(results);
        // Cache results
        delete results.entryValues; // No need to cache these. Free the memory
        this.cache(op, val, results);
        return results;
        // Parallel method: query all words at the same time, then combine results
        // Uses more memory
        // const promises = words.map(word => {
        //     const wildcardIndex = ~(~word.indexOf('*') || ~word.indexOf('?'));
        //     let wordOp;
        //     if (op === 'fulltext:contains') {
        //         wordOp = wildcardIndex >= 0 ? 'like' : '==';
        //     }
        //     else if (op === 'fulltext:!contains') {
        //         wordOp = wildcardIndex >= 0 ? '!like' : '!=';
        //     }
        //     // return super.query(wordOp, word)
        //     return super.query(wordOp, word)
        // });
        // return Promise.all(promises)
        // .then(resultSets => {
        //     // Now only use matches that exist in all result sets
        //     const sortedSets = resultSets.slice().sort((a,b) => a.length < b.length ? -1 : 1)
        //     const shortestSet = sortedSets[0];
        //     const otherSets = sortedSets.slice(1);
        //     let matches = shortestSet.reduce((matches, match) => {
        //         // Check if the key is present in the other result sets
        //         const path = match.path;
        //         const matchedInAllSets = otherSets.every(set => set.findIndex(match => match.path === path) >= 0);
        //         if (matchedInAllSets) { matches.push(match); }
        //         return matches;
        //     }, new IndexQueryResults());
        //     if (options.phrase === true && resultSets.length > 1) {
        //         // Check if the words are in the right order
        //         console.log(`Breakpoint time`);
        //         matches = matches.reduce((matches, match) => {
        //             // the order of the resultSets is in the same order as the given words,
        //             // check if their metadata._indexes_ say the same about the indexed content
        //             const path = match.path;
        //             const wordMatches = resultSets.map(set => {
        //                 return set.find(match => match.path === path);
        //             });
        //             // Convert the _indexes_ strings to arrays we can use
        //             wordMatches.forEach(match => {
        //                 // match.metadata._indexes_ = match.metadata._indexes_.split(',').map(parseInt);
        //                 match.metadata._occurs_ = match.metadata._occurs_.split(',').map(parseInt);
        //             });
        //             const check = (wordMatchIndex, prevWordIndex) => {
        //                 const sourceIndexes = wordMatches[wordMatchIndex].metadata._occurs_; //wordMatches[wordMatchIndex].metadata._indexes_;
        //                 if (typeof prevWordIndex !== 'number') {
        //                     // try with each sourceIndex of the first word
        //                     for (let i = 0; i < sourceIndexes.length; i++) {
        //                         const found = check(1, sourceIndexes[i]);
        //                         if (found) { return true; }
        //                     }
        //                     return false;
        //                 }
        //                 // We're in a recursive call on the 2nd+ word
        //                 if (~sourceIndexes.indexOf(prevWordIndex + 1)) {
        //                     // This word came after the previous word, hooray!
        //                     // Proceed with next word, or report success if this was the last word to check
        //                     if (wordMatchIndex === wordMatches.length-1) { return true; }
        //                     return check(wordMatchIndex+1, prevWordIndex+1);
        //                 }
        //                 else {
        //                     return false;
        //                 }
        //             }
        //             if (check(0)) {
        //                 matches.push(match); // Keep!
        //             }
        //             return matches;
        //         }, new IndexQueryResults());
        //     }
        //     matches.filterKey = this.key;
        //     return matches;
        // });
    }
}
exports.FullTextIndex = FullTextIndex;
function _getGeoRadiusPrecision(radiusM) {
    if (typeof radiusM !== 'number') {
        return;
    }
    if (radiusM < 0.01) {
        return 12;
    }
    if (radiusM < 0.075) {
        return 11;
    }
    if (radiusM < 0.6) {
        return 10;
    }
    if (radiusM < 2.3) {
        return 9;
    }
    if (radiusM < 19) {
        return 8;
    }
    if (radiusM < 76) {
        return 7;
    }
    if (radiusM < 610) {
        return 6;
    }
    if (radiusM < 2400) {
        return 5;
    }
    if (radiusM < 19500) {
        return 4;
    }
    if (radiusM < 78700) {
        return 3;
    }
    if (radiusM < 626000) {
        return 2;
    }
    return 1;
}
function _getGeoHash(obj) {
    if (typeof obj.lat !== 'number' || typeof obj.long !== 'number') {
        return;
    }
    const precision = 10; //_getGeoRadiusPrecision(obj.radius);
    const geohash = Geohash.encode(obj.lat, obj.long, precision);
    return geohash;
}
// Calculates which hashes (of different precisions) are within the radius of a point
function _hashesInRadius(lat, lon, radiusM, precision) {
    const isInCircle = (checkLat, checkLon, lat, lon, radiusM) => {
        const deltaLon = checkLon - lon;
        const deltaLat = checkLat - lat;
        return Math.pow(deltaLon, 2) + Math.pow(deltaLat, 2) <= Math.pow(radiusM, 2);
    };
    const getCentroid = (latitude, longitude, height, width) => {
        const y_cen = latitude + (height / 2);
        const x_cen = longitude + (width / 2);
        return { x: x_cen, y: y_cen };
    };
    const convertToLatLon = (y, x, lat, lon) => {
        const pi = 3.14159265359;
        const r_earth = 6371000;
        const lat_diff = (y / r_earth) * (180 / pi);
        const lon_diff = (x / r_earth) * (180 / pi) / Math.cos(lat * pi / 180);
        const final_lat = lat + lat_diff;
        const final_lon = lon + lon_diff;
        return { lat: final_lat, lon: final_lon };
    };
    const x = 0;
    const y = 0;
    const points = [];
    const geohashes = [];
    const gridWidths = [5009400.0, 1252300.0, 156500.0, 39100.0, 4900.0, 1200.0, 152.9, 38.2, 4.8, 1.2, 0.149, 0.0370];
    const gridHeights = [4992600.0, 624100.0, 156000.0, 19500.0, 4900.0, 609.4, 152.4, 19.0, 4.8, 0.595, 0.149, 0.0199];
    const height = gridHeights[precision - 1] / 2;
    const width = gridWidths[precision - 1] / 2;
    const latMoves = Math.ceil(radiusM / height);
    const lonMoves = Math.ceil(radiusM / width);
    for (let i = 0; i <= latMoves; i++) {
        const tmpLat = y + height * i;
        for (let j = 0; j < lonMoves; j++) {
            const tmpLon = x + width * j;
            if (isInCircle(tmpLat, tmpLon, y, x, radiusM)) {
                const center = getCentroid(tmpLat, tmpLon, height, width);
                points.push(convertToLatLon(center.y, center.x, lat, lon));
                points.push(convertToLatLon(-center.y, center.x, lat, lon));
                points.push(convertToLatLon(center.y, -center.x, lat, lon));
                points.push(convertToLatLon(-center.y, -center.x, lat, lon));
            }
        }
    }
    points.forEach(point => {
        const hash = Geohash.encode(point.lat, point.lon, precision);
        if (geohashes.indexOf(hash) < 0) {
            geohashes.push(hash);
        }
    });
    // Original optionally uses Georaptor compression of geohashes
    // This is my simple implementation
    geohashes.forEach((currentHash, index, arr) => {
        const precision = currentHash.length;
        const parentHash = currentHash.substr(0, precision - 1);
        let hashNeighbourMatches = 0;
        const removeIndexes = [];
        arr.forEach((otherHash, otherIndex) => {
            if (otherHash.startsWith(parentHash)) {
                removeIndexes.push(otherIndex);
                if (otherHash.length == precision) {
                    hashNeighbourMatches++;
                }
            }
        });
        if (hashNeighbourMatches === 32) {
            // All 32 areas of a less precise geohash are included.
            // Replace those with the less precise parent
            for (let i = removeIndexes.length - 1; i >= 0; i--) {
                arr.splice(i, 1);
            }
            arr.splice(index, 0, parentHash);
        }
    });
    return geohashes;
}
class GeoIndex extends DataIndex {
    constructor(storage, path, key, options) {
        if (key === '{key}') {
            throw new Error('Cannot create geo index on node keys');
        }
        super(storage, path, key, options);
    }
    // get fileName() {
    //     return super.fileName.slice(0, -4) + '.geo.idx';
    // }
    get type() {
        return 'geo';
    }
    async handleRecordUpdate(path, oldValue, newValue) {
        const mutated = { old: {}, new: {} };
        oldValue !== null && typeof oldValue === 'object' && Object.assign(mutated.old, oldValue);
        newValue !== null && typeof newValue === 'object' && Object.assign(mutated.new, newValue);
        if (mutated.old[this.key] !== null && typeof mutated.old[this.key] === 'object') {
            mutated.old[this.key] = _getGeoHash(mutated.old[this.key]);
        }
        if (mutated.new[this.key] !== null && typeof mutated.new[this.key] === 'object') {
            mutated.new[this.key] = _getGeoHash(mutated.new[this.key]);
        }
        super.handleRecordUpdate(path, mutated.old, mutated.new);
    }
    build() {
        return super.build({
            addCallback: (add, obj, recordPointer, metadata) => {
                if (typeof obj !== 'object') {
                    this.storage.debug.warn(`GeoIndex cannot index location because value "${obj}" is not an object`);
                    return;
                }
                if (typeof obj.lat !== 'number' || typeof obj.long !== 'number') {
                    this.storage.debug.warn(`GeoIndex cannot index location because lat (${obj.lat}) or long (${obj.long}) are invalid`);
                    return;
                }
                const geohash = _getGeoHash(obj);
                add(geohash, recordPointer, metadata);
                return geohash;
            },
            valueTypes: [node_value_types_1.VALUE_TYPES.OBJECT],
        });
    }
    static get validOperators() {
        return ['geo:nearby'];
    }
    get validOperators() {
        return GeoIndex.validOperators;
    }
    test(obj, op, val) {
        if (!this.validOperators.includes(op)) {
            throw new Error(`Unsupported operator "${op}"`);
        }
        if (obj == null || typeof obj !== 'object') {
            // No source object
            return false;
        }
        const src = obj[this.key];
        if (typeof src !== 'object' || typeof src.lat !== 'number' || typeof src.long !== 'number') {
            // source object is not geo
            return false;
        }
        if (typeof val !== 'object' || typeof val.lat !== 'number' || typeof val.long !== 'number' || typeof val.radius !== 'number') {
            // compare object is not geo with radius
            return false;
        }
        const isInCircle = (checkLat, checkLon, lat, lon, radiusM) => {
            const deltaLon = checkLon - lon;
            const deltaLat = checkLat - lat;
            return Math.pow(deltaLon, 2) + Math.pow(deltaLat, 2) <= Math.pow(radiusM, 2);
        };
        return isInCircle(src.lat, src.long, val.lat, val.long, val.radius);
    }
    async query(op, val, options) {
        if (op instanceof btree_1.BlacklistingSearchOperator) {
            throw new Error(`Not implemented: Can't query geo index with blacklisting operator yet`);
        }
        if (options) {
            this.storage.debug.warn('Not implemented: query options for geo indexes are ignored');
        }
        if (op === 'geo:nearby') {
            if (val === null || typeof val !== 'object' || !('lat' in val) || !('long' in val) || !('radius' in val)) {
                throw new Error(`geo nearby query expects an object with lat, long and radius properties`);
            }
            return this.nearby(val);
        }
        else {
            throw new Error(`Geo indexes can only be queried with operators ${GeoIndex.validOperators.map(op => `"${op}"`).join(', ')}`);
        }
    }
    /**
     * @param op Only 'geo:nearby' is supported at the moment
     */
    async nearby(val) {
        const op = 'geo:nearby';
        // Check cache
        const cached = this.cache(op, val);
        if (cached) {
            // Use cached results
            return cached;
        }
        if (typeof val.lat !== 'number' || typeof val.long !== 'number' || typeof val.radius !== 'number') {
            throw new Error('geo:nearby query must supply an object with properties .lat, .long and .radius');
        }
        const stats = new IndexQueryStats('geo_nearby_query', val, true);
        const precision = _getGeoRadiusPrecision(val.radius / 10);
        const targetHashes = _hashesInRadius(val.lat, val.long, val.radius, precision);
        stats.queries = targetHashes.length;
        const promises = targetHashes.map(hash => {
            return super.query('like', `${hash}*`);
        });
        const resultSets = await Promise.all(promises);
        // Combine all results
        const results = new IndexQueryResults();
        results.filterKey = this.key;
        resultSets.forEach(set => {
            set.forEach(match => results.push(match));
        });
        stats.stop(results.length);
        results.stats = stats;
        this.cache(op, val, results);
        return results;
    }
}
exports.GeoIndex = GeoIndex;
class IndexQueryHint {
    constructor(type, value) {
        this.type = type;
        this.value = value;
    }
}
class FullTextIndexQueryHint extends IndexQueryHint {
    static get types() {
        return Object.freeze({
            missingWord: 'missing',
            genericWord: 'generic',
            ignoredWord: 'ignored',
        });
    }
    constructor(type, value) {
        super(type, value);
    }
    get description() {
        switch (this.type) {
            case FullTextIndexQueryHint.types.missingWord: {
                return `Word "${this.value}" does not occur in the index, you might want to remove it from your query`;
            }
            case FullTextIndexQueryHint.types.genericWord: {
                return `Word "${this.value}" is very generic and occurs many times in the index. Removing the word from your query will speed up the results and minimally impact the size of the result set`;
            }
            case FullTextIndexQueryHint.types.ignoredWord: {
                return `Word "${this.value}" was ignored because it is either blacklisted, occurs in a stoplist, or did not match other criteria such as minimum (wildcard) word length`;
            }
            default: {
                return 'Uknown hint';
            }
        }
    }
}
class ArrayIndexQueryHint extends IndexQueryHint {
    static get types() {
        return Object.freeze({
            missingValue: 'missing',
        });
    }
    constructor(type, value) {
        super(type, value);
    }
    get description() {
        const val = typeof this.value === 'string' ? `"${this.value}"` : this.value;
        switch (this.type) {
            case ArrayIndexQueryHint.types.missingValue: {
                return `Value ${val} does not occur in the index, you might want to remove it from your query`;
            }
            default: {
                return 'Uknown hint';
            }
        }
    }
}
//# sourceMappingURL=index.js.map