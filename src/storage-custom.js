const { ID, PathReference, PathInfo, ascii85, ColorStyle, Utils } = require('acebase-core');
const { compareValues } = Utils;
const { NodeInfo } = require('./node-info');
const { NodeLocker } = require('./node-lock');
const { VALUE_TYPES } = require('./node-value-types');
const { Storage, StorageSettings, NodeNotFoundError, NodeRevisionError } = require('./storage');

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

/** Interface for metadata combined with a stored value */
class ICustomStorageNode extends ICustomStorageNodeMetaData {
    constructor() {
        super();
        /** @type {any} only Object, Array, large string and binary values. */
        this.value = null;
    }
}

/** Enables get/set/remove operations to be wrapped in transactions to improve performance and reliability. */
class CustomStorageTransaction {

    /**
     * @param {{ path: string, write: boolean }} target Which path the transaction is taking place on, and whether it is a read or read/write lock. If your storage backend does not support transactions, is synchronous, or if you are able to lock resources based on path: use storage.nodeLocker to ensure threadsafe transactions
     */
    constructor(target) {
        this.production = false;  // dev mode by default
        this.target = {
            get originalPath() { return target.path; },
            path: target.path,
            get write() { return target.write; }
        };
        /** @type {string} Transaction ID */
        this.id = ID.generate();
    }

    /**
     * @param {string} path 
     * @returns {Promise<ICustomStorageNode>}
     */
    // eslint-disable-next-line no-unused-vars
    async get(path) { throw new Error(`CustomStorageTransaction.get must be overridden by subclass`); }
    
    /**
     * @param {string} path 
     * @param {ICustomStorageNode} node
     * @returns {Promise<any>}
     */
    // eslint-disable-next-line no-unused-vars
    async set(path, node) { throw new Error(`CustomStorageTransaction.set must be overridden by subclass`); }
    
    /**
     * @param {string} path
     * @returns {Promise<any>}
     */
    // eslint-disable-next-line no-unused-vars
    async remove(path) { throw new Error(`CustomStorageTransaction.remove must be overridden by subclass`); }
    
    /**
     * 
     * @param {string} path Parent path to load children of
     * @param {object} include 
     * @param {boolean} include.metadata Whether metadata needs to be loaded
     * @param {boolean} include.value  Whether value needs to be loaded
     * @param {(childPath: string) => boolean} checkCallback callback method to precheck if child needs to be added, perform before loading metadata/value if possible
     * @param {(childPath: string, node?: ICustomStorageNodeMetaData|ICustomStorageNode) => boolean} addCallback callback method that adds the child node. Returns whether or not to keep calling with more children
     * @returns {Promise<any>} Returns a promise that resolves when there are no more children to be streamed
     */
    // eslint-disable-next-line no-unused-vars
    async childrenOf(path, include, checkCallback, addCallback) { throw new Error(`CustomStorageTransaction.childrenOf must be overridden by subclass`); }

    /**
     * 
     * @param {string} path Parent path to load descendants of
     * @param {object} include 
     * @param {boolean} include.metadata Whether metadata needs to be loaded
     * @param {boolean} include.value  Whether value needs to be loaded
     * @param {(descPath: string, metadata?: ICustomStorageNodeMetaData) => boolean} checkCallback callback method to precheck if descendant needs to be added, perform before loading metadata/value if possible. NOTE: if include.metadata === true, you should load and pass the metadata to the checkCallback if doing so has no or small performance impact
     * @param {(descPath: string, node?: ICustomStorageNodeMetaData|ICustomStorageNode) => boolean} addCallback callback method that adds the descendant node. Returns whether or not to keep calling with more children
     * @returns {Promise<any>} Returns a promise that resolves when there are no more descendants to be streamed
     */
    // eslint-disable-next-line no-unused-vars
    async descendantsOf(path, include, checkCallback, addCallback) { throw new Error(`CustomStorageTransaction.descendantsOf must be overridden by subclass`); }

    /**
     * Returns the number of children stored in their own records. This implementation uses `childrenOf` to count, override if storage supports a quicker way. 
     * Eg: For SQL databases, you can implement this with a single query like `SELECT count(*) FROM nodes WHERE ${CustomStorageHelpers.ChildPathsSql(path)}`
     * @param {string} path 
     * @returns {Promise<number>} Returns a promise that resolves with the number of children
     */
    async getChildCount(path) {
        let childCount = 0;
        await this.childrenOf(path, { metadata: false, value: false }, () => { childCount++; return false; });
        return childCount;
    }

    /**
     * NOT USED YET
     * Default implementation of getMultiple that executes .get for each given path. Override for custom logic
     * @param {string[]} paths
     * @returns {Promise<Map<string, ICustomStorageNode>>} Returns promise with a Map of paths to nodes
     */
    async getMultiple(paths) {
        const map = new Map();
        await Promise.all(paths.map(path => this.get(path).then(val => map.set(path, val))));
        return map;
    }

    /**
     * NOT USED YET
     * Default implementation of setMultiple that executes .set for each given path. Override for custom logic
     * @param {Array<{ path: string, node: ICustomStorageNode }>} nodes 
     */
    async setMultiple(nodes) {
        await Promise.all(nodes.map(({ path, node }) => this.set(path, node)));
    }

    /**
     * Default implementation of removeMultiple that executes .remove for each given path. Override for custom logic
     * @param {string[]} paths 
     */
    async removeMultiple(paths) {
        await Promise.all(paths.map(path => this.remove(path)));
    }

