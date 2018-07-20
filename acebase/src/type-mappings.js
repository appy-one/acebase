const { cloneObject, getPathKeys, getPathInfo } = require('./utils');

/**
 * (for internal use) - gets the mapping set for a specific path
 * @param {TypeMappings} mappings
 * @param {string} path 
 */
const get = (mappings, path) => {
    // path points to the mapped (object container) location
    path = path.replace(/^\/|\/$/g, ""); // trim slashes
    // const keys = path.length > 0 ? path.split("/") : [];
    const keys = getPathKeys(path);
    const mappedPath = Object.keys(mappings).find(mpath => {
        // const mkeys = mpath.length > 0 ? mpath.split("/") : [];
        const mkeys = getPathKeys(mpath);
        if (mkeys.length !== keys.length) {
            return false; // Can't be a match
        }
        return mkeys.every((mkey, index) => {
            if (mkey === "*") { //(mkey.startsWith("${")) {
                return true; // wildcard
            }
            return mkey === keys[index];
        });
    });
    const mapping = mappings[mappedPath];
    return mapping;
};

/**
 * (for internal use) - gets the mapping set for a specific path's parent
 * @param {TypeMappings} mappings
 * @param {string} path 
 */
const map = (mappings, path) => {
   // path points to the object location, it's parent should have the mapping
//    path = path.replace(/^\/|\/$/g, ""); // trim slashes
//    const targetPath = path.substring(0, path.lastIndexOf("/"));
    const targetPath = getPathInfo(path).parent;
    if (targetPath === null) { return; }
    return get(mappings, targetPath);
};

/**
 * (for internal use) - gets all mappings set for a specific path and all subnodes
 * @param {TypeMappings} mappings
 * @param {string} entryPath 
 * @returns {Array<object>} returns array of all matched mappings in path
 */
const mapDeep = (mappings, entryPath) => {
    // returns mapping for this node, and all mappings for nested nodes
    // entryPath: "users/ewout"
    // mappingPath: "users"
    // mappingPath: "users/*/posts"
    entryPath = entryPath.replace(/^\/|\/$/g, ""); // trim slashes

    // Start with current path's parent node
    const pathInfo = getPathInfo(entryPath);
    const startPath = pathInfo.parent; //entryPath.substring(0, Math.max(entryPath.lastIndexOf("/"), entryPath.lastIndexOf("[")));
    const keys = startPath ? getPathKeys(startPath) : [];

    // Every path that starts with startPath, is a match
    const matches = Object.keys(mappings).reduce((m, mpath) => {

        //const mkeys = mpath.length > 0 ? mpath.split("/") : [];
        const mkeys = getPathKeys(mpath);
        if (mkeys.length < keys.length) {
            return m; // Can't be a match
        }
        let isMatch = true;
        if (keys.length === 0 && startPath !== null) {
            // Only match first node's children if mapping pattern is "*"
            isMatch = mkeys.length === 1 && mkeys[0] === "*";
        }
        else {
            mkeys.every((mkey, index) => {
                if (index >= keys.length) { 
                    return false; // stop .every loop
                } 
                else if (mkey === "*" || mkey === keys[index]) {
                    return true; // continue .every loop
                }
                else {
                    isMatch = false;
                    return false; // stop .every loop
                }
            });
        }

        if (isMatch) { 
            const mapping = mappings[mpath];
            m.push({ path: mpath, type: mapping }); 
        }

        return m;
    }, []);
    return matches;
};

/**
 * (for internal use) - serializes or deserializes an object using type mappings
 * @param {TypeMappings} mappings
 * @param {string} path 
 * @param {any} obj
 * @param {string} action | "serialize" or "deserialize"
 * @returns {any} returns the (de)serialized value
 */
