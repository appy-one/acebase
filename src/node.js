const { Storage } = require('./storage');
const { NodeInfo } = require('./node-info');
const { VALUE_TYPES } = require('./node-value-types');

class Node {
    static get VALUE_TYPES() { return VALUE_TYPES; }

    /**
     * @param {Storage} storage 
     * @param {string} path 
     * @param {object} [options]
     * @param {boolean} [options.no_cache=false] Whether to use cache for lookups
     * @param {boolean} [options.include_child_count=false] whether to include child count
     * @returns {Promise<NodeInfo>} promise that resolves with info about the node
     */
    static async getInfo(storage, path, options = { no_cache: false, include_child_count: false }) {

        // Check if the info has been cached
        const cacheable = options && !options.no_cache && !options.include_child_count;
        if (cacheable) {
            let cachedInfo = storage.nodeCache.find(path);
            if (cachedInfo) {
                return cachedInfo;
            }
        }

        // Cache miss. Check if node is being looked up already
        const info = await storage.getNodeInfo(path, { include_child_count: options.include_child_count });
        if (cacheable) {
            storage.nodeCache.update(info);
        }
        return info;
    }

    /**
     * Updates or overwrite an existing node, or creates a new node. Handles storing of subnodes, 
     * freeing old node and subnodes allocation, updating/creation of parent nodes, and removing 
     * old cache entries. Triggers event notifications and index updates after the update succeeds.
     * @param {Storage} storage 
     * @param {string} path 
     * @param {any} value Any value will do. If the value is small enough to be stored in a parent record, it will take care of it
     * @param {object} [options]
     * @param {boolean} [options.merge=true] whether to merge or overwrite the current value if node exists
     * @param {boolean} [options.suppress_events=false] whether to suppress the execution of event subscriptions
     * @param {any} [options.context=null] Context to be passed along with data events
     */
    static update(storage, path, value, options = { merge: true, suppress_events: false, context: null }) {
        if (options.merge) {
            return storage.updateNode(path, value, { suppress_events: options.suppress_events, context: options.context });
        }
        else {
            return storage.setNode(path, value, { suppress_events: options.suppress_events, context: options.context });
        }
    }

    /** Checks if a node exists
     * 
     * @param {Storage} storage 
     * @param {string} path 
     * @returns {Promise<boolean>}
     */
    static async exists(storage, path) {
        const nodeInfo = await storage.getNodeInfo(path);
        return nodeInfo.exists;
    }

    /**
     * Gets the value of a node
     * @param {Storage} storage 
     * @param {string} path 
     * @param {object} [options] when omitted retrieves all nested data. If include is set to an array of keys it will only return those children. If exclude is set to an array of keys, those values will not be included
     * @param {string[]} [options.include] keys to include
     * @param {string[]} [options.exclude] keys to exclude
     * @param {boolean} [options.child_objects=true] whether to include child objects
     * @returns {Promise<any>}
     */    
    static getValue(storage, path, options = { include: undefined, exclude: undefined, child_objects: true }) {
        if (!options) { options = {}; }
        if (typeof options.include !== "undefined" && !(options.include instanceof Array)) {
            throw new TypeError(`options.include must be an array of key names`);
        }
        if (typeof options.exclude !== "undefined" && !(options.exclude instanceof Array)) {
            throw new TypeError(`options.exclude must be an array of key names`);
        }
        if (["undefined","boolean"].indexOf(typeof options.child_objects) < 0) {
            throw new TypeError(`options.child_objects must be a boolean`);
        }
        return storage.getNodeValue(path, options);
    }

    // Appears unused:
    // /**
    //  * Gets info about a child node by delegating to getChildren with keyFilter
    //  * @param {Storage} storage 
    //  * @param {string} path 
    //  * @param {string|number} childKeyOrIndex 
    //  * @returns {Promise<NodeInfo>}
    //  */
    // static async getChildInfo(storage, path, childKeyOrIndex) {
    //     let childInfo;
    //     await storage.getChildren(path, { keyFilter: [childKeyOrIndex] })
    //     .next(info => {
    //         childInfo = info;
    //     })
    //     return childInfo || { exists: false };
    // }

    /**
     * Enumerates all children of a given Node for reflection purposes
     * @param {Storage} storage 
     * @param {string} path 
     * @param {string[]|number[]} keyFilter
     * @returns {{ next(child: NodeInfo) => Promise<void>}} returns a generator object that calls .next for each child until the .next callback returns false
     */
    static getChildren(storage, path, keyFilter = undefined) {
        return storage.getChildren(path, { keyFilter });
    }

    // /**
    //  * Removes a Node. Short for Node.update with value null
    //  * @param {Storage} storage 
    //  * @param {string} path 
    //  */
    // static remove(storage, path) {
    //     return storage.removeNode(path);
    // }

    /**
     * Sets the value of a Node. Short for Node.update with option { merge: false }
     * @param {Storage} storage 
     * @param {string} path 
     * @param {any} value 
     * @param {any} [options]
     * @param {any} [options.context=null]
     */
    static set(storage, path, value, options = { context: null }) {
        return Node.update(storage, path, value, { merge: false, context: options.context });
    }

    /**
     * Performs a transaction on a Node
     * @param {Storage} storage 
     * @param {string} path 
     * @param {(currentValue: any) => Promise<any>} callback callback is called with the current value. The returned value (or promise) will be used as the new value. When the callbacks returns undefined, the transaction will be canceled. When callback returns null, the node will be removed.
     * @param {any} [options]
     * @param {boolean} [options.suppress_events=false] whether to suppress the execution of event subscriptions
     * @param {any} [options.context=null]
     */
    static transaction(storage, path, callback, options = { suppress_events: false, context: null }) {
        return storage.transactNode(path, callback, { suppress_events: options.suppress_events, context: options.context });
    }

