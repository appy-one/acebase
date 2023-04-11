"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createIndex = void 0;
const acebase_core_1 = require("acebase-core");
const data_index_1 = require("../data-index");
const promise_fs_1 = require("../promise-fs");
/**
* Creates an index on specified path and key(s)
* @param path location of objects to be indexed. Eg: "users" to index all children of the "users" node; or "chats/*\/members" to index all members of all chats
* @param key for now - one key to index. Once our B+tree implementation supports nested trees, we can allow multiple fields
*/
async function createIndex(context, path, key, options) {
    if (!context.storage.indexes.supported) {
        throw new Error('Indexes are not supported in current environment because it requires Node.js fs');
    }
    // path = path.replace(/\/\*$/, ""); // Remove optional trailing "/*"
    const { ipc, debug, indexes, storage } = context;
    const rebuild = options && options.rebuild === true;
    const indexType = (options && options.type) || 'normal';
    let includeKeys = (options && options.include) || [];
    if (typeof includeKeys === 'string') {
        includeKeys = [includeKeys];
    }
    const existingIndex = indexes.find(index => index.path === path && index.key === key && index.type === indexType
        && index.includeKeys.length === includeKeys.length
        && index.includeKeys.every((key, index) => includeKeys[index] === key));
    if (existingIndex && options.config) {
        // Additional index config params are not saved to index files, apply them to the in-memory index now
        existingIndex.config = options.config;
    }
    if (existingIndex && rebuild !== true) {
        debug.log(`Index on "/${path}/*/${key}" already exists`.colorize(acebase_core_1.ColorStyle.inverse));
        return existingIndex;
    }
    if (!ipc.isMaster) {
        // Pass create request to master
        const result = await ipc.sendRequest({ type: 'index.create', path, key, options });
        if (result.ok) {
            return storage.indexes.add(result.fileName);
        }
        throw new Error(result.reason);
    }
    await promise_fs_1.pfs.mkdir(`${storage.settings.path}/${storage.name}.acebase`).catch(err => {
        if (err.code !== 'EEXIST') {
            throw err;
        }
    });
    const index = existingIndex || (() => {
        const { include, caseSensitive, textLocale, textLocaleKey } = options;
        const indexOptions = { include, caseSensitive, textLocale, textLocaleKey };
        switch (indexType) {
            case 'array': return new data_index_1.ArrayIndex(storage, path, key, Object.assign({}, indexOptions));
            case 'fulltext': return new data_index_1.FullTextIndex(storage, path, key, Object.assign(Object.assign({}, indexOptions), { config: options.config }));
            case 'geo': return new data_index_1.GeoIndex(storage, path, key, Object.assign({}, indexOptions));
            default: return new data_index_1.DataIndex(storage, path, key, Object.assign({}, indexOptions));
        }
    })();
    if (!existingIndex) {
        indexes.push(index);
    }
    try {
        await index.build();
    }
    catch (err) {
        context.debug.error(`Index build on "/${path}/*/${key}" failed: ${err.message} (code: ${err.code})`.colorize(acebase_core_1.ColorStyle.red));
        if (!existingIndex) {
            // Only remove index if we added it. Build may have failed because someone tried creating the index more than once, or rebuilding it while it was building...
            indexes.splice(indexes.indexOf(index), 1);
        }
        throw err;
    }
    ipc.sendNotification({ type: 'index.created', fileName: index.fileName, path, key, options });
    return index;
}
exports.createIndex = createIndex;
//# sourceMappingURL=create-index.js.map