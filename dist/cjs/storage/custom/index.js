"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CustomStorage = exports.CustomStorageNodeInfo = exports.CustomStorageNodeAddress = exports.CustomStorageSettings = exports.CustomStorageTransaction = exports.ICustomStorageNode = exports.ICustomStorageNodeMetaData = exports.CustomStorageHelpers = void 0;
const acebase_core_1 = require("acebase-core");
const { compareValues } = acebase_core_1.Utils;
const node_info_1 = require("../../node-info");
const node_lock_1 = require("../../node-lock");
const node_value_types_1 = require("../../node-value-types");
const node_errors_1 = require("../../node-errors");
const index_1 = require("../index");
const helpers_1 = require("./helpers");
const node_address_1 = require("../../node-address");
const assert_1 = require("../../assert");
var helpers_2 = require("./helpers");
Object.defineProperty(exports, "CustomStorageHelpers", { enumerable: true, get: function () { return helpers_2.CustomStorageHelpers; } });
/** Interface for metadata being stored for nodes */
class ICustomStorageNodeMetaData {
    constructor() {
        /** cuid (time sortable revision id). Nodes stored in the same operation share this id */
        this.revision = '';
        /** Number of revisions, starting with 1. Resets to 1 after deletion and recreation */
        this.revision_nr = 0;
        /** Creation date/time in ms since epoch UTC */
        this.created = 0;
        /** Last modification date/time in ms since epoch UTC */
        this.modified = 0;
        /** Type of the node's value. 1=object, 2=array, 3=number, 4=boolean, 5=string, 6=date, 7=reserved, 8=binary, 9=reference */
        this.type = 0;
    }
}
exports.ICustomStorageNodeMetaData = ICustomStorageNodeMetaData;
/** Interface for metadata combined with a stored value */
class ICustomStorageNode extends ICustomStorageNodeMetaData {
    constructor() {
        super();
        /** only Object, Array, large string and binary values. */
        this.value = null;
    }
}
exports.ICustomStorageNode = ICustomStorageNode;
/** Enables get/set/remove operations to be wrapped in transactions to improve performance and reliability. */
class CustomStorageTransaction {
    /**
     * @param target Which path the transaction is taking place on, and whether it is a read or read/write lock. If your storage backend does not support transactions, is synchronous, or if you are able to lock resources based on path: use storage.nodeLocker to ensure threadsafe transactions
     */
    constructor(target) {
        this.production = false; // dev mode by default
        this.target = {
            get originalPath() { return target.path; },
            path: target.path,
            get write() { return target.write; },
        };
        this.id = acebase_core_1.ID.generate();
    }
    /**
     * Returns the number of children stored in their own records. This implementation uses `childrenOf` to count, override if storage supports a quicker way.
     * Eg: For SQL databases, you can implement this with a single query like `SELECT count(*) FROM nodes WHERE ${CustomStorageHelpers.ChildPathsSql(path)}`
     * @param path
     * @returns Returns a promise that resolves with the number of children
     */
    async getChildCount(path) {
        let childCount = 0;
        await this.childrenOf(path, { metadata: false, value: false }, () => { childCount++; return false; });
        return childCount;
    }
    /**
     * NOT USED YET
     * Default implementation of getMultiple that executes .get for each given path. Override for custom logic
     * @param paths
     * @returns Returns promise with a Map of paths to nodes
     */
    async getMultiple(paths) {
        const map = new Map();
        await Promise.all(paths.map(path => this.get(path).then(val => map.set(path, val))));
        return map;
    }
    /**
     * NOT USED YET
     * Default implementation of setMultiple that executes .set for each given path. Override for custom logic
     * @param nodes
     */
    async setMultiple(nodes) {
        await Promise.all(nodes.map(({ path, node }) => this.set(path, node)));
    }
    /**
     * Default implementation of removeMultiple that executes .remove for each given path. Override for custom logic
     * @param paths
     */
    async removeMultiple(paths) {
        await Promise.all(paths.map(path => this.remove(path)));
    }
    /**
     * @returns {Promise<any>}
     */
    async commit() { throw new Error(`CustomStorageTransaction.rollback must be overridden by subclass`); }
    /**
     * Moves the transaction path to the parent node. If node locking is used, it will request a new lock
     * Used internally, must not be overridden unless custom locking mechanism is required
     * @param targetPath
     */
    async moveToParentPath(targetPath) {
        const currentPath = (this._lock && this._lock.path) || this.target.path;
        if (currentPath === targetPath) {
            return targetPath; // Already on the right path
        }
        const pathInfo = helpers_1.CustomStorageHelpers.PathInfo.get(targetPath);
        if (pathInfo.isParentOf(currentPath)) {
            if (this._lock) {
                this._lock = await this._lock.moveToParent();
            }
        }
        else {
            throw new Error(`Locking issue. Locked path "${this._lock.path}" is not a child/descendant of "${targetPath}"`);
        }
        this.target.path = targetPath;
        return targetPath;
    }
}
exports.CustomStorageTransaction = CustomStorageTransaction;
/**
 * Allows data to be stored in a custom storage backend of your choice! Simply provide a couple of functions
 * to get, set and remove data and you're done.
 */