    /**
     * Check if a node's value matches the passed criteria
     * @param {Storage} storage
     * @param {string} path
     * @param {Array<{ key: string, op: string, compare: string }>} criteria criteria to test
     * @returns {Promise<boolean>} returns a promise that resolves with a boolean indicating if it matched the criteria
     */
    static matches(storage, path, criteria, options) {
        return storage.matchNode(path, criteria, options);
    }
}

class NodeChange {
    static get CHANGE_TYPE() {
        return {
            UPDATE: 'update',
            DELETE: 'delete',
            INSERT: 'insert'
        };
    }

    /**
     * 
     * @param {string|number} keyOrIndex 
     * @param {string} changeType 
     * @param {any} oldValue 
     * @param {any} newValue 
     */
    constructor(keyOrIndex, changeType, oldValue, newValue) {
        this.keyOrIndex = keyOrIndex;
        this.changeType = changeType;
        this.oldValue = oldValue;
        this.newValue = newValue;
    }
}

class NodeChangeTracker {
    /**
     * 
     * @param {string} path 
     */
    constructor(path) {
        this.path = path;
        /** @type {NodeChange[]} */ 
        this._changes = [];
        /** @type {object|Array} */ 
        this._oldValue = undefined;
        this._newValue = undefined;
    }

    addDelete(keyOrIndex, oldValue) {
        const change = new NodeChange(keyOrIndex, NodeChange.CHANGE_TYPE.DELETE, oldValue, null);
        this._changes.push(change);
        return change;
    }
    addUpdate(keyOrIndex, oldValue, newValue) {
        const change = new NodeChange(keyOrIndex, NodeChange.CHANGE_TYPE.UPDATE, oldValue, newValue)
        this._changes.push(change);
        return change;
    }
    addInsert(keyOrIndex, newValue) {
        const change = new NodeChange(keyOrIndex, NodeChange.CHANGE_TYPE.INSERT, null, newValue)
        this._changes.push(change);
        return change;
    }
    add(keyOrIndex, currentValue, newValue) {
        if (currentValue === null) {
            if (newValue === null) { 
                throw new Error(`Wrong logic for node change on "${this.nodeInfo.path}/${keyOrIndex}" - both old and new values are null`);
            }
            return this.addInsert(keyOrIndex, newValue);
        }
        else if (newValue === null) {
            return this.addDelete(keyOrIndex, currentValue);
        }
        else {
            return this.addUpdate(keyOrIndex, currentValue, newValue);
        }            
    }

    get updates() {
        return this._changes.filter(change => change.changeType === NodeChange.CHANGE_TYPE.UPDATE);
    }
    get deletes() {
        return this._changes.filter(change => change.changeType === NodeChange.CHANGE_TYPE.DELETE);
    }
    get inserts() {
        return this._changes.filter(change => change.changeType === NodeChange.CHANGE_TYPE.INSERT);
    }
    get all() {
        return this._changes;
    }
    get totalChanges() {
        return this._changes.length;
    }
    get(keyOrIndex) {
        return this._changes.find(change => change.keyOrIndex === keyOrIndex);
    }
    hasChanged(keyOrIndex) {
        return !!this.get(keyOrIndex);
    }

    get newValue() {
        if (typeof this._newValue === 'object') { return this._newValue; }
        if (typeof this._oldValue === 'undefined') { throw new TypeError(`oldValue is not set`); }
        let newValue = {};
        Object.keys(this.oldValue).forEach(key => newValue[key] = this.oldValue[key]);
        this.deletes.forEach(change => delete newValue[change.key]);
        this.updates.forEach(change => newValue[change.key] = change.newValue);
        this.inserts.forEach(change => newValue[change.key] = change.newValue);
        return newValue;
    }
    set newValue(value) {
        this._newValue = value;
    }

    get oldValue() {
        if (typeof this._oldValue === 'object') { return this._oldValue; }
        if (typeof this._newValue === 'undefined') { throw new TypeError(`newValue is not set`); }
        let oldValue = {};
        Object.keys(this.newValue).forEach(key => oldValue[key] = this.newValue[key]);
        this.deletes.forEach(change => oldValue[change.key] = change.oldValue);
        this.updates.forEach(change => oldValue[change.key] = change.oldValue);
        this.inserts.forEach(change => delete oldValue[change.key]);
        return oldValue;
    }
    set oldValue(value) {
        this._oldValue = value;
    }

    get typeChanged() {
        return typeof this.oldValue !== typeof this.newValue 
            || (this.oldValue instanceof Array && !(this.newValue instanceof Array))
            || (this.newValue instanceof Array && !(this.oldValue instanceof Array));
    }

    static create(path, oldValue, newValue) {
        const changes = new NodeChangeTracker(path);
        changes.oldValue = oldValue;
        changes.newValue = newValue;

        typeof oldValue === 'object' && Object.keys(oldValue).forEach(key => {
            if (typeof newValue === 'object' && key in newValue && newValue !== null) {
                changes.add(key, oldValue[key], newValue[key]);
            }
            else {
                changes.add(key, oldValue[key], null);
            }
        });
        typeof newValue === 'object' && Object.keys(newValue).forEach(key => {
            if (typeof oldValue !== 'object' || !(key in oldValue) || oldValue[key] === null) {
                changes.add(key, null, newValue[key]);
            }
        });
        return changes;
    }
}

module.exports = {
    Node,
    NodeInfo,
    NodeChange,
    NodeChangeTracker
};