    /**
     * @param {Error} reason 
     * @returns {Promise<any>}
     */
    // eslint-disable-next-line no-unused-vars
    async rollback(reason) { throw new Error(`CustomStorageTransaction.rollback must be overridden by subclass`); }

    /**
     * @returns {Promise<any>}
     */
    async commit() { throw new Error(`CustomStorageTransaction.rollback must be overridden by subclass`); }
    
    /**
     * Moves the transaction path to the parent node. If node locking is used, it will request a new lock
     * Used internally, must not be overridden unless custom locking mechanism is required
     * @param {string} targetPath;
     */
    async moveToParentPath(targetPath) {
        const currentPath = (this._lock && this._lock.path) || this.target.path;
        if (currentPath === targetPath) {
            return targetPath; // Already on the right path
        }
        const pathInfo = CustomStorageHelpers.PathInfo.get(targetPath);
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

/**
 * Allows data to be stored in a custom storage backend of your choice! Simply provide a couple of functions
 * to get, set and remove data and you're done.
 */
class CustomStorageSettings extends StorageSettings {

    /**
     * 
     * @param {object} settings 
     * @param {string} [settings.name] Name of the custom storage adapter
     * @param {boolean} [settings.locking=true] Whether default node locking should be used. Set to false if your storage backend disallows multiple simultanious write transactions (eg IndexedDB). Set to true if your storage backend does not support transactions (eg LocalStorage) or allows multiple simultanious write transactions (eg AceBase binary).
     * @param {number} [settings.lockTimeout=120] If default node locking is used, timeout setting for read and write locks in seconds. Operations taking longer than this will be aborted. Default is 120 seconds.
     * @param {() => Promise<any>} settings.ready Function that returns a Promise that resolves once your data store backend is ready for use
     * @param {(target: { path: string, write: boolean }, nodeLocker: NodeLocker) => Promise<CustomStorageTransaction>} settings.getTransaction Function that starts a transaction for read/write operations on a specific path and/or child paths
     */
    constructor(settings) {
        super(settings);
        settings = settings || {};
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
        const nodeLocker = useLocking ? new NodeLocker(console, this.lockTimeout) : null;
        this.getTransaction = async ({ path, write }) => {
            // console.log(`${write ? 'WRITE' : 'READ'} transaction requested for path "${path}"`)
            const transaction = await settings.getTransaction({ path, write });
            console.assert(typeof transaction.id === 'string', `transaction id not set`);
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
            }
            transaction.rollback = async (reason) => {
                // const reasonText = reason instanceof Error ? reason.message : reason.toString();
                // console.error(`ROLLBACK ${transaction.id} for ${write ? 'WRITE' : 'READ'} on path "${path}":`, reason);
                const ret = await rollback.call(transaction, reason);
                // console.log(`ROLLBACK DONE ${transaction.id} for ${write ? 'WRITE' : 'READ'} on path "${path}"`);
                if (useLocking) {
                    await transaction._lock.release('rollback');
                }
                return ret;
            }

            if (useLocking) {
                // Lock the path before continuing
                transaction._lock = await nodeLocker.lock(path, transaction.id, write, `${this.name}::getTransaction`);
            }
            return transaction;
        }
    }
}

class CustomStorageNodeAddress {
    constructor(containerPath) {
        this.path = containerPath;
    }
}

class CustomStorageNodeInfo extends NodeInfo {
    constructor(info) {
        super(info);

        /** @type {CustomStorageNodeAddress} */
        this.address; // no assignment, only typedef

        /** @type {string} */
        this.revision = info.revision;
        /** @type {number} */
        this.revision_nr = info.revision_nr;
        /** @type {Date} */
        this.created = info.created;
        /** @type {Date} */
        this.modified = info.modified;
    }
}

/**
 * Helper functions to build custom storage classes with
 */
class CustomStorageHelpers {
    /**
     * Helper function that returns a SQL where clause for all children of given path
     * @param {string} path Path to get children of
     * @param {string} [columnName] Name of the Path column in your SQL db, default is 'path'
     * @returns {string} Returns the SQL where clause
     */
    static ChildPathsSql(path, columnName = 'path') {
        const where = path === '' 
            ? `${columnName} <> '' AND ${columnName} NOT LIKE '%/%'` 
            : `(${columnName} LIKE '${path}/%' OR ${columnName} LIKE '${path}[%') AND ${columnName} NOT LIKE '${path}/%/%' AND ${columnName} NOT LIKE '${path}[%]/%' AND ${columnName} NOT LIKE '${path}[%][%'`
        return where;
    }

    /**
     * Helper function that returns a regular expression to test if paths are children of the given path
     * @param {string} path Path to test children of
     * @returns {RegExp} Returns regular expression to test paths with
     */
    static ChildPathsRegex(path) {
        return new RegExp(`^${path}(?:/[^/[]+|\\[[0-9]+\\])$`);
    }

