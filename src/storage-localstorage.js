const { debug, ID, PathReference, PathInfo, ascii85 } = require('acebase-core');
const { NodeInfo } = require('./node-info');
const { VALUE_TYPES } = require('./node-value-types');
const { Storage, StorageSettings } = require('./storage');

class LocalStorageSettings extends StorageSettings {
    constructor(settings) {
        super(settings);
        settings = settings || {};
        this.session = settings.session === true; // Whether to use sessionStorage instead of localStorage
        this.provider = typeof settings.provider === 'object' ? settings.provider : null;
    }
};

class LocalStorageNodeAddress {
    constructor(containerPath) {
        this.path = containerPath;
    }
}

class LocalStorageNodeInfo extends NodeInfo {
    constructor(info) {
        super(info);

        /** @type {LocalStorageNodeAddress} */
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

class LocalStorage extends Storage {

    /**
     * 
     * @param {string} dbname 
     * @param {LocalStorageSettings} settings 
     */
    constructor(dbname, settings) {
        super(dbname, settings);

        this._init();
    }

    _init() {
        if (this.settings.provider !== null && typeof this.settings.provider === 'object') {
            // Custom localStorage implementation. Implemented for testing on Node.js without having to add dependency to project
            this._localStorage = this.settings.provider;
        }
        else {
            if (!this.settings.session && typeof localStorage === 'undefined') {
                throw new Error(`No localStorage available. If you are on Node: npm i node-localstorage`);
            }
            if (this.settings.session === true && typeof sessionStorage === 'undefined') {
                throw new Error(`No sessionStorage available`);
            }
            this._localStorage = this.settings.session === true ? sessionStorage : localStorage;
        }

        debug.log(`Database "${this.name}" details:`.intro);
        debug.log(`- Type: LocalStorage`);
        debug.log(`- Max inline value size: ${this.settings.maxInlineValueSize}`.intro);

        // Create root node if it's not there yet
        return this.getNodeInfo('')
        .then(info => {
            if (!info.exists) {
                return this._writeNode('', {});
            }
        })
        .then(() => {
            return this.indexes.load();
        })
        .then(() => {
            this.emit('ready');
        });
    }

    get _keyPrefix() {
        return `${this.name}.acebase::`;
    }
    _getPathFromKey(key) {
        return key.slice(this._keyPrefix.length);
    }
    _getKeyFromPath(path) {
        return `${this._keyPrefix}${path}`;
    }

    /**
     * 
     * @param {string} path 
     * @param {object} info 
     * @param {number} info.type
     * @param {any} info.value
     * @param {string} info.revision
     * @param {number} info.revision_nr
     * @param {number} info.created
     * @param {number} info.modified
     */
    _storeNode(path, info) {
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
                return { type: VALUE_TYPES.REFERENCE, value: child.path };
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
        if (info.type === VALUE_TYPES.ARRAY && info.value instanceof Array) {
            // Convert array to object with numeric properties
            // NOTE: caller should have done this already
            console.warn(`Unprocessed array. ${unprocessed}`);
            const obj = {};
            for (let i = 0; i < info.value.length; i++) {
                obj[i] = info.value[i];
            }
            info.value = obj;
        }
        if (info.type === VALUE_TYPES.BINARY && typeof info.value !== 'string') {
            console.warn(`Unprocessed binary value. ${unprocessed}`);
            info.value = ascii85.encode(info.value);
        }
        if (info.type === VALUE_TYPES.REFERENCE && info.value instanceof PathReference) {
            console.warn(`Unprocessed path reference. ${unprocessed}`);
            info.value = info.value.path;
        }
        if ([VALUE_TYPES.OBJECT, VALUE_TYPES.ARRAY].includes(info.type)) {
            const original = info.value;
            info.value = {};
            // If original is an array, it'll automatically be converted to an object now
            Object.keys(original).forEach(key => {
                info.value[key] = getTypedChildValue(original[key]);
            });
        }

        // Now stringify it for storage
        const json = JSON.stringify(info);
        this._localStorage.setItem(this._getKeyFromPath(path), json);
    }

    _readNode(path) {
        // deserialize a stored value (always an object with "type", "value", "revision", "revision_nr", "created", "modified")
        let val = this._localStorage.getItem(this._getKeyFromPath(path));
        if (val === null) { return null; }
        val = JSON.parse(val);

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

        const node = {
            type: val.type,
            value: val.value,
            revision: val.revision,
            revision_nr: val.revision_nr,
            created: val.created,
            modified: val.modified
        };

        switch (val.type) {

            // case VALUE_TYPES.ARRAY: {
            //     // Array is stored as object with numeric properties
            //     // check if any value needs to be converted
            //     const arr = val.value;
            //     for (let i = 0; i < arr.length; i++) {
            //         let item = arr[i];
            //         if (typeof item === 'object' && 'type' in object) {
            //             arr[i] = getTypedChildValue(item);
            //         }
            //     }
            //     return { type: val.type, value: arr };
            // }

            case VALUE_TYPES.ARRAY:
            case VALUE_TYPES.OBJECT: {
                // check if any value needs to be converted
                // NOTE: Arrays are stored with numeric properties
                const obj = val.value;
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
                node.value = ascii85.decode(val.value);
                break;
            }

            case VALUE_TYPES.STRING: {
                node.value = val.value;
                break;
            }

            case VALUE_TYPES.REFERENCE: {
                node.value = new PathReference(val.value);
                break;
            }

            default:
                throw new Error(`Invalid standalone record value type`); // should never happen
        }
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
     * @param {object} [options] 
     * @returns {Promise<void>}
     */
    _writeNode(path, value, options = { merge: false, revision: null }) {
        if (this.valueFitsInline(value) && path !== '') {
            throw new Error(`invalid value to store in its own node`);
        }
        else if (path === '' && (typeof value !== 'object' || value instanceof Array)) {
            throw new Error(`Invalid root node value. Must be an object`)
        }

        // Get info about current node at path
        const currentRow = this._readNode(path);
        const newRevision = (options && options.revision) || ID.generate();
        let mainNode = {
            type: VALUE_TYPES.OBJECT,
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
            Object.keys(value).forEach(key => {
                const val = value[key];
                delete mainNode.value[key]; // key is being overwritten, moved from inline to dedicated, or deleted. TODO: check if this needs to be done SQLite & MSSQL implementations too
                if (val === null) { //  || typeof val === 'undefined'
                    // This key is being removed
                    return;
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
        if (currentRow) {
            // update
            debug.log(`Node "/${path}" is being ${options.merge ? 'updated' : 'overwritten'}`.cyan);

            // If existing is an array or object, we have to find out which children are affected
            if (currentIsObjectOrArray || newIsObjectOrArray) {

                // Get current child nodes in dedicated child records
                const pathInfo = PathInfo.get(path);
                const keys = [];
                for (let i = 0; i < this._localStorage.length; i++) {
                    const key = this._localStorage.key(i);
                    if (!key.startsWith(this._keyPrefix)) { continue; }
                    let otherPath = this._getPathFromKey(key);
                    if (pathInfo.isParentOf(otherPath)) {
                        const key = PathInfo.get(otherPath).key;
                        keys.push(key);
                    }
                }
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
                    update: children.new.filter(key => children.current.includes(key)),
                    delete: options && options.merge ? Object.keys(value).filter(key => value[key] === null) : children.current.filter(key => !children.new.includes(key)),
                };

                // (over)write all child nodes that must be stored in their own record
                Object.keys(childNodeValues).map(key => {
                    const childPath = PathInfo.getChildPath(path, key);
                    const childValue = childNodeValues[key];
                    this._writeNode(childPath, childValue, { revision: newRevision, merge: false });
                });

                // Delete all child nodes that were stored in their own record, but are being removed 
                // Also delete nodes that are being moved from a dedicated record to inline
                const movingNodes = keys.filter(key => key in mainNode.value); // moving from dedicated to inline value
                const deleteDedicatedKeys = changes.delete.concat(movingNodes);
                deleteDedicatedKeys.forEach(key => {
                    const childPath = PathInfo.getChildPath(path, key);
                    this._deleteNode(childPath);
                });
            }

            // Update main node
            this._storeNode(path, {
                type: mainNode.type,
                value: mainNode.value,
                revision: currentRow.revision,
                revision_nr: currentRow.revision_nr + 1,
                created: currentRow.created,
                modified: Date.now()
            });
        }
        else {
            // Current node does not exist, create it and any child nodes
            // write all child nodes that must be stored in their own record
            debug.log(`Node "/${path}" is being created`.cyan);

            Object.keys(childNodeValues).map(key => {
                const childPath = PathInfo.getChildPath(path, key);
                const childValue = childNodeValues[key];
                this._writeNode(childPath, childValue, { revision: newRevision, merge: false });
            });

            // Create current node
            this._storeNode(path, {
                type: mainNode.type,
                value: mainNode.value,
                revision: newRevision,
                revision_nr: 1,
                created: Date.now(),
                modified: Date.now()
            });
        }
    }

    /**
     * Deletes (dedicated) node and all subnodes without checking for existence. Use with care - all removed nodes will lose their revision stats! DOES NOT REMOVE INLINE CHILD NODES!
     * @param {string} path 
     */
    _deleteNode(path) {
        this._localStorage.removeItem(this._getKeyFromPath(path)); // Remove main node
        for (let i = 0; i < this._localStorage.length; i++) {
            const key = this._localStorage.key(i);
            if (!key.startsWith(this._keyPrefix)) { continue; }
            let otherPath = this._getPathFromKey(key);
            if (pathInfo.isParentOf(otherPath)) {
                localStorage.removeItem(otherPath); // Remove child node
            }
        }
    }

    /**
     * Enumerates all children of a given Node for reflection purposes
     * @param {string} path 
     * @param {string[]|number[]} [options.keyFilter]
     */
    getChildren(path, options = { keyFilter: undefined, tid: undefined }) {
        // return generator
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
        const start = () => {
            let lock, canceled = false;
            const tid = (options && options.tid) || ID.generate();
            return this.nodeLocker.lock(path, tid, false, 'getChildren')
            .then(l => {
                lock = l;

                let row = this._localStorage.getItem(this._getKeyFromPath(path));
                if (!row) { throw new NodeNotFoundError(`Node "/${path}" does not exist`); }
                row = JSON.parse(row);

                if (![VALUE_TYPES.OBJECT, VALUE_TYPES.ARRAY].includes(row.type)) {
                    // No children
                    return;
                }
                const isArray = row.type === VALUE_TYPES.ARRAY;
                const value = row.value;
                let keys = Object.keys(value);
                if (options.keyFilter) {
                    keys = keys.filter(key => options.keyFilter.includes(key));
                }
                const pathInfo = PathInfo.get(path);
                keys.length > 0 && keys.every(key => {
                    let child = this._getTypeFromStoredValue(value[key]);

                    const info = new LocalStorageNodeInfo({
                        path: pathInfo.childPath(key),
                        key: isArray ? null : key,
                        index: isArray ? key : null,
                        type: child.type,
                        address: null,
                        exists: true,
                        value: child.value,
                        revision: row.revision,
                        revision_nr: row.revision_nr,
                        created: row.created,
                        modified: row.modified
                    });

                    canceled = callback(info) === false;
                    return !canceled; // stop .every loop if canceled
                });
                if (canceled) {
                    return;
                }

                // Go on... get other children
                const childRows = [];
                for (let i = 0; i < this._localStorage.length; i++) {
                    const key = this._localStorage.key(i);
                    if (!key.startsWith(this._keyPrefix)) { continue; }
                    let otherPath = this._getPathFromKey(key);
                    if (pathInfo.isParentOf(otherPath)) {
                        const key = PathInfo.get(otherPath).key;
                        if (options.keyFilter && !options.keyFilter.includes(key)) { 
                            continue; // ignore this one
                        }

                        let row = this._readNode(otherPath);
                        childRows.push({
                            type: row.type,
                            path: otherPath,
                            revision: row.revision,
                            revision_nr: row.revision_nr,
                            created: row.created,
                            modified: row.modified
                        });
                    }
                }

                const handleNextChild = i => {
                    const row = childRows[i];
                    if (!row) { return; }

                    const key = PathInfo.get(row.path).key;
                    if (options.keyFilter && !options.keyFilter.includes(key)) { 
                        return handleNextChild(i+1); 
                    }

                    const info = new LocalStorageNodeInfo({
                        path: row.path,
                        type: row.type,
                        key: isArray ? null : key,
                        index: isArray ? key : null,
                        address: new LocalStorageNodeAddress(row.path), //new SqlNodeAddress(row.path),
                        exists: true,
                        value: null, // not loaded
                        revision: row.revision,
                        revision_nr: row.revision_nr,
                        created: new Date(row.created),
                        modified: new Date(row.modified)
                    });

                    canceled = callback(info) === false;
                    if (!canceled) {
                        return handleNextChild(i+1);
                    }
                }
                return handleNextChild(0);
            })
            .then(() => {
                lock.release();
                return canceled;
            })
            .catch(err => {
                lock.release();
                throw err;
            });            
        }; // start()
        return generator;
    }

    getNode(path, options = { include: undefined, exclude: undefined, child_objects: true, tid: undefined }) {
        // path = path.replace(/'/g, '');  // prevent sql injection, remove single quotes

        const tid = (options && options.tid )|| ID.generate();
        let lock;
        return this.nodeLocker.lock(path, tid, false, 'getNode')
        .then(l => {
            lock = l;

            // Get path, path/* and path[*
            const filtered = options && (options.include || options.exclude || options.child_objects === false);
            const pathInfo = PathInfo.get(path);
            const targetRow = this._readNode(path);
            if (!targetRow) {
                // Lookup parent node
                if (path === '') { return null; } // path is root. There is no parent.
                return lock.moveToParent()
                .then(parentLock => {
                    lock = parentLock;
                    let parentNode = this._readNode(pathInfo.parentPath);
                    if ([VALUE_TYPES.OBJECT, VALUE_TYPES.ARRAY].includes(parentNode.type) && pathInfo.key in parentNode) {
                        return parentNode[pathInfo.key];
                    }
                    return null;
                });
            }

            const includeCheck = options.include 
                ? new RegExp('^' + options.include.map(p => '(?:' + p.replace(/\*/g, '[^/\\[]+') + ')').join('|') + '(?:$|[/\\[])')
                : null;
            const excludeCheck = options.exclude 
                ? new RegExp('^' + options.exclude.map(p => '(?:' + p.replace(/\*/g, '[^/\\[]+') + ')').join('|') + '(?:$|[/\\[])')
                : null;

            const childRows = [];
            for (let i = 0; i < this._localStorage.length; i++) {
                const key = this._localStorage.key(i);
                if (!key.startsWith(this._keyPrefix)) { continue; }
                let otherPath = this._getPathFromKey(key);
                let include = false;
                if (pathInfo.isAncestorOf(otherPath)) {
                    
                    // Apply include & exclude filters
                    let checkPath = otherPath.slice(path.length);
                    if (checkPath[0] === '/') { checkPath = checkPath.slice(1); }
                    include = (includeCheck ? includeCheck.test(checkPath) : true) 
                        && (excludeCheck ? !excludeCheck.test(checkPath) : true);
                }

                const childRow = this._readNode(otherPath);

                // Apply child_objects filter
                if (options.child_objects === false 
                    && (pathInfo.isParentOf(otherPath) && [VALUE_TYPES.OBJECT, VALUE_TYPES.ARRAY].includes(childNode.type)
                    || PathInfo.getPathKeys(otherPath).length > pathInfo.pathKeys.length + 1)) {
                    include = false;
                }

                if (include) {
                    childRow.path = otherPath;
                    childRows.push(childRow);                        
                }
            }

            debug.log(`Read node "/${path}" and ${filtered ? '(filtered) ' : ''}children from ${childRows.length + 1} records`.magenta);

            const result = {
                revision: targetRow ? targetRow.revision : null,
                value: targetRow.value
            };

            const objectToArray = obj => {
                // Convert object value to array
                const arr = [];
                Object.keys(obj).forEach(key => {
                    let index = parseInt(key);
                    arr[index] = obj[index];
                });
                return arr;                
            };

            if (targetRow.type === VALUE_TYPES.ARRAY) {
                result.value = objectToArray(result.value);
            }

            if (targetRow.type === VALUE_TYPES.OBJECT || targetRow.type === VALUE_TYPES.ARRAY) {
                // target node is an object or array
                // merge with other found (child) records
                const targetPathKeys = PathInfo.getPathKeys(path);
                let value = targetRow.value;
                for (let i = 0; i < childRows.length; i++) {
                    const otherRow = childRows[i];
                    const pathKeys = PathInfo.getPathKeys(otherRow.path);
                    const trailKeys = pathKeys.slice(targetPathKeys.length);
                    let parent = value;
                    for (let j = 0 ; j < trailKeys.length; j++) {
                        console.assert(typeof parent === 'object', 'parent must be an object/array to have children!!');
                        const key = trailKeys[j];
                        const isLast = j === trailKeys.length-1;
                        const nodeType = isLast 
                            ? otherRow.type 
                            : typeof trailKeys[j+1] === 'number'
                                ? VALUE_TYPES.ARRAY
                                : VALUE_TYPES.OBJECT;
                        let nodeValue;
                        if (!isLast) {
                            nodeValue = nodeType === VALUE_TYPES.OBJECT ? {} : [];
                        }
                        else {
                            nodeValue = otherRow.value;
                            if (nodeType === VALUE_TYPES.ARRAY) {
                                nodeValue = objectToArray(nodeValue);
                            }
                        }
                        if (key in parent) {
                            // Merge with parent
                            console.assert(typeof parent[key] === typeof nodeValue && [VALUE_TYPES.OBJECT, VALUE_TYPES.ARRAY].includes(nodeType), 'Merging child values can only be done if existing and current values are both an array or object');
                            Object.keys(nodeValue).forEach(childKey => {
                                console.assert(!(childKey in parent[key]), 'child key is in parent value already?! HOW?!');
                                parent[key][childKey] = nodeValue[childKey];
                            });
                        }
                        else {
                            parent[key] = nodeValue;
                        }
                        parent = parent[key];
                    }
                }
            }
            else if (childRows.length > 0) {
                throw new Error(`multiple records found for non-object value!`);
            }

            lock.release();

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
        })
        .catch(err => {
            lock.release();
            throw err;
        });
    }

    /**
     * 
     * @param {string} path 
     * @param {*} options 
     * @returns {Promise<LocalStorageNodeInfo>}
     */
    getNodeInfo(path, options = { tid: undefined }) {
        const pathInfo = PathInfo.get(path);
        const tid = (options && options.tid) || ID.generate();
        let lock;
        return this.nodeLocker.lock(path, tid, false, 'getNodeInfo')
        .then(l => {
            lock = l;

            const node = this._readNode(path);
            const info = new LocalStorageNodeInfo({ 
                path, 
                key: typeof pathInfo.key === 'string' ? pathInfo.key : null,
                index: typeof pathInfo.key === 'number' ? pathInfo.key : null,
                type: node ? node.type : 0, 
                exists: node !== null,
                address: node ? new LocalStorageNodeAddress(path) : null,
                created: node ? new Date(node.created) : null,
                modified: node ? new Date(node.modified) : null,
                revision: node ? node.revision : null,
                revision_nr: node ? node.revision_nr : null
            });

            if (node || path === '') {
                return info;
            }

            // Try parent node
            return lock.moveToParent()
            .then(parentLock => {
                lock = parentLock;
                const parent = this._readNode(pathInfo.parentPath);
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
                return info;
            })
        })
        .then(info => {
            lock.release();
            return info;
        })
        .catch(err => {
            lock && lock.release();
            throw err;
        });
    }

    // TODO: Move to Storage base class?
    removeNode(path, options = { tid: undefined }) {
        if (path === '') { 
            return Promise.reject(new Error(`Cannot remove the root node`)); 
        }
        
        const pathInfo = PathInfo.get(path);
        const tid = (options && options.tid) || ID.generate();
        return this.nodeLocker.lock(pathInfo.parentPath, tid, true, 'removeNode')
        .then(lock => {
            return this.updateNode(pathInfo.parentPath, { [pathInfo.key]: null }, { tid })
            .then(result => {
                lock.release();
                return result;
            })
            .catch(err => {
                lock.release();
                throw err;
            });            
        });
    }

    // TODO: Move to Storage base class?
    setNode(path, value, options = { assert_revision: undefined, tid: undefined }) {        
        const pathInfo = PathInfo.get(path);

        let lock;
        const tid = (options && options.tid) || ID.generate();
        return this.nodeLocker.lock(path, tid, true, 'setNode')
        .then(l => {
            lock = l;

            if (path === '') {
                if (value === null || typeof value !== 'object' || value instanceof Array || value instanceof ArrayBuffer || ('buffer' in value && value.buffer instanceof ArrayBuffer)) {
                    return Promise.reject(new Error(`Invalid value for root node: ${value}`));
                }

                return this._writeNodeWithTracking('', value, { merge: false, tid })
            }

            if (options && typeof options.assert_revision !== 'undefined') {
                return this.getNodeInfo(path, { tid: lock.tid })
                .then(info => {
                    if (info.revision !== options.assert_revision) {
                        throw new NodeRevisionError(`revision '${info.revision}' does not match requested revision '${options.assert_revision}'`);
                    }
                    if (info.address && info.address.path === path && !this.valueFitsInline(value)) {
                        // Overwrite node
                        return this._writeNodeWithTracking(path, value, { merge: false, tid });
                    }
                    else {
                        // Update parent node
                        return lock.moveToParent()
                        .then(parentLock => {
                            lock = parentLock;
                            return this._writeNodeWithTracking(pathInfo.parentPath, { [pathInfo.key]: value }, { merge: true, tid });
                        });
                    }
                })
            }
            else {
                // Delegate operation to update on parent node
                return lock.moveToParent()
                .then(parentLock => {
                    lock = parentLock;                
                    return this.updateNode(pathInfo.parentPath, { [pathInfo.key]: value }, { tid });
                });
            }
        })
        .then(result => {
            lock.release();
            return result;
        })
        .catch(err => {
            lock.release();
            throw err;
        });        
    }

    // TODO: Move to Storage base class?
    updateNode(path, updates, options = { tid: undefined }) {

        if (typeof updates !== 'object') { //  || Object.keys(updates).length === 0
            return Promise.reject(new Error(`invalid updates argument`)); //. Must be a non-empty object or array
        }

        const tid = (options && options.tid) || ID.generate();
        let lock;
        return this.nodeLocker.lock(path, tid, true, 'updateNode')
        .then(l => {
            lock = l;
            // Get info about current node
            return this.getNodeInfo(path, { tid: lock.tid });    
        })
        .then(nodeInfo => {
            const pathInfo = PathInfo.get(path);
            if (nodeInfo.exists && nodeInfo.address && nodeInfo.address.path === path) {
                // Node exists and is stored in its own record.
                // Update it
                return this._writeNodeWithTracking(path, updates, { merge: true, tid });
            }
            else if (nodeInfo.exists) {
                // Node exists, but is stored in its parent node.
                const pathInfo = PathInfo.get(path);
                return lock.moveToParent()
                .then(parentLock => {
                    lock = parentLock;
                    return this._writeNodeWithTracking(pathInfo.parentPath, { [pathInfo.key]: value }, { merge: true, tid });
                });
            }
            else {
                // The node does not exist, it's parent doesn't have it either. Update the parent instead
                return lock.moveToParent()
                .then(parentLock => {
                    lock = parentLock;
                    return this.updateNode(pathInfo.parentPath, { [pathInfo.key]: updates }, { tid });
                });
            }
        })
        .then(result => {
            lock.release();
            return result;
        })
        .catch(err => {
            lock.release();
            throw err;
        });        
    }
}

module.exports = {
    LocalStorageNodeAddress,
    LocalStorageNodeInfo,
    LocalStorage,
    LocalStorageSettings    
}