const process = (mappings, path, obj, action) => {
    const keys = getPathKeys(path); // path.length > 0 ? path.split("/") : [];
    const m = mapDeep(mappings, path);
    const changes = [];
    m.sort((a,b) => getPathKeys(a.path).length > getPathKeys(b.path).length ? -1 : 1); // Deepest paths first
    m.forEach(mapping => {
        const mkeys = getPathKeys(mapping.path); //mapping.path.length > 0 ? mapping.path.split("/") : [];
        mkeys.push("*");
        const mTrailKeys = mkeys.slice(keys.length);

        if (mTrailKeys.length === 0) {
            if (action === "serialize") {
                // serialize this object
                obj = mapping.type.serialize(obj);
            }
            else if (action === "deserialize") {
                // deserialize this object
                obj = mapping.type.deserialize(obj);
            }
        }

        // Find all nested objects at this trail path
        const process = (parent, keys) => {
            let key = keys[0];
            let children = [];
            if (key === "*") {
                // Include all children
                children = Object.keys(parent).map(key => ({ key, val: parent[key] }));
            }
            else {
                // Get the 1 child
                let child = parent[key];
                if (typeof child === "object") {
                    children.push({ key, val: child });
                }
            }
            children.forEach(child => { 
                if (keys.length === 1) {
                    // TODO: this alters the existing object, we must build our own copy!
                    if (action === "serialize") {
                        // serialize this object
                        changes.push({ parent, key: child.key, original: parent[child.key] });
                        parent[child.key] = mapping.type.serialize(child.val);
                    }
                    else if (action === "deserialize") {
                        // deserialize this object
                        parent[child.key] = mapping.type.deserialize(child.val);
                    }
                }
                else {
                    // Dig deeper
                    process(child.val, keys.slice(1)); 
                }
            });
        };
        process(obj, mTrailKeys);
    });
    if (action === "serialize") {
        // Clone this serialized object so any types that remained
        // will become plain objects without functions, and we can restore
        // the original object's values if any mappings were processed.
        // This will also prevent circular references
        obj = cloneObject(obj);

        if (changes.length > 0) {
            // Restore the changes made to the original object
            changes.forEach(change => {
                change.parent[change.key] = change.original;
            });
        }
    }
    return obj;
};

class TypeMappingOptions {
    constructor(options) {
        if (!options) { 
            options = {}; 
        }
        if (typeof options.instantiate === "undefined") { 
            options.instantiate = true; 
        }
        if (["function", "undefined"].indexOf(typeof options.serializer ) < 0) { 
            throw new TypeError(`serializer must be a function. Omit to use default .serialize() method for serialization`);
        }
        if (typeof options.exclude !== "undefined" && !(options.exclude instanceof Array)) {
            throw new TypeError(`exclude must be an array of key names`);
        }
        if (typeof options.include !== "undefined" && !(options.include instanceof Array)) {
            throw new TypeError(`include must be an array of key names`);
        }
        if (options.exclude && options.include) {
            throw new TypeError(`can't use exclude and include at the same time`);
        }
        this.instantiate = options.instantiate;
        this.serializer = options.serializer;
        this.exclude = options.exclude;
        this.include = options.include;
    }
}

const _mappings = Symbol("mappings");
class TypeMappings {
    constructor() {
        //this._mappings = {};
        this[_mappings] = {};
    }

    get mappings() { return this[_mappings]; }
    map(path) {
        return map(this[_mappings], path);
    }

    /**
     * Maps objects that are stored in a specific path to a constructor method, 
     * so they can automatically be serialized/deserialized when stored/loaded to/from
     * the database
     * @param {string} path | path to an object container, eg "users" or "users/${userid}/posts"
     * @param {function} constructor | constructor to instantiate objects with
     * @param {TypeMappingOptions} options | instantiate: boolean that specifies if the constructor method should be called using the "new" keyword, or just execute the function. serializer: function that can serialize your object for storing, if your class does not have a .serialize() method
     */
    bind(path, constructor, options = new TypeMappingOptions({ instantiate: true, serializer: undefined, exclude: undefined, include: undefined })) {
        // Maps objects that are stored in a specific path to a constructor method,
        // so they are automatically deserialized
        if (typeof path !== "string") {
            throw new TypeError("path must be a string");
        }
        if (typeof constructor !== "function") {
            throw new TypeError("constructor must be a function");
        }

        path = path.replace(/^\/|\/$/g, ""); // trim slashes
        this[_mappings][path] = {
            constructor,
            instantiate: options.instantiate,
            serializer: options.serializer,
            exclude: options.exclude,
            include: options.include,
            deserialize(obj) {
                // run constructor method
                if (this.instantiate) {
                    obj = new this.constructor(obj);
                }
                else {
                    obj = this.constructor(obj);
                }
                return obj;
            },
            serialize(obj) {
                if (typeof this.serializer === "function") {
                    obj = this.serializer.call(obj, obj);
                }
                else if (typeof obj.serialize === "function") {
                    obj = obj.serialize();
                }
                return obj;
            }
        };
    }

    /**
     * Serialzes any child in given object that has a type mapping
     * @param {string} path | path to the object's location
     * @param {object} obj | object to serialize
     */
    serialize(path, obj) {
        return process(this[_mappings], path, obj, "serialize");
    }

    /**
     * Deserialzes any child in given object that has a type mapping
     * @param {string} path | path to the object's location
     * @param {object} obj | object to deserialize
     */
    deserialize(path, obj) {
        return process(this[_mappings], path, obj, "deserialize");
    }
}

module.exports = {
    TypeMappings,
    TypeMappingOptions
}