    /**
     * Helper function that returns a SQL where clause for all descendants of given path
     * @param {string} path Path to get descendants of
     * @param {string} [columnName] Name of the Path column in your SQL db, default is 'path'
     * @returns {string} Returns the SQL where clause
     */
    static DescendantPathsSql(path, columnName = 'path') {
        const where = path === '' 
            ? `${columnName} <> ''` 
            : `${columnName} LIKE '${path}/%' OR ${columnName} LIKE '${path}[%'`
        return where;
    }
    /**
     * Helper function that returns a regular expression to test if paths are descendants of the given path
     * @param {string} path Path to test descendants of
     * @returns {RegExp} Returns regular expression to test paths with
     */
    static DescendantPathsRegex(path) {
        return new RegExp(`^${path}(?:/[^/[]+|\\[[0-9]+\\])`);
    }

    /**
     * PathInfo helper class. Can be used to extract keys from a given path, get parent paths, check if a path is a child or descendant of other path etc
     * @example
     * var pathInfo = CustomStorage.PathInfo.get('my/path/to/data');
     * pathInfo.key === 'data';
     * pathInfo.parentPath === 'my/path/to';
     * pathInfo.pathKeys; // ['my','path','to','data'];
     * pathInfo.isChildOf('my/path/to') === true;
     * pathInfo.isDescendantOf('my/path') === true;
     * pathInfo.isParentOf('my/path/to/data/child') === true;
     * pathInfo.isAncestorOf('my/path/to/data/child/grandchild') === true;
     * pathInfo.childPath('child') === 'my/path/to/data/child';
     * pathInfo.childPath(0) === 'my/path/to/data[0]';
     */
    static get PathInfo() {
        return PathInfo;
    }
}

class CustomStorage extends Storage {

    /**
     * 
     * @param {string} dbname 
     * @param {CustomStorageSettings} settings 
     */
    constructor(dbname, settings) {
        super(dbname, settings);

        this._init();
    }