class CustomStorageSettings extends index_1.StorageSettings {
    constructor(settings) {
        super(settings);
        /**
         * Whether default node locking should be used.
         * Set to false if your storage backend disallows multiple simultanious write transactions.
         * Set to true if your storage backend does not support transactions (eg LocalStorage) or allows
         * multiple simultanious write transactions (eg AceBase binary).
         * @default true
         */
        this.locking = true;
        if (typeof settings !== 'object') {
            throw new Error('settings missing');
        }
        if (typeof settings.ready !== 'function') {
            throw new Error(`ready must be a function`);
        }
        if (typeof settings.getTransaction !== 'function') {
            throw new Error(`getTransaction must be a function`);
        }
        this.name = settings.name;
        // this.info = `${this.name || 'CustomStorage'} realtime database`;
        this.locking = settings.locking !== false;
        if (this.locking) {
            this.lockTimeout = typeof settings.lockTimeout === 'number' ? settings.lockTimeout : 120;
        }
        this.ready = settings.ready;
        // Hijack getTransaction to add locking
        const useLocking = this.locking;
        const nodeLocker = useLocking ? new node_lock_1.NodeLocker(console, this.lockTimeout) : null;
        this.getTransaction = async ({ path, write }) => {
            // console.log(`${write ? 'WRITE' : 'READ'} transaction requested for path "${path}"`)
            const transaction = await settings.getTransaction({ path, write });
            (0, assert_1.assert)(typeof transaction.id === 'string', `transaction id not set`);
            // console.log(`Got transaction ${transaction.id} for ${write ? 'WRITE' : 'READ'} on path "${path}"`);
            // Hijack rollback and commit
            const rollback = transaction.rollback;
            const commit = transaction.commit;
            transaction.commit = async () => {
                // console.log(`COMMIT ${transaction.id} for ${write ? 'WRITE' : 'READ'} on path "${path}"`);
                const ret = await commit.call(transaction);
                // console.log(`COMMIT DONE ${transaction.id} for ${write ? 'WRITE' : 'READ'} on path "${path}"`);
                if (useLocking) {
                    await transaction._lock.release('commit');
                }
                return ret;
            };
            transaction.rollback = async (reason) => {
                // const reasonText = reason instanceof Error ? reason.message : reason.toString();
                // console.error(`ROLLBACK ${transaction.id} for ${write ? 'WRITE' : 'READ'} on path "${path}":`, reason);
                const ret = await rollback.call(transaction, reason);
                // console.log(`ROLLBACK DONE ${transaction.id} for ${write ? 'WRITE' : 'READ'} on path "${path}"`);
                if (useLocking) {
                    await transaction._lock.release('rollback');
                }
                return ret;
            };
            if (useLocking) {
                // Lock the path before continuing
                transaction._lock = await nodeLocker.lock(path, transaction.id, write, `${this.name}::getTransaction`);
            }
            return transaction;
        };
    }
}
exports.CustomStorageSettings = CustomStorageSettings;
class CustomStorageNodeAddress {
    constructor(containerPath) {
        this.path = containerPath;
    }
}
exports.CustomStorageNodeAddress = CustomStorageNodeAddress;
class CustomStorageNodeInfo extends node_info_1.NodeInfo {
    constructor(info) {
        super(info);
        this.revision = info.revision;
        this.revision_nr = info.revision_nr;
        this.created = info.created;
        this.modified = info.modified;
    }
}
exports.CustomStorageNodeInfo = CustomStorageNodeInfo;
class CustomStorage extends index_1.Storage {
    constructor(dbname, settings, env) {
        super(dbname, settings, env);
        this._customImplementation = settings;
        this._init();
    }
    async _init() {
        this.debug.log(`Database "${this.name}" details:`.colorize(acebase_core_1.ColorStyle.dim));
        this.debug.log(`- Type: CustomStorage`.colorize(acebase_core_1.ColorStyle.dim));
        this.debug.log(`- Path: ${this.settings.path}`.colorize(acebase_core_1.ColorStyle.dim));
        this.debug.log(`- Max inline value size: ${this.settings.maxInlineValueSize}`.colorize(acebase_core_1.ColorStyle.dim));
        this.debug.log(`- Autoremove undefined props: ${this.settings.removeVoidProperties}`.colorize(acebase_core_1.ColorStyle.dim));
        // Create root node if it's not there yet
        await this._customImplementation.ready();
        const transaction = await this._customImplementation.getTransaction({ path: '', write: true });
        const info = await this.getNodeInfo('', { transaction });
        if (!info.exists) {
            await this._writeNode('', {}, { transaction });
        }
        await transaction.commit();
        if (this.indexes.supported) {
            await this.indexes.load();
        }
        this.emit('ready');
    }
    throwImplementationError(message) {
        throw new Error(`CustomStorage "${this._customImplementation.name}" ${message}`);
    }
    _storeNode(path, node, options) {
        // serialize the value to store
        const getTypedChildValue = (val) => {
            if (val === null) {
                throw new Error(`Not allowed to store null values. remove the property`);
            }
            else if (['string', 'number', 'boolean'].includes(typeof val)) {
                return val;
            }
            else if (val instanceof Date) {
                return { type: node_value_types_1.VALUE_TYPES.DATETIME, value: val.getTime() };
            }
            else if (val instanceof acebase_core_1.PathReference) {
                return { type: node_value_types_1.VALUE_TYPES.REFERENCE, value: val.path };
            }
            else if (val instanceof ArrayBuffer) {
                return { type: node_value_types_1.VALUE_TYPES.BINARY, value: acebase_core_1.ascii85.encode(val) };
            }
            else if (typeof val === 'object') {
                (0, assert_1.assert)(Object.keys(val).length === 0, 'child object stored in parent can only be empty');
                return val;
            }
        };
        const unprocessed = `Caller should have pre-processed the value by converting it to a string`;
        if (node.type === node_value_types_1.VALUE_TYPES.ARRAY && node.value instanceof Array) {
            // Convert array to object with numeric properties
            // NOTE: caller should have done this already
            console.warn(`Unprocessed array. ${unprocessed}`);
            const obj = {};
            for (let i = 0; i < node.value.length; i++) {
                obj[i] = node.value[i];
            }
            node.value = obj;
        }
        if (node.type === node_value_types_1.VALUE_TYPES.BINARY && typeof node.value !== 'string') {
            console.warn(`Unprocessed binary value. ${unprocessed}`);
            node.value = acebase_core_1.ascii85.encode(node.value);
        }
        if (node.type === node_value_types_1.VALUE_TYPES.REFERENCE && node.value instanceof acebase_core_1.PathReference) {
            console.warn(`Unprocessed path reference. ${unprocessed}`);
            node.value = node.value.path;
        }
        if ([node_value_types_1.VALUE_TYPES.OBJECT, node_value_types_1.VALUE_TYPES.ARRAY].includes(node.type)) {
            const original = node.value;
            node.value = {};
            // If original is an array, it'll automatically be converted to an object now
            Object.keys(original).forEach(key => {
                node.value[key] = getTypedChildValue(original[key]);
            });
        }
        return options.transaction.set(path, node);
    }
    _processReadNodeValue(node) {
        const getTypedChildValue = (val) => {
            // Typed value stored in parent record
            if (val.type === node_value_types_1.VALUE_TYPES.BINARY) {
                // binary stored in a parent record as a string
                return acebase_core_1.ascii85.decode(val.value);
            }
            else if (val.type === node_value_types_1.VALUE_TYPES.DATETIME) {
                // Date value stored as number
                return new Date(val.value);
            }
            else if (val.type === node_value_types_1.VALUE_TYPES.REFERENCE) {
                // Path reference stored as string
                return new acebase_core_1.PathReference(val.value);
            }
            else {
                throw new Error(`Unhandled child value type ${val.type}`);
            }
        };
        switch (node.type) {
            case node_value_types_1.VALUE_TYPES.ARRAY:
            case node_value_types_1.VALUE_TYPES.OBJECT: {
                // check if any value needs to be converted
                // NOTE: Arrays are stored with numeric properties
                const obj = node.value;
                Object.keys(obj).forEach(key => {
                    const item = obj[key];
                    if (typeof item === 'object' && 'type' in item) {
                        obj[key] = getTypedChildValue(item);
                    }
                });
                node.value = obj;
                break;
            }
            case node_value_types_1.VALUE_TYPES.BINARY: {
                node.value = acebase_core_1.ascii85.decode(node.value);
                break;
            }
            case node_value_types_1.VALUE_TYPES.REFERENCE: {
                node.value = new acebase_core_1.PathReference(node.value);
                break;
            }
            case node_value_types_1.VALUE_TYPES.STRING: {
                // No action needed
                // node.value = node.value;
                break;
            }
            default:
                throw new Error(`Invalid standalone record value type`); // should never happen
        }
    }
    async _readNode(path, options) {
        // deserialize a stored value (always an object with "type", "value", "revision", "revision_nr", "created", "modified")
        const node = await options.transaction.get(path);
        if (node === null) {
            return null;
        }
        if (typeof node !== 'object') {
            this.throwImplementationError(`transaction.get must return an ICustomStorageNode object. Use JSON.parse if your set function stored it as a string`);
        }
        this._processReadNodeValue(node);
        return node;
    }
    _getTypeFromStoredValue(val) {
        let type;
        if (typeof val === 'string') {
            type = node_value_types_1.VALUE_TYPES.STRING;
        }
        else if (typeof val === 'number') {
            type = node_value_types_1.VALUE_TYPES.NUMBER;
        }
        else if (typeof val === 'boolean') {
            type = node_value_types_1.VALUE_TYPES.BOOLEAN;
        }
        else if (val instanceof Array) {
            type = node_value_types_1.VALUE_TYPES.ARRAY;
        }
        else if (typeof val === 'object') {
            if ('type' in val) {
                const serialized = val;
                type = serialized.type;
                val = serialized.value;
                if (type === node_value_types_1.VALUE_TYPES.DATETIME) {
                    val = new Date(val);
                }
                else if (type === node_value_types_1.VALUE_TYPES.REFERENCE) {
                    val = new acebase_core_1.PathReference(val);
                }
            }
            else {
                type = node_value_types_1.VALUE_TYPES.OBJECT;
            }
        }
        else {
            throw new Error(`Unknown value type`);
        }
        return { type, value: val };
    }
    /**
     * Creates or updates a node in its own record. DOES NOT CHECK if path exists in parent node, or if parent paths exist! Calling code needs to do this
     */
    async _writeNode(path, value, options) {
        if (!options.merge && this.valueFitsInline(value) && path !== '') {
            throw new Error(`invalid value to store in its own node`);
        }
        else if (path === '' && (typeof value !== 'object' || value instanceof Array)) {
            throw new Error(`Invalid root node value. Must be an object`);
        }
        // Check if the value for this node changed, to prevent recursive calls to
        // perform unnecessary writes that do not change any data
        if (typeof options.diff === 'undefined' && typeof options.currentValue !== 'undefined') {
            const diff = compareValues(options.currentValue, value);
            if (options.merge && typeof diff === 'object') {
                diff.removed = diff.removed.filter(key => value[key] === null); // Only keep "removed" items that are really being removed by setting to null
            }
            options.diff = diff;
        }
        if (options.diff === 'identical') {
            return; // Done!
        }
        const transaction = options.transaction;
        // Get info about current node at path
        const currentRow = options.currentValue === null
            ? null // No need to load info if currentValue is null (we already know it doesn't exist)
            : await this._readNode(path, { transaction });
        if (options.merge && currentRow) {
            if (currentRow.type === node_value_types_1.VALUE_TYPES.ARRAY && !(value instanceof Array) && typeof value === 'object' && Object.keys(value).some(key => isNaN(parseInt(key)))) {
                throw new Error(`Cannot merge existing array of path "${path}" with an object`);
            }
            if (value instanceof Array && currentRow.type !== node_value_types_1.VALUE_TYPES.ARRAY) {
                throw new Error(`Cannot merge existing object of path "${path}" with an array`);
            }
        }
        const revision = options.revision || acebase_core_1.ID.generate();
        const mainNode = {
            type: currentRow && currentRow.type === node_value_types_1.VALUE_TYPES.ARRAY ? node_value_types_1.VALUE_TYPES.ARRAY : node_value_types_1.VALUE_TYPES.OBJECT,
            value: {},
        };
        const childNodeValues = {};
        if (value instanceof Array) {
            mainNode.type = node_value_types_1.VALUE_TYPES.ARRAY;
            // Convert array to object with numeric properties
            const obj = {};
            for (let i = 0; i < value.length; i++) {
                obj[i] = value[i];
            }
            value = obj;
        }
        else if (value instanceof acebase_core_1.PathReference) {
            mainNode.type = node_value_types_1.VALUE_TYPES.REFERENCE;
            mainNode.value = value.path;
        }
        else if (value instanceof ArrayBuffer) {
            mainNode.type = node_value_types_1.VALUE_TYPES.BINARY;
            mainNode.value = acebase_core_1.ascii85.encode(value);
        }
        else if (typeof value === 'string') {
            mainNode.type = node_value_types_1.VALUE_TYPES.STRING;
            mainNode.value = value;
        }
        const currentIsObjectOrArray = currentRow ? [node_value_types_1.VALUE_TYPES.OBJECT, node_value_types_1.VALUE_TYPES.ARRAY].includes(currentRow.type) : false;
        const newIsObjectOrArray = [node_value_types_1.VALUE_TYPES.OBJECT, node_value_types_1.VALUE_TYPES.ARRAY].includes(mainNode.type);
        const children = {
            current: [],
            new: [],
        };
        let currentObject = null;
        if (currentIsObjectOrArray) {
            currentObject = currentRow.value;
            children.current = Object.keys(currentObject);
            // if (currentObject instanceof Array) { // ALWAYS FALSE BECAUSE THEY ARE STORED AS OBJECTS WITH NUMERIC PROPERTIES
            //     // Convert array to object with numeric properties
            //     const obj = {};
            //     for (let i = 0; i < value.length; i++) {
            //         obj[i] = value[i];
            //     }
            //     currentObject = obj;
            // }
            if (newIsObjectOrArray) {
                mainNode.value = currentObject;
            }
        }
        if (newIsObjectOrArray) {
            // Object or array. Determine which properties can be stored in the main node,
            // and which should be stored in their own nodes
            if (!options.merge) {
                // Check which keys are present in the old object, but not in newly given object
                Object.keys(mainNode.value).forEach(key => {
                    if (!(key in value)) {
                        // Property that was in old object, is not in new value -> set to null to mark deletion!
                        value[key] = null;
                    }
                });
            }
            Object.keys(value).forEach(key => {
                const val = value[key];
                delete mainNode.value[key]; // key is being overwritten, moved from inline to dedicated, or deleted. TODO: check if this needs to be done SQLite & MSSQL implementations too
                if (val === null) { //  || typeof val === 'undefined'
                    // This key is being removed
                    return;
                }
                else if (typeof val === 'undefined') {
                    if (this.settings.removeVoidProperties === true) {
                        delete value[key]; // Kill the property in the passed object as well, to prevent differences in stored and working values
                        return;
                    }
                    else {
                        throw new Error(`Property "${key}" has invalid value. Cannot store undefined values. Set removeVoidProperties option to true to automatically remove undefined properties`);
                    }
                }
                // Where to store this value?
                if (this.valueFitsInline(val)) {
                    // Store in main node
                    mainNode.value[key] = val;
                }
                else {
                    // Store in child node
                    childNodeValues[key] = val;
                }
            });
        }
        // Insert or update node
        const isArray = mainNode.type === node_value_types_1.VALUE_TYPES.ARRAY;
        if (currentRow) {
            // update
            this.debug.log(`Node "/${path}" is being ${options.merge ? 'updated' : 'overwritten'}`.colorize(acebase_core_1.ColorStyle.cyan));
            // If existing is an array or object, we have to find out which children are affected
            if (currentIsObjectOrArray || newIsObjectOrArray) {
                // Get current child nodes in dedicated child records
                const pathInfo = acebase_core_1.PathInfo.get(path);
                const keys = [];
                let checkExecuted = false;
                const includeChildCheck = (childPath) => {
                    checkExecuted = true;
                    if (!transaction.production && !pathInfo.isParentOf(childPath)) {
                        // Double check failed
                        this.throwImplementationError(`"${childPath}" is not a child of "${path}" - childrenOf must only check and return paths that are children`);
                    }
                    return true;
                };
                const addChildPath = (childPath) => {
                    if (!checkExecuted) {
                        this.throwImplementationError(`childrenOf did not call checkCallback before addCallback`);
                    }
                    const key = acebase_core_1.PathInfo.get(childPath).key;
                    keys.push(key.toString()); // .toString to make sure all keys are compared as strings
                    return true; // Keep streaming
                };
                await transaction.childrenOf(path, { metadata: false, value: false }, includeChildCheck, addChildPath);
                children.current = children.current.concat(keys);
                if (newIsObjectOrArray) {
                    if (options && options.merge) {
                        children.new = children.current.slice();
                    }
                    Object.keys(value).forEach(key => {
                        if (!children.new.includes(key)) {
                            children.new.push(key);
                        }
                    });
                }
                const changes = {
                    insert: children.new.filter(key => !children.current.includes(key)),
                    update: [],
                    delete: options && options.merge ? Object.keys(value).filter(key => value[key] === null) : children.current.filter(key => !children.new.includes(key)),
                };
                changes.update = children.new.filter(key => children.current.includes(key) && !changes.delete.includes(key));
                if (isArray && options.merge && (changes.insert.length > 0 || changes.delete.length > 0)) {
                    // deletes or inserts of individual array entries are not allowed, unless it is the last entry:
                    // - deletes would cause the paths of following items to change, which is unwanted because the actual data does not change,
                    // eg: removing index 3 on array of size 10 causes entries with index 4 to 9 to 'move' to indexes 3 to 8
                    // - inserts might introduce gaps in indexes,
                    // eg: adding to index 7 on an array of size 3 causes entries with indexes 3 to 6 to go 'missing'
                    const newArrayKeys = changes.update.concat(changes.insert);
                    const isExhaustive = newArrayKeys.every((k, index, arr) => arr.includes(index.toString()));
                    if (!isExhaustive) {
                        throw new Error(`Elements cannot be inserted beyond, or removed before the end of an array. Rewrite the whole array at path "${path}" or change your schema to use an object collection instead`);
                    }
                }
                // (over)write all child nodes that must be stored in their own record
                const writePromises = Object.keys(childNodeValues).map(key => {
                    const keyOrIndex = isArray ? parseInt(key) : key;
                    const childDiff = typeof options.diff === 'object' ? options.diff.forChild(keyOrIndex) : undefined;
                    if (childDiff === 'identical') {
                        // console.warn(`Skipping _writeNode recursion for child "${keyOrIndex}"`);
                        return; // Skip
                    }
                    const childPath = pathInfo.childPath(keyOrIndex); // PathInfo.getChildPath(path, key);
                    const childValue = childNodeValues[keyOrIndex];
                    // Pass current child value to _writeNode
                    const currentChildValue = typeof options.currentValue === 'undefined' // Fixing issue #20
                        ? undefined
                        : options.currentValue !== null && typeof options.currentValue === 'object' && keyOrIndex in options.currentValue
                            ? options.currentValue[keyOrIndex]
                            : null;
                    return this._writeNode(childPath, childValue, { transaction, revision, merge: false, currentValue: currentChildValue, diff: childDiff });
                });
                // Delete all child nodes that were stored in their own record, but are being removed
                // Also delete nodes that are being moved from a dedicated record to inline
                const movingNodes = newIsObjectOrArray ? keys.filter(key => key in mainNode.value) : []; // moving from dedicated to inline value
                const deleteDedicatedKeys = changes.delete.concat(movingNodes);
                const deletePromises = deleteDedicatedKeys.map(key => {
                    const keyOrIndex = isArray ? parseInt(key) : key;
                    const childPath = pathInfo.childPath(keyOrIndex);
                    return this._deleteNode(childPath, { transaction });
                });
                const promises = writePromises.concat(deletePromises);
                await Promise.all(promises);
            }
            // Update main node
            // TODO: Check if revision should change?
            const p = this._storeNode(path, {
                type: mainNode.type,
                value: mainNode.value,
                revision: currentRow.revision,
                revision_nr: currentRow.revision_nr + 1,
                created: currentRow.created,
                modified: Date.now(),
            }, {
                transaction,
            });
            if (p instanceof Promise) {
                return await p;
            }
        }
        else {
            // Current node does not exist, create it and any child nodes
            // write all child nodes that must be stored in their own record
            this.debug.log(`Node "/${path}" is being created`.colorize(acebase_core_1.ColorStyle.cyan));
            if (isArray) {
                // Check if the array is "intact" (all entries have an index from 0 to the end with no gaps)
                const arrayKeys = Object.keys(mainNode.value).concat(Object.keys(childNodeValues));
                const isExhaustive = arrayKeys.every((k, index, arr) => arr.includes(index.toString()));
                if (!isExhaustive) {
                    throw new Error(`Cannot store arrays with missing entries`);
                }
            }
            const promises = Object.keys(childNodeValues).map(key => {
                const keyOrIndex = isArray ? parseInt(key) : key;
                const childPath = acebase_core_1.PathInfo.getChildPath(path, keyOrIndex);
                const childValue = childNodeValues[keyOrIndex];
                return this._writeNode(childPath, childValue, { transaction, revision, merge: false, currentValue: null });
            });
            // Create current node
            const p = this._storeNode(path, {
                type: mainNode.type,
                value: mainNode.value,
                revision,
                revision_nr: 1,
                created: Date.now(),
                modified: Date.now(),
            }, {
                transaction,
            });
            if (p instanceof Promise) {
                promises.push(p);
            }
            await Promise.all(promises);
        }
    }
    /**
     * Deletes (dedicated) node and all subnodes without checking for existence. Use with care - all removed nodes will lose their revision stats! DOES NOT REMOVE INLINE CHILD NODES!
     */
    async _deleteNode(path, options) {
        const pathInfo = acebase_core_1.PathInfo.get(path);
        this.debug.log(`Node "/${path}" is being deleted`.colorize(acebase_core_1.ColorStyle.cyan));
        const deletePaths = [path];
        let checkExecuted = false;
        const includeDescendantCheck = (descPath) => {
            checkExecuted = true;
            if (!transaction.production && !pathInfo.isAncestorOf(descPath)) {
                // Double check failed
                this.throwImplementationError(`"${descPath}" is not a descendant of "${path}" - descendantsOf must only check and return paths that are descendants`);
            }
            return true;
        };
        const addDescendant = (descPath) => {
            if (!checkExecuted) {
                this.throwImplementationError(`descendantsOf did not call checkCallback before addCallback`);
            }
            deletePaths.push(descPath);
            return true;
        };
        const transaction = options.transaction;
        await transaction.descendantsOf(path, { metadata: false, value: false }, includeDescendantCheck, addDescendant);
        this.debug.log(`Nodes ${deletePaths.map(p => `"/${p}"`).join(',')} are being deleted`.colorize(acebase_core_1.ColorStyle.cyan));
        return transaction.removeMultiple(deletePaths);
    }
    /**
     * Enumerates all children of a given Node for reflection purposes
     */
    getChildren(path, options = {}) {
        let callback;
        const generator = {
            /**
             *
             * @param valueCallback callback function to run for each child. Return false to stop iterating
             * @returns returns a promise that resolves with a boolean indicating if all children have been enumerated, or was canceled by the valueCallback function
             */
            next(valueCallback) {
                callback = valueCallback;
                return start();
            },
        };
        const start = async () => {
            const transaction = options.transaction || await this._customImplementation.getTransaction({ path, write: false });
            try {
                let canceled = false;
                await (async () => {
                    const node = await this._readNode(path, { transaction });
                    if (!node) {
                        throw new node_errors_1.NodeNotFoundError(`Node "/${path}" does not exist`);
                    }
                    if (![node_value_types_1.VALUE_TYPES.OBJECT, node_value_types_1.VALUE_TYPES.ARRAY].includes(node.type)) {
                        // No children
                        return;
                    }
                    const isArray = node.type === node_value_types_1.VALUE_TYPES.ARRAY;
                    const value = node.value;
                    let keys = Object.keys(value).map(key => isArray ? parseInt(key) : key);
                    if (options.keyFilter) {
                        keys = keys.filter(key => options.keyFilter.includes(key));
                    }
                    const pathInfo = acebase_core_1.PathInfo.get(path);
                    keys.length > 0 && keys.every(key => {
                        const child = this._getTypeFromStoredValue(value[key]);
                        const info = new CustomStorageNodeInfo({
                            path: pathInfo.childPath(key),
                            key: isArray ? null : key,
                            index: isArray ? key : null,
                            type: child.type,
                            address: null,
                            exists: true,
                            value: child.value,
                            revision: node.revision,
                            revision_nr: node.revision_nr,
                            created: new Date(node.created),
                            modified: new Date(node.modified),
                        });
                        canceled = callback(info) === false;
                        return !canceled; // stop .every loop if canceled
                    });
                    if (canceled) {
                        return;
                    }
                    // Go on... get other children
                    let checkExecuted = false;
                    const includeChildCheck = (childPath) => {
                        checkExecuted = true;
                        if (!transaction.production && !pathInfo.isParentOf(childPath)) {
                            // Double check failed
                            this.throwImplementationError(`"${childPath}" is not a child of "${path}" - childrenOf must only check and return paths that are children`);
                        }
                        if (options.keyFilter) {
                            const key = acebase_core_1.PathInfo.get(childPath).key;
                            return options.keyFilter.includes(key);
                        }
                        return true;
                    };
                    const addChildNode = (childPath, node) => {
                        if (!checkExecuted) {
                            this.throwImplementationError(`childrenOf did not call checkCallback before addCallback`);
                        }
                        const key = acebase_core_1.PathInfo.get(childPath).key;
                        const info = new CustomStorageNodeInfo({
                            path: childPath,
                            type: node.type,
                            key: isArray ? null : key,
                            index: isArray ? key : null,
                            address: new node_address_1.NodeAddress(childPath),
                            exists: true,
                            value: null,
                            revision: node.revision,
                            revision_nr: node.revision_nr,
                            created: new Date(node.created),
                            modified: new Date(node.modified),
                        });
                        canceled = callback(info) === false;
                        return !canceled;
                    };
                    await transaction.childrenOf(path, { metadata: true, value: false }, includeChildCheck, addChildNode);
                })();
                if (!options.transaction) {
                    // transaction was created by us, commit
                    await transaction.commit();
                }
                return canceled;
            }
            catch (err) {
                if (!options.transaction) {
                    // transaction was created by us, rollback
                    await transaction.rollback(err);
                }
                throw err;
            }
        }; // start()
        return generator;
    }
    async getNode(path, options) {
        // path = path.replace(/'/g, '');  // prevent sql injection, remove single quotes
        options = options || {};
        const transaction = options.transaction || await this._customImplementation.getTransaction({ path, write: false });
        try {
            const node = await (async () => {
                // Get path, path/* and path[*
                const filtered = (options.include && options.include.length > 0) || (options.exclude && options.exclude.length > 0) || options.child_objects === false;
                const pathInfo = acebase_core_1.PathInfo.get(path);
                const targetNode = await this._readNode(path, { transaction });
                if (!targetNode) {
                    // Lookup parent node
                    if (path === '') {
                        return { value: null };
                    } // path is root. There is no parent.
                    const lockPath = await transaction.moveToParentPath(pathInfo.parentPath);
                    (0, assert_1.assert)(lockPath === pathInfo.parentPath, `transaction.moveToParentPath() did not move to the right parent path of "${path}"`);
                    const parentNode = await this._readNode(pathInfo.parentPath, { transaction });
                    if (parentNode && [node_value_types_1.VALUE_TYPES.OBJECT, node_value_types_1.VALUE_TYPES.ARRAY].includes(parentNode.type) && pathInfo.key in parentNode.value) {
                        const childValueInfo = this._getTypeFromStoredValue(parentNode.value[pathInfo.key]);
                        return {
                            revision: parentNode.revision,
                            revision_nr: parentNode.revision_nr,
                            created: parentNode.created,
                            modified: parentNode.modified,
                            type: childValueInfo.type,
                            value: childValueInfo.value,
                        };
                    }
                    return { value: null };
                }
                const isArray = targetNode.type === node_value_types_1.VALUE_TYPES.ARRAY;
                /**
                 * Convert include & exclude filters to PathInfo instances for easier handling
                 */
                const convertFilterArray = (arr) => {
                    const isNumber = (key) => /^[0-9]+$/.test(key);
                    return arr.map(path => acebase_core_1.PathInfo.get(isArray && isNumber(path) ? `[${path}]` : path));
                };
                const includeFilter = options.include ? convertFilterArray(options.include) : [];
                const excludeFilter = options.exclude ? convertFilterArray(options.exclude) : [];
                /**
                 * Apply include filters to prevent unwanted properties stored inline to be added.
                 *
                 * Removes properties that are not on the trail of any include filter, but were loaded because they are
                 * stored inline in the parent node.
                 *
                 * Example:
                 * data of `"users/someuser/posts/post1"`: `{ title: 'My first post', posted: (date), history: {} }`
                 * code: `db.ref('users/someuser').get({ include: ['posts/*\/title'] })`
                 * descPath: `"users/someuser/posts/post1"`,
                 * trailKeys: `["posts", "post1"]`,
                 * includeFilter[0]: `["posts", "*", "title"]`
                 * properties `posted` and `history` must be removed from the object
                 */
                const applyFiltersOnInlineData = (descPath, node) => {
                    if ([node_value_types_1.VALUE_TYPES.OBJECT, node_value_types_1.VALUE_TYPES.ARRAY].includes(node.type) && includeFilter.length > 0) {
                        const trailKeys = acebase_core_1.PathInfo.getPathKeys(descPath).slice(pathInfo.keys.length);
                        const checkPathInfo = new acebase_core_1.PathInfo(trailKeys);
                        const remove = [];
                        const includes = includeFilter.filter(info => info.isDescendantOf(checkPathInfo));
                        if (includes.length > 0) {
                            const isArray = node.type === node_value_types_1.VALUE_TYPES.ARRAY;
                            remove.push(...Object.keys(node.value).map(key => isArray ? +key : key)); // Mark all at first
                            for (const info of includes) {
                                const targetProp = info.keys[trailKeys.length];
                                if (typeof targetProp === 'string' && (targetProp === '*' || targetProp.startsWith('$'))) {
                                    remove.splice(0);
                                    break;
                                }
                                const index = remove.indexOf(targetProp);
                                index >= 0 && remove.splice(index, 1);
                            }
                        }
                        const hasIncludeOnChild = includeFilter.some(info => info.isChildOf(checkPathInfo));
                        const hasExcludeOnChild = excludeFilter.some(info => info.isChildOf(checkPathInfo));
                        if (hasExcludeOnChild && !hasIncludeOnChild) {
                            // do not remove children that are NOT in direct exclude filters (which includes them again)
                            const excludes = excludeFilter.filter(info => info.isChildOf(checkPathInfo));
                            for (let i = 0; i < remove.length; i++) {
                                if (!excludes.find(info => info.equals(remove[i]))) {
                                    remove.splice(i, 1);
                                    i--;
                                }
                            }
                        }
                        // remove.length > 0 && this.debug.log(`Remove properties:`, remove);
                        for (const key of remove) {
                            delete node.value[key];
                        }
                    }
                };
                applyFiltersOnInlineData(path, targetNode);
                let checkExecuted = false;
                const includeDescendantCheck = (descPath, metadata) => {
                    checkExecuted = true;
                    if (!transaction.production && !pathInfo.isAncestorOf(descPath)) {
                        // Double check failed
                        this.throwImplementationError(`"${descPath}" is not a descendant of "${path}" - descendantsOf must only check and return paths that are descendants`);
                    }
                    if (!filtered) {
                        return true;
                    }
                    // Apply include & exclude filters
                    const descPathKeys = acebase_core_1.PathInfo.getPathKeys(descPath);
                    const trailKeys = descPathKeys.slice(pathInfo.keys.length);
                    const checkPathInfo = new acebase_core_1.PathInfo(trailKeys);
                    let include = (includeFilter.length > 0
                        ? includeFilter.some(info => checkPathInfo.isOnTrailOf(info))
                        : true)
                        && (excludeFilter.length > 0
                            ? !excludeFilter.some(info => info.equals(checkPathInfo) || info.isAncestorOf(checkPathInfo))
                            : true);
                    // Apply child_objects filter. If metadata is not loaded, we can only skip deeper descendants here - any child object that does get through will be ignored by addDescendant
                    if (include
                        && options.child_objects === false
                        && (pathInfo.isParentOf(descPath) && [node_value_types_1.VALUE_TYPES.OBJECT, node_value_types_1.VALUE_TYPES.ARRAY].includes(metadata ? metadata.type : -1)
                            || acebase_core_1.PathInfo.getPathKeys(descPath).length > pathInfo.pathKeys.length + 1)) {
                        include = false;
                    }
                    return include;
                };
                const descRows = [];
                const addDescendant = (descPath, node) => {
                    // console.warn(`Adding descendant "${descPath}"`);
                    if (!checkExecuted) {
                        this.throwImplementationError('descendantsOf did not call checkCallback before addCallback');
                    }
                    if (options.child_objects === false && [node_value_types_1.VALUE_TYPES.OBJECT, node_value_types_1.VALUE_TYPES.ARRAY].includes(node.type)) {
                        // child objects are filtered out, but this one got through because includeDescendantCheck did not have access to its metadata,
                        // which is ok because doing that might drastically improve performance in client code. Skip it now.
                        return true;
                    }
                    // Apply include filters to prevent unwanted properties stored inline to be added
                    applyFiltersOnInlineData(descPath, node);
                    // Process the value
                    this._processReadNodeValue(node);
                    // Add node
                    const row = node;
                    row.path = descPath;
                    descRows.push(row);
                    return true; // Keep streaming
                };
                await transaction.descendantsOf(path, { metadata: true, value: true }, includeDescendantCheck, addDescendant);
                this.debug.log(`Read node "/${path}" and ${filtered ? '(filtered) ' : ''}descendants from ${descRows.length + 1} records`.colorize(acebase_core_1.ColorStyle.magenta));
                const result = targetNode;
                const objectToArray = (obj) => {
                    // Convert object value to array
                    const arr = [];
                    Object.keys(obj).forEach(key => {
                        const index = parseInt(key);
                        arr[index] = obj[index];
                    });
                    return arr;
                };
                if (targetNode.type === node_value_types_1.VALUE_TYPES.ARRAY) {
                    result.value = objectToArray(result.value);
                }
                if (targetNode.type === node_value_types_1.VALUE_TYPES.OBJECT || targetNode.type === node_value_types_1.VALUE_TYPES.ARRAY) {
                    // target node is an object or array
                    // merge with other found (child) nodes
                    const targetPathKeys = acebase_core_1.PathInfo.getPathKeys(path);
                    const value = targetNode.value;
                    for (let i = 0; i < descRows.length; i++) {
                        const otherNode = descRows[i];
                        const pathKeys = acebase_core_1.PathInfo.getPathKeys(otherNode.path);
                        const trailKeys = pathKeys.slice(targetPathKeys.length);
                        let parent = value;
                        for (let j = 0; j < trailKeys.length; j++) {
                            (0, assert_1.assert)(typeof parent === 'object', 'parent must be an object/array to have children!!');
                            const key = trailKeys[j];
                            const isLast = j === trailKeys.length - 1;
                            const nodeType = isLast
                                ? otherNode.type
                                : typeof trailKeys[j + 1] === 'number'
                                    ? node_value_types_1.VALUE_TYPES.ARRAY
                                    : node_value_types_1.VALUE_TYPES.OBJECT;
                            let nodeValue;
                            if (!isLast) {
                                nodeValue = nodeType === node_value_types_1.VALUE_TYPES.OBJECT ? {} : [];
                            }
                            else {
                                nodeValue = otherNode.value;
                                if (nodeType === node_value_types_1.VALUE_TYPES.ARRAY) {
                                    nodeValue = objectToArray(nodeValue);
                                }
                            }
                            if (key in parent) {
                                // Merge with parent
                                const mergePossible = typeof parent[key] === typeof nodeValue && [node_value_types_1.VALUE_TYPES.OBJECT, node_value_types_1.VALUE_TYPES.ARRAY].includes(nodeType);
                                if (!mergePossible) {
                                    // Ignore the value in the child record, see issue #20: "Assertion failed: Merging child values can only be done if existing and current values are both an array or object"
                                    this.debug.error(`The value stored in node "${otherNode.path}" cannot be merged with the parent node, value will be ignored. This error should disappear once the target node value is updated. See issue #20 for more information`, { path, parent, key, nodeType, nodeValue });
                                }
                                else {
                                    Object.keys(nodeValue).forEach(childKey => {
                                        if (childKey in parent[key]) {
                                            this.throwImplementationError(`Custom storage merge error: child key "${childKey}" is in parent value already! Make sure the get/childrenOf/descendantsOf methods of the custom storage class return values that can be modified by AceBase without affecting the stored source`);
                                        }
                                        parent[key][childKey] = nodeValue[childKey];
                                    });
                                }
                            }
                            else {
                                parent[key] = nodeValue;
                            }
                            parent = parent[key];
                        }
                    }
                }
                else if (descRows.length > 0) {
                    this.throwImplementationError(`multiple records found for non-object value!`);
                }
                // Post process filters to remove any data that got through because they were
                // not stored in dedicated records. This will happen with smaller values because
                // they are stored inline in their parent node.
                // eg:
                // { number: 1, small_string: 'small string', bool: true, obj: {}, arr: [] }
                // All properties of this object are stored inline,
                // if exclude: ['obj'], or child_objects: false was passed, these will still
                // have to be removed from the value
                if (options.child_objects === false) {
                    Object.keys(result.value).forEach(key => {
                        if (typeof result.value[key] === 'object' && result.value[key].constructor === Object) {
                            // This can only happen if the object was empty
                            (0, assert_1.assert)(Object.keys(result.value[key]).length === 0);
                            delete result.value[key];
                        }
                    });
                }
                if (options.include) {
                    // TODO: remove any unselected children that did get through
                }
                if (options.exclude) {
                    const process = (obj, keys) => {
                        if (typeof obj !== 'object') {
                            return;
                        }
                        const key = keys[0];
                        if (key === '*') {
                            Object.keys(obj).forEach(k => {
                                process(obj[k], keys.slice(1));
                            });
                        }
                        else if (keys.length > 1) {
                            key in obj && process(obj[key], keys.slice(1));
                        }
                        else {
                            delete obj[key];
                        }
                    };
                    options.exclude.forEach(path => {
                        const checkKeys = acebase_core_1.PathInfo.getPathKeys(path);
                        process(result.value, checkKeys);
                    });
                }
                return result;
            })();
            if (!options.transaction) {
                // transaction was created by us, commit
                await transaction.commit();
            }
            return node;
        }
        catch (err) {
            if (!options.transaction) {
                // transaction was created by us, rollback
                await transaction.rollback(err);
            }
            throw err;
        }
    }
    async getNodeInfo(path, options = {}) {
        options = options || {};
        const pathInfo = acebase_core_1.PathInfo.get(path);
        const transaction = options.transaction || await this._customImplementation.getTransaction({ path, write: false });
        try {
            const node = await this._readNode(path, { transaction });
            const info = new CustomStorageNodeInfo({
                path,
                key: typeof pathInfo.key === 'string' ? pathInfo.key : null,
                index: typeof pathInfo.key === 'number' ? pathInfo.key : null,
                type: node ? node.type : 0,
                exists: node !== null,
                address: node ? new node_address_1.NodeAddress(path) : null,
                created: node ? new Date(node.created) : null,
                modified: node ? new Date(node.modified) : null,
                revision: node ? node.revision : null,
                revision_nr: node ? node.revision_nr : null,
            });
            if (!node && path !== '') {
                // Try parent node
                const lockPath = await transaction.moveToParentPath(pathInfo.parentPath);
                (0, assert_1.assert)(lockPath === pathInfo.parentPath, `transaction.moveToParentPath() did not move to the right parent path of "${path}"`);
                const parent = await this._readNode(pathInfo.parentPath, { transaction });
                if (parent && [node_value_types_1.VALUE_TYPES.OBJECT, node_value_types_1.VALUE_TYPES.ARRAY].includes(parent.type) && pathInfo.key in parent.value) {
                    // Stored in parent node
                    info.exists = true;
                    info.value = parent.value[pathInfo.key];
                    info.address = null;
                    info.type = parent.type;
                    info.created = new Date(parent.created);
                    info.modified = new Date(parent.modified);
                    info.revision = parent.revision;
                    info.revision_nr = parent.revision_nr;
                }
                else {
                    // Parent doesn't exist, so the node we're looking for cannot exist either
                    info.address = null;
                }
            }
            if (options.include_child_count) {
                info.childCount = 0;
                if ([node_value_types_1.VALUE_TYPES.OBJECT, node_value_types_1.VALUE_TYPES.ARRAY].includes(info.valueType) && info.address) {
                    // Get number of children
                    info.childCount = node.value ? Object.keys(node.value).length : 0;
                    info.childCount += await transaction.getChildCount(path);
                }
            }
            if (!options.transaction) {
                // transaction was created by us, commit
                await transaction.commit();
            }
            return info;
        }
        catch (err) {
            if (!options.transaction) {
                // transaction was created by us, rollback
                await transaction.rollback(err);
            }
            throw err;
        }
    }
    // TODO: Move to Storage base class?
    async setNode(path, value, options = { suppress_events: false, context: null }) {
        if (this.settings.readOnly) {
            throw new Error(`Database is opened in read-only mode`);
        }
        const pathInfo = acebase_core_1.PathInfo.get(path);
        const transaction = options.transaction || await this._customImplementation.getTransaction({ path, write: true });
        try {
            if (path === '') {
                if (value === null || typeof value !== 'object' || value instanceof Array || value instanceof ArrayBuffer || ('buffer' in value && value.buffer instanceof ArrayBuffer)) {
                    throw new Error(`Invalid value for root node: ${value}`);
                }
                await this._writeNodeWithTracking('', value, { merge: false, transaction, suppress_events: options.suppress_events, context: options.context });
            }
            else if (typeof options.assert_revision !== 'undefined') {
                const info = await this.getNodeInfo(path, { transaction });
                if (info.revision !== options.assert_revision) {
                    throw new node_errors_1.NodeRevisionError(`revision '${info.revision}' does not match requested revision '${options.assert_revision}'`);
                }
                if (info.address && info.address.path === path && value !== null && !this.valueFitsInline(value)) {
                    // Overwrite node
                    await this._writeNodeWithTracking(path, value, { merge: false, transaction, suppress_events: options.suppress_events, context: options.context });
                }
                else {
                    // Update parent node
                    const lockPath = await transaction.moveToParentPath(pathInfo.parentPath);
                    (0, assert_1.assert)(lockPath === pathInfo.parentPath, `transaction.moveToParentPath() did not move to the right parent path of "${path}"`);
                    await this._writeNodeWithTracking(pathInfo.parentPath, { [pathInfo.key]: value }, { merge: true, transaction, suppress_events: options.suppress_events, context: options.context });
                }
            }
            else {
                // Delegate operation to update on parent node
                const lockPath = await transaction.moveToParentPath(pathInfo.parentPath);
                (0, assert_1.assert)(lockPath === pathInfo.parentPath, `transaction.moveToParentPath() did not move to the right parent path of "${path}"`);
                await this.updateNode(pathInfo.parentPath, { [pathInfo.key]: value }, { transaction, suppress_events: options.suppress_events, context: options.context });
            }
            if (!options.transaction) {
                // transaction was created by us, commit
                await transaction.commit();
            }
        }
        catch (err) {
            if (!options.transaction) {
                // transaction was created by us, rollback
                await transaction.rollback(err);
            }
            throw err;
        }
    }
    // TODO: Move to Storage base class?
    async updateNode(path, updates, options = { suppress_events: false, context: null }) {
        if (this.settings.readOnly) {
            throw new Error(`Database is opened in read-only mode`);
        }
        if (typeof updates !== 'object') {
            throw new Error(`invalid updates argument`); //. Must be a non-empty object or array
        }
        else if (Object.keys(updates).length === 0) {
            return; // Nothing to update. Done!
        }
        const transaction = options.transaction || await this._customImplementation.getTransaction({ path, write: true });
        try {
            // Get info about current node
            const nodeInfo = await this.getNodeInfo(path, { transaction });
            const pathInfo = acebase_core_1.PathInfo.get(path);
            if (nodeInfo.exists && nodeInfo.address && nodeInfo.address.path === path) {
                // Node exists and is stored in its own record.
                // Update it
                await this._writeNodeWithTracking(path, updates, { transaction, merge: true, suppress_events: options.suppress_events, context: options.context });
            }
            else if (nodeInfo.exists) {
                // Node exists, but is stored in its parent node.
                const pathInfo = acebase_core_1.PathInfo.get(path);
                const lockPath = await transaction.moveToParentPath(pathInfo.parentPath);
                (0, assert_1.assert)(lockPath === pathInfo.parentPath, `transaction.moveToParentPath() did not move to the right parent path of "${path}"`);
                await this._writeNodeWithTracking(pathInfo.parentPath, { [pathInfo.key]: updates }, { transaction, merge: true, suppress_events: options.suppress_events, context: options.context });
            }
            else {
                // The node does not exist, it's parent doesn't have it either. Update the parent instead
                const lockPath = await transaction.moveToParentPath(pathInfo.parentPath);
                (0, assert_1.assert)(lockPath === pathInfo.parentPath, `transaction.moveToParentPath() did not move to the right parent path of "${path}"`);
                await this.updateNode(pathInfo.parentPath, { [pathInfo.key]: updates }, { transaction, suppress_events: options.suppress_events, context: options.context });
            }
            if (!options.transaction) {
                // transaction was created by us, commit
                await transaction.commit();
            }
        }
        catch (err) {
            if (!options.transaction) {
                // transaction was created by us, rollback
                await transaction.rollback(err);
            }
            throw err;
        }
    }
}
exports.CustomStorage = CustomStorage;
//# sourceMappingURL=index.js.map