    async _init() {
        /** @type {CustomStorageSettings} */
        this._customImplementation = this.settings;
        this.debug.log(`Database "${this.name}" details:`.colorize(ColorStyle.dim));
        this.debug.log(`- Type: CustomStorage`.colorize(ColorStyle.dim));
        this.debug.log(`- Path: ${this.settings.path}`.colorize(ColorStyle.dim));
        this.debug.log(`- Max inline value size: ${this.settings.maxInlineValueSize}`.colorize(ColorStyle.dim));
        this.debug.log(`- Autoremove undefined props: ${this.settings.removeVoidProperties}`.colorize(ColorStyle.dim));

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

    /**
     * 
     * @param {string} path 
     * @param {ICustomStorageNode} node 
     * @param {object} options
     * @param {CustomStorageTransaction} options.transaction
     * @returns {Promise<void>}
     */
    _storeNode(path, node, options) {
        // serialize the value to store
        const getTypedChildValue = val => {
            if (val === null) {
                throw new Error(`Not allowed to store null values. remove the property`);
            }
            else if (['string','number','boolean'].includes(typeof val)) {
                return val;
            }
            else if (val instanceof Date) {
                return { type: VALUE_TYPES.DATETIME, value: val.getTime() };
            }
            else if (val instanceof PathReference) {
                return { type: VALUE_TYPES.REFERENCE, value: val.path };
            }
            else if (val instanceof ArrayBuffer) {
                return { type: VALUE_TYPES.BINARY, value: ascii85.encode(val) };
            }
            else if (typeof val === 'object') {
                console.assert(Object.keys(val).length === 0, 'child object stored in parent can only be empty');
                return val;
            }
        }

        const unprocessed = `Caller should have pre-processed the value by converting it to a string`;
        if (node.type === VALUE_TYPES.ARRAY && node.value instanceof Array) {
            // Convert array to object with numeric properties
            // NOTE: caller should have done this already
            console.warn(`Unprocessed array. ${unprocessed}`);
            const obj = {};
            for (let i = 0; i < node.value.length; i++) {
                obj[i] = node.value[i];
            }
            node.value = obj;
        }
        if (node.type === VALUE_TYPES.BINARY && typeof node.value !== 'string') {
            console.warn(`Unprocessed binary value. ${unprocessed}`);
            node.value = ascii85.encode(node.value);
        }
        if (node.type === VALUE_TYPES.REFERENCE && node.value instanceof PathReference) {
            console.warn(`Unprocessed path reference. ${unprocessed}`);
            node.value = node.value.path;
        }
        if ([VALUE_TYPES.OBJECT, VALUE_TYPES.ARRAY].includes(node.type)) {
            const original = node.value;
            node.value = {};
            // If original is an array, it'll automatically be converted to an object now
            Object.keys(original).forEach(key => {
                node.value[key] = getTypedChildValue(original[key]);
            });
        }

        return options.transaction.set(path, node);
    }

    /**
     * 
     * @param {ICustomStorageNode} node 
     */
    _processReadNodeValue(node) {

        const getTypedChildValue = val => {
            // Typed value stored in parent record
            if (val.type === VALUE_TYPES.BINARY) {
                // binary stored in a parent record as a string
                return ascii85.decode(val.value);
            }
            else if (val.type === VALUE_TYPES.DATETIME) {
                // Date value stored as number
                return new Date(val.value);
            }
            else if (val.type === VALUE_TYPES.REFERENCE) {
                // Path reference stored as string
                return new PathReference(val.value);
            }
            else {
                throw new Error(`Unhandled child value type ${val.type}`);
            }            
        }

        switch (node.type) {

            case VALUE_TYPES.ARRAY:
            case VALUE_TYPES.OBJECT: {
                // check if any value needs to be converted
                // NOTE: Arrays are stored with numeric properties
                const obj = node.value;
                Object.keys(obj).forEach(key => {
                    let item = obj[key];
                    if (typeof item === 'object' && 'type' in item) {
                        obj[key] = getTypedChildValue(item);
                    }
                });
                node.value = obj;
                break;
            }

            case VALUE_TYPES.BINARY: {
                node.value = ascii85.decode(node.value);
                break;
            }

            case VALUE_TYPES.REFERENCE: {
                node.value = new PathReference(node.value);
                break;
            }

            case VALUE_TYPES.STRING: {
                // No action needed 
                // node.value = node.value;
                break;
            }

            default:
                throw new Error(`Invalid standalone record value type`); // should never happen
        }
    }

    /**
     * @param {string} path 
     * @param {object} options 
     * @param {CustomStorageTransaction} options.transaction
     * @returns {Promise<ICustomStorageNode>}
     */
    async _readNode(path, options) {
        // deserialize a stored value (always an object with "type", "value", "revision", "revision_nr", "created", "modified")
        let node = await options.transaction.get(path);
        if (node === null) { return null; }
        if (typeof node !== 'object') {
            throw new Error(`CustomStorageTransaction.get must return an ICustomStorageNode object. Use JSON.parse if your set function stored it as a string`);
        }

        this._processReadNodeValue(node);
        return node;
    }

    _getTypeFromStoredValue(val) {
        let type;
        if (typeof val === 'string') {
            type = VALUE_TYPES.STRING;
        }
        else if (typeof val === 'number') {
            type = VALUE_TYPES.NUMBER;
        }
        else if (typeof val === 'boolean') {
            type = VALUE_TYPES.BOOLEAN;
        }
        else if (val instanceof Array) {
            type = VALUE_TYPES.ARRAY;
        }
        else if (typeof val === 'object') {
            if ('type' in val) {
                type = val.type;
                val = val.value;
                if (type === VALUE_TYPES.DATETIME) {
                    val = new Date(val);
                }
                else if (type === VALUE_TYPES.REFERENCE) {
                    val = new PathReference(val);
                }
            }
            else {
                type = VALUE_TYPES.OBJECT;
            }
        }
        else {
            throw new Error(`Unknown value type`);
        }
        return { type, value: val };
    }


    /**
     * Creates or updates a node in its own record. DOES NOT CHECK if path exists in parent node, or if parent paths exist! Calling code needs to do this
     * @param {string} path 
     * @param {any} value 
     * @param {object} options
     * @param {CustomStorageTransaction} options.transaction
     * @param {boolean} [options.merge=false]
     * @param {string} [options.revision]
     * @param {any} [options.currentValue]
     * @returns {Promise<void>}
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
            if (currentRow.type === VALUE_TYPES.ARRAY && !(value instanceof Array) && typeof value === 'object' && Object.keys(value).some(key => isNaN(key))) {
                throw new Error(`Cannot merge existing array of path "${path}" with an object`);
            }
            if (value instanceof Array && currentRow.type !== VALUE_TYPES.ARRAY) {
                throw new Error(`Cannot merge existing object of path "${path}" with an array`);
            }
        }

        const revision = options.revision || ID.generate();
        let mainNode = {
            type: currentRow && currentRow.type === VALUE_TYPES.ARRAY ? VALUE_TYPES.ARRAY : VALUE_TYPES.OBJECT,
            value: {}
        };
        const childNodeValues = {};
        if (value instanceof Array) {
            mainNode.type = VALUE_TYPES.ARRAY;
            // Convert array to object with numeric properties
            const obj = {};
            for (let i = 0; i < value.length; i++) {
                obj[i] = value[i];
            }
            value = obj;
        }
        else if (value instanceof PathReference) {
            mainNode.type = VALUE_TYPES.REFERENCE;
            mainNode.value = value.path;
        }
        else if (value instanceof ArrayBuffer) {
            mainNode.type = VALUE_TYPES.BINARY;
            mainNode.value = ascii85.encode(value);
        }
        else if (typeof value === 'string') {
            mainNode.type = VALUE_TYPES.STRING;
            mainNode.value = value;
        }

        const currentIsObjectOrArray = currentRow ? [VALUE_TYPES.OBJECT, VALUE_TYPES.ARRAY].includes(currentRow.type) : false;
        const newIsObjectOrArray = [VALUE_TYPES.OBJECT, VALUE_TYPES.ARRAY].includes(mainNode.type);
        const children = {
            current: [],
            new: []
        }

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
                else if (typeof val === "undefined") {
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
        const isArray = mainNode.type === VALUE_TYPES.ARRAY;
        if (currentRow) {
            // update
            this.debug.log(`Node "/${path}" is being ${options.merge ? 'updated' : 'overwritten'}`.colorize(ColorStyle.cyan));

            // If existing is an array or object, we have to find out which children are affected
            if (currentIsObjectOrArray || newIsObjectOrArray) {

                // Get current child nodes in dedicated child records
                const pathInfo = PathInfo.get(path);
                const keys = [];
                let checkExecuted = false;
                const includeChildCheck = childPath => {
                    checkExecuted = true;
                    if (!transaction.production && !pathInfo.isParentOf(childPath)) {
                        // Double check failed
                        throw new Error(`"${childPath}" is not a child of "${path}" - childrenOf must only check and return paths that are children`);
                    }
                    return true;
                }
                const addChildPath = childPath => {
                    if (!checkExecuted) {
                        throw new Error(`${this._customImplementation.info} childrenOf did not call checkCallback before addCallback`);
                    }
                    const key = PathInfo.get(childPath).key;
                    keys.push(key.toString()); // .toString to make sure all keys are compared as strings
                    return true; // Keep streaming
                }
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
                    if (isArray) { key = parseInt(key); }
                    const childDiff = typeof options.diff === 'object' ? options.diff.forChild(key) : undefined;
                    if (childDiff === 'identical') {
                        // console.warn(`Skipping _writeNode recursion for child "${key}"`);
                        return; // Skip
                    }
                    const childPath = pathInfo.childPath(key); // PathInfo.getChildPath(path, key);
                    const childValue = childNodeValues[key];

                    // Pass current child value to _writeNode
                    const currentChildValue = typeof options.currentValue === 'undefined'  // Fixing issue #20
                        ? undefined
                        : options.currentValue !== null && typeof options.currentValue === 'object' && key in options.currentValue 
                            ? options.currentValue[key] 
                            : null;

                    return this._writeNode(childPath, childValue, { transaction, revision, merge: false, currentValue: currentChildValue, diff: childDiff });
                });

                // Delete all child nodes that were stored in their own record, but are being removed 
                // Also delete nodes that are being moved from a dedicated record to inline
                const movingNodes = keys.filter(key => key in mainNode.value); // moving from dedicated to inline value
                const deleteDedicatedKeys = changes.delete.concat(movingNodes);
                const deletePromises = deleteDedicatedKeys.map(key => {
                    if (isArray) { key = parseInt(key); }
                    const childPath = pathInfo.childPath(key); //PathInfo.getChildPath(path, key);
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
                modified: Date.now()
            }, {
                transaction
            });
            if (p instanceof Promise) {
                return await p;
            }
        }
        else {
            // Current node does not exist, create it and any child nodes
            // write all child nodes that must be stored in their own record
            this.debug.log(`Node "/${path}" is being created`.colorize(ColorStyle.cyan));

            if (isArray) {
                // Check if the array is "intact" (all entries have an index from 0 to the end with no gaps)
                const arrayKeys = Object.keys(mainNode.value).concat(Object.keys(childNodeValues));
                const isExhaustive = arrayKeys.every((k, index, arr) => arr.includes(index.toString()));
                if (!isExhaustive) {
                    throw new Error(`Cannot store arrays with missing entries`);
                }
            }

            const promises = Object.keys(childNodeValues).map(key => {
                if (isArray) { key = parseInt(key); }
                const childPath = PathInfo.getChildPath(path, key);
                const childValue = childNodeValues[key];
                return this._writeNode(childPath, childValue, { transaction, revision, merge: false, currentValue: null });
            });

            // Create current node
            const p = this._storeNode(path, {
                type: mainNode.type,
                value: mainNode.value,
                revision,
                revision_nr: 1,
                created: Date.now(),
                modified: Date.now()
            }, { 
                transaction 
            });
            promises.push(p);
            return Promise.all(promises);
        }
    }

    /**
     * Deletes (dedicated) node and all subnodes without checking for existence. Use with care - all removed nodes will lose their revision stats! DOES NOT REMOVE INLINE CHILD NODES!
     * @param {string} path 
     * @param {object} options
     * @param {CustomStorageTransaction} options.transaction
     */
    async _deleteNode(path, options) {
        const pathInfo = PathInfo.get(path);
        this.debug.log(`Node "/${path}" is being deleted`.colorize(ColorStyle.cyan));

        const deletePaths = [path];
        let checkExecuted = false;
        const includeDescendantCheck = (descPath) => {
            checkExecuted = true;
            if (!transaction.production && !pathInfo.isAncestorOf(descPath)) {
                // Double check failed
                throw new Error(`"${descPath}" is not a descendant of "${path}" - descendantsOf must only check and return paths that are descendants`);
            }
            return true;        
        };
        const addDescendant = (descPath) => {
            if (!checkExecuted) {
                throw new Error(`${this._customImplementation.info} descendantsOf did not call checkCallback before addCallback`);
            }
            deletePaths.push(descPath);
            return true;
        };
        const transaction = options.transaction;
        await transaction.descendantsOf(path, { metadata: false, value: false }, includeDescendantCheck, addDescendant);

        this.debug.log(`Nodes ${deletePaths.map(p => `"/${p}"`).join(',')} are being deleted`.colorize(ColorStyle.cyan));
        return transaction.removeMultiple(deletePaths);
    }

    /**
     * Enumerates all children of a given Node for reflection purposes
     * @param {string} path 
     * @param {object} [options]
     * @param {CustomStorageTransaction} [options.transaction]
     * @param {string[]|number[]} [options.keyFilter]
     */
    getChildren(path, options) {
        // return generator
        options = options || {};
        var callback; //, resolve, reject;
        const generator = {
            /**
             * 
             * @param {(child: NodeInfo) => boolean} valueCallback callback function to run for each child. Return false to stop iterating
             * @returns {Promise<bool>} returns a promise that resolves with a boolean indicating if all children have been enumerated, or was canceled by the valueCallback function
             */
            next(valueCallback) {
                callback = valueCallback;
                return start();
            }
        };
        const start = async () => {
            const transaction = options.transaction || await this._customImplementation.getTransaction({ path, write: false });
            try {
                let canceled = false;
                await (async () => {
                    let node = await this._readNode(path, { transaction });
                    if (!node) { throw new NodeNotFoundError(`Node "/${path}" does not exist`); }

                    if (![VALUE_TYPES.OBJECT, VALUE_TYPES.ARRAY].includes(node.type)) {
                        // No children
                        return;
                    }
                    const isArray = node.type === VALUE_TYPES.ARRAY;
                    const value = node.value;
                    let keys = Object.keys(value);
                    if (options.keyFilter) {
                        keys = keys.filter(key => options.keyFilter.includes(key));
                    }
                    const pathInfo = PathInfo.get(path);
                    keys.length > 0 && keys.every(key => {
                        let child = this._getTypeFromStoredValue(value[key]);

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
                            created: node.created,
                            modified: node.modified
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
                            throw new Error(`"${childPath}" is not a child of "${path}" - childrenOf must only check and return paths that are children`);
                        }
                        if (options.keyFilter) {
                            const key = PathInfo.get(childPath).key;
                            return options.keyFilter.includes(key);
                        }
                        return true;           
                    };

                    /**
                     * 
                     * @param {string} childPath 
                     * @param {ICustomStorageNodeMetaData} node 
                     */
                    const addChildNode = (childPath, node) => {
                        if (!checkExecuted) {
                            throw new Error(`${this._customImplementation.info} childrenOf did not call checkCallback before addCallback`);
                        }
                        const key = PathInfo.get(childPath).key;
                        const info = new CustomStorageNodeInfo({
                            path: childPath,
                            type: node.type,
                            key: isArray ? null : key,
                            index: isArray ? key : null,
                            address: new CustomStorageNodeAddress(childPath),
                            exists: true,
                            value: null, // not loaded
                            revision: node.revision,
                            revision_nr: node.revision_nr,
                            created: new Date(node.created),
                            modified: new Date(node.modified)
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

            // })
            // .then(() => {
            //     lock.release();
            //     return canceled;
            // })
            // .catch(err => {
            //     lock.release();
            //     throw err;
            // });            
        }; // start()
        return generator;
    }

    /**
     * 
     * @param {string} path 
     * @param {object} [options] 
     * @param {string[]} [options.include]
     * @param {string[]} [options.exclude]
     * @param {boolean} [options.child_objects=true]
     * @param {CustomStorageTransaction} [options.transaction]
     * @returns {Promise<ICustomStorageNode>}
     */
    async getNode(path, options) {
        // path = path.replace(/'/g, '');  // prevent sql injection, remove single quotes

        options = options || {};
        const transaction = options.transaction || await this._customImplementation.getTransaction({ path, write: false });
        // let lock;
        // return this.nodeLocker.lock(path, tid, false, 'getNode')
        // .then(async l => {
        //     lock = l;
        try {
            const node = await (async () => {
                // Get path, path/* and path[*
                const filtered = (options.include && options.include.length > 0) || (options.exclude && options.exclude.length > 0) || options.child_objects === false;
                const pathInfo = PathInfo.get(path);
                const targetNode = await this._readNode(path, { transaction });
                if (!targetNode) {
                    // Lookup parent node
                    if (path === '') { return { value: null }; } // path is root. There is no parent.
                    const lockPath = await transaction.moveToParentPath(pathInfo.parentPath);
                    console.assert(lockPath === pathInfo.parentPath, `transaction.moveToParentPath() did not move to the right parent path of "${path}"`)
                    // return lock.moveToParent()
                    // .then(async parentLock => {
                    //     lock = parentLock;
                    let parentNode = await this._readNode(pathInfo.parentPath, { transaction });
                    if (parentNode && [VALUE_TYPES.OBJECT, VALUE_TYPES.ARRAY].includes(parentNode.type) && pathInfo.key in parentNode.value) {
                        const childValueInfo = this._getTypeFromStoredValue(parentNode.value[pathInfo.key]);
                        return { 
                            revision: parentNode.revision, 
                            revision_nr: parentNode.revision_nr,
                            created: parentNode.created,
                            modified: parentNode.modified,
                            type: childValueInfo.type,
                            value: childValueInfo.value
                        };
                    }
                    return { value: null };
                    // });
                }

                // const includeCheck = options.include && options.include.length > 0
                //     ? new RegExp('^' + options.include.map(p => '(?:' + p.replace(/\*/g, '[^/\\[]+') + ')').join('|') + '(?:$|[/\\[])')
                //     : null;
                // const excludeCheck = options.exclude && options.exclude.length > 0
                //     ? new RegExp('^' + options.exclude.map(p => '(?:' + p.replace(/\*/g, '[^/\\[]+') + ')').join('|') + '(?:$|[/\\[])')
                //     : null;

                let checkExecuted = false;
                const includeDescendantCheck = (descPath, metadata) => {
                    checkExecuted = true;
                    if (!transaction.production && !pathInfo.isAncestorOf(descPath)) {
                        // Double check failed
                        throw new Error(`"${descPath}" is not a descendant of "${path}" - descendantsOf must only check and return paths that are descendants`);
                    }
                    if (!filtered) { return true; }

                    // Apply include & exclude filters
                    let checkPath = descPath.slice(path.length);
                    if (checkPath[0] === '/') { checkPath = checkPath.slice(1); }
                    const checkPathInfo = new PathInfo(checkPath);
                    let include = (options.include && options.include.length > 0 
                        ? options.include.some(k => checkPathInfo.equals(k) || checkPathInfo.isDescendantOf(k))
                        : true) 
                        && (options.exclude && options.exclude.length > 0
                        ? !options.exclude.some(k => checkPathInfo.equals(k) || checkPathInfo.isDescendantOf(k))
                        : true);

                    // Apply child_objects filter. If metadata is not loaded, we can only skip deeper descendants here - any child object that does get through will be ignored by addDescendant
                    if (include 
                        && options.child_objects === false 
                        && (pathInfo.isParentOf(descPath) && [VALUE_TYPES.OBJECT, VALUE_TYPES.ARRAY].includes(metadata ? metadata.type : -1)
                        || PathInfo.getPathKeys(descPath).length > pathInfo.pathKeys.length + 1)
                    ) {
                        include = false;
                    }
                    return include;
                }

                const descRows = [];
                /**
                 * 
                 * @param {string} descPath 
                 * @param {ICustomStorageNode} node 
                 */
                const addDescendant = (descPath, node) => {
                    if (!checkExecuted) {
                        throw new Error(`${this._customImplementation.info} descendantsOf did not call checkCallback before addCallback`);
                    }
                    if (options.child_objects === false && [VALUE_TYPES.OBJECT, VALUE_TYPES.ARRAY].includes(node.type)) {
                        // child objects are filtered out, but this one got through because includeDescendantCheck did not have access to its metadata,
                        // which is ok because doing that might drastically improve performance in client code. Skip it now.
                        return true;
                    }
                    // Process the value
                    this._processReadNodeValue(node);
                    
                    // Add node
                    node.path = descPath;
                    descRows.push(node);

                    return true; // Keep streaming
                };

                await transaction.descendantsOf(path, { metadata: true, value: true }, includeDescendantCheck, addDescendant);

                this.debug.log(`Read node "/${path}" and ${filtered ? '(filtered) ' : ''}descendants from ${descRows.length + 1} records`.colorize(ColorStyle.magenta));

                const result = targetNode;

                const objectToArray = obj => {
                    // Convert object value to array
                    const arr = [];
                    Object.keys(obj).forEach(key => {
                        let index = parseInt(key);
                        arr[index] = obj[index];
                    });
                    return arr;                
                };

                if (targetNode.type === VALUE_TYPES.ARRAY) {
                    result.value = objectToArray(result.value);
                }

                if (targetNode.type === VALUE_TYPES.OBJECT || targetNode.type === VALUE_TYPES.ARRAY) {
                    // target node is an object or array
                    // merge with other found (child) nodes
                    const targetPathKeys = PathInfo.getPathKeys(path);
                    let value = targetNode.value;
                    for (let i = 0; i < descRows.length; i++) {
                        const otherNode = descRows[i];
                        const pathKeys = PathInfo.getPathKeys(otherNode.path);
                        const trailKeys = pathKeys.slice(targetPathKeys.length);
                        let parent = value;
                        for (let j = 0 ; j < trailKeys.length; j++) {
                            console.assert(typeof parent === 'object', 'parent must be an object/array to have children!!');
                            const key = trailKeys[j];
                            const isLast = j === trailKeys.length-1;
                            const nodeType = isLast 
                                ? otherNode.type 
                                : typeof trailKeys[j+1] === 'number'
                                    ? VALUE_TYPES.ARRAY
                                    : VALUE_TYPES.OBJECT;
                            let nodeValue;
                            if (!isLast) {
                                nodeValue = nodeType === VALUE_TYPES.OBJECT ? {} : [];
                            }
                            else {
                                nodeValue = otherNode.value;
                                if (nodeType === VALUE_TYPES.ARRAY) {
                                    nodeValue = objectToArray(nodeValue);
                                }
                            }
                            if (key in parent) {
                                // Merge with parent
                                const mergePossible = typeof parent[key] === typeof nodeValue && [VALUE_TYPES.OBJECT, VALUE_TYPES.ARRAY].includes(nodeType);
                                if (!mergePossible) {
                                    // Ignore the value in the child record, see issue #20: "Assertion failed: Merging child values can only be done if existing and current values are both an array or object"
                                    this.debug.error(`The value stored in node "${otherNode.path}" cannot be merged with the parent node, value will be ignored. This error should disappear once the target node value is updated. See issue #20 for more information`);
                                }
                                else {
                                    Object.keys(nodeValue).forEach(childKey => {
                                        console.assert(!(childKey in parent[key]), 'child key is in parent value already?! HOW?!');
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
                    throw new Error(`multiple records found for non-object value!`);
                }

                // Post process filters to remove any data that got though because they were
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
                            console.assert(Object.keys(result.value[key]).length === 0);
                            delete result.value[key];
                        }
                    })
                }

                if (options.include) {
                    // TODO: remove any unselected children that did get through
                }

                if (options.exclude) {
                    const process = (obj, keys) => {
                        if (typeof obj !== 'object') { return; }
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
                        const checkKeys = PathInfo.getPathKeys(path);
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

    /**
     * 
     * @param {string} path 
     * @param {object} [options]
     * @param {CustomStorageTransaction} [options.transaction]
     * @param {boolean} [options.include_child_count=false] whether to include child count if node is an object or array
     * @returns {Promise<CustomStorageNodeInfo>}
     */
    async getNodeInfo(path, options) {
        options = options || {};
        const pathInfo = PathInfo.get(path);
        const transaction = options.transaction || await this._customImplementation.getTransaction({ path, write: false });
        try {
            const node = await this._readNode(path, { transaction });
            const info = new CustomStorageNodeInfo({ 
                path, 
                key: typeof pathInfo.key === 'string' ? pathInfo.key : null,
                index: typeof pathInfo.key === 'number' ? pathInfo.key : null,
                type: node ? node.type : 0, 
                exists: node !== null,
                address: node ? new CustomStorageNodeAddress(path) : null,
                created: node ? new Date(node.created) : null,
                modified: node ? new Date(node.modified) : null,
                revision: node ? node.revision : null,
                revision_nr: node ? node.revision_nr : null
            });

            if (!node && path !== '') {
                // Try parent node

                const lockPath = await transaction.moveToParentPath(pathInfo.parentPath);
                console.assert(lockPath === pathInfo.parentPath, `transaction.moveToParentPath() did not move to the right parent path of "${path}"`)
                const parent = await this._readNode(pathInfo.parentPath, { transaction });
                if (parent && [VALUE_TYPES.OBJECT, VALUE_TYPES.ARRAY].includes(parent.type) && pathInfo.key in parent.value) {
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
                if ([VALUE_TYPES.ARRAY, VALUE_TYPES.OBJECT].includes(info.valueType) && info.address) {
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
    /**
     * 
     * @param {string} path 
     * @param {any} value
     * @param {object} [options]
     * @param {string} [options.assert_revision]
     * @param {CustomStorageTransaction} [options.transaction]
     * @param {boolean} [options.suppress_events=false]
     * @param {any} [options.context]
     * @returns {Promise<CustomStorageNodeInfo>}
     */
    async setNode(path, value, options = { suppress_events: false, context: null }) {        
        const pathInfo = PathInfo.get(path);
        const transaction = options.transaction || await this._customImplementation.getTransaction({ path, write: true });
        try {

            if (path === '') {
                if (value === null || typeof value !== 'object' || value instanceof Array || value instanceof ArrayBuffer || ('buffer' in value && value.buffer instanceof ArrayBuffer)) {
                    throw new Error(`Invalid value for root node: ${value}`);
                }
                await this._writeNodeWithTracking('', value, { merge: false, transaction, suppress_events: options.suppress_events, context: options.context })
            }
            else if (typeof options.assert_revision !== 'undefined') {
                const info = await this.getNodeInfo(path, { transaction })
                if (info.revision !== options.assert_revision) {
                    throw new NodeRevisionError(`revision '${info.revision}' does not match requested revision '${options.assert_revision}'`);
                }
                if (info.address && info.address.path === path && value !== null && !this.valueFitsInline(value)) {
                    // Overwrite node
                    await this._writeNodeWithTracking(path, value, { merge: false, transaction, suppress_events: options.suppress_events, context: options.context });
                }
                else {
                    // Update parent node
                    const lockPath = await transaction.moveToParentPath(pathInfo.parentPath);
                    console.assert(lockPath === pathInfo.parentPath, `transaction.moveToParentPath() did not move to the right parent path of "${path}"`)
                    await this._writeNodeWithTracking(pathInfo.parentPath, { [pathInfo.key]: value }, { merge: true, transaction, suppress_events: options.suppress_events, context: options.context });
                }
            }
            else {
                // Delegate operation to update on parent node
                const lockPath = await transaction.moveToParentPath(pathInfo.parentPath);
                console.assert(lockPath === pathInfo.parentPath, `transaction.moveToParentPath() did not move to the right parent path of "${path}"`)
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
    /**
     * 
     * @param {string} path 
     * @param {*} updates 
     * @param {object} [options] 
     * @param {CustomStorageTransaction} [options.transaction]
     * @param {boolean} [options.suppress_events=false]
     * @param {any} [options.context]
     */
    async updateNode(path, updates, options = { suppress_events: false, context: null }) {

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
            const pathInfo = PathInfo.get(path);
            if (nodeInfo.exists && nodeInfo.address && nodeInfo.address.path === path) {
                // Node exists and is stored in its own record.
                // Update it
                await this._writeNodeWithTracking(path, updates, { transaction, merge: true, suppress_events: options.suppress_events, context: options.context });
            }
            else if (nodeInfo.exists) {
                // Node exists, but is stored in its parent node.
                const pathInfo = PathInfo.get(path);
                const lockPath = await transaction.moveToParentPath(pathInfo.parentPath);
                console.assert(lockPath === pathInfo.parentPath, `transaction.moveToParentPath() did not move to the right parent path of "${path}"`)
                await this._writeNodeWithTracking(pathInfo.parentPath, { [pathInfo.key]: updates }, { transaction, merge: true, suppress_events: options.suppress_events, context: options.context });
            }
            else {
                // The node does not exist, it's parent doesn't have it either. Update the parent instead
                const lockPath = await transaction.moveToParentPath(pathInfo.parentPath);
                console.assert(lockPath === pathInfo.parentPath, `transaction.moveToParentPath() did not move to the right parent path of "${path}"`)
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

module.exports = {
    CustomStorageNodeAddress,
    CustomStorageNodeInfo,
    CustomStorage,
    CustomStorageSettings,
    CustomStorageHelpers,
    CustomStorageTransaction,
    ICustomStorageNodeMetaData,
    ICustomStorageNode
}