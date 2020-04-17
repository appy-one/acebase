(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.acebase = f()}})(function(){var define,module,exports;return (function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
/**
 * cuid.js
 * Collision-resistant UID generator for browsers and node.
 * Sequential for fast db lookups and recency sorting.
 * Safe for element IDs and server-side lookups.
 *
 * Extracted from CLCTR
 *
 * Copyright (c) Eric Elliott 2012
 * MIT License
 */

var fingerprint = require('./lib/fingerprint.js');
var pad = require('./lib/pad.js');

var c = 0,
  blockSize = 4,
  base = 36,
  discreteValues = Math.pow(base, blockSize);

function randomBlock () {
  return pad((Math.random() *
    discreteValues << 0)
    .toString(base), blockSize);
}

function safeCounter () {
  c = c < discreteValues ? c : 0;
  c++; // this is not subliminal
  return c - 1;
}

function cuid () {
  // Starting with a lowercase letter makes
  // it HTML element ID friendly.
  var letter = 'c', // hard-coded allows for sequential access

    // timestamp
    // warning: this exposes the exact date and time
    // that the uid was created.
    timestamp = (new Date().getTime()).toString(base),

    // Prevent same-machine collisions.
    counter = pad(safeCounter().toString(base), blockSize),

    // A few chars to generate distinct ids for different
    // clients (so different computers are far less
    // likely to generate the same id)
    print = fingerprint(),

    // Grab some more chars from Math.random()
    random = randomBlock() + randomBlock();

  return letter + timestamp + counter + print + random;
}

cuid.slug = function slug () {
  var date = new Date().getTime().toString(36),
    counter = safeCounter().toString(36).slice(-4),
    print = fingerprint().slice(0, 1) +
      fingerprint().slice(-1),
    random = randomBlock().slice(-2);

  return date.slice(-2) +
    counter + print + random;
};

cuid.isCuid = function isCuid (stringToCheck) {
  if (typeof stringToCheck !== 'string') return false;
  if (stringToCheck.startsWith('c')) return true;
  return false;
};

cuid.isSlug = function isSlug (stringToCheck) {
  if (typeof stringToCheck !== 'string') return false;
  var stringLength = stringToCheck.length;
  if (stringLength >= 7 && stringLength <= 10) return true;
  return false;
};

cuid.fingerprint = fingerprint;

module.exports = cuid;

},{"./lib/fingerprint.js":2,"./lib/pad.js":3}],2:[function(require,module,exports){
var pad = require('./pad.js');

var env = typeof window === 'object' ? window : self;
var globalCount = Object.keys(env).length;
var mimeTypesLength = navigator.mimeTypes ? navigator.mimeTypes.length : 0;
var clientId = pad((mimeTypesLength +
  navigator.userAgent.length).toString(36) +
  globalCount.toString(36), 4);

module.exports = function fingerprint () {
  return clientId;
};

},{"./pad.js":3}],3:[function(require,module,exports){
module.exports = function pad (num, size) {
  var s = '000000000' + num;
  return s.substr(s.length - size);
};

},{}],4:[function(require,module,exports){
/**
   ________________________________________________________________________________
   
      ___          ______                
     / _ \         | ___ \               
    / /_\ \ ___ ___| |_/ / __ _ ___  ___ 
    |  _  |/ __/ _ \ ___ \/ _` / __|/ _ \
    | | | | (_|  __/ |_/ / (_| \__ \  __/
    \_| |_/\___\___\____/ \__,_|___/\___|
                                     
   Copyright 2018 by Ewout Stortenbeker (me@appy.one)   
   Published under MIT license
   ________________________________________________________________________________
  
 */
const { EventEmitter } = require('events');
const { DataReference, DataReferenceQuery } = require('./data-reference');
const { TypeMappings } = require('./type-mappings');

class AceBaseSettings {
    constructor(options) {
        // if (typeof options.api !== 'object') {
        //     throw new Error(`No api passed to AceBaseSettings constructor`);
        // }
        this.logLevel = options.logLevel || "log";
        // this.api = options.api;
    }
}

class AceBaseBase extends EventEmitter {

    /**
     * 
     * @param {string} dbname | Name of the database to open or create
     * @param {AceBaseSettings} options | 
     */
    constructor(dbname, options) {
        super();

        if (!options) { options = {}; }

        this.once("ready", () => {
            this._ready = true;
        });

        // Specific api given such as web api, or browser api etc
        // this.api = new options.api.class(dbname, options.api.settings, ready => {
        //     this.emit("ready");
        // });

        this.types = new TypeMappings(this);
    }

    /**
     * 
     * @param {()=>void} [callback] (optional) callback function that is called when ready. You can also use the returned promise
     * @returns {Promise<void>} returns a promise that resolves when ready
     */
    ready(callback = undefined) {
        if (this._ready === true) { 
            // ready event was emitted before
            callback && callback();
            return Promise.resolve();
        }
        else {
            // Wait for ready event
            let resolve;
            const promise = new Promise(res => resolve = res);
            this.on("ready", () => {
                resolve();
                callback && callback(); 
            });
            return promise;
        }
    }

    get isReady() {
        return this._ready === true;
    }

    /**
     * Creates a reference to a node
     * @param {string} path 
     * @returns {DataReference} reference to the requested node
     */
    ref(path) {
        return new DataReference(this, path);
    }

    /**
     * Get a reference to the root database node
     * @returns {DataReference} reference to root node
     */
    get root() {
        return this.ref("");
    }

    /**
     * Creates a query on the requested node
     * @param {string} path 
     * @returns {DataReferenceQuery} query for the requested node
     */
    query(path) {
        const ref = new DataReference(this, path);
        return new DataReferenceQuery(ref);
    }

    get indexes() {
        return {
            /**
             * Gets all indexes
             */
            get: () => {
                return this.api.getIndexes();
            },
            /**
             * Creates an index on "key" for all child nodes at "path". If the index already exists, nothing happens.
             * Example: creating an index on all "name" keys of child objects of path "system/users", 
             * will index "system/users/user1/name", "system/users/user2/name" etc.
             * You can also use wildcard paths to enable indexing and quering of fragmented data.
             * Example: path "users/*\/posts", key "title": will index all "title" keys in all posts of all users.
             * @param {string} path path to the container node
             * @param {string} key name of the key to index every container child node
             * @param {object} [options] any additional options
             * @param {string} [options.type] special index type, such as 'fulltext', or 'geo'
             * @param {string[]} [options.include] keys to include in the index. Speeds up sorting on these columns when the index is used (and dramatically increases query speed when .take(n) is used in addition)
             * @param {object} [options.config] additional index-specific configuration settings 
             */
            create: (path, key, options) => {
                return this.api.createIndex(path, key, options);
            }
        };
    }

}

module.exports = { AceBaseBase, AceBaseSettings };
},{"./data-reference":7,"./type-mappings":16,"events":40}],5:[function(require,module,exports){

class Api {
    // interface for local and web api's
    stats(options = undefined) {}

    /**
     * 
     * @param {string} path | reference
     * @param {string} event | event to subscribe to ("value", "child_added" etc)
     * @param {function} callback | callback function(err, path, value)
     */
    subscribe(path, event, callback) {}

    // TODO: add jsdoc comments

    unsubscribe(path, event, callback) {}
    update(path, updates) {}
    set(path, value) {}
    get(path, options) {}
    exists(path) {}
    query(path, query, options) {}
    createIndex(path, key) {}
    getIndexes() {}
}

module.exports = { Api };
},{}],6:[function(require,module,exports){
const c = function(input, length, result) {
    var i, j, n, b = [0, 0, 0, 0, 0];
    for(i = 0; i < length; i += 4){
        n = ((input[i] * 256 + input[i+1]) * 256 + input[i+2]) * 256 + input[i+3];
        if(!n){
            result.push("z");
        }else{
            for(j = 0; j < 5; b[j++] = n % 85 + 33, n = Math.floor(n / 85));
        }
        result.push(String.fromCharCode(b[4], b[3], b[2], b[1], b[0]));
    }
}

const ascii85 = {
    encode: function(arr) {
        // summary: encodes input data in ascii85 string
        // input: ArrayLike
        if (arr instanceof ArrayBuffer) {
            arr = new Uint8Array(arr, 0, arr.byteLength);
        }
        var input = arr;
        var result = [], remainder = input.length % 4, length = input.length - remainder;
        c(input, length, result);
        if(remainder){
            var t = new Uint8Array(4);
            t.set(input.slice(length), 0);
            c(t, 4, result);
            var x = result.pop();
            if(x == "z"){ x = "!!!!!"; }
            result.push(x.substr(0, remainder + 1));
        }
        var ret = result.join("");	// String
        ret = '<~' + ret + '~>';
        return ret;
    },
    decode: function(input) {
        // summary: decodes the input string back to an ArrayBuffer
        // input: String: the input string to decode
        if (!input.startsWith('<~') || !input.endsWith('~>')) {
            throw new Error('Invalid input string');
        }
        input = input.substr(2, input.length-4);
        var n = input.length, r = [], b = [0, 0, 0, 0, 0], i, j, t, x, y, d;
        for(i = 0; i < n; ++i) {
            if(input.charAt(i) == "z"){
                r.push(0, 0, 0, 0);
                continue;
            }
            for(j = 0; j < 5; ++j){ b[j] = input.charCodeAt(i + j) - 33; }
            d = n - i;
            if(d < 5){
                for(j = d; j < 4; b[++j] = 0);
                b[d] = 85;
            }
            t = (((b[0] * 85 + b[1]) * 85 + b[2]) * 85 + b[3]) * 85 + b[4];
            x = t & 255;
            t >>>= 8;
            y = t & 255;
            t >>>= 8;
            r.push(t >>> 8, t & 255, y, x);
            for(j = d; j < 5; ++j, r.pop());
            i += 4;
        }
        const data = new Uint8Array(r);
        return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    }
};

module.exports = ascii85;
},{}],7:[function(require,module,exports){
const { DataSnapshot } = require('./data-snapshot');
const { EventStream, EventPublisher } = require('./subscription');
const { ID } = require('./id');
const debug = require('./debug');
const { PathInfo } = require('./path-info');

class DataRetrievalOptions {
    /**
     * Options for data retrieval, allows selective loading of object properties
     * @param {{ include?: Array<string|number>, exclude?: Array<string|number>, child_objects?: boolean, allow_cache?: boolean }} options 
     */
    constructor(options) {
        if (!options) {
            options = {};
        }
        if (typeof options.include !== 'undefined' && !(options.include instanceof Array)) {
            throw new TypeError(`options.include must be an array`);
        }
        if (typeof options.exclude !== 'undefined' && !(options.exclude instanceof Array)) {
            throw new TypeError(`options.exclude must be an array`);
        }
        if (typeof options.child_objects !== 'undefined' && typeof options.child_objects !== 'boolean') {
            throw new TypeError(`options.child_objects must be a boolean`);
        }
        if (typeof options.allow_cache !== 'undefined' && typeof options.allow_cache !== 'boolean') {
            throw new TypeError(`options.allow_cache must be a boolean`);
        }

        /**
         * @property {string[]} include - child keys to include (will exclude other keys), can include wildcards (eg "messages/*\/title")
         */
        this.include = options.include || undefined;
        /**
         * @property {string[]} exclude - child keys to exclude (will include other keys), can include wildcards (eg "messages/*\/replies")
         */
        this.exclude = options.exclude || undefined;
        /**
         * @property {boolean} child_objects - whether or not to include any child objects, default is true
         */
        this.child_objects = typeof options.child_objects === "boolean" ? options.child_objects : undefined;
        /**
         * @property {boolean} allow_cache - whether cached results are allowed to be used (supported by AceBaseClients using local cache), default is true
         */
        this.allow_cache = typeof options.allow_cache === "boolean" ? options.allow_cache : undefined;
    }
}

class QueryDataRetrievalOptions extends DataRetrievalOptions {
    /**
     * Options for data retrieval, allows selective loading of object properties
     * @param {QueryDataRetrievalOptions} [options]
     */
    constructor(options) {
        super(options);
        if (typeof options.snapshots !== 'undefined' && typeof options.snapshots !== 'boolean') {
            throw new TypeError(`options.snapshots must be an array`);
        }
        /**
         * @property {boolean} snapshots - whether to return snapshots of matched nodes (include data), or references only (no data). Default is true
         */
        this.snapshots = typeof options.snapshots === 'boolean' ? options.snapshots : undefined;
    }
}

const _private = Symbol("private");
class DataReference {
    /**
     * Creates a reference to a node
     * @param {AceBase} db
     * @param {string} path 
     */
    constructor (db, path, vars) {
        if (!path) { path = ""; }
        path = path.replace(/^\/|\/$/g, ""); // Trim slashes
        const pathInfo = PathInfo.get(path);
        const key = pathInfo.key; //path.length === 0 ? "" : path.substr(path.lastIndexOf("/") + 1); //path.match(/(?:^|\/)([a-z0-9_$]+)$/i)[1];
        // const query = { 
        //     filters: [],
        //     skip: 0,
        //     take: 0,
        //     order: []
        // };
        const callbacks = [];
        this[_private] = {
            get path() { return path; },
            get key() { return key; },
            get callbacks() { return callbacks; },
            vars: vars || {}
        };
        this.db = db; //Object.defineProperty(this, "db", ...)
    }

    /**
    * The path this instance was created with
    * @type {string}
    */
    get path() { return this[_private].path; }

    /**
     * The key or index of this node
     * @type {string|number}
     */
    get key() { return this[_private].key; }
    
    /**
     * Returns a new reference to this node's parent
     * @type {DataReference}
     */
    get parent() {
        let currentPath = PathInfo.fillVariables2(this.path, this.vars);
        const info = PathInfo.get(currentPath);
        if (info.parentPath === null) {
            return null;
        }
        return new DataReference(this.db, info.parentPath);
    }

    /**
     * Contains values of the variables/wildcards used in a subscription path if this reference was 
     * created by an event ("value", "child_added" etc)
     * @type {{ [index: number]: string|number, [variable: string]: string|number }}
     */
    get vars() {
        return this[_private].vars;
    }

    /**
     * Returns a new reference to a child node
     * @param {string} childPath Child key or path
     * @returns {DataReference} reference to the child
     */
    child(childPath) {
        childPath = childPath.replace(/^\/|\/$/g, "");
        const currentPath = PathInfo.fillVariables2(this.path, this.vars);
        const targetPath = PathInfo.getChildPath(currentPath, childPath);
        return new DataReference(this.db, targetPath); //  `${this.path}/${childPath}`
    }
    
    /**
     * Sets or overwrites the stored value
     * @param {any} value value to store in database
     * @param {(err: Error, ref: DataReference) => void} [onComplete] completion callback to use instead of returning promise 
     * @returns {Promise<DataReference>} promise that resolves with this reference when completed (when not using onComplete callback)
     */
    set(value, onComplete = undefined) {
        if (this.isWildcardPath) {
            throw new Error(`Cannot set the value of a path with wildcards and/or variables`);
        }
        if (this.parent === null) {
            throw new Error(`Cannot set the root object. Use update, or set individual child properties`);
        }
        if (typeof value === 'undefined') {
            throw new TypeError(`Cannot store value undefined`);
        }
        value = this.db.types.serialize(this.path, value);
        return this.db.api.set(this.path, value)
        .then(res => {
            if (typeof onComplete === 'function') {
                try { onComplete(null, this);} catch(err) { console.error(`Error in onComplete callback:`, err); }
            }
        })
        .catch(err => {
            if (typeof onComplete === 'function') {
                try { onComplete(err); } catch(err) { console.error(`Error in onComplete callback:`, err); }
            }
            else {
                // throw again
                throw err;
            }
        })
        .then(() => {
            return this;
        });
    }

    /**
     * Updates properties of the referenced node
     * @param {object} updates object containing the properties to update
     * @param {(err: Error, ref: DataReference) => void} [onComplete] completion callback to use instead of returning promise 
     * @return {Promise<DataReference>} returns promise that resolves with this reference once completed (when not using onComplete callback)
     */
    update(updates, onComplete = undefined) {
        if (this.isWildcardPath) {
            throw new Error(`Cannot update the value of a path with wildcards and/or variables`);
        }
        let promise;
        if (typeof updates !== "object" || updates instanceof Array || updates instanceof ArrayBuffer || updates instanceof Date) {
            promise = this.set(updates);
        }
        else {
            updates = this.db.types.serialize(this.path, updates);
            promise = this.db.api.update(this.path, updates);
        }
        return promise.then(() => {
            if (typeof onComplete === 'function') {
                try { onComplete(null, this); } catch(err) { console.error(`Error in onComplete callback:`, err); }
            }
        })
        .catch(err => {
            if (typeof onComplete === 'function') {
                try { onComplete(err); } catch(err) { console.error(`Error in onComplete callback:`, err); }
            }
            else {
                throw err;
            }
        })
        .then(() => {
            return this;
        })
    }

    /**
     * Sets the value a node using a transaction: it runs you callback function with the current value, uses its return value as the new value to store.
     * @param {(currentValue: DataSnapshot) => void} callback - callback function(currentValue) => newValue: is called with a snapshot of the current value, must return a new value to store in the database
     * @returns {Promise<DataReference>} returns a promise that resolves with the DataReference once the transaction has been processed
     */
    transaction(callback) {
        if (this.isWildcardPath) {
            throw new Error(`Cannot start a transaction on a path with wildcards and/or variables`);
        }        
        let cb = (currentValue) => {
            currentValue = this.db.types.deserialize(this.path, currentValue);
            const snap = new DataSnapshot(this, currentValue);
            let newValue;
            try {
                newValue = callback(snap);
            }
            catch(err) {
                // Make sure an exception thrown in client code cancels the transaction
                return;
            }
            if (newValue instanceof Promise) {
                return newValue.then((val) => {
                    return this.db.types.serialize(this.path, val);
                });
            }
            else {
                return this.db.types.serialize(this.path, newValue);
            }
        }
        return this.db.api.transaction(this.path, cb)
        .then(result => {
            return this;
        });
    }

    /**
     * Subscribes to an event. Supported events are "value", "child_added", "child_changed", "child_removed", 
     * which will run the callback with a snapshot of the data. If you only wish to receive notifications of the 
     * event (without the data), use the "notify_value", "notify_child_added", "notify_child_changed", 
     * "notify_child_removed" events instead, which will run the callback with a DataReference to the changed 
     * data. This enables you to manually retreive data upon changes (eg if you want to exclude certain child 
     * data from loading)
     * @param {string} event - Name of the event to subscribe to
     * @param {((snapshotOrReference:DataSnapshot|DataReference) => void)|boolean} callback - Callback function(snapshot) or whether or not to run callbacks on current values when using "value" or "child_added" events
     * @returns {EventStream} returns an EventStream
     */
    on(event, callback, cancelCallbackOrContext, context) {
        if (this.path === '' && ['value','notify_value','child_changed','notify_child_changed'].includes(event)) {
            console.warn(`WARNING: Listening for value and child_changed events on the root node is a bad practice`);
        }
        const cancelCallback = typeof cancelCallbackOrContext === 'function' && cancelCallbackOrContext;
        context = typeof cancelCallbackOrContext === 'object' ? cancelCallbackOrContext : context

        const useCallback = typeof callback === 'function';
        
        /** @type {EventPublisher} */
        let eventPublisher = null;
        const eventStream = new EventStream(publisher => { eventPublisher = publisher });

        // Map OUR callback to original callback, so .off can remove the right callback
        let cb = { 
            subscr: eventStream,
            original: callback, 
            ours: (err, path, newValue, oldValue) => {
                if (err) {
                    debug.error(`Error getting data for event ${event} on path "${path}"`, err);
                    return;
                }
                let ref = this.db.ref(path);
                ref[_private].vars = PathInfo.extractVariables(this.path, path);
                
                let callbackObject;
                if (event.startsWith('notify_')) {
                    // No data event, callback with reference
                    callbackObject = ref;
                }
                else {
                    const isRemoved = event === "child_removed";
                    const val = this.db.types.deserialize(path, isRemoved ? oldValue : newValue);
                    const snap = new DataSnapshot(ref, val, isRemoved);
                    callbackObject = snap;
                }

                useCallback && callback.call(context || null, callbackObject);
                let keep = eventPublisher.publish(callbackObject);
                if (!keep && !useCallback) {
                    // If no callback was used, unsubscribe
                    let callbacks = this[_private].callbacks;
                    callbacks.splice(callbacks.indexOf(cb), 1);
                    this.db.api.unsubscribe(this.path, event, cb.ours);
                }
            }
        };
        this[_private].callbacks.push(cb);

        let authorized = this.db.api.subscribe(this.path, event, cb.ours);
        const allSubscriptionsStoppedCallback = () => {
            let callbacks = this[_private].callbacks;
            callbacks.splice(callbacks.indexOf(cb), 1);
            this.db.api.unsubscribe(this.path, event, cb.ours);
        };
        if (authorized instanceof Promise) {
            // Web API now returns a promise that resolves if the request is allowed
            // and rejects when access is denied by the set security rules
            authorized.then(() => {
                // Access granted
                eventPublisher.start(allSubscriptionsStoppedCallback);
            })
            .catch(err => {
                // Access denied?
                // Cancel subscription
                let callbacks = this[_private].callbacks;
                callbacks.splice(callbacks.indexOf(cb), 1);
                this.db.api.unsubscribe(this.path, event, cb.ours);

                // Call cancelCallbacks
                eventPublisher.cancel(err.message);
                cancelCallback && cancelCallback(err.message);
            });
        }
        else {
            // Local API, always authorized
            eventPublisher.start(allSubscriptionsStoppedCallback);
        }

        if (callback && !this.isWildcardPath) {
            // If callback param is supplied (either a callback function or true or something else truthy),
            // it will fire events for current values right now.
            // Otherwise, it expects the .subscribe methode to be used, which will then
            // only be called for future events
            if (event === "value") {
                this.get(snap => {
                    eventPublisher.publish(snap);
                    useCallback && callback(snap);
                });
            }
            else if (event === "child_added") {
                this.get(snap => {
                    const val = snap.val();
                    if (val === null || typeof val !== "object") { return; }
                    Object.keys(val).forEach(key => {
                        let childSnap = new DataSnapshot(this.child(key), val[key]);
                        eventPublisher.publish(childSnap);
                        useCallback && callback(childSnap);
                    });
                });
            }
        }

        return eventStream;
    }

    /**
     * Unsubscribes from a previously added event
     * @param {string} event | Name of the event
     * @param {Function} callback | callback function to remove
     */
    off(event = undefined, callback = undefined) {
        const callbacks = this[_private].callbacks;
        if (callback) {
            const cb = callbacks.find(cb => cb.original === callback);
            if (!cb) {
                debug.error(`Can't find specified callback to unsubscribe from (path: "${this.path}", event: ${event}, callback: ${callback})`);
                return;
            }
            callbacks.splice(callbacks.indexOf(cb), 1);
            callback = cb.ours;
            cb.subscr.unsubscribe(callback);
        }
        else {
            callbacks.splice(0, callbacks.length).forEach(cb => {
                cb.subscr.unsubscribe();
            });
        }
        this.db.api.unsubscribe(this.path, event, callback);
        return this;
    }

    /**
     * Gets a snapshot of the stored value. Shorthand method for .once("value")
     * @param {DataRetrievalOptions|((snapshot:DataSnapshot) => void)} [optionsOrCallback] data retrieval options to include or exclude specific child keys, or callback
     * @param {(snapshot:DataSnapshot) => void} [callback] callback function to run with a snapshot of the data instead of returning a promise
     * @returns {Promise<DataSnapshot>|void} returns a promise that resolves with a snapshot of the data, or nothing if callback is used
     */
    get(optionsOrCallback = undefined, callback = undefined) {
        if (this.isWildcardPath) {
            throw new Error(`Cannot get the value of a path with wildcards and/or variables. Use .query() instead`);
        }

        callback = 
            typeof optionsOrCallback === 'function' 
            ? optionsOrCallback 
            : typeof callback === 'function'
                ? callback
                : undefined;

        const options = 
            typeof optionsOrCallback === 'object' 
            ? optionsOrCallback
            : new DataRetrievalOptions({ allow_cache: true });

        if (typeof options.allow_cache === 'undefined') {
            options.allow_cache = true;
        }

        const promise = this.db.api.get(this.path, options).then(value => {
            value = this.db.types.deserialize(this.path, value);
            const snapshot = new DataSnapshot(this, value);
            return snapshot;
        });

        if (callback) { 
            promise.then(callback);
            return; 
        }
        else {
            return promise;
        }
    }

    /**
     * Waits for an event to occur
     * @param {string} event - Name of the event, eg "value", "child_added", "child_changed", "child_removed"
     * @param {DataRetrievalOptions} options - data retrieval options, to include or exclude specific child keys
     * @returns {Promise<DataSnapshot>} - returns promise that resolves with a snapshot of the data
     */
    once(event, options) {
        if (event === "value" && !this.isWildcardPath) {
            // Shortcut, do not start listening for future events
            return this.get(options);
        }
        return new Promise((resolve, reject) => {
            const callback = (snap) => {
                this.off(event, snap); // unsubscribe directly
                resolve(snap);
            }
            this.on(event, callback);
        });
    }

    /**
     * Creates a new child with a unique key and returns the new reference. 
     * If a value is passed as an argument, it will be stored to the database directly. 
     * The returned reference can be used as a promise that resolves once the
     * given value is stored in the database
     * @param {any} value optional value to store into the database right away
     * @param {function} onComplete optional callback function to run once value has been stored
     * @returns {DataReference|Promise<DataReference>} returns a reference to the new child, or a promise that resolves with the reference after the passed value has been stored
     * @example 
     * // Create a new user in "game_users"
     * db.ref("game_users")
     * .push({ name: "Betty Boop", points: 0 })
     * .then(ref => {
     * //  ref is a new reference to the newly created object,
     * //  eg to: "game_users/7dpJMeLbhY0tluMyuUBK27"
     * });
     * @example
     * // Create a new child reference with a generated key, 
     * // but don't store it yet
     * let userRef = db.ref("users").push();
     * // ... to store it later:
     * userRef.set({ name: "Popeye the Sailor" })
     */
    push(value = undefined, onComplete = undefined) {
        if (this.isWildcardPath) {
            throw new Error(`Cannot push to a path with wildcards and/or variables`);
        }

        const id = ID.generate(); //uuid62.v1({ node: [0x61, 0x63, 0x65, 0x62, 0x61, 0x73] });
        const ref = this.child(id);
        ref.__pushed = true;

        if (typeof value !== 'undefined') {
            return ref.set(value, onComplete).then(res => ref);
        }
        else {
            return ref;
        }
    }

    /**
     * Removes this node and all children
     */
    remove() {
        if (this.isWildcardPath) {
            throw new Error(`Cannot remove a path with wildcards and/or variables. Use query().remove instead`);
        }
        if (this.parent === null) {
            throw new Error(`Cannot remove the top node`);
        }
        return this.set(null);
    }

    /**
     * Quickly checks if this reference has a value in the database, without returning its data
     * @returns {Promise<boolean>} | returns a promise that resolves with a boolean value
     */
    exists() {
        if (this.isWildcardPath) {
            throw new Error(`Cannot push to a path with wildcards and/or variables`);
        }
        return this.db.api.exists(this.path);
    }

    get isWildcardPath() {
        return this.path.indexOf('*') >= 0 || this.path.indexOf('$') >= 0;
    }

    query() {
        return new DataReferenceQuery(this);
    }

    reflect(type, args) {
        if (this.pathHasVariables) {
            throw new Error(`Cannot reflect on a path with wildcards and/or variables`);
        }
        return this.db.api.reflect(this.path, type, args);
    }

    export(stream, options = { format: 'json' }) {
        return this.db.api.export(this.path, stream, options);
    }
} 

class DataReferenceQuery {
    
    /**
     * Creates a query on a reference
     * @param {DataReference} ref 
     */
    constructor(ref) {
        this.ref = ref;
        this[_private] = {
            filters: [],
            skip: 0,
            take: 0,
            order: []
        };
    }

    /**
     * Applies a filter to the children of the refence being queried. 
     * If there is an index on the property key being queried, it will be used 
     * to speed up the query
     * @param {string|number} key | property to test value of
     * @param {string} op | operator to use
     * @param {any} compare | value to compare with
     * @returns {DataReferenceQuery}
     */                
    filter(key, op, compare) {
        if ((op === "in" || op === "!in") && (!(compare instanceof Array) || compare.length === 0)) {
            throw new Error(`${op} filter for ${key} must supply an Array compare argument containing at least 1 value`);
        }
        if ((op === "between" || op === "!between") && (!(compare instanceof Array) || compare.length !== 2)) {
            throw new Error(`${op} filter for ${key} must supply an Array compare argument containing 2 values`);
        }
        if ((op === "matches" || op === "!matches") && !(compare instanceof RegExp)) {
            throw new Error(`${op} filter for ${key} must supply a RegExp compare argument`);
        }
        // DISABLED 2019/10/23 because it is not fully implemented only works locally
        // if (op === "custom" && typeof compare !== "function") {
        //     throw `${op} filter for ${key} must supply a Function compare argument`;
        // }
        if ((op === "contains" || op === "!contains") && ((typeof compare === 'object' && !(compare instanceof Array) && !(compare instanceof Date)) || (compare instanceof Array && compare.length === 0))) {
            throw new Error(`${op} filter for ${key} must supply a simple value or (non-zero length) array compare argument`);
        }
        this[_private].filters.push({ key, op, compare });
        return this;
    }

    /**
     * @deprecated use .filter instead
     */
    where(key, op, compare) {
        return this.filter(key, op, compare)
    }

    /**
     * Limits the number of query results to n
     * @param {number} n 
     * @returns {DataReferenceQuery}
     */
    take(n) {
        this[_private].take = n;
        return this;
    }

    /**
     * Skips the first n query results
     * @param {number} n 
     * @returns {DataReferenceQuery}
     */
    skip(n) {
        this[_private].skip = n;
        return this;
    }

    /**
     * Sorts the query results
     * @param {string} key 
     * @param {boolean} [ascending=true]
     * @returns {DataReferenceQuery}
     */
    sort(key, ascending = true) {
        if (typeof key !== "string") {
            throw `key must be a string`;
        }
        this[_private].order.push({ key, ascending });
        return this;
    }

    /**
     * @deprecated use .sort instead
     */
    order(key, ascending = true) {
        return this.sort(key, ascending);
    }

    /**
     * Executes the query
     * @param {((snapshotsOrReferences:DataSnapshotsArray|DataReferencesArray) => void)|QueryDataRetrievalOptions} [optionsOrCallback] data retrieval options (to include or exclude specific child data, and whether to return snapshots (default) or references only), or callback
     * @param {(snapshotsOrReferences:DataSnapshotsArray|DataReferencesArray) => void} [callback] callback to use instead of returning a promise
     * @returns {Promise<DataSnapshotsArray>|Promise<DataReferencesArray>|void} returns an Promise that resolves with an array of DataReferences or DataSnapshots, or void if a callback is used instead
     */
    get(optionsOrCallback = undefined, callback = undefined) {
        callback = 
            typeof optionsOrCallback === 'function' 
            ? optionsOrCallback 
            : typeof callback === 'function'
                ? callback
                : undefined;

        const options = 
            typeof optionsOrCallback === 'object' 
            ? optionsOrCallback 
            : new QueryDataRetrievalOptions({ snapshots: true, allow_cache: true });

        if (typeof options.snapshots === 'undefined') {
            options.snapshots = true;
        }
        if (typeof options.allow_cache === 'undefined') {
            options.allow_cache = true;
        }
        options.eventHandler = ev => {
            if (!this._events || !this._events[ev.name]) { return false; }
            const listeners = this._events[ev.name];
            if (typeof listeners !== 'object' || listeners.length === 0) { return false; }
            if (['add','change','remove'].includes(ev.name)) {
                const ref = new DataReference(this.ref.db, ev.path);
                const eventData = { name: ev.name };
                if (options.snapshots && ev.name !== 'remove') {
                    const val = db.types.deserialize(ev.path, ev.value);
                    eventData.snapshot = new DataSnapshot(ref, val, false);
                }
                else {
                    eventData.ref = ref;
                }
                ev = eventData;
            }
            listeners.forEach(callback => { try { callback(ev); } catch(e) {} });
        };
        // Check if there are event listeners set for realtime changes
        options.monitor = { add: false, change: false, remove: false };
        if (this._events) {
            if (this._events['add'] && this._events['add'].length > 0) {
                options.monitor.add = true;
            }
            if (this._events['change'] && this._events['change'].length > 0) {
                options.monitor.change = true;
            }
            if (this._events['remove'] && this._events['remove'].length > 0) {
                options.monitor.remove = true;
            }
        }
        const db = this.ref.db;
        return db.api.query(this.ref.path, this[_private], options)
        .catch(err => {
            throw new Error(err);
        })
        .then(results => {
            results.forEach((result, index) => {
                if (options.snapshots) {
                    const val = db.types.deserialize(result.path, result.val);
                    results[index] = new DataSnapshot(db.ref(result.path), val);
                }
                else {
                    results[index] = db.ref(result);
                }
            });
            if (options.snapshots) {
                return DataSnapshotsArray.from(results);
            }
            else {
                return DataReferencesArray.from(results);
            }
        })
        .then(results => {
            callback && callback(results);
            return results;
        });
    }

    /**
     * Executes the query and returns references. Short for .get({ snapshots: false })
     * @param {(references:DataReferencesArray) => void} [callback] callback to use instead of returning a promise
     * @returns {Promise<DataReferencesArray>|void} returns an Promise that resolves with an array of DataReferences, or void when using a callback
     */
    getRefs(callback = undefined) {
        return this.get({ snapshots: false }, callback);
    }

    /**
     * Executes the query, removes all matches from the database
     * @returns {Promise<void>|void} | returns an Promise that resolves once all matches have been removed, or void if a callback is used
     */
    remove(callback) {
        return this.get({ snapshots: false })
        .then(refs => {
            const promises = [];
            return Promise.all(refs.map(ref => ref.remove()))
            .then(() => {
                callback && callback();
            });
        });
    }

    /**
     * Subscribes to an event. Supported events are:
     *  "stats": receive information about query performance.
     *  "hints": receive query or index optimization hints
     *  "add", "change", "remove": receive real-time query result changes
     * @param {string} event - Name of the event to subscribe to
     * @param {(event: object) => void} callback - Callback function
     * @returns {DataReferenceQuery} returns reference to this query
     */
    on(event, callback) {
        if (!this._events) { this._events = {}; };
        if (!this._events[event]) { this._events[event] = []; }
        this._events[event].push(callback);
        return this;
    }

    /**
     * Unsubscribes from a previously added event(s)
     * @param {string} [event] Name of the event
     * @param {Function} [callback] callback function to remove
     * @returns {DataReferenceQuery} returns reference to this query
     */
    off(event, callback) {
        if (!this._events) { return this; }
        if (typeof event === 'undefined') {
            this._events = {};
            return this;
        }
        if (!this._events[event]) { return this; }
        if (typeof callback === 'undefined') {
            delete this._events[event];
            return this;
        }
        const index = !this._events[event].indexOf(callback);
        if (!~index) { return this; }
        this._events[event].splice(index, 1);
        return this;
    }
}

class DataSnapshotsArray extends Array {
    /**
     * 
     * @param {DataSnapshot[]} snaps 
     */
    static from(snaps) {
        const arr = new DataSnapshotsArray(snaps.length);
        snaps.forEach((snap, i) => arr[i] = snap);
        return arr;
    }
    getValues() {
        return this.map(snap => snap.val());
    }
}

class DataReferencesArray extends Array { 
    /**
     * 
     * @param {DataReference[]} refs 
     */
    static from(refs) {
        const arr = new DataReferencesArray(refs.length);
        refs.forEach((ref, i) => arr[i] = ref);
        return arr;
    }
    getPaths() {
        return this.map(ref => ref.path);
    }
}

module.exports = { 
    DataReference, 
    DataReferenceQuery,
    DataRetrievalOptions,
    QueryDataRetrievalOptions
};
},{"./data-snapshot":8,"./debug":9,"./id":10,"./path-info":12,"./subscription":14}],8:[function(require,module,exports){
const { DataReference } = require('./data-reference');
const { getPathKeys } = require('./path-info');

const getChild = (snapshot, path) => {
    if (!snapshot.exists()) { return null; }
    let child = snapshot.val();
    //path.split("/").every...
    getPathKeys(path).every(key => {
        child = child[key];
        return typeof child !== "undefined";
    });
    return child || null;
};

const getChildren = (snapshot) => {
    if (!snapshot.exists()) { return []; }
    let value = snapshot.val();
    if (value instanceof Array) {
        return new Array(value.length).map((v,i) => i);
    }
    if (typeof value === "object") {
        return Object.keys(value);
    }
    return [];
};

class DataSnapshot {

    /**
     * 
     * @param {DataReference} ref 
     * @param {any} value 
     */
    constructor(ref, value, isRemoved = false) {
        this.ref = ref;
        this.val = () => { return value; };
        this.exists = () => { 
            if (isRemoved) { return false; } 
            return value !== null && typeof value !== "undefined"; 
        }
    }
    
    /**
     * Gets a new snapshot for a child node
     * @param {string} path child key or path
     * @returns {DataSnapshot}
     */
    child(path) {
        // Create new snapshot for child data
        let child = getChild(this, path);
        return new DataSnapshot(this.ref.child(path), child);
    }

    /**
     * Checks if the snapshot's value has a child with the given key or path
     * @param {string} path child key or path
     * @returns {boolean}
     */
    hasChild(path) {
        return getChild(this, path) !== null;
    }

    /**
     * Indicates whether the the snapshot's value has any child nodes
     * @returns {boolean}
     */
    hasChildren() {
        return getChildren(this).length > 0;
    }

    /**
     * The number of child nodes in this snapshot
     * @returns {number}
     */
    numChildren() {
        return getChildren(this).length;          
    }

    /**
     * Runs a callback function for each child node in this snapshot until the callback returns false
     * @param {(child: DataSnapshot) => boolean} callback function that is called with a snapshot of each child node in this snapshot. Must return a boolean value that indicates whether to continue iterating or not.
     * @returns {void}
     */
    forEach(callback) {
        const value = this.val();
        return getChildren(this).every((key, i) => {
            const snap = new DataSnapshot(this.ref.child(key), value[key]); 
            return callback(snap);
        });
    }

    /**
     * @type {string|number}
     */
    get key() { return this.ref.key; }

    // /**
    //  * Convenience method to update this snapshot's value AND commit the changes to the database
    //  * @param {object} updates 
    //  */
    // update(updates) {
    //     return this.ref.update(updates)
    //     .then(ref => {
    //         const isRemoved = updates === null;
    //         let value = this.val();
    //         if (!isRemoved && typeof updates === 'object' && typeof value === 'object') {
    //             Object.assign(value, updates);
    //         }
    //         else {
    //             value = updates;
    //         }
    //         this.val = () => { return value; };
    //         this.exists = () => {
    //             return value !== null && typeof value !== "undefined"; 
    //         }
    //         return this;
    //     });
    // }
}

module.exports = { DataSnapshot };
},{"./data-reference":7,"./path-info":12}],9:[function(require,module,exports){
class DebugLogger {
    constructor(level = "log", prefix = '') {
        this.prefix = prefix;
        this.setLevel(level);
    }
    setLevel(level) {
        const prefix = this.prefix ? this.prefix : '';
        this.level = level;
        this.verbose = ["verbose"].includes(level) ? console.log.bind(console, prefix) : () => {};
        this.log = ["verbose", "log"].includes(level) ? console.log.bind(console, prefix) : () => {};
        this.warn = ["verbose", "log", "warn"].includes(level) ? console.warn.bind(console, prefix) : () => {};
        this.error = ["verbose", "log", "warn", "error"].includes(level) ? console.error.bind(console, prefix) : () => {};
        this.write = console.log.bind(console);
    }
}

module.exports = DebugLogger;
},{}],10:[function(require,module,exports){
const cuid = require('cuid');
// const uuid62 = require('uuid62');

class ID {
    static generate() {
        // Could also use https://www.npmjs.com/package/pushid for Firebase style 20 char id's
        return cuid().slice(1); // Cuts off the always leading 'c'
        // return uuid62.v1();
    }
}

module.exports = { ID };
},{"cuid":1}],11:[function(require,module,exports){
const { AceBaseBase, AceBaseSettings } = require('./acebase-base');
const { Api } = require('./api');
const { DataReference, DataReferenceQuery, DataRetrievalOptions, QueryDataRetrievalOptions } = require('./data-reference');
const { DataSnapshot } = require('./data-snapshot');
const DebugLogger = require('./debug');
const { ID } = require('./id');
const { PathReference } = require('./path-reference');
const { EventStream, EventPublisher, EventSubscription } = require('./subscription');
const Transport = require('./transport');
const { TypeMappings, TypeMappingOptions } = require('./type-mappings');
const Utils = require('./utils');
const { PathInfo } = require('./path-info');
const ascii85 = require('./ascii85');

module.exports = {
    AceBaseBase, AceBaseSettings,
    Api,
    DataReference, DataReferenceQuery, DataRetrievalOptions, QueryDataRetrievalOptions,
    DataSnapshot,
    DebugLogger,
    ID,
    PathReference,
    EventStream, EventPublisher, EventSubscription,
    Transport,
    TypeMappings, TypeMappingOptions,
    Utils,
    PathInfo,
    ascii85
};
},{"./acebase-base":4,"./api":5,"./ascii85":6,"./data-reference":7,"./data-snapshot":8,"./debug":9,"./id":10,"./path-info":12,"./path-reference":13,"./subscription":14,"./transport":15,"./type-mappings":16,"./utils":17}],12:[function(require,module,exports){

/**
 * 
 * @param {string} path 
 * @returns {Array<string|number>}
 */
function getPathKeys(path) {
    if (path.length === 0) { return []; }
    let keys = path.replace(/\[/g, "/[").split("/");
    keys.forEach((key, index) => {
        if (key.startsWith("[")) { 
            keys[index] = parseInt(key.substr(1, key.length - 2)); 
        }
    });
    return keys;
}

function getPathInfo(path) {
    if (path.length === 0) {
        return { parent: null, key: "" };
    }
    const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("["));
    const parentPath = i < 0 ? "" : path.substr(0, i);
    let key = i < 0 ? path : path.substr(i);
    if (key.startsWith("[")) { 
        key = parseInt(key.substr(1, key.length - 2)); 
    }
    else if (key.startsWith("/")) {
        key = key.substr(1); // Chop off leading slash
    }
    if (parentPath === path) {
        parentPath = null;
    }
    return {
        parent: parentPath,
        key
    };
}

/**
 * 
 * @param {string} path 
 * @param {string|number} key 
 * @returns {string}
 */
function getChildPath(path, key) {
    if (path.length === 0) {
        if (typeof key === "number") { throw new TypeError("Cannot add array index to root path!"); }
        return key;
    }
    if (typeof key === "number") {
        return `${path}[${key}]`;
    }
    return `${path}/${key}`;
}
//const _pathVariableRegex =  /^\$(\{[a-z0-9]+\})$/i;

class PathInfo {
    /** @returns {PathInfo} */
    static get(path) {
        return new PathInfo(path);
    }

    /** @returns {string} */
    static getChildPath(path, childKey) {
        return getChildPath(path, childKey);
    }

    /** @returns {Array<string|number>} */
    static getPathKeys(path) {
        return getPathKeys(path);
    }

    /**
     * @param {string} path 
     */
    constructor(path) {
        this.path = path;
    }

    /** @type {string|number} */
    get key() {
        return getPathInfo(this.path).key;
    }

    /** @type {string} */
    get parentPath() {
        return getPathInfo(this.path).parent;
    }

    /** 
     * @param {string|number} childKey
     * @returns {string} 
     * */
    childPath(childKey) {
        return getChildPath(`${this.path}`, childKey);
    }

    /** @returns {Array<string|number>} */
    get pathKeys() {
        return getPathKeys(this.path);
    }

    // /**
    //  * If varPath contains variables or wildcards, it will return them with the values found in fullPath
    //  * @param {string} varPath 
    //  * @param {string} fullPath 
    //  * @returns {Array<{ name?: string, value: string|number }>}
    //  * @example
    //  * PathInfo.extractVariables('users/$uid/posts/$postid', 'users/ewout/posts/post1/title') === [
    //  *  { name: '$uid', value: 'ewout' },
    //  *  { name: '$postid', value: 'post1' }
    //  * ];
    //  * 
    //  * PathInfo.extractVariables('users/*\/posts/*\/$property', 'users/ewout/posts/post1/title') === [
    //  *  { value: 'ewout' },
    //  *  { value: 'post1' },
    //  *  { name: '$property', value: 'title' }
    //  * ]
    //  */
    // static extractVariables(varPath, fullPath) {
    //     if (varPath.indexOf('*') < 0 && varPath.indexOf('$') < 0) { 
    //         return []; 
    //     }
    //     // if (!this.equals(fullPath)) {
    //     //     throw new Error(`path does not match with the path of this PathInfo instance: info.equals(path) === false!`)
    //     // }
    //     const keys = getPathKeys(varPath);
    //     const pathKeys = getPathKeys(fullPath);
    //     const variables = [];
    //     keys.forEach((key, index) => {
    //         const pathKey = pathKeys[index];
    //         if (key === '*') {
    //             variables.push({ value: pathKey });
    //         }
    //         else if (typeof key === 'string' && key[0] === '$') {
    //             variables.push({ name: key, value: pathKey });
    //         }
    //     });
    //     return variables;
    // }

    /**
     * If varPath contains variables or wildcards, it will return them with the values found in fullPath
     * @param {string} varPath path containing variables such as * and $name
     * @param {string} fullPath real path to a node
     * @returns {{ [index: number]: string|number, [variable: string]: string|number }} returns an array-like object with all variable values. All named variables are also set on the array by their name (eg vars.uid and vars.$uid)
     * @example
     * PathInfo.extractVariables('users/$uid/posts/$postid', 'users/ewout/posts/post1/title') === {
     *  0: 'ewout',
     *  1: 'post1',
     *  uid: 'ewout', // or $uid
     *  postid: 'post1' // or $postid
     * };
     * 
     * PathInfo.extractVariables('users/*\/posts/*\/$property', 'users/ewout/posts/post1/title') === {
     *  0: 'ewout',
     *  1: 'post1',
     *  2: 'title',
     *  property: 'title' // or $property
     * };
     * 
     * PathInfo.extractVariables('users/$user/friends[*]/$friend', 'users/dora/friends[4]/diego') === {
     *  0: 'dora',
     *  1: 4,
     *  2: 'diego',
     *  user: 'dora', // or $user
     *  friend: 'diego' // or $friend
     * };
    */
    static extractVariables(varPath, fullPath) {
        if (!varPath.includes('*') && !varPath.includes('$')) { 
            return []; 
        }
        // if (!this.equals(fullPath)) {
        //     throw new Error(`path does not match with the path of this PathInfo instance: info.equals(path) === false!`)
        // }
        const keys = getPathKeys(varPath);
        const pathKeys = getPathKeys(fullPath);
        let count = 0;
        const variables = {
            get length() { return count; }
        };
        keys.forEach((key, index) => {
            const pathKey = pathKeys[index];
            if (key === '*') {
                variables[count++] = pathKey;
            }
            else if (typeof key === 'string' && key[0] === '$') {
                variables[count++] = pathKey;
                // Set the $variable property
                variables[key] = pathKey;
                // Set friendly property name (without $)
                const varName = key.slice(1);
                if (typeof variables[varName] === 'undefined') {
                    variables[varName] = pathKey;
                }
            }
        });
        return variables;
    }

    /**
     * If varPath contains variables or wildcards, it will return a path with the variables replaced by the keys found in fullPath.
     * @param {string} varPath 
     * @param {string} fullPath 
     * @returns {string}
     * @example
     * PathInfo.fillVariables('users/$uid/posts/$postid', 'users/ewout/posts/post1/title') === 'users/ewout/posts/post1'
     */
    static fillVariables(varPath, fullPath) {
        if (varPath.indexOf('*') < 0 && varPath.indexOf('$') < 0) { 
            return varPath; 
        }
        const keys = getPathKeys(varPath);
        const pathKeys = getPathKeys(fullPath);
        let merged = keys.map((key, index) => {
            if (key === pathKeys[index] || index >= pathKeys.length) {
                return key;
            }
            else if (typeof key === 'string' && (key === '*' || key[0] === '$')) {
                return pathKeys[index];
            }
            else {
                throw new Error(`Path "${fullPath}" cannot be used to fill variables of path "${this.path}" because they do not match`);
            }
        });
        let mergedPath = '';
        merged.forEach(key => {
            if (typeof key === 'number') { 
                mergedPath += `[${key}]`; 
            }
            else { 
                if (mergedPath.length > 0) { mergedPath += '/'; }
                mergedPath += key;
            }
        });
        return mergedPath;
    }

    /**
     * Replaces all variables in a path with the values in the vars argument
     * @param {string} varPath path containing variables
     * @param {object} variables variables object such as one gotten from PathInfo.extractVariables
     */
    static fillVariables2(varPath, vars) {
        if (typeof vars !== 'object' || Object.keys(vars).length === 0) {
            return varPath; // Nothing to fill
        }
        let pathKeys = getPathKeys(varPath);
        let n = 0;
        const targetPath = pathKeys.reduce((path, key) => { 
            if (key === '*' || key.startsWith('$')) {
                key = vars[n++];
            }
            if (typeof key === 'number') {
                return `${path}[${key}]`;
            }
            else {
                return `${path}/${key}`;
            }
        }, '');
        return targetPath;
    }

    /**
     * Checks if a given path matches this path, eg "posts/*\/title" matches "posts/12344/title" and "users/123/name" matches "users/$uid/name"
     * @param {string} otherPath 
     * @returns {boolean}
     */
    equals(otherPath) {
        if (this.path === otherPath) { return true; } // they are identical
        const keys = getPathKeys(this.path);
        const otherKeys = getPathKeys(otherPath);
        if (keys.length !== otherKeys.length) { return false; }
        return keys.every((key, index) => {
            const otherKey = otherKeys[index];
            return otherKey === key 
                || (typeof otherKey === 'string' && (otherKey === "*" || otherKey[0] === '$'))
                || (typeof key === 'string' && (key === "*" ||  key[0] === '$'));
        });
    }

    /**
     * Checks if a given path is an ancestor, eg "posts" is an ancestor of "posts/12344/title"
     * @param {string} otherPath 
     * @returns {boolean}
     */
    isAncestorOf(descendantPath) {
        if (descendantPath === '' || this.path === descendantPath) { return false; }
        if (this.path === '') { return true; }
        const ancestorKeys = getPathKeys(this.path);
        const descendantKeys = getPathKeys(descendantPath);
        if (ancestorKeys.length >= descendantKeys.length) { return false; }
        return ancestorKeys.every((key, index) => {
            const otherKey = descendantKeys[index];
            return otherKey === key 
                || (typeof otherKey === 'string' && (otherKey === "*" || otherKey[0] === '$'))
                || (typeof key === 'string' && (key === "*" ||  key[0] === '$'));
        });
    }

    /**
     * Checks if a given path is a descendant, eg "posts/1234/title" is a descendant of "posts"
     * @param {string} otherPath 
     * @returns {boolean}
     */
    isDescendantOf(ancestorPath) {
        if (this.path === '' || this.path === ancestorPath) { return false; }
        if (ancestorPath === '') { return true; }
        const ancestorKeys = getPathKeys(ancestorPath);
        const descendantKeys = getPathKeys(this.path);
        if (ancestorKeys.length >= descendantKeys.length) { return false; }
        return ancestorKeys.every((key, index) => {
            const otherKey = descendantKeys[index];
            return otherKey === key 
                || (typeof otherKey === 'string' && (otherKey === "*" || otherKey[0] === '$'))
                || (typeof key === 'string' && (key === "*" ||  key[0] === '$'));
        });
    }

    /**
     * Checks if a given path is a direct child, eg "posts/1234/title" is a child of "posts/1234"
     * @param {string} otherPath 
     * @returns {boolean}
     */
    isChildOf(otherPath) {
        if (this.path === '') { return false; } // If our path is the root, it's nobody's child...
        const parentInfo = PathInfo.get(this.parentPath);
        return parentInfo.equals(otherPath);
    }

    /**
     * Checks if a given path is its parent, eg "posts/1234" is the parent of "posts/1234/title"
     * @param {string} otherPath 
     * @returns {boolean}
     */
    isParentOf(otherPath) {
        if (otherPath === '') { return false; } // If the other path is the root, this path cannot be its parent...
        const parentInfo = PathInfo.get(PathInfo.get(otherPath).parentPath);
        return parentInfo.equals(this.path);
    }
}

module.exports = { getPathInfo, getChildPath, getPathKeys, PathInfo };
},{}],13:[function(require,module,exports){
class PathReference {
    /**
     * Creates a reference to a path that can be stored in the database. Use this to create cross-references to other data in your database
     * @param {string} path
     */
    constructor(path) {
        this.path = path;
    }
}
module.exports = { PathReference };
},{}],14:[function(require,module,exports){
class EventSubscription {
    /**
     * 
     * @param {() => void} stop function that stops the subscription from receiving future events
     * @param {(callback?: () => void) => Promise<void>} activated function that runs optional callback when subscription is activated, and returns a promise that resolves once activated
     */
    constructor(stop) {
        this.stop = stop;
        this._internal = { 
            state: 'init',
            cancelReason: undefined,
            /** @type {{ callback?: (activated: boolean, cancelReason?: string) => void, resolve?: () => void, reject?: (reason: any) => void}[]} */
            activatePromises: []
        };
    }

    /**
     * Notifies when subscription is activated or canceled
     * @param {callback?: (activated: boolean, cancelReason?: string) => void} [callback] optional callback when subscription is activated or canceled
     * @returns {Promise<void>} returns a promise that resolves once activated, or rejects when it is denied (and no callback was supplied)
     */
    activated(callback = undefined) {
        if (callback) {
            this._internal.activatePromises.push({ callback });
            if (this._internal.state === 'active') {
                callback(true);
            }
            else if (this._internal.state === 'canceled') {
                callback(false, this._internal.cancelReason);
            }
        }
        // Changed behaviour: now also returns a Promise when the callback is used.
        // This allows for 1 activated call to both handle: first activation result, 
        // and any future events using the callback
        return new Promise((resolve, reject) => { 
            if (this._internal.state === 'active') { 
                return resolve(); 
            }
            else if (this._internal.state === 'canceled' && !callback) { 
                return reject(new Error(this._internal.cancelReason)); 
            }
            this._internal.activatePromises.push({ 
                resolve, 
                reject: callback ? () => {} : reject // Don't reject when callback is used: let callback handle this (prevents UnhandledPromiseRejection if only callback is used)
            });
        });
    }

    _setActivationState(activated, cancelReason) {
        this._internal.cancelReason = cancelReason;
        this._internal.state = activated ? 'active' : 'canceled';
        while (this._internal.activatePromises.length > 0) {
            const p = this._internal.activatePromises.shift();
            if (activated) { 
                p.callback && p.callback(true); 
                p.resolve && p.resolve();
            }
            else { 
                p.callback && p.callback(false, cancelReason);
                p.reject && p.reject(cancelReason); 
            }
        }
    }
}

class EventPublisher {
    /**
     * 
     * @param {(val: any) => boolean} publish function that publishes a new value to subscribers, return if there are any active subscribers
     * @param {() => void} start function that notifies subscribers their subscription is activated
     * @param {(reason: string) => void} cancel function that notifies subscribers their subscription has been canceled, removes all subscriptions
     */
    constructor(publish, start, cancel) {
        this.publish = publish;
        this.start = start;
        this.cancel = cancel;
    }
}

class EventStream {

    /**
     * 
     * @param {(eventPublisher: EventPublisher) => void} eventPublisherCallback 
     */
    constructor(eventPublisherCallback) {
        const subscribers = [];
        let noMoreSubscribersCallback;
        let activationState;
        const _stoppedState = 'stopped (no more subscribers)';

        /**
         * Subscribe to new value events in the stream
         * @param {function} callback | function(val) to run once a new value is published
         * @param {(activated: boolean, cancelReason?: string) => void} activationCallback callback that notifies activation or cancelation of the subscription by the publisher. 
         * @returns {EventSubscription} returns a subscription to the requested event
         */
        this.subscribe = (callback, activationCallback) => {
            if (typeof callback !== "function") {
                throw new TypeError("callback must be a function");
            }
            else if (activationState === _stoppedState) {
                throw new Error("stream can't be used anymore because all subscribers were stopped");
            }

            const sub = {
                callback,
                activationCallback: function(activated, cancelReason) {
                    activationCallback && activationCallback(activated, cancelReason);
                    this.subscription._setActivationState(activated, cancelReason);
                },
                // stop() {
                //     subscribers.splice(subscribers.indexOf(this), 1);
                // },
                subscription: new EventSubscription(function stop() {
                    subscribers.splice(subscribers.indexOf(this), 1);
                    checkActiveSubscribers();
                })
            };
            subscribers.push(sub);

            if (typeof activationState !== 'undefined') {
                if (activationState === true) {
                    activationCallback && activationCallback(true);
                    sub.subscription._setActivationState(true);
                }
                else if (typeof activationState === 'string') {
                    activationCallback && activationCallback(false, activationState);
                    sub.subscription._setActivationState(false, activationState);
                }
            }
            return sub.subscription;
        };

        const checkActiveSubscribers = () => {
            if (subscribers.length === 0) {
                noMoreSubscribersCallback && noMoreSubscribersCallback();
                activationState = _stoppedState;
            }
        };

        /**
         * Stops monitoring new value events
         * @param {function} callback | (optional) specific callback to remove. Will remove all callbacks when omitted
         */
        this.unsubscribe = (callback = undefined) => {
            const remove = callback 
                ? subscribers.filter(sub => sub.callback === callback)
                : subscribers;
            remove.forEach(sub => {
                const i = subscribers.indexOf(sub);
                subscribers.splice(i, 1);
            });
            checkActiveSubscribers();
        };

        this.stop = () => {
            // Stop (remove) all subscriptions
            subscribers.splice(0);
            checkActiveSubscribers();
        }

        /**
         * For publishing side: adds a value that will trigger callbacks to all subscribers
         * @param {any} val
         * @returns {boolean} returns whether there are subscribers left
         */
        const publish = (val) => {
            subscribers.forEach(sub => {
                try {
                    sub.callback(val);
                }
                catch(err) {
                    debug.error(`Error running subscriber callback: ${err.message}`);
                }
            });
            return subscribers.length > 0;
        };

        /**
         * For publishing side: let subscribers know their subscription is activated. Should be called only once
         */
        const start = (allSubscriptionsStoppedCallback) => {
            activationState = true;
            noMoreSubscribersCallback = allSubscriptionsStoppedCallback;
            subscribers.forEach(sub => {
                sub.activationCallback && sub.activationCallback(true);
            });
        };

        /**
         * For publishing side: let subscribers know their subscription has been canceled. Should be called only once
         */
        const cancel = (reason) => {
            activationState = reason;
            subscribers.forEach(sub => {
                sub.activationCallback && sub.activationCallback(false, reason || new Error('unknown reason'));
            });
            subscribers.splice(); // Clear all
        }

        const publisher = new EventPublisher(publish, start, cancel);
        eventPublisherCallback(publisher);
    }
}

module.exports = { EventStream, EventPublisher, EventSubscription };
},{}],15:[function(require,module,exports){
const { PathReference } = require('./path-reference');
//const { DataReference } = require('./data-reference');
const { cloneObject } = require('./utils');
const ascii85 = require('./ascii85');

module.exports = {
    deserialize(data) {
        if (data.map === null || typeof data.map === "undefined") {
            return data.val;
        }
        const deserializeValue = (type, val) => {
            if (type === "date") {
                // Date was serialized as a string (UTC)
                return new Date(val);
            }
            else if (type === "binary") {
                // ascii85 encoded binary data
                return ascii85.decode(val);
            }
            else if (type === "reference") {
                return new PathReference(val);
            }
            else if (type === "regexp") {
                return new RegExp(val.pattern, val.flags);
            }
            return val;          
        };
        if (typeof data.map === "string") {
            // Single value
            return deserializeValue(data.map, data.val);
        }
        Object.keys(data.map).forEach(path => {
            const type = data.map[path];
            const keys = path.replace(/\[/g, "/[").split("/");
            keys.forEach((key, index) => {
                if (key.startsWith("[")) { 
                    keys[index] = parseInt(key.substr(1, key.length - 2)); 
                }
            });
            let parent = data;
            let key = "val";
            let val = data.val;
            keys.forEach(k => {
                key = k;
                parent = val;
                val = val[key]; // If an error occurs here, there's something wrong with the calling code...
            });
            parent[key] = deserializeValue(type, val);
        });

        return data.val;
    },

    serialize(obj) {
        // Recursively find dates and binary data
        if (obj === null || typeof obj !== "object" || obj instanceof Date || obj instanceof ArrayBuffer || obj instanceof PathReference) {
            // Single value
            const ser = this.serialize({ value: obj });
            return {
                map: ser.map.value,
                val: ser.val.value
            };
        }
        obj = cloneObject(obj); // Make sure we don't alter the original object
        const process = (obj, mappings, prefix) => {
            Object.keys(obj).forEach(key => {
                const val = obj[key];
                const path = prefix.length === 0 ? key : `${prefix}/${key}`;
                if (val instanceof Date) {
                    // serialize date to UTC string
                    obj[key] = val.toISOString();
                    mappings[path] = "date";
                }
                else if (val instanceof ArrayBuffer) {
                    // Serialize binary data with ascii85
                    obj[key] = ascii85.encode(val); //ascii85.encode(Buffer.from(val)).toString();
                    mappings[path] = "binary";
                }
                else if (val instanceof PathReference) {
                    obj[key] = val.path;
                    mappings[path] = "reference";
                }
                else if (val instanceof RegExp) {
                    // Queries using the 'matches' filter with a regular expression can now also be used on remote db's
                    obj[key] = { pattern: val.source, flags: val.flags };
                    mappings[path] = "regexp";
                }
                else if (typeof val === "object" && val !== null) {
                    process(val, mappings, path);
                }
            });
        };
        const mappings = {};
        process(obj, mappings, "");
        return {
            map: mappings,
            val: obj
        };
    }        
};
},{"./ascii85":6,"./path-reference":13,"./utils":17}],16:[function(require,module,exports){
const { cloneObject } = require('./utils');
const { PathInfo } = require('./path-info');
const { AceBaseBase } = require('./acebase-base');
const { DataReference } = require('./data-reference');
const { DataSnapshot } = require('./data-snapshot');

/**
 * (for internal use) - gets the mapping set for a specific path
 * @param {TypeMappings} mappings
 * @param {string} path 
 */
const get = (mappings, path) => {
    // path points to the mapped (object container) location
    path = path.replace(/^\/|\/$/g, ''); // trim slashes
    // const keys = path.length > 0 ? path.split("/") : [];
    const keys = PathInfo.getPathKeys(path);
    const mappedPath = Object.keys(mappings).find(mpath => {
        // const mkeys = mpath.length > 0 ? mpath.split("/") : [];
        const mkeys = PathInfo.getPathKeys(mpath);
        if (mkeys.length !== keys.length) {
            return false; // Can't be a match
        }
        return mkeys.every((mkey, index) => {
            if (mkey === '*' || mkey[0] === '$') {
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
    const targetPath = PathInfo.get(path).parentPath;
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
    entryPath = entryPath.replace(/^\/|\/$/g, ''); // trim slashes

    // Start with current path's parent node
    const pathInfo = PathInfo.get(entryPath);
    const startPath = pathInfo.parentPath;
    const keys = startPath ? PathInfo.getPathKeys(startPath) : [];

    // Every path that starts with startPath, is a match
    const matches = Object.keys(mappings).reduce((m, mpath) => {

        //const mkeys = mpath.length > 0 ? mpath.split("/") : [];
        const mkeys = PathInfo.getPathKeys(mpath);
        if (mkeys.length < keys.length) {
            return m; // Can't be a match
        }
        let isMatch = true;
        if (keys.length === 0 && startPath !== null) {
            // Only match first node's children if mapping pattern is "*" or "$variable"
            isMatch = mkeys.length === 1 && (mkeys[0] === '*' || mkeys[0][0] === '$');
        }
        else {
            mkeys.every((mkey, index) => {
                if (index >= keys.length) { 
                    return false; // stop .every loop
                } 
                else if (mkey === '*' || mkey[0] === '$' || mkey === keys[index]) {
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
 * @param {AceBaseBase} db
 * @param {TypeMappings} mappings
 * @param {string} path 
 * @param {any} obj
 * @param {string} action | "serialize" or "deserialize"
 * @returns {any} returns the (de)serialized value
 */
const process = (db, mappings, path, obj, action) => {
    if (obj === null || typeof obj !== 'object') { 
        return obj; 
    }
    const keys = PathInfo.getPathKeys(path); // path.length > 0 ? path.split("/") : [];
    const m = mapDeep(mappings, path);
    const changes = [];
    m.sort((a,b) => PathInfo.getPathKeys(a.path).length > PathInfo.getPathKeys(b.path).length ? -1 : 1); // Deepest paths first
    m.forEach(mapping => {
        const mkeys = PathInfo.getPathKeys(mapping.path); //mapping.path.length > 0 ? mapping.path.split("/") : [];
        mkeys.push('*');
        const mTrailKeys = mkeys.slice(keys.length);
        if (mTrailKeys.length === 0) {
            const vars = PathInfo.extractVariables(mapping.path, path);
            const ref = new DataReference(db, path, vars);
            if (action === 'serialize') {
                // serialize this object
                obj = mapping.type.serialize(obj, ref);
            }
            else if (action === 'deserialize') {
                // deserialize this object
                const snap = new DataSnapshot(ref, obj);
                obj = mapping.type.deserialize(snap);
            }
            return;
        }

        // Find all nested objects at this trail path
        const process = (parentPath, parent, keys) => {
            if (obj === null || typeof obj !== 'object') { 
                return obj; 
            }
            const key = keys[0];
            let children = [];
            if (key === '*' || key[0] === '$') {
                // Include all children
                if (parent instanceof Array) {
                    children = parent.map((val, index) => ({ key: index, val }));
                }
                else {
                    children = Object.keys(parent).map(k => ({ key: k, val: parent[k] }));
                }
            }
            else {
                // Get the 1 child
                const child = parent[key];
                if (typeof child === 'object') {
                    children.push({ key, val: child });
                }
            }
            children.forEach(child => { 
                const childPath = PathInfo.getChildPath(parentPath, child.key);
                const vars = PathInfo.extractVariables(mapping.path, childPath);
                const ref = new DataReference(db, childPath, vars);

                if (keys.length === 1) {
                    // TODO: this alters the existing object, we must build our own copy!
                    if (action === 'serialize') {
                        // serialize this object
                        changes.push({ parent, key: child.key, original: parent[child.key] });
                        parent[child.key] = mapping.type.serialize(child.val, ref);
                    }
                    else if (action === 'deserialize') {
                        // deserialize this object
                        const snap = new DataSnapshot(ref, child.val);
                        parent[child.key] = mapping.type.deserialize(snap);
                    }
                }
                else {
                    // Dig deeper
                    process(childPath, child.val, keys.slice(1)); 
                }
            });
        };
        process(path, obj, mTrailKeys);
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
        /** @type {string | ((ref: DataReference, typedObj: any) => any)} */
        this.serializer = options.serializer;
        /** @type {string | ((snap: DataSnapshot) => any)} */
        this.creator = options.creator;
    }
}

const _mappings = Symbol("mappings");
class TypeMappings {
    /**
     * 
     * @param {AceBaseBase} db 
     */
    constructor(db) {
        //this._mappings = {};
        this.db = db;
        this[_mappings] = {};
    }

    get mappings() { return this[_mappings]; }
    map(path) {
        return map(this[_mappings], path);
    }

    /**
     * Maps objects that are stored in a specific path to a class, so they can automatically be 
     * serialized when stored to, and deserialized (instantiated) when loaded from the database.
     * @param {string} path path to an object container, eg "users" or "users/*\/posts"
     * @param {(obj: any) => object} type class to bind all child objects of path to
     * @param {TypeMappingOptions} [options] (optional) You can specify the functions to use to 
     * serialize and/or instantiate your class. If you do not specificy a creator (constructor) method, 
     * AceBase will call YourClass.create(obj, ref) method if it exists, or execute: new YourClass(obj, ref).
     * If you do not specifiy a serializer method, AceBase will call YourClass.prototype.serialize(ref) if it
     * exists, or tries storing your object's fields unaltered. NOTE: 'this' in your creator function will point 
     * to YourClass, and 'this' in your serializer function will point to the instance of YourClass.
     */
    bind(path, type, options = {}) {
        // Maps objects that are stored in a specific path to a constructor method,
        // so they are automatically deserialized
        if (typeof path !== "string") {
            throw new TypeError("path must be a string");
        }
        if (typeof type !== "function") {
            throw new TypeError("constructor must be a function");
        }

        if (typeof options.serializer === 'undefined') {
            // if (typeof type.prototype.serialize === 'function') {
            //     // Use .serialize instance method
            //     options.serializer = type.prototype.serialize;
            // }

            // Use object's serialize method upon serialization (if available)
        }
        else if (typeof options.serializer === 'string') {
            if (typeof type.prototype[options.serializer] === 'function') {
                options.serializer = type.prototype[options.serializer];
            }
            else {
                throw new TypeError(`${type.name}.prototype.${options.serializer} is not a function, cannot use it as serializer`)
            }
        }
        else if (typeof options.serializer !== 'function') {
            throw new TypeError(`serializer for class ${type.name} must be a function, or the name of a prototype method`);
        }

        if (typeof options.creator === 'undefined') {
            if (typeof type.create === 'function') {
                // Use static .create as creator method
                options.creator = type.create;
            }
        }
        else if (typeof options.creator === 'string') {
            if (typeof type[options.creator] === 'function') {
                options.creator = type[options.creator];
            }
            else {
                throw new TypeError(`${type.name}.${options.creator} is not a function, cannot use it as creator`)
            }
        }
        else if (typeof options.creator !== 'function') {
            throw new TypeError(`creator for class ${type.name} must be a function, or the name of a static method`);
        }

        path = path.replace(/^\/|\/$/g, ""); // trim slashes
        this[_mappings][path] = {
            db: this.db,
            type,
            creator: options.creator,
            serializer: options.serializer,
            deserialize(snap) {
                // run constructor method
                let obj;
                if (this.creator) {
                    obj = this.creator.call(this.type, snap)
                }
                else {
                    obj = new this.type(snap);
                }
                return obj;
            },
            serialize(obj, ref) {
                if (this.serializer) {
                    obj = this.serializer.call(obj, ref, obj);
                }
                else if (obj && typeof obj.serialize === 'function') {
                    obj = obj.serialize(ref, obj);
                }
                return obj;
            }
        };
    }

    /**
     * Serializes any child in given object that has a type mapping
     * @param {string} path | path to the object's location
     * @param {object} obj | object to serialize
     */
    serialize(path, obj) {
        return process(this.db, this[_mappings], path, obj, "serialize");
    }

    /**
     * Deserialzes any child in given object that has a type mapping
     * @param {string} path | path to the object's location
     * @param {object} obj | object to deserialize
     */
    deserialize(path, obj) {
        return process(this.db, this[_mappings], path, obj, "deserialize");
    }
}

module.exports = {
    TypeMappings,
    TypeMappingOptions
}

},{"./acebase-base":4,"./data-reference":7,"./data-snapshot":8,"./path-info":12,"./utils":17}],17:[function(require,module,exports){
(function (Buffer){
const { PathReference } = require('./path-reference');

function numberToBytes(number) {
    const bytes = new Uint8Array(8);
    const view = new DataView(bytes.buffer);
    view.setFloat64(0, number);
    return new Array(...bytes);
}

function bytesToNumber(bytes) {
    //if (bytes.length !== 8) { throw "passed value must contain 8 bytes"; }
    if (bytes.length < 8) {
        throw new TypeError("must be 8 bytes");
        // // Pad with zeroes
        // let padding = new Uint8Array(8 - bytes.length);
        // for(let i = 0; i < padding.length; i++) { padding[i] = 0; }
        // bytes = concatTypedArrays(bytes, padding);
    }
    const bin = new Uint8Array(bytes);
    const view = new DataView(bin.buffer);
    const nr = view.getFloat64(0);
    return nr;
}

/**
 * Converts a string to a utf-8 encoded Uint8Array
 * @param {string} str 
 * @returns {Uint8Array}
 */
function encodeString(str) {
    if (typeof TextEncoder !== 'undefined') {
        // Modern browsers, Node.js v11.0.0+ (or v8.3.0+ with util.TextEncoder)
        const encoder = new TextEncoder();
        return encoder.encode(str);
    }
    else if (typeof Buffer === 'function') {
        // Node.js
        const buf = Buffer.from(str, 'utf-8');
        return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    }
    else {
        // Older browsers. Manually encode
        let arr = [];
        for (let i = 0; i < str.length; i++) {
            let code = str.charCodeAt(i);
            if (code > 128) {
                // Attempt simple UTF-8 conversion. See https://en.wikipedia.org/wiki/UTF-8
                if ((code & 0xd800) === 0xd800) {
                    // code starts with 1101 10...: this is a 2-part utf-16 char code
                    const nextCode = str.charCodeAt(i+1);
                    if ((nextCode & 0xdc00) !== 0xdc00) {
                        // next code must start with 1101 11...
                        throw new Error('follow-up utf-16 character does not start with 0xDC00');
                    }
                    i++;
                    const p1 = code & 0x3ff; // Only use last 10 bits
                    const p2 = nextCode & 0x3ff;
                    // Create code point from these 2: (see https://en.wikipedia.org/wiki/UTF-16)
                    code = 0x10000 | (p1 << 10) | p2;
                }
                if (code < 2048) {
                    // Use 2 bytes for 11 bit value, first byte starts with 110xxxxx (0xc0), 2nd byte with 10xxxxxx (0x80)
                    const b1 = 0xc0 | ((code >> 6) & 0x1f); // 0xc0 = 11000000, 0x1f = 11111
                    const b2 = 0x80 | (code & 0x3f); // 0x80 = 10000000, 0x3f = 111111
                    arr.push(b1, b2);
                }
                else if (code < 65536) {
                    // Use 3 bytes for 16-bit value, bits per byte: 4, 6, 6
                    const b1 = 0xe0 | ((code >> 12) & 0xf); // 0xe0 = 11100000, 0xf = 1111
                    const b2 = 0x80 | ((code >> 6) & 0x3f); // 0x80 = 10000000, 0x3f = 111111
                    const b3 = 0x80 | (code & 0x3f);
                    arr.push(b1, b2, b3);
                }
                else if (code < 2097152) {
                    // Use 4 bytes for 21-bit value, bits per byte: 3, 6, 6, 6
                    const b1 = 0xf0 | ((code >> 18) & 0x7); // 0xf0 = 11110000, 0x7 = 111
                    const b2 = 0x80 | ((code >> 12) & 0x3f); // 0x80 = 10000000, 0x3f = 111111
                    const b3 = 0x80 | ((code >> 6) & 0x3f); // 0x80 = 10000000, 0x3f = 111111
                    const b4 = 0x80 | (code & 0x3f);
                    arr.push(b1, b2, b3, b4);                    
                }
                else {
                    throw new Error(`Cannot convert character ${str.charAt(i)} (code ${code}) to utf-8`)
                }
            }
            else {
                arr.push(code < 128 ? code : 63); // 63 = ?
            }
        }
        return new Uint8Array(arr);
    }
}

/**
 * Converts a utf-8 encoded buffer to string
 * @param {ArrayBuffer|Buffer|Uint8Array|number[]} buffer 
 * @returns {string}
 */
function decodeString(buffer) {
    if (typeof TextDecoder !== 'undefined') {
        // Modern browsers, Node.js v11.0.0+ (or v8.3.0+ with util.TextDecoder)
        const decoder = new TextDecoder();
        if (buffer instanceof Uint8Array) {
            return decoder.decode(buffer);
        }
        const buf = Uint8Array.from(buffer);
        return decoder.decode(buf);
    }
    else if (typeof Buffer === 'function') {
        // Node.js
        if (buffer instanceof Buffer) { 
            return buffer.toString('utf-8'); 
        }
        else if (buffer instanceof Array) {
            const typedArray = Uint8Array.from(buffer);
            const buf = Buffer.from(typedArray.buffer, typedArray.byteOffset, typedArray.byteOffset + typedArray.byteLength);
            return buf.toString('utf-8');
        }
        else if ('buffer' in buffer && buffer['buffer'] instanceof ArrayBuffer) {
            const buf = Buffer.from(buffer['buffer'], buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
            return buf.toString('utf-8');
        }
        else {
            throw new Error(`Unsupported buffer argument`);
        }
    }
    else {
        // Older browsers. Manually decode!
        if (!(buffer instanceof Uint8Array) && 'buffer' in buffer && buffer['buffer'] instanceof ArrayBuffer) {
            // Convert TypedArray to Uint8Array
            buffer = new Uint8Array(buffer['buffer'], buffer.byteOffset, buffer.byteLength);
        }
        if (buffer instanceof Buffer || buffer instanceof Array || buffer instanceof Uint8Array) {
            let str = '';
            for (let i = 0; i < buffer.length; i++) {
                let code = buffer[i];
                if (code > 128) {
                    // Decode Unicode character
                    if ((code & 0xf0) === 0xf0) {
                        // 4 byte char
                        const b1 = code, b2 = buffer[i+1], b3 = buffer[i+2], b4 = buffer[i+3];
                        code = ((b1 & 0x7) << 18) | ((b2 & 0x3f) << 12) | ((b3 & 0x3f) << 6) | (b4 & 0x3f);
                        i += 3;
                    }
                    else if ((code & 0xe0) === 0xe0) {
                        // 3 byte char
                        const b1 = code, b2 = buffer[i+1], b3 = buffer[i+2];
                        code = ((b1 & 0xf) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f);
                        i += 2;
                    }
                    else if ((code & 0xc0) === 0xc0) {
                        // 2 byte char
                        const b1 = code, b2 = buffer[i+1];
                        code = ((b1 & 0x1f) << 6) | (b2 & 0x3f);
                        i++;
                    }
                    else {
                        throw new Error(`invalid utf-8 data`);
                    }
                }
                if (code >= 65536) {
                    // Split into 2-part utf-16 char codes
                    code ^= 0x10000;
                    const p1 = 0xd800 | (code >> 10);
                    const p2 = 0xdc00 | (code & 0x3ff);
                    str += String.fromCharCode(p1);
                    str += String.fromCharCode(p2);
                }
                else {
                    str += String.fromCharCode(code);
                }
            }
            return str;
        }
        else {
            throw new Error(`Unsupported buffer argument`);
        }
    }
}

function concatTypedArrays(a, b) {
    const c = new a.constructor(a.length + b.length);
    c.set(a);
    c.set(b, a.length);
    return c;
};

function cloneObject(original, stack) {
    const { DataSnapshot } = require('./data-snapshot'); // Don't move to top, because data-snapshot requires this script (utils)
    if (original instanceof DataSnapshot) {
        throw new TypeError(`Object to clone is a DataSnapshot (path "${original.ref.path}")`);
    }
    
    const checkAndFixTypedArray = obj => {
        if (obj !== null && typeof obj === 'object' 
            && typeof obj.constructor === 'function' && typeof obj.constructor.name === 'string' 
            && ['Buffer','Uint8Array','Int8Array','Uint16Array','Int16Array','Uint32Array','Int32Array','BigUint64Array','BigInt64Array'].includes(obj.constructor.name)) 
        {
            // FIX for typed array being converted to objects with numeric properties:
            // Convert Buffer or TypedArray to ArrayBuffer
            obj = obj.buffer.slice(obj.byteOffset, obj.byteOffset + obj.byteLength);
        }
        return obj;
    };
    original = checkAndFixTypedArray(original);

    if (typeof original !== "object" || original === null || original instanceof Date || original instanceof ArrayBuffer || original instanceof PathReference || original instanceof RegExp) {
        return original;
    }

    const cloneValue = (val) => {
        if (stack.indexOf(val) >= 0) {
            throw new ReferenceError(`object contains a circular reference`);
        }
        val = checkAndFixTypedArray(val);
        if (val === null || val instanceof Date || val instanceof ArrayBuffer || val instanceof PathReference || val instanceof RegExp) { // || val instanceof ID
            return val;
        }
        else if (val instanceof Array) {
            stack.push(val);
            val = val.map(item => cloneValue(item));
            stack.pop();
            return val;
        }
        else if (typeof val === "object") {
            stack.push(val);
            val = cloneObject(val, stack);
            stack.pop();
            return val;
        }
        else {
            return val; // Anything other can just be copied
        }
    }
    if (typeof stack === "undefined") { stack = [original]; }
    const clone = {};
    Object.keys(original).forEach(key => {
        let val = original[key];
        if (typeof val === "function") {
            return; // skip functions
        }
        clone[key] = cloneValue(val);
    });
    return clone;
}

function compareValues (oldVal, newVal) {
    const voids = [undefined, null];
    if (oldVal === newVal) { return "identical"; }
    else if (voids.indexOf(oldVal) >= 0 && voids.indexOf(newVal) < 0) { return "added"; }
    else if (voids.indexOf(oldVal) < 0 && voids.indexOf(newVal) >= 0) { return "removed"; }
    else if (typeof oldVal !== typeof newVal) { return "changed"; }
    else if (typeof oldVal === "object") { 
        // Do key-by-key comparison of objects
        const isArray = oldVal instanceof Array;
        const oldKeys = isArray 
            ? Object.keys(oldVal).map(v => parseInt(v)) //new Array(oldVal.length).map((v,i) => i) 
            : Object.keys(oldVal);
        const newKeys = isArray 
            ? Object.keys(newVal).map(v => parseInt(v)) //new Array(newVal.length).map((v,i) => i) 
            : Object.keys(newVal);
        const removedKeys = oldKeys.filter(key => newKeys.indexOf(key) < 0);
        const addedKeys = newKeys.filter(key => oldKeys.indexOf(key) < 0);
        const changedKeys = newKeys.reduce((changed, key) => { 
            if (oldKeys.indexOf(key) >= 0) {
                const val1 = oldVal[key];
                const val2 = newVal[key];
                const c = compareValues(val1, val2);
                if (c !== "identical") {
                    changed.push({ key, change: c });
                }
            } 
            return changed;
        }, []);

        if (addedKeys.length === 0 && removedKeys.length === 0 && changedKeys.length === 0) {
            return "identical";
        }
        else {
            return {
                added: addedKeys,
                removed: removedKeys,
                changed: changedKeys
            }; 
        }
    }
    else if (oldVal !== newVal) { return "changed"; }
    return "identical";
}

const getChildValues = (childKey, oldValue, newValue) => {
    oldValue = oldValue === null ? null : oldValue[childKey];
    if (typeof oldValue === 'undefined') { oldValue = null; }
    newValue = newValue === null ? null : newValue[childKey];
    if (typeof newValue === 'undefined') { newValue = null; }
    return { oldValue, newValue };
};

module.exports = {
    numberToBytes,
    bytesToNumber,
    concatTypedArrays,
    cloneObject,
    // getPathKeys,
    // getPathInfo,
    // getChildPath,
    compareValues,
    getChildValues,
    encodeString,
    decodeString
};

}).call(this,require("buffer").Buffer)
},{"./data-snapshot":8,"./path-reference":13,"buffer":39}],18:[function(require,module,exports){
/*

The MIT License (MIT)

Original Library
  - Copyright (c) Marak Squires

Additional functionality
 - Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

*/

var colors = {};
module['exports'] = colors;

colors.themes = {};

var util = require('util');
var ansiStyles = colors.styles = require('./styles');
var defineProps = Object.defineProperties;
var newLineRegex = new RegExp(/[\r\n]+/g);

colors.supportsColor = require('./system/supports-colors').supportsColor;

if (typeof colors.enabled === 'undefined') {
  colors.enabled = colors.supportsColor() !== false;
}

colors.enable = function() {
  colors.enabled = true;
};

colors.disable = function() {
  colors.enabled = false;
};

colors.stripColors = colors.strip = function(str) {
  return ('' + str).replace(/\x1B\[\d+m/g, '');
};

// eslint-disable-next-line no-unused-vars
var stylize = colors.stylize = function stylize(str, style) {
  if (!colors.enabled) {
    return str+'';
  }

  return ansiStyles[style].open + str + ansiStyles[style].close;
};

var matchOperatorsRe = /[|\\{}()[\]^$+*?.]/g;
var escapeStringRegexp = function(str) {
  if (typeof str !== 'string') {
    throw new TypeError('Expected a string');
  }
  return str.replace(matchOperatorsRe, '\\$&');
};

function build(_styles) {
  var builder = function builder() {
    return applyStyle.apply(builder, arguments);
  };
  builder._styles = _styles;
  // __proto__ is used because we must return a function, but there is
  // no way to create a function with a different prototype.
  builder.__proto__ = proto;
  return builder;
}

var styles = (function() {
  var ret = {};
  ansiStyles.grey = ansiStyles.gray;
  Object.keys(ansiStyles).forEach(function(key) {
    ansiStyles[key].closeRe =
      new RegExp(escapeStringRegexp(ansiStyles[key].close), 'g');
    ret[key] = {
      get: function() {
        return build(this._styles.concat(key));
      },
    };
  });
  return ret;
})();

var proto = defineProps(function colors() {}, styles);

function applyStyle() {
  var args = Array.prototype.slice.call(arguments);

  var str = args.map(function(arg) {
    if (arg != undefined && arg.constructor === String) {
      return arg;
    } else {
      return util.inspect(arg);
    }
  }).join(' ');

  if (!colors.enabled || !str) {
    return str;
  }

  var newLinesPresent = str.indexOf('\n') != -1;

  var nestedStyles = this._styles;

  var i = nestedStyles.length;
  while (i--) {
    var code = ansiStyles[nestedStyles[i]];
    str = code.open + str.replace(code.closeRe, code.open) + code.close;
    if (newLinesPresent) {
      str = str.replace(newLineRegex, function(match) {
        return code.close + match + code.open;
      });
    }
  }

  return str;
}

colors.setTheme = function(theme) {
  if (typeof theme === 'string') {
    console.log('colors.setTheme now only accepts an object, not a string.  ' +
      'If you are trying to set a theme from a file, it is now your (the ' +
      'caller\'s) responsibility to require the file.  The old syntax ' +
      'looked like colors.setTheme(__dirname + ' +
      '\'/../themes/generic-logging.js\'); The new syntax looks like '+
      'colors.setTheme(require(__dirname + ' +
      '\'/../themes/generic-logging.js\'));');
    return;
  }
  for (var style in theme) {
    (function(style) {
      colors[style] = function(str) {
        if (typeof theme[style] === 'object') {
          var out = str;
          for (var i in theme[style]) {
            out = colors[theme[style][i]](out);
          }
          return out;
        }
        return colors[theme[style]](str);
      };
    })(style);
  }
};

function init() {
  var ret = {};
  Object.keys(styles).forEach(function(name) {
    ret[name] = {
      get: function() {
        return build([name]);
      },
    };
  });
  return ret;
}

var sequencer = function sequencer(map, str) {
  var exploded = str.split('');
  exploded = exploded.map(map);
  return exploded.join('');
};

// custom formatter methods
colors.trap = require('./custom/trap');
colors.zalgo = require('./custom/zalgo');

// maps
colors.maps = {};
colors.maps.america = require('./maps/america')(colors);
colors.maps.zebra = require('./maps/zebra')(colors);
colors.maps.rainbow = require('./maps/rainbow')(colors);
colors.maps.random = require('./maps/random')(colors);

for (var map in colors.maps) {
  (function(map) {
    colors[map] = function(str) {
      return sequencer(colors.maps[map], str);
    };
  })(map);
}

defineProps(colors, init());

},{"./custom/trap":19,"./custom/zalgo":20,"./maps/america":23,"./maps/rainbow":24,"./maps/random":25,"./maps/zebra":26,"./styles":27,"./system/supports-colors":29,"util":45}],19:[function(require,module,exports){
module['exports'] = function runTheTrap(text, options) {
  var result = '';
  text = text || 'Run the trap, drop the bass';
  text = text.split('');
  var trap = {
    a: ['\u0040', '\u0104', '\u023a', '\u0245', '\u0394', '\u039b', '\u0414'],
    b: ['\u00df', '\u0181', '\u0243', '\u026e', '\u03b2', '\u0e3f'],
    c: ['\u00a9', '\u023b', '\u03fe'],
    d: ['\u00d0', '\u018a', '\u0500', '\u0501', '\u0502', '\u0503'],
    e: ['\u00cb', '\u0115', '\u018e', '\u0258', '\u03a3', '\u03be', '\u04bc',
         '\u0a6c'],
    f: ['\u04fa'],
    g: ['\u0262'],
    h: ['\u0126', '\u0195', '\u04a2', '\u04ba', '\u04c7', '\u050a'],
    i: ['\u0f0f'],
    j: ['\u0134'],
    k: ['\u0138', '\u04a0', '\u04c3', '\u051e'],
    l: ['\u0139'],
    m: ['\u028d', '\u04cd', '\u04ce', '\u0520', '\u0521', '\u0d69'],
    n: ['\u00d1', '\u014b', '\u019d', '\u0376', '\u03a0', '\u048a'],
    o: ['\u00d8', '\u00f5', '\u00f8', '\u01fe', '\u0298', '\u047a', '\u05dd',
         '\u06dd', '\u0e4f'],
    p: ['\u01f7', '\u048e'],
    q: ['\u09cd'],
    r: ['\u00ae', '\u01a6', '\u0210', '\u024c', '\u0280', '\u042f'],
    s: ['\u00a7', '\u03de', '\u03df', '\u03e8'],
    t: ['\u0141', '\u0166', '\u0373'],
    u: ['\u01b1', '\u054d'],
    v: ['\u05d8'],
    w: ['\u0428', '\u0460', '\u047c', '\u0d70'],
    x: ['\u04b2', '\u04fe', '\u04fc', '\u04fd'],
    y: ['\u00a5', '\u04b0', '\u04cb'],
    z: ['\u01b5', '\u0240'],
  };
  text.forEach(function(c) {
    c = c.toLowerCase();
    var chars = trap[c] || [' '];
    var rand = Math.floor(Math.random() * chars.length);
    if (typeof trap[c] !== 'undefined') {
      result += trap[c][rand];
    } else {
      result += c;
    }
  });
  return result;
};

},{}],20:[function(require,module,exports){
// please no
module['exports'] = function zalgo(text, options) {
  text = text || '   he is here   ';
  var soul = {
    'up': [
      '̍', '̎', '̄', '̅',
      '̿', '̑', '̆', '̐',
      '͒', '͗', '͑', '̇',
      '̈', '̊', '͂', '̓',
      '̈', '͊', '͋', '͌',
      '̃', '̂', '̌', '͐',
      '̀', '́', '̋', '̏',
      '̒', '̓', '̔', '̽',
      '̉', 'ͣ', 'ͤ', 'ͥ',
      'ͦ', 'ͧ', 'ͨ', 'ͩ',
      'ͪ', 'ͫ', 'ͬ', 'ͭ',
      'ͮ', 'ͯ', '̾', '͛',
      '͆', '̚',
    ],
    'down': [
      '̖', '̗', '̘', '̙',
      '̜', '̝', '̞', '̟',
      '̠', '̤', '̥', '̦',
      '̩', '̪', '̫', '̬',
      '̭', '̮', '̯', '̰',
      '̱', '̲', '̳', '̹',
      '̺', '̻', '̼', 'ͅ',
      '͇', '͈', '͉', '͍',
      '͎', '͓', '͔', '͕',
      '͖', '͙', '͚', '̣',
    ],
    'mid': [
      '̕', '̛', '̀', '́',
      '͘', '̡', '̢', '̧',
      '̨', '̴', '̵', '̶',
      '͜', '͝', '͞',
      '͟', '͠', '͢', '̸',
      '̷', '͡', ' ҉',
    ],
  };
  var all = [].concat(soul.up, soul.down, soul.mid);

  function randomNumber(range) {
    var r = Math.floor(Math.random() * range);
    return r;
  }

  function isChar(character) {
    var bool = false;
    all.filter(function(i) {
      bool = (i === character);
    });
    return bool;
  }


  function heComes(text, options) {
    var result = '';
    var counts;
    var l;
    options = options || {};
    options['up'] =
      typeof options['up'] !== 'undefined' ? options['up'] : true;
    options['mid'] =
      typeof options['mid'] !== 'undefined' ? options['mid'] : true;
    options['down'] =
      typeof options['down'] !== 'undefined' ? options['down'] : true;
    options['size'] =
      typeof options['size'] !== 'undefined' ? options['size'] : 'maxi';
    text = text.split('');
    for (l in text) {
      if (isChar(l)) {
        continue;
      }
      result = result + text[l];
      counts = {'up': 0, 'down': 0, 'mid': 0};
      switch (options.size) {
      case 'mini':
        counts.up = randomNumber(8);
        counts.mid = randomNumber(2);
        counts.down = randomNumber(8);
        break;
      case 'maxi':
        counts.up = randomNumber(16) + 3;
        counts.mid = randomNumber(4) + 1;
        counts.down = randomNumber(64) + 3;
        break;
      default:
        counts.up = randomNumber(8) + 1;
        counts.mid = randomNumber(6) / 2;
        counts.down = randomNumber(8) + 1;
        break;
      }

      var arr = ['up', 'mid', 'down'];
      for (var d in arr) {
        var index = arr[d];
        for (var i = 0; i <= counts[index]; i++) {
          if (options[index]) {
            result = result + soul[index][randomNumber(soul[index].length)];
          }
        }
      }
    }
    return result;
  }
  // don't summon him
  return heComes(text, options);
};


},{}],21:[function(require,module,exports){
var colors = require('./colors');

module['exports'] = function() {
  //
  // Extends prototype of native string object to allow for "foo".red syntax
  //
  var addProperty = function(color, func) {
    String.prototype.__defineGetter__(color, func);
  };

  addProperty('strip', function() {
    return colors.strip(this);
  });

  addProperty('stripColors', function() {
    return colors.strip(this);
  });

  addProperty('trap', function() {
    return colors.trap(this);
  });

  addProperty('zalgo', function() {
    return colors.zalgo(this);
  });

  addProperty('zebra', function() {
    return colors.zebra(this);
  });

  addProperty('rainbow', function() {
    return colors.rainbow(this);
  });

  addProperty('random', function() {
    return colors.random(this);
  });

  addProperty('america', function() {
    return colors.america(this);
  });

  //
  // Iterate through all default styles and colors
  //
  var x = Object.keys(colors.styles);
  x.forEach(function(style) {
    addProperty(style, function() {
      return colors.stylize(this, style);
    });
  });

  function applyTheme(theme) {
    //
    // Remark: This is a list of methods that exist
    // on String that you should not overwrite.
    //
    var stringPrototypeBlacklist = [
      '__defineGetter__', '__defineSetter__', '__lookupGetter__',
      '__lookupSetter__', 'charAt', 'constructor', 'hasOwnProperty',
      'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString', 'toString',
      'valueOf', 'charCodeAt', 'indexOf', 'lastIndexOf', 'length',
      'localeCompare', 'match', 'repeat', 'replace', 'search', 'slice',
      'split', 'substring', 'toLocaleLowerCase', 'toLocaleUpperCase',
      'toLowerCase', 'toUpperCase', 'trim', 'trimLeft', 'trimRight',
    ];

    Object.keys(theme).forEach(function(prop) {
      if (stringPrototypeBlacklist.indexOf(prop) !== -1) {
        console.log('warn: '.red + ('String.prototype' + prop).magenta +
          ' is probably something you don\'t want to override.  ' +
          'Ignoring style name');
      } else {
        if (typeof(theme[prop]) === 'string') {
          colors[prop] = colors[theme[prop]];
        } else {
          var tmp = colors[theme[prop][0]];
          for (var t = 1; t < theme[prop].length; t++) {
            tmp = tmp[theme[prop][t]];
          }
          colors[prop] = tmp;
        }
        addProperty(prop, function() {
          return colors[prop](this);
        });
      }
    });
  }

  colors.setTheme = function(theme) {
    if (typeof theme === 'string') {
      console.log('colors.setTheme now only accepts an object, not a string. ' +
        'If you are trying to set a theme from a file, it is now your (the ' +
        'caller\'s) responsibility to require the file.  The old syntax ' +
        'looked like colors.setTheme(__dirname + ' +
        '\'/../themes/generic-logging.js\'); The new syntax looks like '+
        'colors.setTheme(require(__dirname + ' +
        '\'/../themes/generic-logging.js\'));');
       return;
    } else {
      applyTheme(theme);
    }
  };
};

},{"./colors":18}],22:[function(require,module,exports){
var colors = require('./colors');
module['exports'] = colors;

// Remark: By default, colors will add style properties to String.prototype.
//
// If you don't wish to extend String.prototype, you can do this instead and
// native String will not be touched:
//
//   var colors = require('colors/safe);
//   colors.red("foo")
//
//
require('./extendStringPrototype')();

},{"./colors":18,"./extendStringPrototype":21}],23:[function(require,module,exports){
module['exports'] = function(colors) {
  return function(letter, i, exploded) {
    if (letter === ' ') return letter;
    switch (i%3) {
      case 0: return colors.red(letter);
      case 1: return colors.white(letter);
      case 2: return colors.blue(letter);
    }
  };
};

},{}],24:[function(require,module,exports){
module['exports'] = function(colors) {
  // RoY G BiV
  var rainbowColors = ['red', 'yellow', 'green', 'blue', 'magenta'];
  return function(letter, i, exploded) {
    if (letter === ' ') {
      return letter;
    } else {
      return colors[rainbowColors[i++ % rainbowColors.length]](letter);
    }
  };
};


},{}],25:[function(require,module,exports){
module['exports'] = function(colors) {
  var available = ['underline', 'inverse', 'grey', 'yellow', 'red', 'green',
    'blue', 'white', 'cyan', 'magenta'];
  return function(letter, i, exploded) {
    return letter === ' ' ? letter :
      colors[
        available[Math.round(Math.random() * (available.length - 2))]
      ](letter);
  };
};

},{}],26:[function(require,module,exports){
module['exports'] = function(colors) {
  return function(letter, i, exploded) {
    return i % 2 === 0 ? letter : colors.inverse(letter);
  };
};

},{}],27:[function(require,module,exports){
/*
The MIT License (MIT)

Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

*/

var styles = {};
module['exports'] = styles;

var codes = {
  reset: [0, 0],

  bold: [1, 22],
  dim: [2, 22],
  italic: [3, 23],
  underline: [4, 24],
  inverse: [7, 27],
  hidden: [8, 28],
  strikethrough: [9, 29],

  black: [30, 39],
  red: [31, 39],
  green: [32, 39],
  yellow: [33, 39],
  blue: [34, 39],
  magenta: [35, 39],
  cyan: [36, 39],
  white: [37, 39],
  gray: [90, 39],
  grey: [90, 39],

  bgBlack: [40, 49],
  bgRed: [41, 49],
  bgGreen: [42, 49],
  bgYellow: [43, 49],
  bgBlue: [44, 49],
  bgMagenta: [45, 49],
  bgCyan: [46, 49],
  bgWhite: [47, 49],

  // legacy styles for colors pre v1.0.0
  blackBG: [40, 49],
  redBG: [41, 49],
  greenBG: [42, 49],
  yellowBG: [43, 49],
  blueBG: [44, 49],
  magentaBG: [45, 49],
  cyanBG: [46, 49],
  whiteBG: [47, 49],

};

Object.keys(codes).forEach(function(key) {
  var val = codes[key];
  var style = styles[key] = [];
  style.open = '\u001b[' + val[0] + 'm';
  style.close = '\u001b[' + val[1] + 'm';
});

},{}],28:[function(require,module,exports){
(function (process){
/*
MIT License

Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com)

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

'use strict';

module.exports = function(flag, argv) {
  argv = argv || process.argv;

  var terminatorPos = argv.indexOf('--');
  var prefix = /^-{1,2}/.test(flag) ? '' : '--';
  var pos = argv.indexOf(prefix + flag);

  return pos !== -1 && (terminatorPos === -1 ? true : pos < terminatorPos);
};

}).call(this,require('_process'))
},{"_process":43}],29:[function(require,module,exports){
(function (process){
/*
The MIT License (MIT)

Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

*/

'use strict';

var os = require('os');
var hasFlag = require('./has-flag.js');

var env = process.env;

var forceColor = void 0;
if (hasFlag('no-color') || hasFlag('no-colors') || hasFlag('color=false')) {
  forceColor = false;
} else if (hasFlag('color') || hasFlag('colors') || hasFlag('color=true')
           || hasFlag('color=always')) {
  forceColor = true;
}
if ('FORCE_COLOR' in env) {
  forceColor = env.FORCE_COLOR.length === 0
    || parseInt(env.FORCE_COLOR, 10) !== 0;
}

function translateLevel(level) {
  if (level === 0) {
    return false;
  }

  return {
    level: level,
    hasBasic: true,
    has256: level >= 2,
    has16m: level >= 3,
  };
}

function supportsColor(stream) {
  if (forceColor === false) {
    return 0;
  }

  if (hasFlag('color=16m') || hasFlag('color=full')
      || hasFlag('color=truecolor')) {
    return 3;
  }

  if (hasFlag('color=256')) {
    return 2;
  }

  if (stream && !stream.isTTY && forceColor !== true) {
    return 0;
  }

  var min = forceColor ? 1 : 0;

  if (process.platform === 'win32') {
    // Node.js 7.5.0 is the first version of Node.js to include a patch to
    // libuv that enables 256 color output on Windows. Anything earlier and it
    // won't work. However, here we target Node.js 8 at minimum as it is an LTS
    // release, and Node.js 7 is not. Windows 10 build 10586 is the first
    // Windows release that supports 256 colors. Windows 10 build 14931 is the
    // first release that supports 16m/TrueColor.
    var osRelease = os.release().split('.');
    if (Number(process.versions.node.split('.')[0]) >= 8
        && Number(osRelease[0]) >= 10 && Number(osRelease[2]) >= 10586) {
      return Number(osRelease[2]) >= 14931 ? 3 : 2;
    }

    return 1;
  }

  if ('CI' in env) {
    if (['TRAVIS', 'CIRCLECI', 'APPVEYOR', 'GITLAB_CI'].some(function(sign) {
      return sign in env;
    }) || env.CI_NAME === 'codeship') {
      return 1;
    }

    return min;
  }

  if ('TEAMCITY_VERSION' in env) {
    return (/^(9\.(0*[1-9]\d*)\.|\d{2,}\.)/.test(env.TEAMCITY_VERSION) ? 1 : 0
    );
  }

  if ('TERM_PROGRAM' in env) {
    var version = parseInt((env.TERM_PROGRAM_VERSION || '').split('.')[0], 10);

    switch (env.TERM_PROGRAM) {
      case 'iTerm.app':
        return version >= 3 ? 3 : 2;
      case 'Hyper':
        return 3;
      case 'Apple_Terminal':
        return 2;
      // No default
    }
  }

  if (/-256(color)?$/i.test(env.TERM)) {
    return 2;
  }

  if (/^screen|^xterm|^vt100|^rxvt|color|ansi|cygwin|linux/i.test(env.TERM)) {
    return 1;
  }

  if ('COLORTERM' in env) {
    return 1;
  }

  if (env.TERM === 'dumb') {
    return min;
  }

  return min;
}

function getSupportLevel(stream) {
  var level = supportsColor(stream);
  return translateLevel(level);
}

module.exports = {
  supportsColor: getSupportLevel,
  stdout: getSupportLevel(process.stdout),
  stderr: getSupportLevel(process.stderr),
};

}).call(this,require('_process'))
},{"./has-flag.js":28,"_process":43,"os":42}],30:[function(require,module,exports){
/**
   ________________________________________________________________________________
   
      ___          ______                
     / _ \         | ___ \               
    / /_\ \ ___ ___| |_/ / __ _ ___  ___ 
    |  _  |/ __/ _ \ ___ \/ _` / __|/ _ \
    | | | | (_|  __/ |_/ / (_| \__ \  __/
    \_| |_/\___\___\____/ \__,_|___/\___|
                                     
   Copyright 2018 by Ewout Stortenbeker (me@appy.one)   
   Published under MIT license
   ________________________________________________________________________________
  
 */
const { AceBaseBase, AceBaseSettings } = require('acebase-core');
const { StorageSettings } = require('./storage');
const { LocalApi } = require('./api-local');

class AceBaseLocalSettings {
    /**
     * 
     * @param {{ logLevel: 'verbose'|'log'|'warn'|'error', storage: StorageSettings }} options 
     */
    constructor(options) {
        if (!options) { options = {}; }
        this.logLevel = options.logLevel || 'log';
        this.storage = options.storage; ////new StorageOptions(options.storage);
    }
}

class AceBase extends AceBaseBase {

    /**
     * 
     * @param {string} dbname | Name of the database to open or create
     * @param {AceBaseLocalSettings} options | 
     */
    constructor(dbname, options) {
        options = new AceBaseLocalSettings(options);
        super(dbname, options);
        const apiSettings = { 
            db: this,
            storage: options.storage,
            logLevel: options.logLevel
        };
        this.api = new LocalApi(dbname, apiSettings, ready => {
            this.emit("ready");
        });
    }
}

class BrowserAceBase extends AceBase {
    /**
     * Convenience class for using AceBase in the browser without supplying additional settings.
     * Uses the browser's localStorage or sessionStorage.
     * @param {string} name database name
     * @param {object} [settings] optional settings
     * @param {string} [settings.logLevel] what level to use for logging to the console
     * @param {boolean} [settings.temp] whether to use sessionStorage instead of localStorage
     */
    constructor(name, settings) {
        settings = settings || {};
        const { LocalStorageSettings } = require('./storage-localstorage');
        settings.storage = new LocalStorageSettings();
        if (settings.temp === true) {
            settings.storage.session = true;
            delete settings.temp;
        }
        super(name, settings);
    }
}

module.exports = { AceBase, AceBaseLocalSettings, BrowserAceBase };
},{"./api-local":31,"./storage":38,"./storage-localstorage":37,"acebase-core":11}],31:[function(require,module,exports){
const { Api, Utils } = require('acebase-core');
const { AceBase } = require('./acebase-local');
const { StorageSettings } = require('./storage');
const { AceBaseStorage, AceBaseStorageSettings } = require('./storage-acebase');
const { SQLiteStorage, SQLiteStorageSettings } = require('./storage-sqlite');
const { MSSQLStorage, MSSQLStorageSettings } = require('./storage-mssql');
const { LocalStorage, LocalStorageSettings } = require('./storage-localstorage');
const { Node } = require('./node');
const { DataIndex } = require('./data-index');

class LocalApi extends Api {
    // All api methods for local database instance
    
    /**
     * 
     * @param {{db: AceBase, storage: StorageSettings, logLevel?: string }} settings
     */
    constructor(dbname = "default", settings, readyCallback) {
        super();
        this.db = settings.db;

        if (typeof settings.storage === 'object') {
            settings.storage.logLevel = settings.logLevel;
            if (SQLiteStorageSettings && (settings.storage instanceof SQLiteStorageSettings || settings.storage.type === 'sqlite')) {
                this.storage = new SQLiteStorage(dbname, settings.storage);
            }
            else if (MSSQLStorageSettings && (settings.storage instanceof MSSQLStorageSettings || settings.storage.type === 'mssql')) {
                this.storage = new MSSQLStorage(dbname, settings.storage);
            }
            else if (LocalStorageSettings && (settings.storage instanceof LocalStorageSettings || settings.storage.type === 'localstorage')) {
                this.storage = new LocalStorage(dbname, settings.storage);
            }
            else {
                const storageSettings = settings.storage instanceof AceBaseStorageSettings
                    ? settings.storage
                    : new AceBaseStorageSettings(settings.storage);
                this.storage = new AceBaseStorage(dbname, storageSettings);
            }
        }
        else {
            settings.storage = new AceBaseStorageSettings({ logLevel: settings.logLevel });
            this.storage = new AceBaseStorage(dbname, settings.storage);
        }
        this.storage.on("ready", readyCallback);
    }

    stats(options) {
        return Promise.resolve(this.storage.stats);
    }

    subscribe(path, event, callback) {
        this.storage.subscriptions.add(path, event, callback);
    }

    unsubscribe(path, event = undefined, callback = undefined) {
        this.storage.subscriptions.remove(path, event, callback);
    }

    set(path, value, flags = undefined) {
        return Node.update(this.storage, path, value, { merge: false });
    }

    update(path, updates, flags = undefined) {
        return Node.update(this.storage, path, updates, { merge: true });
    }

    get(path, options) {
        return Node.getValue(this.storage, path, options);
    }

    transaction(path, callback) {
        return Node.transaction(this.storage, path, callback);
    }

    exists(path) {
        return Node.exists(this.storage, path);
    }

    query2(path, query, options = { snapshots: false, include: undefined, exclude: undefined, child_objects: undefined }) {
        /*
        
        Now that we're using indexes to filter data and order upon, each query requires a different strategy
        to get the results the quickest.

        So, we'll analyze the query first, build a strategy and then execute the strategy

        Analyze stage:
        - what path is being queried (wildcard path or single parent)
        - which indexes are available for the path
        - which indexes can be used for filtering
        - which indexes can be used for sorting
        - is take/skip used to limit the result set
        
        Strategy stage:
        - chain index filtering
        - ....

        TODO!
        */
    }

    /**
     * 
     * @param {string} path 
     * @param {object} query 
     * @param {Array<{ key: string, op: string, compare: any}>} query.filters
     * @param {number} query.skip number of results to skip, useful for paging
     * @param {number} query.take max number of results to return
     * @param {Array<{ key: string, ascending: boolean }>} query.order
     * @param {object} [options]
     * @param {boolean} [options.snapshots=false] whether to return matching data, or paths to matching nodes only
     * @param {string[]} [options.include] when using snapshots, keys or relative paths to include in result data
     * @param {string[]} [options.exclude] when using snapshots, keys or relative paths to exclude from result data
     * @param {boolean} [options.child_objects] when using snapshots, whether to include child objects in result data
     * @param {(event: { name: string, [key]: any }) => void} [options.eventHandler]
     * @param {object} [options.monitor] NEW (BETA) monitor changes
     * @param {boolean} [options.monitor.add=false] monitor new matches (either because they were added, or changed and now match the query)
     * @param {boolean} [options.monitor.change=false] monitor changed children that still match this query
     * @param {boolean} [options.monitor.remove=false] monitor children that don't match this query anymore
     * @ param {(event:string, path: string, value?: any) => boolean} [options.monitor.callback] NEW (BETA) callback with subscription to enable monitoring of new matches
     * @returns {Promise<object[]|string[]>} returns a promise that resolves with matching data or paths
     */
    query(path, query, options = { snapshots: false, include: undefined, exclude: undefined, child_objects: undefined, eventHandler: event => {} }) {
        if (typeof options !== "object") { options = {}; }
        if (typeof options.snapshots === "undefined") { options.snapshots = false; }
        
        const sortMatches = (matches) => {
            matches.sort((a,b) => {
                const compare = (i) => {
                    const o = query.order[i];
                    let left = a.val[o.key];
                    let right = b.val[o.key];
                    // if (typeof left !== typeof right) {
                    //     // Wow. Using 2 different types in your data, AND sorting on it. 
                    //     // compare the types instead of their values ;-)
                    //     left = typeof left;
                    //     right = typeof right;
                    // }
                    if (typeof left === 'undefined' && typeof right !== 'undefined') { return o.ascending ? -1 : 1; }
                    if (typeof left !== 'undefined' && typeof right === 'undefined') { return o.ascending ? 1 : -1; }
                    if (typeof left === 'undefined' && typeof right === 'undefined') { return 0; }
                    if (left == right) {
                        if (i < query.order.length - 1) { return compare(i+1); }
                        else { return a.path < b.path ? -1 : 1; } // Sort by path if property values are equal
                    }
                    else if (left < right) {
                        return o.ascending ? -1 : 1;
                    }
                    else if (left > right) {
                        return o.ascending ? 1 : -1;
                    }
                };
                return compare(0);
            });
        };
        const loadResultsData = (preResults, options) => {
            // Limit the amount of concurrent getValue calls by batching them
            if (preResults.length === 0) {
                return Promise.resolve([]);
            }
            const maxBatchSize = 50;
            let batches = [];
            const items = preResults.map((result, index) => ({ path: result.path, index }));
            while (items.length > 0) {
                let batchItems= items.splice(0, maxBatchSize);
                batches.push(batchItems);
            }
            const results = [];
            const nextBatch = () => {
                const batch = batches.shift();
                return Promise.all(batch.map(item => {
                    const { path, index } = item;
                    return Node.getValue(this.storage, path, options)
                    .then(val => {
                        if (val === null) { 
                            // Record was deleted, but index isn't updated yet?
                            this.storage.debug.warn(`Indexed result "/${path}" does not have a record!`);
                            // TODO: let index rebuild
                            return; 
                        }
                        
                        const result = { path, val };
                        if (stepsExecuted.sorted) {
                            // Put the result in the same index as the preResult was
                            results[index] = result;
                        }
                        else {
                            results.push(result);
                            if (!stepsExecuted.skipped && results.length > query.skip + query.take) {
                                // we can toss a value! sort, toss last one 
                                sortMatches(results);
                                results.pop(); // toss last value
                            }
                        }
                    });
                }))
                .then(() => {
                    if (batches.length > 0) { 
                        return nextBatch(); 
                    }
                });
            };
            return nextBatch()
            .then(() => {
                // Got all values
                return results;
            });                
        };

        const isWildcardPath = path.indexOf('*') >= 0 || path.indexOf('$') >= 0;

        const availableIndexes = this.storage.indexes.get(path);
        const usingIndexes = [];
        query.filters.forEach(filter => {
            if (filter.index) { 
                // Index has been assigned already
                return; 
            }
            const indexesOnKey = availableIndexes
                .filter(index => index.key === filter.key)
                .filter(index => {
                    return index.validOperators.includes(filter.op);
                });

            if (indexesOnKey.length >= 1) {
                // If there are multiple indexes on 1 key (happens when index includes other keys), 
                // we should check other .filters and .order to determine the best one to use
                // TODO: Create a good strategy here...
                const otherFilterKeys = query.filters.filter(f => f !== filter).map(f => f.key);
                const sortKeys = query.order.map(o => o.key).filter(key => key !== filter.key);
                const beneficialIndexes = indexesOnKey.map(index => {
                    const availableKeys = index.includeKeys.concat(index.key);
                    const forOtherFilters = availableKeys.filter(key => otherFilterKeys.indexOf(key) >= 0);
                    const forSorting = availableKeys.filter(key => sortKeys.indexOf(key) >= 0);
                    const forBoth = forOtherFilters.concat(forSorting.filter(index => forOtherFilters.indexOf(index) < 0));
                    const points = {
                        filters: forOtherFilters.length,
                        sorting: forSorting.length * (query.take > 0 ? forSorting.length : 1),
                        both: forBoth.length * forBoth.length,
                        get total() {
                            return this.filters + this.sorting + this.both;
                        }
                    }
                    return { index, points: points.total, filterKeys: forOtherFilters, sortKeys: forSorting };
                });
                // Use index with the most points
                beneficialIndexes.sort((a,b) => a.points > b.points ? -1 : 1);
                const bestBenificialIndex = beneficialIndexes[0];
                
                // Assign to this filter
                filter.index = bestBenificialIndex.index;

                // Assign to other filters and sorts
                bestBenificialIndex.filterKeys.forEach(key => {
                    query.filters.filter(f => f !== filter && f.key === key).forEach(f => {
                        if (!DataIndex.validOperators.includes(f.op)) {
                            // The used operator for this filter is invalid for use on metadata
                            // Probably because it is an Array/Fulltext/Geo query operator
                            return;
                        }
                        f.indexUsage = 'filter';
                        f.index = bestBenificialIndex.index;
                    });
                });
                bestBenificialIndex.sortKeys.forEach(key => {
                    query.order.filter(s => s.key === key).forEach(s => {
                        s.index = bestBenificialIndex.index;
                    });
                });
            }
            if (filter.index) {
                usingIndexes.push({ index: filter.index, description: filter.index.description});
            }
        });

        if (query.order.length > 0 && query.take > 0) {
            query.order.forEach(sort => {
                if (sort.index) {
                    // Index has been assigned already
                    return;
                }
                sort.index = availableIndexes
                    .filter(index => index.key === sort.key)
                    .find(index => index.type === 'normal');

                // if (sort.index) {
                //     usingIndexes.push({ index: sort.index, description: `${sort.index.description} (for sorting)`});
                // }
            });
        }

        // const usingIndexes = query.filters.map(filter => filter.index).filter(index => index);
        const indexDescriptions = usingIndexes.map(index => index.description).join(', ');
        usingIndexes.length > 0 && this.storage.debug.log(`Using indexes for query: ${indexDescriptions}`);

        // Filters that should run on all nodes after indexed results:
        const tableScanFilters = query.filters.filter(filter => !filter.index);

        // Check if there are filters that require an index to run (such as "fulltext:contains", and "geo:nearby" etc)
        const specialOpsRegex = /^[a-z]+\:/i;
        if (tableScanFilters.some(filter => specialOpsRegex.test(filter.op))) {
            const f = tableScanFilters.find(filter => specialOpsRegex.test(filter.op));
            const err = new Error(`query contains operator "${f.op}" which requires a special index that was not found on path "${path}", key "${f.key}"`)
            return Promise.reject(err);
        }

        // Check if the filters are using valid operators
        const allowedTableScanOperators = ["<","<=","==","!=",">=",">","like","!like","in","!in","matches","!matches","between","!between","has","!has","contains","!contains","exists","!exists"]; // DISABLED "custom" because it is not fully implemented and only works locally
        for(let i = 0; i < tableScanFilters.length; i++) {
            const f = tableScanFilters[i];
            if (!allowedTableScanOperators.includes(f.op)) {
                return Promise.reject(new Error(`query contains unknown filter operator "${f.op}" on path "${path}", key "${f.key}"`));
            }
        }

        // Check if the available indexes are sufficient for this wildcard query
        if (isWildcardPath && tableScanFilters.length > 0) {
            // There are unprocessed filters, which means the fields aren't indexed. 
            // We're not going to get all data of a wildcard path to query manually. 
            // Indexes must be created
            const keys = tableScanFilters.reduce((keys, f) => { 
                if (keys.indexOf(f.key) < 0) { keys.push(f.key); }
                return keys;
            }, []).map(key => `"${key}"`);
            const err = new Error(`This wildcard path query on "/${path}" requires index(es) on key(s): ${keys.join(", ")}. Create the index(es) and retry`);
            return Promise.reject(err);
        }

        // Run queries on available indexes
        const indexScanPromises = [];
        query.filters.forEach(filter => {
            if (filter.index && filter.indexUsage !== 'filter') {
                let promise = filter.index.query(filter.op, filter.compare)
                .then(results => {
                    options.eventHandler && options.eventHandler({ name: 'stats', type: 'index_query', source: filter.index.description, stats: results.stats });
                    if (results.hints.length > 0) {
                        options.eventHandler && options.eventHandler({ name: 'hints', type: 'index_query', source: filter.index.description, hints: results.hints });
                    }
                    return results;
                });
                
                // Get other filters that can be executed on these indexed results (eg filters on included keys of the index)
                const resultFilters = query.filters.filter(f => f.index === filter.index && f.indexUsage === 'filter');
                if (resultFilters.length > 0) {
                    // Hook into the promise
                    promise = promise.then(results => {
                        resultFilters.forEach(filter => {
                            results = results.filterMetadata(filter.key, filter.op, filter.compare);
                        });
                        return results;
                    });
                }
                indexScanPromises.push(promise);
            }
        });

        const stepsExecuted = {
            filtered: query.filters.length === 0,
            skipped: query.skip === 0,
            taken: query.take === 0,
            sorted: query.order.length === 0,
            preDataLoaded: false,
            dataLoaded: false
        };

        if (query.filters.length === 0 && query.take === 0) { 
            this.storage.debug.error(`Filterless queries must use .take to limit the results. Defaulting to 100 for query on path "${path}"`);
            query.take = 100;
        }

        if (query.filters.length === 0 && query.order.length > 0 && query.order[0].index) {
            const sortIndex = query.order[0].index;
            this.storage.debug.log(`Using index for sorting: ${sortIndex.description}`);
            const promise = sortIndex.take(query.skip, query.take, query.order[0].ascending)
            .then(results => {
                options.eventHandler && options.eventHandler({ name: 'stats', type: 'sort_index_take', source: filter.index.description, stats: results.stats });
                if (results.hints.length > 0) {
                    options.eventHandler && options.eventHandler({ name: 'hints', type: 'sort_index_take', source: filter.index.description, hints: results.hints });
                }
                return results;
            });
            indexScanPromises.push(promise);
            stepsExecuted.skipped = true;
            stepsExecuted.taken = true;
            stepsExecuted.sorted = true;
        }

        return Promise.all(indexScanPromises)
        .then(indexResultSets => {
            // Merge all results in indexResultSets, get distinct nodes
            let indexedResults = [];
            if (indexResultSets.length === 1) {
                const resultSet = indexResultSets[0];
                indexedResults = resultSet.map(match => {
                    const result = { key: match.key, path: match.path, val: { [resultSet.filterKey]: match.value } };
                    match.metadata && Object.assign(result.val, match.metadata);
                    return result;
                });
                stepsExecuted.filtered = true;
            }
            else if (indexResultSets.length > 1) {
                indexResultSets.sort((a,b) => a.length < b.length ? -1 : 1); // Sort results, shortest result set first
                const shortestSet = indexResultSets[0];
                const otherSets = indexResultSets.slice(1);

                indexedResults = shortestSet.reduce((results, match) => {
                    // Check if the key is present in the other result sets
                    const result = { key: match.key, path: match.path, val: { [shortestSet.filterKey]: match.value } };
                    const matchedInAllSets = otherSets.every(set => set.findIndex(m => match.path === match.path) >= 0);
                    if (matchedInAllSets) { 
                        match.metadata && Object.assign(result.val, match.metadata);
                        otherSets.forEach(set => {
                            const otherResult = set.find(r => r.path === result.path)
                            result.val[set.filterKey] = otherResult.value;
                            otherResult.metadata && Object.assign(result.val, otherResult.metadata)
                        });
                        results.push(result); 
                    }
                    return results;
                }, []);

                stepsExecuted.filtered = true;
            }
        
            if (isWildcardPath || (indexScanPromises.length > 0 && tableScanFilters.length === 0)) {

                if (query.order.length === 0 || query.order.every(o => o.index)) {
                    // No sorting, or all sorts are on indexed keys. We can use current index results
                    stepsExecuted.preDataLoaded = true;
                    if (!stepsExecuted.sorted && query.order.length > 0) {
                        sortMatches(indexedResults);
                    }
                    stepsExecuted.sorted = true;
                    if (!stepsExecuted.skipped && query.skip > 0) {
                        indexedResults = indexedResults.slice(query.skip);
                    }
                    if (!stepsExecuted.taken && query.take > 0) {
                        indexedResults = indexedResults.slice(0, query.take);
                    }
                    stepsExecuted.skipped = true;
                    stepsExecuted.taken = true;

                    if (!options.snapshots) {
                        return indexedResults;
                    }

                    // TODO: exclude already known key values, merge loaded with known 
                    const childOptions = { include: options.include, exclude: options.exclude, child_objects: options.child_objects };
                    return loadResultsData(indexedResults, childOptions)
                    .then(results => {
                        stepsExecuted.dataLoaded = true;
                        return results;
                    });
                }
                
                if (options.snapshots || !stepsExecuted.sorted) {
                    const loadPartialResults = query.order.length > 0;
                    const childOptions = loadPartialResults
                        ? { include: query.order.map(order => order.key) }
                        : { include: options.include, exclude: options.exclude, child_objects: options.child_objects };
                    return loadResultsData(indexedResults, childOptions)
                    .then(results => {
                        if (query.order.length > 0) {
                            sortMatches(results);
                        }
                        stepsExecuted.sorted = true;
                        if (query.skip > 0) {
                            results = results.slice(query.skip);
                        }
                        if (query.take > 0) {
                            results = results.slice(0, query.take);
                        }
                        stepsExecuted.skipped = true;
                        stepsExecuted.taken = true;
    
                        if (options.snapshots && loadPartialResults) {
                            // Get the rest
                            return loadResultsData(results, { include: options.include, exclude: options.exclude, child_objects: options.child_objects });
                        }
                        return results;
                    });
                }
                else {
                    // No need to take further actions, return what we have now
                    return indexedResults;
                }
            }

            // If we get here, this is a query on a regular path (no wildcards) with additional non-indexed filters left, 
            // we can get child records from a single parent. Merge index results by key
            let indexKeyFilter;
            if (indexedResults.length > 0) {
                indexKeyFilter = indexedResults.map(result => result.key);
            }
            // const queue = [];
            const promises = [];
            let matches = [];
            let preliminaryStop = false;
            const loadPartialData = query.order.length > 0;
            const childOptions = loadPartialData
                ? { include: query.order.map(order => order.key) }
                : { include: options.include, exclude: options.exclude, child_objects: options.child_objects };

            return Node.getChildren(this.storage, path, indexKeyFilter)
            .next(child => {
                if (child.type === Node.VALUE_TYPES.OBJECT) { // if (child.valueType === VALUE_TYPES.OBJECT) {
                    if (!child.address) {
                        // Currently only happens if object has no properties 
                        // ({}, stored as a tiny_value in parent record). In that case, 
                        // should it be matched in any query? -- That answer could be YES, when testing a property for !exists. Ignoring for now
                        return;
                    }
                    if (preliminaryStop) {
                        return false;
                    }
                    // TODO: Queue it, then process in batches later... If the amount of children we're about to process is
                    // large, this will go very wrong.
                    // queue.push({ path: child.path });

                    const p = Node.matches(this.storage, child.address.path, tableScanFilters)
                    .then(isMatch => {
                        if (!isMatch) { return null; }

                        const childPath = child.address.path;
                        if (options.snapshots || query.order.length > 0) {
                            return Node.getValue(this.storage, childPath, childOptions).then(val => {
                                return { path: childPath, val };
                            });                                
                        }
                        else {
                            return { path: childPath };
                        }
                    })
                    .then(result => {
                        // If a maximumum number of results is requested, we can check if we can preliminary toss this result
                        // This keeps the memory space used limited to skip + take
                        // TODO: see if we can limit it to the max number of results returned (.take)

                        if (result !== null) {
                            matches.push(result);
                            if (query.take > 0 && matches.length > query.take + query.skip) {
                                if (query.order.length > 0) {
                                    // A query order has been set. If this value falls in between it can replace some other value
                                    // matched before. 
                                    sortMatches(matches);
                                }
                                else {
                                    // No query order set, we can stop after 'take' + 'skip' results
                                    preliminaryStop = true; // Flags the loop that no more nodes have to be checked
                                }
                                matches.pop(); // toss last value
                            }
                        }
                    });
                    promises.push(p);
                }
            })
            .catch(reason => {
                // No record?
                this.storage.debug.warn(`Error getting child stream: ${reason}`);
                return [];
            })
            .then(() => {
                // Done iterating all children, wait for all match promises to resolve

                return Promise.all(promises)
                .then(() => {
                    stepsExecuted.preDataLoaded = loadPartialData;
                    stepsExecuted.dataLoaded = !loadPartialData;
                    if (query.order.length > 0) {
                        sortMatches(matches);
                    }
                    stepsExecuted.sorted = true;
                    if (query.skip > 0) {
                        matches = matches.slice(query.skip);
                    }
                    stepsExecuted.skipped = true;
                    if (query.take > 0) {
                        // (should not be necessary, basically it has already been done in the loop?)
                        matches = matches.slice(0, query.take);
                    }
                    stepsExecuted.taken = true;

                    if (!stepsExecuted.dataLoaded) {
                        return loadResultsData(matches, { include: options.include, exclude: options.exclude, child_objects: options.child_objects })
                        .then(results => {
                            stepsExecuted.dataLoaded = true;
                            return results;
                        });
                    }
                    return matches;
                });
            });
        })
        .then(matches => {
            // Order the results
            if (!stepsExecuted.sorted && query.order.length > 0) {
                sortMatches(matches);
            }

            if (!options.snapshots) {
                // Remove the loaded values from the results, because they were not requested (and aren't complete, we only have data of the sorted keys)
                matches = matches.map(match => match.path);
            }

            // Limit result set
            if (!stepsExecuted.skipped && query.skip > 0) {
                matches = matches.slice(query.skip);
            }
            if (!stepsExecuted.taken && query.take > 0) {
                matches = matches.slice(0, query.take);
            }

            // NEW: Check if this is a realtime query - future updates must send query result updates
            if (options.monitor === true) {
                options.monitor = { add: true, change: true, remove: true };
            }
            if (typeof options.monitor === 'object' && (options.monitor.add || options.monitor.change || options.monitor.remove)) {
                const matchedPaths = options.snapshots ? matches.map(match => match.path) : matches.slice();
                const ref = this.db.ref(path);
                const removeMatch = (path) => {
                    const index = matchedPaths.indexOf(path);
                    if (index < 0) { return; }
                    matchedPaths.splice(index, 1);
                };
                const addMatch = (path) => {
                    if (matchedPaths.includes(path)) { return; }
                    matchedPaths.push(path);
                };
                const stopMonitoring = () => {
                    this.unsubscribe(ref.path, 'notify_child_changed', childChangedCallback);
                    this.unsubscribe(ref.path, 'notify_child_added', childAddedCallback);
                    this.unsubscribe(ref.path, 'notify_child_removed', childRemovedCallback);
                };
                const childChangedCallback = (err, path, newValue, oldValue) => {
                    const wasMatch = matchedPaths.includes(path);

                    let keepMonitoring = true;
                    // check if the properties we already have match filters, 
                    // and if we have to check additional properties
                    const checkKeys = [];
                    query.filters.forEach(f => !checkKeys.includes(f.key) && checkKeys.push(f.key));
                    const seenKeys = [];
                    typeof oldValue === 'object' && Object.keys(oldValue).forEach(key => !seenKeys.includes(key) && seenKeys.push(key));
                    typeof newValue === 'object' && Object.keys(newValue).forEach(key => !seenKeys.includes(key) && seenKeys.push(key));
                    const missingKeys = [];
                    let isMatch = seenKeys.every(key => {
                        if (!checkKeys.includes(key)) { return true; }
                        const filters = query.filters.filter(filter => filter.key === key);
                        return filters.every(filter => {
                            if (allowedTableScanOperators.includes(filter.op)) {
                                return this.storage.test(newValue[key], filter.op, filter.compare);
                            }
                            // specific index filter
                            if (filter.index.constructor.name === 'FullTextDataIndex' && filter.index.localeKey && !seenKeys.includes(filter.index.localeKey)) {
                                // Can't check because localeKey is missing
                                missingKeys.push(filter.index.localeKey);
                                return true; // so we'll know if all others did match
                            }
                            return filter.index.test(newValue, filter.op, filter.compare);
                        });
                    });
                    if (isMatch) {
                        // Matches all checked (updated) keys. BUT. Did we have all data needed?
                        // If it was a match before, other properties don't matter because they didn't change and won't
                        // change the current outcome

                        missingKeys.push(...checkKeys.filter(key => !seenKeys.includes(key)));

                        let promise = Promise.resolve(true);
                        if (!wasMatch && missingKeys.length > 0) {
                            // We have to check if this node becomes a match
                            const filterQueue = query.filters.filter(f => missingKeys.includes(f.key)); 
                            const simpleFilters = filterQueue.filter(f => allowedTableScanOperators.includes(f.op));
                            const indexFilters = filterQueue.filter(f => !allowedTableScanOperators.includes(f.op));
                            
                            const processFilters = () => {
                                const checkIndexFilters = () => {
                                    // TODO: ask index what keys to load (eg: FullTextIndex might need key specified by localeKey)
                                    const keysToLoad = indexFilters.reduce((keys, filter) => {
                                        if (!keys.includes(filter.key)) {
                                            keys.push(filter.key);
                                        }
                                        if (filter.index.constructor.name === 'FullTextDataIndex' && filter.index.localeKey && !keys.includes(filter.index.localeKey)) {
                                            keys.push(filter.index.localeKey);
                                        }
                                        return keys;
                                    }, []);
                                    return Node.getValue(this.storage, path, { include: keysToLoad })
                                    .then(val => {
                                        if (val === null) { return false; }
                                        return indexFilters.every(filter => filter.index.test(val, filter.op, filter.compare));
                                    })
                                }
                                if (simpleFilters.length > 0) {
                                    return Node.matches(this.storage, path, simpleFilters)
                                    .then(isMatch => {
                                        if (isMatch) {
                                            if (indexFilters.length === 0) { return true; }
                                            return checkIndexFilters();
                                        }
                                        return false;
                                    })
                                }
                                else {
                                    return checkIndexFilters();
                                }
                            }
                            promise = processFilters();
                        }
                        return promise
                        .then(isMatch => {
                            if (isMatch) {
                                if (!wasMatch) { addMatch(path); }
                                // load missing data if snapshots are requested
                                let gotValue = value => {
                                    if (wasMatch && options.monitor.change) {
                                        keepMonitoring = options.eventHandler({ name: 'change', path, value });
                                    }
                                    else if (!wasMatch && options.monitor.add) {
                                        keepMonitoring = options.eventHandler({ name: 'add', path, value });
                                    }
                                    if (keepMonitoring === false) { stopMonitoring(); }
                                };
                                if (options.snapshots) {
                                    const loadOptions = { include: options.include, exclude: options.exclude, child_objects: options.child_objects };
                                    return this.storage.getNodeValue(path, loadOptions)
                                    .then(gotValue);
                                }
                                else {
                                    return gotValue(newValue);
                                }
                            }
                            else if (wasMatch) {
                                removeMatch(path);
                                if (options.monitor.remove) {
                                    keepMonitoring = options.eventHandler({ name: 'remove', path: path, value: oldValue });
                                }
                            }
                            if (keepMonitoring === false) { stopMonitoring(); }
                        });
                    }
                    else {
                        // No match
                        if (wasMatch) {
                            removeMatch(path);
                            if (options.monitor.remove) {
                                keepMonitoring = options.eventHandler({ name: 'remove', path: path, value: oldValue });
                                if (keepMonitoring === false) { stopMonitoring(); }
                            }                                
                        }
                    }
                };
                const childAddedCallback = (err, path, newValue, oldValue) => {
                    let isMatch = query.filters.every(filter => {
                        if (allowedTableScanOperators.includes(filter.op)) {
                            return this.storage.test(newValue[filter.key], filter.op, filter.compare);
                        }
                        else {
                            return filter.index.test(newValue, filter.op, filter.compare);
                        }
                    });
                    let keepMonitoring = true;
                    if (isMatch) {
                        addMatch(path);
                        if (options.monitor.add) {
                            keepMonitoring = options.eventHandler({ name: 'add', path: path, value: options.snapshots ? newValue : null });
                        }
                    }
                    if (keepMonitoring === false) { stopMonitoring(); }
                };
                const childRemovedCallback = (err, path, newValue, oldValue) => {
                    let keepMonitoring = true;
                    removeMatch(path);
                    if (options.monitor.remove) {
                        keepMonitoring = options.eventHandler({ name: 'remove', path: path, value: options.snapshots ? oldValue : null });
                    }
                    if (keepMonitoring === false) { stopMonitoring(); }
                };
                if (options.monitor.add || options.monitor.change || options.monitor.remove) {
                    // Listen for child_changed events
                    this.subscribe(ref.path, 'notify_child_changed', childChangedCallback);
                }
                if (options.monitor.remove) {
                    this.subscribe(ref.path, 'notify_child_removed', childRemovedCallback);
                }
                if (options.monitor.add) {
                    this.subscribe(ref.path, 'notify_child_added', childAddedCallback);
                }
            }
        
            return matches;
        });
    }

    /**
     * Creates an index on key for all child nodes at path
     * @param {string} path
     * @param {string} key
     * @param {object} [options]
     * @returns {Promise<DataIndex>}
     */
    createIndex(path, key, options) {
        return this.storage.indexes.create(path, key, options);
    }

    /**
     * Gets all indexes
     * @returns {Promise<DataIndex[]>}
     */
    getIndexes() {
        return Promise.resolve(this.storage.indexes.list());
    }

    reflect(path, type, args) {
        const getChildren = (path, limit = 50, skip = 0) => {
            if (typeof limit === 'string') { limit = parseInt(limit); }
            if (typeof skip === 'string') { skip = parseInt(skip); }
            const children = [];
            let n = 0, stop = skip + limit;
            return Node.getChildren(this.storage, path)
            .next(childInfo => {
                n++;
                if (limit === 0 || (n <= stop && n > skip)) {
                    children.push({
                        key: typeof childInfo.key === 'string' ? childInfo.key : childInfo.index,
                        type: childInfo.valueTypeName,
                        value: childInfo.value,
                        // address is now only added when storage is acebase. Not when eg sqlite, mssql, localstorage
                        address: typeof childInfo.address === 'object' && 'pageNr' in childInfo.address ? { pageNr: childInfo.address.pageNr, recordNr: childInfo.address.recordNr } : undefined
                    });
                }
                if (limit > 0 && n > stop) {
                    return false; // Stop iterating
                }
            })
            .then(() => {
                return {
                    more: limit !== 0 && n > stop,
                    list: children
                };
            });
        }
        switch(type) {
            case "children": {
                return getChildren(path, args.limit, args.skip);
            }
            case "info": {
                const info = {
                    key: '',
                    exists: false,
                    type: 'unknown',
                    value: undefined,
                    children: {
                        more: false,
                        list: []
                    }
                };
                return Node.getInfo(this.storage, path)
                .then(nodeInfo => {
                    info.key = nodeInfo.key;
                    info.exists = nodeInfo.exists;
                    info.type = nodeInfo.valueTypeName;
                    info.value = nodeInfo.value;
                    let hasChildren = nodeInfo.exists && nodeInfo.address && [Node.VALUE_TYPES.OBJECT, Node.VALUE_TYPES.ARRAY].includes(nodeInfo.type);
                    if (hasChildren) {
                        return getChildren(path, args.child_limit, args.child_skip);
                    }
                })
                .then(children => {
                    info.children = children;
                    return info;
                });
            }
        }
    }

    export(path, stream, options = { format: 'json' }) {
        return this.storage.exportNode(path, stream, options);
    }
}

module.exports = { LocalApi };
},{"./acebase-local":30,"./data-index":39,"./node":36,"./storage":38,"./storage-acebase":39,"./storage-localstorage":37,"./storage-mssql":39,"./storage-sqlite":39,"acebase-core":11}],32:[function(require,module,exports){
/*
    * This file is used to create a browser bundle, 
    (re)generate it with: npm run browserify

    * To use AceBase in the browser with localStorage as the storage engine:
    const settings = { logLevel: 'error', temp: false }; // optional
    const db = new AceBase('dbname', settings); // (uses BrowserAceBase class behind the scenes)

    * When using Typescript (Angular/Ionic), you will have to pass a LocalStorageSettings object:
    import { AceBase, LocalStorageSettings } from 'acebase';
    const settings = { logLevel: 'error', storage: new LocalStorageSettings({ session: false }) };
    const db = new AceBase('dbname', settings);

    * In Typescript, its also possible to use the BrowserAceBase class
    import { BrowserAceBase } from 'acebase';
    const settings = { logLevel: 'error', temp: false }; // optional
    const db = new BrowserAceBase('dbname', settings);
 */


const { DataReference, DataSnapshot, EventSubscription, PathReference, TypeMappings, TypeMappingOptions } = require('acebase-core');
const { AceBase, AceBaseLocalSettings, BrowserAceBase } = require('./acebase-local');
const { LocalStorageSettings } = require('./storage-localstorage');

const acebase = {
    BrowserAceBase,
    AceBase, 
    AceBaseLocalSettings,
    DataReference, 
    DataSnapshot, 
    EventSubscription, 
    PathReference, 
    TypeMappings, 
    TypeMappingOptions,
    LocalStorageSettings
};

// Expose classes to window.acebase:
window.acebase = acebase;
// Expose BrowserAceBase class as window.AceBase:
window.AceBase = BrowserAceBase;
// Expose classes for module imports:
module.exports = acebase;
},{"./acebase-local":30,"./storage-localstorage":37,"acebase-core":11}],33:[function(require,module,exports){
const { VALUE_TYPES, getValueTypeName } = require('./node-value-types');
const { PathInfo } = require('acebase-core');

class NodeInfo {
    /** {path?: string, type?: number, key?: string, index?: number, exists?: boolean, address?: NodeAddress, value?: any }
     * @param {object} info 
     * @param {string} [info.path]
     * @param {number} [info.type]
     * @param {string} [info.key]
     * @param {number} [info.index]
     * @param {boolean} [info.exists]
     * @param {NodeAddress} [info.address]
     * @param {any} [info.value]
     */
    constructor(info) {
        this.path = info.path;
        this.type = info.type;
        this.index = info.index;
        this.key = info.key;
        this.exists = info.exists;
        this.address = info.address;
        this.value = info.value;

        if (typeof this.path === 'string' && (typeof this.key === 'undefined' && typeof this.index === 'undefined')) {
            let pathInfo = PathInfo.get(this.path);
            if (typeof pathInfo.key === 'number') {
                this.index = pathInfo.key;
            }
            else {
                this.key = pathInfo.key;
            }
        }
        if (typeof this.exists === 'undefined') {
            this.exists = true;
        }
    }

    get valueType() {
        return this.type;
    }

    get valueTypeName() {
        return getValueTypeName(this.valueType);
    }

    toString() {
        if (!this.exists) {
            return `"${this.path}" doesn't exist`;
        }
        if (this.address) {
            return `"${this.path}" is ${this.valueTypeName} stored at ${this.address.pageNr},${this.address.recordNr}`;
        }
        else {
            return `"${this.path}" is ${this.valueTypeName} with value ${this.value}`;
        }
    }
}

module.exports = { NodeInfo };
},{"./node-value-types":35,"acebase-core":11}],34:[function(require,module,exports){
const { PathInfo } = require('acebase-core');

const SECOND = 1000;
const MINUTE = 60000;

const DEBUG_MODE = false;
const LOCK_TIMEOUT = DEBUG_MODE ? 15 * MINUTE : 90 * SECOND;

const LOCK_STATE = {
    PENDING: 'pending',
    LOCKED: 'locked',
    EXPIRED: 'expired',
    DONE: 'done'
};

class NodeLocker {
    /**
     * Provides locking mechanism for nodes, ensures no simultanious read and writes happen to overlapping paths
     */
    constructor() {
        /**
         * @type {NodeLock[]}
         */
        this._locks = [];
    }

    _allowLock(path, tid, forWriting) {
        // Can this lock be granted now or do we have to wait?
        const pathInfo = PathInfo.get(path);
        const existing = this._locks.find(otherLock => 
            otherLock.tid === tid 
            && otherLock.state === LOCK_STATE.LOCKED 
            && (otherLock.path === path || pathInfo.isDescendantOf(otherLock.path)) // other lock is on the same or a higher path
            && (otherLock.forWriting || !forWriting) // other lock is for writing, or requested lock isn't
        );
        if (typeof existing === 'object') {
            // Current tid already has a granted lock on this path
            return { allow: true };
        }

        const conflict = this._locks
            .filter(otherLock => otherLock.tid !== tid && otherLock.state === LOCK_STATE.LOCKED)
            .find(otherLock => {
                return (
                    // Other lock clashes with requested lock, if:
                    // One (or both) of them is for writing
                    (forWriting || otherLock.forWriting)

                    // and requested lock is on the same or deeper path
                    && (
                        path === otherLock.path
                        || pathInfo.isDescendantOf(otherLock.path)
                    )
                );
            });

        const clashes = typeof conflict !== 'undefined';
        return { allow: !clashes, conflict };
    }

    _processLockQueue() {
        const pending = this._locks
            .filter(lock => 
                lock.state === LOCK_STATE.PENDING
                && (lock.waitingFor === null || lock.waitingFor.state !== LOCK_STATE.LOCKED)
            )
            .sort((a,b) => {
                // // Writes get higher priority so all reads get the most recent data
                // if (a.forWriting === b.forWriting) { 
                //     if (a.requested < b.requested) { return -1; }
                //     else { return 1; }
                // }
                // else if (a.forWriting) { return -1; }
                if (a.priority && !b.priority) { return -1; }
                else if (!a.priority && b.priority) { return 1; }
                return a.requested < b.requested;
            });
        pending.forEach(lock => {
            const check = this._allowLock(lock.path, lock.tid, lock.forWriting);
            lock.waitingFor = check.conflict || null;
            if (check.allow) {
                this.lock(lock)
                .then(lock.resolve)
                .catch(lock.reject);
            }
        });
    }

    /**
     * Locks a path for writing. While the lock is in place, it's value cannot be changed by other transactions.
     * @param {string} path path being locked
     * @param {string} tid a unique value to identify your transaction
     * @param {boolean} forWriting if the record will be written to. Multiple read locks can be granted access at the same time if there is no write lock. Once a write lock is granted, no others can read from or write to it.
     * @returns {Promise<NodeLock>} returns a promise with the lock object once it is granted. It's .release method can be used as a shortcut to .unlock(path, tid) to release the lock
     */
    lock(path, tid, forWriting = true, comment = '', options = { withPriority: false, noTimeout: false }) {
        let lock, proceed;
        if (path instanceof NodeLock) {
            lock = path;
            lock.comment = `(retry: ${lock.comment})`;
            proceed = true;
        }
        else if (this._locks.findIndex((l => l.tid === tid && l.state === LOCK_STATE.EXPIRED)) >= 0) {
            return Promise.reject(new Error(`lock on tid ${tid} has expired, not allowed to continue`));
        }
        else {

            // // Test the requested lock path
            // let duplicateKeys = getPathKeys(path)
            //     .reduce((r, key) => {
            //         let i = r.findIndex(c => c.key === key);
            //         if (i >= 0) { r[i].count++; }
            //         else { r.push({ key, count: 1 }) }
            //         return r;
            //     }, [])
            //     .filter(c => c.count > 1)
            //     .map(c => c.key);
            // if (duplicateKeys.length > 0) {
            //     console.log(`ALERT: Duplicate keys found in path "/${path}"`.dim.bgRed);
            // }

            lock = new NodeLock(this, path, tid, forWriting, options.withPriority === true);
            lock.comment = comment;
            this._locks.push(lock);
            const check = this._allowLock(path, tid, forWriting);
            lock.waitingFor = check.conflict || null;
            proceed = check.allow;
        }

        if (proceed) {
            lock.state = LOCK_STATE.LOCKED;
            if (typeof lock.granted === "number") {
                //debug.warn(`lock :: ALLOWING ${lock.forWriting ? "write" : "read" } lock on path "/${lock.path}" by tid ${lock.tid}; ${lock.comment}`);
            }
            else {
                lock.granted = Date.now();
                if (options.noTimeout !== true) {
                    lock.expires = Date.now() + LOCK_TIMEOUT;
                    //debug.warn(`lock :: GRANTED ${lock.forWriting ? "write" : "read" } lock on path "/${lock.path}" by tid ${lock.tid}; ${lock.comment}`);
                    lock.timeout = setTimeout(() => {
                        // In the right situation, this timeout never fires. Target: Bugfree code

                        if (lock.state !== LOCK_STATE.LOCKED) { return; }
                        console.error(`lock :: ${lock.forWriting ? "write" : "read" } lock on path "/${lock.path}" by tid ${lock.tid} took too long, ${lock.comment}`);
                        lock.state = LOCK_STATE.EXPIRED;
                        // let allTransactionLocks = _locks.filter(l => l.tid === lock.tid).sort((a,b) => a.requested < b.requested ? -1 : 1);
                        // let transactionsDebug = allTransactionLocks.map(l => `${l.state} ${l.forWriting ? "WRITE" : "read"} ${l.comment}`).join("\n");
                        // debug.error(transactionsDebug);

                        this._processLockQueue();
                    }, LOCK_TIMEOUT);
                }
            }
            return Promise.resolve(lock);
        }
        else {
            // Keep pending until clashing lock(s) is/are removed
            //debug.warn(`lock :: QUEUED ${lock.forWriting ? "write" : "read" } lock on path "/${lock.path}" by tid ${lock.tid}; ${lock.comment}`);
            console.assert(lock.state === LOCK_STATE.PENDING);
            const p = new Promise((resolve, reject) => {
                lock.resolve = resolve;
                lock.reject = reject;
            });
            return p;
        }
    }

    unlock(lockOrId, comment, processQueue = true) {// (path, tid, comment) {
        let lock, i;
        if (lockOrId instanceof NodeLock) {
            lock = lockOrId;
            i = this._locks.indexOf(lock);
        }
        else {
            let id = lockOrId;
            i = this._locks.findIndex(l => l.id === id);
            lock = this._locks[i];
        }

        if (i < 0) {
            const msg = `lock on "/${lock.path}" for tid ${lock.tid} wasn't found; ${comment}`;
            // debug.error(`unlock :: ${msg}`);
            return Promise.reject(new Error(msg));
        }
        lock.state = LOCK_STATE.DONE;
        clearTimeout(lock.timeout);
        this._locks.splice(i, 1);
        //debug.warn(`unlock :: RELEASED ${lock.forWriting ? "write" : "read" } lock on "/${lock.path}" for tid ${lock.tid}; ${lock.comment}; ${comment}`);
        processQueue && this._processLockQueue();
        return Promise.resolve(lock);
    }

    list() {
        return this._locks || [];
    }

    isAllowed(path, tid, forWriting) {
        return this._allowLock(path, tid, forWriting).allow;
    }
}

let lastid = 0;
class NodeLock {

    static get LOCK_STATE() { return LOCK_STATE; }

    /**
     * Constructor for a record lock
     * @param {NodeLocker} locker
     * @param {string} path 
     * @param {string} tid 
     * @param {boolean} forWriting 
     * @param {boolean} priority
     */
    constructor(locker, path, tid, forWriting, priority = false) {
        this.locker = locker;
        this.path = path;
        this.tid = tid;
        this.forWriting = forWriting;
        this.priority = priority;
        this.state = LOCK_STATE.PENDING;
        this.requested = Date.now();
        this.granted = undefined;
        this.expires = undefined;
        this.comment = "";
        this.waitingFor = null;
        this.id = ++lastid;
    }

    release(comment) {
        //return this.storage.unlock(this.path, this.tid, comment);
        return this.locker.unlock(this, comment || this.comment);
    }

    moveToParent() {
        const parentPath = PathInfo.get(this.path).parentPath; //getPathInfo(this.path).parent;
        const allowed = this.locker.isAllowed(parentPath, this.tid, this.forWriting); //_allowLock(parentPath, this.tid, this.forWriting);
        if (allowed) {
            this.waitingFor = null;
            this.path = parentPath;
            this.comment = `moved to parent: ${this.comment}`;
            return Promise.resolve(this);
        }
        else {
            // Unlock without processing the queue
            this.locker.unlock(this, `moveLockToParent: ${this.comment}`, false);

            // Lock parent node with priority to jump the queue
            return this.locker.lock(parentPath, this.tid, this.forWriting, `moved to parent (queued): ${this.comment}`, { withPriority: true })
            .then(newLock => {
                return newLock;
            });
        }
    }

    moveTo(otherPath, forWriting) {
        //const check = _allowLock(otherPath, this.tid, forWriting);
        const allowed = this.locker.isAllowed(otherPath, this.tid, forWriting);
        if (allowed) {
            this.waitingFor = null;
            this.path = otherPath;
            this.forWriting = forWriting;
            this.comment = `moved to "/${otherPath}": ${this.comment}`;
            return Promise.resolve(this);
        }
        else {
            // Unlock without processing the queue
            this.locker.unlock(this, `moving to "/${otherPath}": ${this.comment}`, false);

            // Lock other node with priority to jump the queue
            return this.locker.lock(otherPath, this.tid, forWriting, `moved to "/${otherPath}" (queued): ${this.comment}`, { withPriority: true })
            .then(newLock => {
                return newLock;
            });
        }
    }

}

module.exports = { NodeLocker, NodeLock };
},{"acebase-core":11}],35:[function(require,module,exports){
const VALUE_TYPES = {
    // Native types:
    OBJECT: 1,
    ARRAY: 2,
    NUMBER: 3,
    BOOLEAN: 4,
    STRING: 5,
    // Custom types:
    DATETIME: 6,
    //ID: 7
    BINARY: 8,
    REFERENCE: 9
};

function getValueTypeName(valueType) {
    switch (valueType) {
        case VALUE_TYPES.ARRAY: return 'array';
        case VALUE_TYPES.BINARY: return 'binary';
        case VALUE_TYPES.BOOLEAN: return 'boolean';
        case VALUE_TYPES.DATETIME: return 'date';
        case VALUE_TYPES.NUMBER: return 'number';
        case VALUE_TYPES.OBJECT: return 'object';
        case VALUE_TYPES.REFERENCE: return 'reference';
        case VALUE_TYPES.STRING: return 'string';
        default: 'unknown';
    }
}

module.exports = { VALUE_TYPES, getValueTypeName };
},{}],36:[function(require,module,exports){
const { Storage } = require('./storage');
const { NodeInfo } = require('./node-info');
const { VALUE_TYPES, getValueTypeName } = require('./node-value-types');
const colors = require('colors');

class Node {
    static get VALUE_TYPES() { return VALUE_TYPES; }

    /**
     * @param {Storage} storage 
     * @param {string} path 
     * @param {object} [options]
     * @param {boolean} [options.no_cache=false] Whether to use cache for lookups
     * @returns {Promise<NodeInfo>} promise that resolves with info about the node
     */
    static getInfo(storage, path, options = { no_cache: false }) {

        // Check if the info has been cached
        if (options && !options.no_cache) {
            let cachedInfo = storage.nodeCache.find(path);
            if (cachedInfo) {
                return Promise.resolve(cachedInfo);
            }
        }

        // Cache miss. Check if node is being looked up already
        return storage.getNodeInfo(path)
        .then(info => {
            if (options && !options.no_cache) {
                storage.nodeCache.update(info);
            }
            return info;
        });
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
     */
    static update(storage, path, value, options = { merge: true }) {

        // debug.log(`Update request for node "/${path}"`);

        if (options.merge) {
            return storage.updateNode(path, value);
        }
        else {
            return storage.setNode(path, value);
        }
    }

    /** Checks if a node exists
     * 
     * @param {Storage} storage 
     * @param {string} path 
     * @returns {Promise<boolean>}
     */
    static exists(storage, path) {
        return storage.getNodeInfo(path)
        .then(nodeInfo => {
            return nodeInfo.exists;
        });
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

    /**
     * Gets info about a child node by delegating to getChildren with keyFilter
     * @param {Storage} storage 
     * @param {string} path 
     * @param {string|number} childKeyOrIndex 
     * @returns {Promise<NodeInfo>}
     */
    static getChildInfo(storage, path, childKeyOrIndex) {
        let childInfo;
        return storage.getChildren(path, { keyFilter: [childKeyOrIndex] })
        .next(info => {
            childInfo = info;
        })
        .then(() => {
            return childInfo;
        });
    }

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

    /**
     * Removes a Node. Short for Node.update with value null
     * @param {Storage} storage 
     * @param {string} path 
     */
    static remove(storage, path) {
        return storage.removeNode(path);
    }

    /**
     * Sets the value of a Node. Short for Node.update with option { merge: false }
     * @param {Storage} storage 
     * @param {string} path 
     * @param {any} value 
     */
    static set(storage, path, value) {
        return Node.update(storage, path, value, { merge: false });
    }

    /**
     * Performs a transaction on a Node
     * @param {Storage} storage 
     * @param {string} path 
     * @param {(currentValue: any) => Promise<any>} callback callback is called with the current value. The returned value (or promise) will be used as the new value. When the callbacks returns undefined, the transaction will be canceled. When callback returns null, the node will be removed.
     */
    static transaction(storage, path, callback) {
        return storage.transactNode(path, callback);
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
        this._changes.push(new NodeChange(keyOrIndex, NodeChange.CHANGE_TYPE.DELETE, oldValue, null));
    }
    addUpdate(keyOrIndex, oldValue, newValue) {
        this._changes.push(new NodeChange(keyOrIndex, NodeChange.CHANGE_TYPE.UPDATE, oldValue, newValue));
    }
    addInsert(keyOrIndex, newValue) {
        this._changes.push(new NodeChange(keyOrIndex, NodeChange.CHANGE_TYPE.INSERT, null, newValue));
    }
    add(keyOrIndex, currentValue, newValue) {
        if (currentValue === null) {
            if (newValue === null) { 
                throw new Error(`Wrong logic for node change on "${this.nodeInfo.path}/${keyOrIndex}" - both old and new values are null`);
            }
            this.addInsert(keyOrIndex, newValue);
        }
        else if (newValue === null) {
            this.addDelete(keyOrIndex, currentValue);
        }
        else {
            this.addUpdate(keyOrIndex, currentValue, newValue);
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
        Object.keys(this.oldValue).forEach(key => newValue[key] = oldValue[key]);
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
        Object.keys(this.newValue).forEach(key => oldValue[key] = newValue[key]);
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
    NodeInfo
};
},{"./node-info":33,"./node-value-types":35,"./storage":38,"colors":22}],37:[function(require,module,exports){
const { debug, ID, PathReference, PathInfo, ascii85 } = require('acebase-core');
const { NodeInfo } = require('./node-info');
const { VALUE_TYPES } = require('./node-value-types');
const { Storage, StorageSettings, NodeNotFoundError } = require('./storage');

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

        this.debug.log(`Database "${this.name}" details:`.intro);
        this.debug.log(`- Type: LocalStorage`);
        this.debug.log(`- Max inline value size: ${this.settings.maxInlineValueSize}`.intro);

        // Create root node if it's not there yet
        return this.getNodeInfo('')
        .then(info => {
            if (!info.exists) {
                return this._writeNode('', {});
            }
        })
        .then(() => {
            return this.indexes.supported && this.indexes.load();
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
        if (currentRow) {
            // update
            this.debug.log(`Node "/${path}" is being ${options.merge ? 'updated' : 'overwritten'}`.cyan);

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
            this.debug.log(`Node "/${path}" is being created`.cyan);

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
        const pathInfo = PathInfo.get(path);
        this.debug.log(`Node "/${path}" is being deleted`.cyan);
        this._localStorage.removeItem(this._getKeyFromPath(path)); // Remove main node
        for (let i = 0; i < this._localStorage.length; i++) {
            const key = this._localStorage.key(i);
            if (!key.startsWith(this._keyPrefix)) { continue; }
            let otherPath = this._getPathFromKey(key);
            if (pathInfo.isAncestorOf(otherPath)) {
                this.debug.log(`Node "/${otherPath}" is being deleted`.cyan);
                localStorage.removeItem(this._getKeyFromPath(otherPath)); // Remove child node
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
                if (path === '') { return { value: null }; } // path is root. There is no parent.
                return lock.moveToParent()
                .then(parentLock => {
                    lock = parentLock;
                    let parentNode = this._readNode(pathInfo.parentPath);
                    if (parentNode && [VALUE_TYPES.OBJECT, VALUE_TYPES.ARRAY].includes(parentNode.type) && pathInfo.key in parentNode) {
                        return { revision: parentNode.revision, value: parentNode.value[pathInfo.key] };
                    }
                    return { value: null };
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

            this.debug.log(`Read node "/${path}" and ${filtered ? '(filtered) ' : ''}children from ${childRows.length + 1} records`.magenta);

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
        .then(result => {
            lock.release();
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
},{"./node-info":33,"./node-value-types":35,"./storage":38,"acebase-core":11}],38:[function(require,module,exports){
(function (process){
const { Utils, DebugLogger, PathInfo, ID, PathReference, ascii85 } = require('acebase-core');
const { NodeLocker } = require('./node-lock');
const { VALUE_TYPES, getValueTypeName } = require('./node-value-types');
const { NodeInfo } = require('./node-info');
const { EventEmitter } = require('events');
const { cloneObject, compareValues, getChildValues, encodeString } = Utils;
const colors = require('colors');

class NodeNotFoundError extends Error {}
class NodeRevisionError extends Error {}

class ClusterSettings {

    /**
     * 
     * @param {object} settings 
     * @param {boolean} [settings.enabled=false]
     * @param {boolean} [settings.isMaster=false]
     * @param {NodeJS.Process} [settings.master=null]
     * @param {NodeJS.Process[]} [settings.workers=null]
     */
    constructor(settings) {
        settings = settings || {};
        this.enabled = settings.enabled === true;
        this.isMaster = settings.isMaster === true;
        this.master = this.isMaster ? null : settings.master;
        this.workers = this.isMaster ? settings.workers : null;
    }
}

class ClusterManager extends EventEmitter {
    /**
     * @param {ClusterSettings} settings 
     */
    constructor(settings) {
        super();
        this.settings = new ClusterSettings(settings);

        if (!settings.enabled) {
            // do nothing
        }
        else if (settings.isMaster) {
            // This is the master process, we have to respond to requests
            settings.workers.forEach(worker => {
                // Setup communication channel with worker
                worker.on("message", data => {
                    // Received message from a worker process

                    const { id, request } = data;
                    if (typeof request === 'object' && request.type === "ping") {
                        // Reply pong
                        worker.send({ id, result: "pong" });
                    }
                    else {
                        // Storage subclass handles this by listening to worker requests:
                        // this.cluster.on('worker_request', ({ request, reply, broadcast }) => {
                        //    if (request.type === 'some_request') { (...) reply('ok'); }
                        // }) 
                        const reply = result => { 
                            // Sends reply to worker
                            worker.send({ id, result }); 
                        };
                        const broadcast = msg => {
                            // Broadcasts message to all other workers
                            console.assert(!('id' in msg), 'message to broadcast cannot have id property, it will confuse workers because they think it is a reply to their request')
                            settings.workers.forEach(otherWorker => {
                                if (otherWorker !== worker) {
                                    otherWorker.send(msg);
                                }
                            });
                        }
                        this.emit('worker_request', { request, reply, broadcast });
                    }
                });
            });
            this.request = msg => {
                throw new Error(`request can only be called by worker processes!`);
            }
        }
        else {
            // This is a worker process, setup request/result communication
            const master = settings.master;
            const requests = { };
            this.request = (msg) => {
                return new Promise((resolve, reject) => {
                    const id = ID.generate();
                    requests[id] = resolve;
                    master.send({ id, request: msg });
                });
            };
            master.on("message", data => {
                if (typeof data.id !== 'undefined') {
                    // Reply to a request sent to us
                    let resolve = requests[data.id];
                    delete requests[data.id];
                    resolve(data.result); // if this throw an error, a sent master notification has id property, which it should not have!
                }
                else {
                    this.emit('master_notification', data);
                }
            });
            // Test communication:
            this.request({ type: "ping" }).then(result => {
                console.log(`PING master process result: ${result}`);
            });
        }
    }

    get isMaster() {
        return this.settings.isMaster;
    }
    get enabled() {
        return this.settings.enabled;
    }
}

class StorageSettings {

    /**
     * 
     * @param {object} settings 
     * @param {number} [settings.maxInlineValueSize=50] in bytes, max amount of child data to store within a parent record before moving to a dedicated record. Default is 50
     * @param {boolean} [settings.removeVoidProperties=false] Instead of throwing errors on undefined values, remove the properties automatically. Default is false
     * @param {ClusterSettings} [settings.cluster] cluster settings
     * @param {string} [settings.path="."] Target path to store database files in, default is '.'
     * @param {string} [settings.info="realtime database"] optional info to be written to the console output underneith the logo
     */
    constructor(settings) {
        settings = settings || {};
        this.maxInlineValueSize = typeof settings.maxInlineValueSize === 'number' ? settings.maxInlineValueSize : 50;
        this.removeVoidProperties = settings.removeVoidProperties === true;
        this.cluster = new ClusterSettings(settings.cluster); // When running in a cluster, managing node locking must be done by the cluster master
        /** @type {string} */
        this.path = settings.path || '.';
        if (this.path.endsWith('/')) { this.path = this.path.slice(0, -1); }
        /** @type {string} */
        this.logLevel = settings.logLevel || 'log';
        this.info = settings.info || 'realtime database';
    }
}

class Storage extends EventEmitter {

    /**
     * Base class for database storage, must be extended by back-end specific methods.
     * Currently implemented back-ends are AceBaseStorage and SQLiteStorage
     * @param {string} name name of the database
     * @param {StorageSettings} settings instance of AceBaseStorageSettings or SQLiteStorageSettings
     */
    constructor(name, settings) {
        super();
        this.name = name;
        this.settings = settings;
        this.debug = new DebugLogger(settings.logLevel, `[${name}]`); // `├ ${name} ┤` // `[🧱${name}]`

        colors.setTheme({
            art: ['magenta', 'bold'],
            intro: ['dim']
        });
        // ASCI art: http://patorjk.com/software/taag/#p=display&f=Doom&t=AceBase
        const logo =
            '     ___          ______                '.art + '\n' +
            '    / _ \\         | ___ \\               '.art + '\n' +
            '   / /_\\ \\ ___ ___| |_/ / __ _ ___  ___ '.art + '\n' +
            '   |  _  |/ __/ _ \\ ___ \\/ _` / __|/ _ \\'.art + '\n' +
            '   | | | | (_|  __/ |_/ / (_| \\__ \\  __/'.art + '\n' +
            '   \\_| |_/\\___\\___\\____/ \\__,_|___/\\___|'.art + '\n' +
            (settings.info ? ''.padStart(40 - settings.info.length, ' ') + settings.info.magenta + '\n' : '');

        this.debug.write(logo);

        // this._ready = false;
        // this._readyCallbacks = [];

        // TODO: Implement?
        this.nodeCache = {
            find(path) {
                // TODO: implement
                return null;
            },
            update(path, info) {
                // TODO: implement
            }
        };
        this.nodeLocker = new NodeLocker();

        // Setup cluster functionality
        this.cluster = new ClusterManager(settings.cluster);

        // Setup indexing functionality
        const { DataIndex, ArrayIndex, FullTextIndex, GeoIndex } = require('./data-index'); // Indexing might not be available: the browser dist bundle doesn't include it because fs is not available: browserify --i ./src/data-index.js

        /** @type {DataIndex[]} */ 
        const _indexes = [];
        const storage = this;
        this.indexes = {
            /**
             * Tests if (the default storage implementation of) indexes are supported in the environment. 
             * They are currently only supported when running in Node.js because they use the fs filesystem. 
             * TODO: Implement storage specific indexes (eg in SQLite, MySQL, MSSQL, in-memory)
             */
            get supported() {
                const pfs = require('./promise-fs');
                return pfs && pfs.hasFileSystem;
            },

            /**
             * Creates an index on specified path and key(s)
             * @param {string} path location of objects to be indexed. Eg: "users" to index all children of the "users" node; or "chats/*\/members" to index all members of all chats
             * @param {string} key for now - one key to index. Once our B+tree implementation supports nested trees, we can allow multiple fields
             * @param {object} [options]
             * @param {boolean} [options.rebuild=false]
             * @param {string} [options.type] special index to create: 'array', 'fulltext' or 'geo'
             * @param {string[]} [options.include] keys to include in index
             * @param {object} [options.config] additional index-specific configuration settings 
             * @returns {Promise<DataIndex>}
             */
            create(path, key, options = { rebuild: false, type: undefined, include: undefined }) { //, refresh = false) {
                path = path.replace(/\/\*$/, ""); // Remove optional trailing "/*"
                const rebuild = options && options.rebuild === true;
                const indexType = (options && options.type) || 'normal';
                let includeKeys = (options && options.include) || [];
                if (typeof includeKeys === 'string') { includeKeys = [includeKeys]; }
                const existingIndex = _indexes.find(index => 
                    index.path === path && index.key === key && index.type === indexType
                    && index.includeKeys.length === includeKeys.length
                    && index.includeKeys.every((key, index) => includeKeys[index] === key)
                );
                if (existingIndex && rebuild !== true) {
                    storage.debug.log(`Index on "/${path}/*/${key}" already exists`.inverse);
                    return Promise.resolve(existingIndex);
                }
                const index = existingIndex || (() => {
                    switch (indexType) {
                        case 'array': return new ArrayIndex(storage, path, key, { include: options.include, config: options.config });
                        case 'fulltext': return new FullTextIndex(storage, path, key, { include: options.include, config: options.config });
                        case 'geo': return new GeoIndex(storage, path, key, { include: options.include, config: options.config });
                        default: return new DataIndex(storage, path, key, { include: options.include, config: options.config });
                    }
                })();
                if (!existingIndex) {
                    _indexes.push(index);
                }
                return index.build()
                .then(() => {
                    return index;
                })
                .catch(err => {
                    storage.debug.error(`Index build on "/${path}/*/${key}" failed: ${err.message} (code: ${err.code})`.red);
                    if (!existingIndex) {
                        // Only remove index if we added it. Build may have failed because someone tried creating the index more than once, or rebuilding it while it was building...
                        _indexes.splice(_indexes.indexOf(index), 1);
                    }
                    throw err;
                });
            },

            /**
             * Returns indexes at a path, or a specific index on a key in that path
             * @param {string} path 
             * @param {string} [key=null] 
             * @returns {DataIndex[]}
             */
            get(path, key = null) {
                return _indexes.filter(index => index.path === path && (key === null || key === index.key));
            },

            /**
             * Returns all indexes on a target path, optionally includes indexes on child and parent paths
             * @param {string} targetPath 
             * @param {boolean} [childPaths=true] 
             * @returns {DataIndex[]}
             */
            getAll(targetPath, options = { parentPaths: true, childPaths: true }) {
                const pathKeys = PathInfo.getPathKeys(targetPath);
                return _indexes.filter(index => {
                    const indexKeys = PathInfo.getPathKeys(index.path + '/*');
                    // check if index is on a parent node of given path:
                    if (options.parentPaths && indexKeys.every((key, i) => { return key === '*' || pathKeys[i] === key; }) && [index.key].concat(...index.includeKeys).includes(pathKeys[indexKeys.length])) {
                        // eg: path = 'restaurants/1/location/lat', index is on 'restaurants(/*)', key 'location'
                        return true;
                    }
                    else if (indexKeys.length < pathKeys.length) {
                        // the index is on a higher path, and did not match above parent paths check
                        return false;
                    }
                    else if (!options.childPaths && indexKeys.length !== pathKeys.length) { 
                        // no checking for indexes on child paths and index path has more or less keys than path
                        // eg: path = 'restaurants/1', index is on child path 'restaurants/*/reviews(/*)', key 'rating'
                        return false;
                    }
                    // check if all path's keys match the index path
                    // eg: path = 'restaurants/1', index is on 'restaurants(/*)', key 'name'
                    // or: path = 'restaurants/1', index is on 'restaurants/*/reviews(/*)', key 'rating' (and options.childPaths === true)
                    return pathKeys.every((key, i) => {
                        return [key, '*'].includes(indexKeys[i]); //key === indexKeys[i] || indexKeys[i] === '*';
                    });
                });
            },

            /**
             * Returns all indexes
             * @returns {DataIndex[]}
             */
            list() {
                return _indexes.slice();
            },

            /**
             * Discovers and populates all created indexes
             */
            load() {
                _indexes.splice(0);
                const pfs = require('./promise-fs');
                if (!pfs || !pfs.readdir) { 
                    // If pfs (fs) is not available, don't try using it
                    return Promise.resolve();
                }
                return pfs.readdir(`${storage.settings.path}/${storage.name}.acebase`)
                .then(files => {
                    const promises = [];
                    files.forEach(fileName => {
                        if (fileName.endsWith('.idx')) {
                            const p = DataIndex.readFromFile(storage, fileName)
                            .then(index => {
                                _indexes.push(index);
                            })
                            .catch(err => {
                                storage.debug.error(err);
                            });
                            promises.push(p);
                        }
                    });
                    return Promise.all(promises);
                })
                .catch(err => {
                    storage.debug.error(err);
                });
            }
        };

        // Subscriptions
        const _subs = {};
        const _supportedEvents = ["value","child_added","child_changed","child_removed"];
        // Add 'notify_*' event types for each event to enable data-less notifications, so data retrieval becomes optional
        _supportedEvents.push(..._supportedEvents.map(event => `notify_${event}`)); 
        this.subscriptions = {
            /**
             * Adds a subscription to a node
             * @param {string} path - Path to the node to add subscription to
             * @param {string} type - Type of the subscription
             * @param {(err: Error, path: string, newValue: any, oldValue: any) => void} callback - Subscription callback function
             */
            add(path, type, callback) {
                if (_supportedEvents.indexOf(type) < 0) {
                    throw new TypeError(`Invalid event type "${type}"`);
                }
                let pathSubs = _subs[path];
                if (!pathSubs) { pathSubs = _subs[path] = []; }
                // if (pathSubs.findIndex(ps => ps.type === type && ps.callback === callback)) {
                //     storage.debug.warn(`Identical subscription of type ${type} on path "${path}" being added`);
                // }
                pathSubs.push({ created: Date.now(), type, callback });
            },

            /**
             * Removes 1 or more subscriptions from a node
             * @param {string} path - Path to the node to remove the subscription from
             * @param {string} type - Type of subscription(s) to remove (optional: if omitted all types will be removed)
             * @param {Function} callback - Callback to remove (optional: if omitted all of the same type will be removed)
             */
            remove(path, type = undefined, callback = undefined) {
                let pathSubs = _subs[path];
                if (!pathSubs) { return; }
                while(true) {
                    const i = pathSubs.findIndex(ps => 
                        (type ? ps.type === type : true) && (callback ? ps.callback === callback : true)
                    );
                    if (i < 0) { break; }
                    pathSubs.splice(i, 1);
                }
            },

            /**
             * Checks if there are any subscribers at given path that need the node's previous value when a change is triggered
             * @param {string} path 
             */
            hasValueSubscribersForPath(path) {
                const valueNeeded = this.getValueSubscribersForPath(path);
                return !!valueNeeded;
            },

            /**
             * Gets all subscribers at given path that need the node's previous value when a change is triggered
             * @param {string} path 
             * @returns {Array<{ type: string, path: string }>}
             */
            getValueSubscribersForPath(path) {
                // Subscribers that MUST have the entire previous value of a node before updating:
                //  - "value" events on the path itself, and any ancestor path
                //  - "child_added", "child_removed" events on the parent path
                //  - "child_changed" events on the parent path and its ancestors
                //  - ALL events on child/descendant paths
                const pathInfo = new PathInfo(path);
                const valueSubscribers = [];
                Object.keys(_subs).forEach(subscriptionPath => {
                    if (pathInfo.equals(subscriptionPath) || pathInfo.isDescendantOf(subscriptionPath)) {
                        let pathSubs = _subs[subscriptionPath];
                        const eventPath = PathInfo.fillVariables(subscriptionPath, path);
                        pathSubs.forEach(sub => {
                            let dataPath = null;
                            if (sub.type === "value" || sub.type === "notify_value") { 
                                dataPath = eventPath;
                            }
                            else if ((sub.type === "child_changed" || sub.type === "notify_child_changed") && path !== eventPath) {
                                let childKey = PathInfo.getPathKeys(path.slice(eventPath.length).replace(/^\//, ''))[0];
                                dataPath = PathInfo.getChildPath(eventPath, childKey);
                             }
                            else if (["child_added", "child_removed", "notify_child_added", "notify_child_removed"].includes(sub.type) && pathInfo.isChildOf(eventPath)) { 
                                let childKey = PathInfo.getPathKeys(path.slice(eventPath.length).replace(/^\//, ''))[0];
                                dataPath = PathInfo.getChildPath(eventPath, childKey);
                            }
                            
                            if (dataPath !== null && valueSubscribers.findIndex(s => s.type === sub.type && s.path === eventPath) < 0) {
                                valueSubscribers.push({ type: sub.type, eventPath, dataPath, subscriptionPath });
                            }
                        });
                    }
                });
                return valueSubscribers;
            },

            /**
             * Gets all subscribers at given path that could possibly be invoked after a node is updated
             * @param {string} path 
             */
            getAllSubscribersForPath(path) {
                const pathInfo = PathInfo.get(path);
                const subscribers = [];
                Object.keys(_subs).forEach(subscriptionPath => {
                    if (pathInfo.equals(subscriptionPath) //path === subscriptionPath 
                        || pathInfo.isDescendantOf(subscriptionPath) 
                        || pathInfo.isAncestorOf(subscriptionPath)
                    ) {
                        let pathSubs = _subs[subscriptionPath];
                        const eventPath = PathInfo.fillVariables(subscriptionPath, path);

                        pathSubs.forEach(sub => {
                            let dataPath = null;
                            if (sub.type === "value" || sub.type === "notify_value") { 
                                dataPath = eventPath; 
                            }
                            else if (sub.type === "child_changed" || sub.type === "notify_child_changed") { 
                                let childKey = path === eventPath || pathInfo.isAncestorOf(eventPath) 
                                    ? "*" 
                                    : PathInfo.getPathKeys(path.slice(eventPath.length).replace(/^\//, ''))[0];
                                dataPath = PathInfo.getChildPath(eventPath, childKey);
                            }
                            else if (
                                ["child_added", "child_removed", "notify_child_added", "notify_child_removed"].includes(sub.type) 
                                && (
                                    pathInfo.isChildOf(eventPath) 
                                    || path === eventPath 
                                    || pathInfo.isAncestorOf(eventPath)
                                )
                            ) { 
                                let childKey = path === eventPath || pathInfo.isAncestorOf(eventPath) 
                                    ? "*" 
                                    : PathInfo.getPathKeys(path.slice(eventPath.length).replace(/^\//, ''))[0];
                                dataPath = PathInfo.getChildPath(eventPath, childKey); //NodePath(subscriptionPath).childPath(childKey); 
                            }
                            if (dataPath !== null) { // && subscribers.findIndex(s => s.type === sub.type && s.dataPath === dataPath) < 0
                                subscribers.push({ type: sub.type, eventPath, dataPath, subscriptionPath });
                            }
                        });
                    }
                });
                return subscribers;
            },

            /**
             * Triggers subscription events to run on relevant nodes
             * @param {string} event - Event type: "value", "child_added", "child_changed", "child_removed"
             * @param {string} path - Path to the node the subscription is on
             * @param {string} dataPath - path to the node the value is stored
             * @param {any} oldValue - old value
             * @param {any} newValue - new value
             */
            trigger(event, path, dataPath, oldValue, newValue) {
                //console.warn(`Event "${event}" triggered on node "/${path}" with data of "/${dataPath}": `, newValue);
                const pathSubscriptions = _subs[path] || [];
                pathSubscriptions.filter(sub => sub.type === event)
                .forEach(sub => {
                    sub.callback(null, dataPath, newValue, oldValue);
                    // if (event.startsWith('notify_')) {
                    //     // Notify only event, run callback without data
                    //     sub.callback(null, dataPath);
                    // }
                    // else {
                    //     // Run callback with data
                    //     sub.callback(null, dataPath, newValue, oldValue);
                    // }
                });
            }
        };
       
    } // end of constructor

    get path() {
        return `${this.settings.path}/${this.name}.acebase`;
    }

    // /** 
    //  * Once storage is ready for use, the optional callback will fire
    //  * and the returned promise will resolve.
    //  * @param {() => void} [callback] Optional callback
    //  * @returns {Promise<void>} return Promise that resolves when ready for use
    //  */
    // ready(callback) {
    //     if (this._ready) {
    //         callback && callback();
    //         return Promise.resolve();
    //     }
    //     return new Promise((resolve, reject) => {
    //         if (this._ready) { 
    //             callback && callback();
    //             return Promise.resolve();
    //         }
    //         this._readyCallbacks.push({ resolve, reject, callback });
    //     });
    // }

    // _setReady(ready, err) {
    //     if (ready) {
    //         // Run ready success callbacks
    //         this._ready = true;
    //         this._readyCallbacks.splice(0).forEach(listener => {
    //             listener.resolve();
    //             listener.callback && listener.callback();
    //         });
    //     }
    //     else {
    //         // Run ready error callbacks
    //         this._ready = false;
    //         this._readyCallbacks.splice(0).forEach(listener => {
    //             listener.reject(err);
    //         });
    //     }
    // }

    /**
     * Checks if a value can be stored in a parent object, or if it should 
     * move to a dedicated record. Uses settings.maxInlineValueSize
     * @param {any} value 
     */
    valueFitsInline(value) {
        const encoding = 'utf8';
        if (typeof value === "number" || typeof value === "boolean" || value instanceof Date) {
            return true;
        }
        else if (typeof value === "string") {
            if (value.length > this.settings.maxInlineValueSize) { return false; }
            // if the string has unicode chars, its byte size will be bigger than value.length
            const encoded = encodeString(value); // Buffer.from(value, encoding); //textEncoder.encode(value);
            return encoded.length < this.settings.maxInlineValueSize;
        }
        else if (value instanceof PathReference) {
            if (value.path.length > this.settings.maxInlineValueSize) { return false; }
            // if the path has unicode chars, its byte size will be bigger than value.path.length
            const encoded = encodeString(value.path); // Buffer.from(value.path, encoding); //textEncoder.encode(value.path);
            return encoded.length < this.settings.maxInlineValueSize;
        }
        else if (value instanceof ArrayBuffer) {
            return value.length < this.settings.maxInlineValueSize;
        }
        else if (value instanceof Array) {
            return value.length === 0;
        }
        else if (typeof value === "object") {
            return Object.keys(value).length === 0;
        }
        else {
            throw new TypeError(`What else is there?`);
        }
    }

    /**
     * Creates or updates a node in its own record. DOES NOT CHECK if path exists in parent node, or if parent paths exist! Calling code needs to do this
     * @param {string} path 
     * @param {any} value 
     * @param {object} [options] 
     * @returns {Promise<void>}
     */
    _writeNode(path, value, options = { merge: false }) {
        throw new Error(`This method must be implemented by subclass`);
    }

    /**
     * Wrapper for _writeNode, handles triggering change events, index updating. MUST be called for
     * @param {string} path 
     * @param {any} value 
     * @param {object} [options] 
     * @returns {Promise<void>}
     */
    _writeNodeWithTracking(path, value, options = { merge: false, tid: undefined, _customWriteFunction: undefined, waitForIndexUpdates: true }) {
        if (!options || !options.tid) { throw new Error(`_writeNodeWithTracking MUST be executed with a tid!`); }
        options.merge = options.merge === true;
        const tid = options.tid;

        // Is anyone interested in the values changing on this path?
        let topEventData = null;
        let topEventPath = path;
        let hasValueSubscribers = false;
        
        // Get all subscriptions that should execute on the data (includes events on child nodes as well)
        let eventSubscriptions = this.subscriptions.getAllSubscribersForPath(path);

        // Get all subscriptions for data on this or ancestor nodes, determines what data to load before processing
        const valueSubscribers = this.subscriptions.getValueSubscribersForPath(path);
        if (valueSubscribers.length > 0) {
            hasValueSubscribers = true;
            let eventPaths = valueSubscribers
                .map(sub => { return { path: sub.dataPath, keys: PathInfo.getPathKeys(sub.dataPath) }; })
                .sort((a,b) => {
                    if (a.keys.length < b.keys.length) return -1;
                    else if (a.keys.length > b.keys.length) return 1;
                    return 0;
                });
            let first = eventPaths[0];
            topEventPath = first.path;
            if (valueSubscribers.filter(sub => sub.dataPath === topEventPath).every(sub => sub.type.startsWith('notify_'))) {
                // Prevent loading of all data on path, so it'll only load changing properties
                hasValueSubscribers = false;
            }
            topEventPath = PathInfo.fillVariables(topEventPath, path); // fill in any wildcards in the subscription path 
        }

        const writeNode = () => {
            if (typeof options._customWriteFunction === 'function') {
                return options._customWriteFunction();
            }
            return this._writeNode(path, value, options);            
        }

        // TODO: FIX indexes on higher path not being updated. 
        // Now, updates on an indexed property does not update the index!
        // issue example: 
        // a geo index on path 'restaurants', key 'location'
        // updates on 'restaurant/1' will update the index
        // BUT updates on 'restaurent/1/location' WILL NOT!!!!
        const indexes = this.indexes.getAll(path, { childPaths: true, parentPaths: true })
            .map(index => ({ index, keys: PathInfo.getPathKeys(index.path) }))
            .sort((a, b) => {
                if (a.keys.length < b.keys.length) { return -1; }
                else if (a.keys.length > b.keys.length) { return 1; }
                return 0;
            })
            .map(obj => obj.index);
        if (eventSubscriptions.length === 0 && indexes.length === 0) {
            // Nobody's interested in value changes. Write node without tracking
            return writeNode();
        }
        let keysFilter = [];
        if (indexes.length > 0) {
            indexes.sort((a,b) => {
                if (typeof a._pathKeys === 'undefined') { a._pathKeys = PathInfo.getPathKeys(a.path); }
                if (typeof b._pathKeys === 'undefined') { b._pathKeys = PathInfo.getPathKeys(b.path); }
                if (a._pathKeys.length < b._pathKeys.length) return -1;
                else if (a._pathKeys.length > b._pathKeys.length) return 1;
                return 0;
            });
            const topIndex = indexes[0];
            let topIndexPath = topIndex.path === path ? path : PathInfo.fillVariables(`${topIndex.path}/*`, path);
            if (topIndexPath.length < topEventPath.length) {
                // index is on a higher path than any value subscriber.
                // eg: 
                //      path = 'restaurants/1/rating'
                //      topEventPath = 'restaurants/1/rating' (because of 'value' event on 'restaurants/*/rating')
                //      topIndexPath = 'restaurants/1' (because of index on 'restaurants(/*)', key 'name', included key 'rating')
                // set topEventPath to topIndexPath, but include only:
                // - indexed keys on that path,
                // - any additional child keys for all value event subscriptions in that path (they can never be different though?)
                topEventPath = topIndexPath;
                indexes.filter(index => index.path === topIndex.path).forEach(index => {
                    let keys = [index.key].concat(index.includeKeys);
                    keys.forEach(key => !keysFilter.includes(key) && keysFilter.push(key));
                });
                // following will never add any keys to the filter, right?!!
                // let topKeys = topIndex.path;  
                // eventSubscriptions.forEach(sub => {
                //     let keys = PathInfo.getPathKeys(sub.dataPath);
                //     let targetKey = keys[topKeys.length];
                //     !keysFilter.includes(targetKey) && keysFilter.push(targetKey);
                // })
            }
        }

        if (!hasValueSubscribers && options.merge === true && keysFilter.length === 0) {
            // only load properties being updated
            keysFilter = Object.keys(value);
            if (topEventPath !== path) {
                let trailPath = path.slice(topEventPath.length);
                keysFilter = keysFilter.map(key => `${trailPath}/${key}`);
            }
        }

        return this.getNodeInfo(topEventPath, { tid })
        .then(eventNodeInfo => {
            if (!eventNodeInfo.exists) {
                // Node doesn't exist
                return null;
            }
            let valueOptions = { tid };
            // if (!hasValueSubscribers && options.merge === true) {
            //     // Only load current value for properties being updated
            //     valueOptions.include = Object.keys(value);
            //     // Make sure the keys for any indexes on this path are also loaded
            //     this.indexes.getAll(path, false).forEach(index => {
            //         const keys = [index.key].concat(index.includeKeys);
            //         keys.forEach(key => !valueOptions.include.includes(key) && valueOptions.include.push(key));
            //     });
            // }
            if (keysFilter.length > 0) {
                valueOptions.include = keysFilter;
            }
            if (topEventPath === '' && typeof valueOptions.include === 'undefined') {
                this.debug.warn(`WARNING: One or more value event listeners on the root node are causing the entire database value to be read to facilitate change tracking. Using "value", "notify_value", "child_changed" and "notify_child_changed" events on the root node are a bad practice because of the significant performance impact`);
            }
            return this.getNodeValue(topEventPath, valueOptions);
        })
        .then(currentValue => {
            topEventData = currentValue;

            // Now proceed with node updating
            return writeNode();
        })
        .then(result => {

            // Build data for old/new comparison
            let newTopEventData = cloneObject(topEventData);
            if (newTopEventData === null) {
                // the node didn't exist prior to the update
                newTopEventData = path === topEventPath ? value : {};
            }
            let modifiedData = newTopEventData;
            if (path !== topEventPath) {
                let trailPath = path.slice(topEventPath.length).replace(/^\//, '');
                let trailKeys = PathInfo.getPathKeys(trailPath);
                while (trailKeys.length > 0) {
                    let childKey = trailKeys.shift();
                    if (!options.merge && trailKeys.length === 0) {
                        modifiedData[childKey] = value;
                    }
                    else {
                        if (!(childKey in modifiedData)) {
                            modifiedData[childKey] = {}; // Fixes an error if an object in current path did not exist
                        }
                        modifiedData = modifiedData[childKey];
                    }
                }
            }
            if (options.merge) {
                Object.keys(value).forEach(key => {
                    let newValue = value[key];
                    if (newValue !== null) {
                        modifiedData[key] = newValue;
                    }
                    else {
                        delete modifiedData[key];
                    }
                });
            }
            else if (path === topEventPath) {
                newTopEventData = modifiedData = value;
            }

            // Find out if there are indexes that need to be updated
            // const updatedData = (() => {
            //     let topPathKeys = PathInfo.getPathKeys(topEventPath);
            //     let trailKeys = PathInfo.getPathKeys(path).slice(topPathKeys.length);
            //     let oldValue = topEventData;
            //     let newValue = newTopEventData;
            //     while (trailKeys.length > 0) {
            //         let subKey = trailKeys.shift();
            //         let childValues = getChildValues(subKey, oldValue, newValue);
            //         oldValue = childValues.oldValue;
            //         newValue = childValues.newValue;
            //     }
            //     return { oldValue, newValue };
            // })();

            // Trigger all index updates
            const indexUpdates = [];
            indexes.map(index => ({ index, keys: PathInfo.getPathKeys(index.path) }))
            .sort((a, b) => {
                // Deepest paths should fire first, then bubble up the tree
                if (a.keys.length < b.keys.length) { return 1; }
                else if (a.keys.length > b.keys.length) { return -1; }
                return 0;
            })
            .forEach(({ index }) => {
                // Index is either on the top event path, or on a child path

                // Example situation:
                // path = "users/ewout/posts/1" (a post was added)
                // topEventPath = "users/ewout" (a "child_changed" event was on "users")
                // index.path is "users/*/posts"
                // index must be called with data of "users/ewout/posts/1" 

                let pathKeys = PathInfo.getPathKeys(topEventPath); 
                let indexPathKeys = PathInfo.getPathKeys(index.path + '/*');
                let trailKeys = indexPathKeys.slice(pathKeys.length);
                // let { oldValue, newValue } = updatedData;
                let oldValue = topEventData;
                let newValue = newTopEventData;
                if (trailKeys.length === 0) {
                    console.assert(pathKeys.length === indexPathKeys.length, 'check logic');
                    // Index is on updated path
                    const p = index.handleRecordUpdate(topEventPath, oldValue, newValue);
                    indexUpdates.push(p);
                    return; // next index
                }
                const getAllIndexUpdates = (path, oldValue, newValue) => {
                    if (oldValue === null && newValue === null) {
                        return [];
                    }
                    let pathKeys = PathInfo.getPathKeys(path);
                    let indexPathKeys = PathInfo.getPathKeys(index.path + '/*');
                    let trailKeys = indexPathKeys.slice(pathKeys.length);
                    if (trailKeys.length === 0) {
                        console.assert(pathKeys.length === indexPathKeys.length, 'check logic');
                        return [{ path, oldValue, newValue }];
                    }

                    let results = [];
                    let trailPath = '';
                    while (trailKeys.length > 0) {
                        let subKey = trailKeys.shift();
                        if (subKey === '*') {
                            // Recursion needed
                            let allKeys = oldValue === null ? [] : Object.keys(oldValue);
                            newValue !== null && Object.keys(newValue).forEach(key => {
                                if (allKeys.indexOf(key) < 0) {
                                    allKeys.push(key);
                                }
                            });
                            allKeys.forEach(key => {
                                let childPath = PathInfo.getChildPath(trailPath, key);
                                let childValues = getChildValues(key, oldValue, newValue);
                                let subTrailPath = PathInfo.getChildPath(path, childPath);
                                let childResults = getAllIndexUpdates(subTrailPath, childValues.oldValue, childValues.newValue);
                                results = results.concat(childResults);
                            });
                            break;
                        }
                        else {
                            let values = getChildValues(subKey, oldValue, newValue);
                            oldValue = values.oldValue;
                            newValue = values.newValue;
                            if (oldValue === null && newValue === null) {
                                break;
                            }
                            trailPath = PathInfo.getChildPath(trailPath, subKey);
                        }
                    }
                    return results;
                };
                let results = getAllIndexUpdates(topEventPath, oldValue, newValue);
                results.forEach(result => {
                    const p = index.handleRecordUpdate(result.path, result.oldValue, result.newValue);
                    indexUpdates.push(p);
                });
            });

            const callSubscriberWithValues = (sub, oldValue, newValue, variables = []) => {
                let trigger = true;
                let type = sub.type;
                if (type.startsWith('notify_')) {
                    type = type.slice('notify_'.length);
                }
                if (type === "child_changed" && (oldValue === null || newValue === null)) {
                    trigger = false;
                }
                else if (type === "value" || type === "child_changed") {
                    let changes = compareValues(oldValue, newValue);
                    trigger = changes !== 'identical';
                }
                else if (type === "child_added") {
                    trigger = oldValue === null && newValue !== null;
                }
                else if (type === "child_removed") {
                    trigger = oldValue !== null && newValue === null;
                }
                // let dataPath = sub.dataPath;
                // if (dataPath.endsWith('/*')) {
                //     dataPath = dataPath.substr(0, dataPath.length-1);
                //     dataPath += wildcardKey;
                // }
                let dataPath = sub.dataPath;
                variables.forEach((variable, i) => {
                    // only replaces first occurrence (so multiple *'s will be processed 1 by 1)
                    const safeVarName = variable.name === '*' ? '\\*' : variable.name.replace('$', '\\$');
                    dataPath = dataPath.replace(new RegExp(`(^|/)${safeVarName}([/\[]|$)`), `$1${variable.value}$2`);
                });
                trigger && this.subscriptions.trigger(sub.type, sub.subscriptionPath, dataPath, oldValue, newValue);
            };

            const triggerAllEvents = () => {
                // Notify all event subscriptions, should be executed with a delay (process.nextTick)
                eventSubscriptions.map(sub => {
                    const keys = PathInfo.getPathKeys(sub.dataPath);
                    return {
                        sub,
                        keys
                    };
                })
                .sort((a, b) => {
                    // Deepest paths should fire first, then bubble up the tree
                    if (a.keys.length < b.keys.length) { return 1; }
                    else if (a.keys.length > b.keys.length) { return -1; }
                    return 0;
                })
                .forEach(({ sub }) => {
                    const process = (currentPath, oldValue, newValue, variables = []) => {
                        let trailPath = sub.dataPath.slice(currentPath.length).replace(/^\//, '');
                        let trailKeys = PathInfo.getPathKeys(trailPath);
                        while (trailKeys.length > 0) {
                            let subKey = trailKeys.shift();
                            if (typeof subKey === 'string' && (subKey === '*' || subKey[0] === '$')) {
                                // Fire on all relevant child keys
                                let allKeys = oldValue === null ? [] : Object.keys(oldValue);
                                newValue !== null && Object.keys(newValue).forEach(key => {
                                    if (allKeys.indexOf(key) < 0) {
                                        allKeys.push(key);
                                    }
                                });
                                allKeys.forEach(key => {
                                    const childValues = getChildValues(key, oldValue, newValue);
                                    const vars = variables.concat({ name: subKey, value: key });
                                    if (trailKeys.length === 0) {
                                        callSubscriberWithValues(sub, childValues.oldValue, childValues.newValue, vars);
                                    }
                                    else {
                                        process(`${currentPath}/${subKey}`, childValues.oldValue, childValues.newValue, vars);
                                    }
                                });
                                return; // We can stop processing
                            }
                            else {
                                currentPath = PathInfo.getChildPath(currentPath, subKey);
                                let childValues = getChildValues(subKey, oldValue, newValue);
                                oldValue = childValues.oldValue;
                                newValue = childValues.newValue;
                            }
                        }
                        callSubscriberWithValues(sub, oldValue, newValue, variables);
                    };

                    process(topEventPath, topEventData, newTopEventData);
                });
            };

            // Wait for all index updates to complete
            if (options.waitForIndexUpdates === false) {
                indexUpdates.splice(0); // Remove all index update promises, so we don't wait for them to resolve
            }
            return Promise.all(indexUpdates)
            .then(() => {
                process.nextTick(triggerAllEvents); // Delayed execution
                return result;
            })
        });
    }


    /**
     * Enumerates all children of a given Node for reflection purposes
     * @param {string} path 
     * @param {object} [options] optional options used by implementation for recursive calls
     * @param {string[]|number[]} [options.keyFilter] specify the child keys to get callbacks for, skips .next callbacks for other keys
     * @param {string} [options.tid] optional transaction id for node locking purposes
     * @returns {{ next(child: NodeInfo) => Promise<void>}} returns a generator object that calls .next for each child until the .next callback returns false
     */
    getChildren(path, options = { keyFilter: undefined, tid: undefined }) {
        throw new Error(`This method must be implemented by subclass`);
    }

    /**
     * Gets a node's value by delegating to getNode, returning only the value
     * @param {string} path 
     * @param {object} [options] optional options that can limit the amount of (sub)data being loaded, and any other implementation specific options for recusrsive calls
     * @param {string[]} [options.include] child paths to include
     * @param {string[]} [options.exclude] child paths to exclude
     * @param {boolean} [options.child_objects] whether to inlcude child objects and arrays
     * @param {string} [options.tid] optional transaction id for node locking purposes
     * @returns {Promise<any>}
     */
    getNodeValue(path, options = { include: undefined, exclude: undefined, child_objects: true, tid: undefined }) {
        return this.getNode(path, options)
        .then(node => {
            return node.value;
        });
    }

    /**
     * Gets a node's value and (if supported) revision
     * @param {string} path 
     * @param {object} [options] optional options that can limit the amount of (sub)data being loaded, and any other implementation specific options for recusrsive calls
     * @param {string[]} [options.include] child paths to include
     * @param {string[]} [options.exclude] child paths to exclude
     * @param {boolean} [options.child_objects] whether to inlcude child objects and arrays
     * @param {string} [options.tid] optional transaction id for node locking purposes
     * @returns {Promise<{ revision?: string, value: any}>}
     */
    getNode(path, options = { include: undefined, exclude: undefined, child_objects: true, tid: undefined }) {
        throw new Error(`This method must be implemented by subclass`);
    }

    /**
     * Retrieves info about a node (existence, wherabouts etc)
     * @param {string} path 
     * @param {object} [options] optional options used by implementation for recursive calls
     * @param {string} [options.tid] optional transaction id for node locking purposes
     * @returns {Promise<NodeInfo>}
     */
    getNodeInfo(path, options = { tid: undefined }) {
        throw new Error(`This method must be implemented by subclass`);
    }

    /**
     * Removes a node by delegating to updateNode on the parent with null value.
     * Throws an Error if path is root ('')
     * @param {string} path
     * @param {object} [options] optional options used by implementation for recursive calls
     * @param {string} [options.tid] optional transaction id for node locking purposes
     * @returns {Promise<void>}
     */
    removeNode(path, options = { tid: undefined }) {
        throw new Error(`This method must be implemented by subclass`);
    }

    /**
     * Creates or overwrites a node. Delegates to updateNode on a parent if
     * path is not the root.
     * @param {string} path
     * @param {any} value
     * @param {object} [options] optional options used by implementation for recursive calls
     * @param {string} [options.tid] optional transaction id for node locking purposes
     * @returns {Promise<void>}
     */
    setNode(path, value, options = { tid: undefined }) {
        throw new Error(`This method must be implemented by subclass`);
    }

    /**
     * Updates a node by merging an existing node with passed updates object, 
     * or creates it by delegating to updateNode on the parent path.
     * @param {string} path
     * @param {object} updates object with key/value pairs
     * @param {object} [options] optional options used by implementation for recursive calls
     * @param {string} [options.tid] optional transaction id for node locking purposes
     * @returns {Promise<void>}
     */
    updateNode(path, updates, options = { tid: undefined }) {
        throw new Error(`This method must be implemented by subclass`);
    }

    /**
     * Updates a node by getting its value, running a callback function that transforms 
     * the current value and returns the new value to be stored. Assures the read value 
     * does not change while the callback runs, or runs the callback again if it did.
     * @param {string} path
     * @param {(value: any) => any} callback function that transforms current value and returns the new value to be stored. Can return a Promise
     * @param {object} [options] optional options used by implementation for recursive calls
     * @param {string} [options.tid] optional transaction id for node locking purposes
     * @returns {Promise<void>}
     */
    transactNode(path, callback, options = { no_lock: false }) {
        let checkRevision;

        const tid = ID.generate();
        const lockPromise = options && options.no_lock === true 
            ? Promise.resolve({ tid, release() {} }) // Fake lock, we'll use revision checking & retrying instead
            : this.nodeLocker.lock(path, tid, true, 'transactNode');

        return lockPromise
        .then(lock => {
            let changed = false, changeCallback = (err, path) => {
                changed = true;
            };
            if (options && options.no_lock) {
                // Monitor value changes
                this.subscriptions.add(path, 'notify_value', changeCallback)
            }
            return this.getNode(path, { tid })
            .then(node => {
                checkRevision = node.revision;
                let newValue;
                try {
                    newValue = callback(node.value);
                }
                catch (err) {
                    this.debug.error(`Error in transaction callback: ${err.message}`);
                }
                if (newValue instanceof Promise) {
                    return newValue.catch(err => {
                        this.debug.error(`Error in transaction callback: ${err.message}`);
                    });
                }
                return newValue;
            })
            .then(newValue => {
                if (typeof newValue === 'undefined') {
                    // Callback did not return value. Cancel transaction
                    return;
                }
                // asserting revision is only needed when no_lock option was specified
                if (options && options.no_lock) {
                    this.subscriptions.remove(path, 'notify_value', changeCallback)
                }
                if (changed) {
                    return Promise.reject(new NodeRevisionError(`Node changed`));
                }
                return this.setNode(path, newValue, { assert_revision: checkRevision, tid: lock.tid });
            })
            .then(result => {
                lock.release();
                return result;
            })
            .catch(err => {
                lock.release();
                // do it again
                if (err instanceof NodeRevisionError) {
                    console.warn(`node value changed, running again. Error: ${err.message}`);
                    return this.transactNode(path, callback, options);
                }
                else {
                    throw err;
                }
            })
        });
    }
    // transactNode(path, callback, options = { tid: undefined }) {
    //     throw new Error(`This method must be implemented by subclass`);
    // }

    /**
     * Checks if a node's value matches the passed criteria
     * @param {string} path
     * @param {Array<{ key: string, op: string, compare: string }>} criteria criteria to test
     * @param {object} [options] optional options used by implementation for recursive calls
     * @param {string} [options.tid] optional transaction id for node locking purposes
     * @returns {Promise<boolean>} returns a promise that resolves with a boolean indicating if it matched the criteria
     */
    matchNode(path, criteria, options = { tid: undefined }) {

        const tid = (options && options.tid) || ID.generate();

        /**
         * 
         * @param {string} path 
         * @param {Array<{ key: string, op: string, compare: string }>} criteria criteria to test
         */
        const checkNode = (path, criteria) => {
            if (criteria.length === 0) {
                return Promise.resolve(true); // No criteria, so yes... It matches!
            }
            const criteriaKeys = criteria.reduce((keys, cr) => {
                if (keys.indexOf(cr.key) < 0) {
                    keys.push(cr.key);
                }
                return keys;
            }, []);
            const unseenKeys = criteriaKeys.slice();

            let isMatch = true;
            let delayedMatchPromises = [];
            return this.getChildren(path, { tid, keyFilter: criteriaKeys })
            .next(childInfo => {
                unseenKeys.includes(childInfo.key) && unseenKeys.splice(unseenKeys.indexOf(childInfo.key), 1);
                const keyCriteria = criteria
                    .filter(cr => cr.key === childInfo.key)
                    .map(cr => ({ op: cr.op, compare: cr.compare }));
                const result = checkChild(childInfo, keyCriteria);
                isMatch = result.isMatch;
                delayedMatchPromises.push(...result.promises);
                if (!isMatch || unseenKeys.length === 0) {
                    return false; // Stop iterating
                }
            })
            .then(() => {
                if (isMatch) {
                    return Promise.all(delayedMatchPromises)
                    .then(results => {
                        isMatch = results.every(res => res.isMatch)
                    });
                }
            })
            .then(() => {
                if (!isMatch) { return false; }
                // Now, also check keys that weren't found in the node. (a criterium may be "!exists")
                isMatch = unseenKeys.every(key => {
                    const child = new NodeInfo({ key, exists: false });
                    const keyCriteria = criteria
                        .filter(cr => cr.key === key)
                        .map(cr => ({ op: cr.op, compare: cr.compare }));
                    const result = checkChild(child, keyCriteria);
                    return result.isMatch;
                });
                return isMatch;
            })
            .catch(err => {
                this.debug.error(`Error matching on "${path}": `, err);
                throw err;
            });
        }; // checkNode


        /**
         * 
         * @param {NodeInfo} child 
         * @param {Array<{ op: string, compare: string }>} criteria criteria to test
         */
        const checkChild = (child, criteria) => {
            const promises = [];
            const isMatch = criteria.every(f => {
                let proceed = true;
                if (f.op === "!exists" || (f.op === "==" && (typeof f.compare === 'undefined' || f.compare === null))) { 
                    proceed = !child.exists;
                }
                else if (f.op === "exists" || (f.op === "!=" && (typeof f.compare === 'undefined' || f.compare === null))) {
                    proceed = child.exists;
                }
                else if (!child.exists) {
                    proceed = false;
                }
                else {
                    // const isMatch = (val) => {
                    //     if (f.op === "<") { return val < f.compare; }
                    //     if (f.op === "<=") { return val <= f.compare; }
                    //     if (f.op === "==") { return val === f.compare; }
                    //     if (f.op === "!=") { return val !== f.compare; }
                    //     if (f.op === ">") { return val > f.compare; }
                    //     if (f.op === ">=") { return val >= f.compare; }
                    //     if (f.op === "in") { return f.compare.indexOf(val) >= 0; }
                    //     if (f.op === "!in") { return f.compare.indexOf(val) < 0; }
                    //     if (f.op === "like" || f.op === "!like") {
                    //         const pattern = f.compare.replace(/[-[\]{}()+.,\\^$|#\s]/g, '\\$&').replace(/\?/g, '.').replace(/\*/g, '.*?');
                    //         const re = new RegExp(pattern, 'i');
                    //         const isMatch = re.test(val.toString());
                    //         return f.op === "like" ? isMatch : !isMatch;
                    //     }
                    //     if (f.op === "matches") {
                    //         return f.compare.test(val.toString());
                    //     }
                    //     if (f.op === "!matches") {
                    //         return !f.compare.test(val.toString());
                    //     }
                    //     if (f.op === "between") {
                    //         return val >= f.compare[0] && val <= f.compare[1];
                    //     }
                    //     if (f.op === "!between") {
                    //         return val < f.compare[0] || val > f.compare[1];
                    //     }
                    //     // DISABLED 2019/10/23 because "custom" only works locally and is not fully implemented
                    //     // if (f.op === "custom") {
                    //     //     return f.compare(val);
                    //     // }
                    //     return false;
                    // };
                    
                    if (child.address) {
                        if (child.valueType === VALUE_TYPES.OBJECT && ["has","!has"].indexOf(f.op) >= 0) {
                            const op = f.op === "has" ? "exists" : "!exists";
                            const p = checkNode(child.path, [{ key: f.compare, op }])
                            .then(isMatch => {
                                return { key: child.key, isMatch };
                            });
                            promises.push(p);
                            proceed = true;
                        }
                        else if (child.valueType === VALUE_TYPES.ARRAY && ["contains","!contains"].indexOf(f.op) >= 0) {
                            // TODO: refactor to use child stream
                            const p = this.getNodeValue(child.path, { tid })
                            .then(arr => {
                                // const i = arr.indexOf(f.compare);
                                // return { key: child.key, isMatch: (i >= 0 && f.op === "contains") || (i < 0 && f.op === "!contains") };
        
                                const isMatch = 
                                    f.op === "contains"
                                        // "contains"
                                        ? f.compare instanceof Array
                                            ? f.compare.every(val => arr.includes(val)) // Match if ALL of the passed values are in the array
                                            : arr.includes(f.compare)
                                    
                                        // "!contains"
                                        : f.compare instanceof Array
                                            ? !f.compare.some(val => arr.includes(val)) // DON'T match if ANY of the passed values is in the array
                                            : !arr.includes(f.compare);
        
                                return { key: child.key, isMatch };
                            });
                            promises.push(p);
                            proceed = true;
                        }
                        else if (child.valueType === VALUE_TYPES.STRING) {
                            const p = this.getNodeValue(child.path, { tid })
                            .then(val => {
                                return { key: child.key, isMatch: this.test(val, f.op, f.compare) };
                            });
                            promises.push(p);
                            proceed = true;
                        }
                        else {
                            proceed = false;
                        }
                    }
                    else if (child.type === VALUE_TYPES.OBJECT && ["has","!has"].indexOf(f.op) >= 0) {
                        const has = f.compare in child.value;
                        proceed = (has && f.op === "has") || (!has && f.op === "!has");
                    }
                    else if (child.type === VALUE_TYPES.ARRAY && ["contains","!contains"].indexOf(f.op) >= 0) {
                        const contains = child.value.indexOf(f.compare) >= 0;
                        proceed = (contains && f.op === "contains") || (!contains && f.op === "!contains");
                    }
                    else {
                        const ret = this.test(child.value, f.op, f.compare);
                        if (ret instanceof Promise) {
                            promises.push(ret);
                            ret = true;
                        }
                        proceed = ret;
                    }
                }
                return proceed;
            }); // fs.every
        
            return { isMatch, promises };        
        }; // checkChild

        return checkNode(path, criteria);
    }

    test(val, op, compare) {
        if (op === "<") { return val < compare; }
        if (op === "<=") { return val <= compare; }
        if (op === "==") { return val === compare; }
        if (op === "!=") { return val !== compare; }
        if (op === ">") { return val > compare; }
        if (op === ">=") { return val >= compare; }
        if (op === "in") { return compare.indexOf(val) >= 0; }
        if (op === "!in") { return compare.indexOf(val) < 0; }
        if (op === "like" || op === "!like") {
            const pattern = '^' + compare.replace(/[-[\]{}()+.,\\^$|#\s]/g, '\\$&').replace(/\?/g, '.').replace(/\*/g, '.*?') + '$';
            const re = new RegExp(pattern, 'i');
            const isMatch = re.test(val.toString());
            return op === "like" ? isMatch : !isMatch;
        }
        if (op === "matches") {
            return compare.test(val.toString());
        }
        if (op === "!matches") {
            return !compare.test(val.toString());
        }
        if (op === "between") {
            return val >= compare[0] && val <= compare[1];
        }
        if (op === "!between") {
            return val < compare[0] || val > compare[1];
        }
        if (op === "has" || op === "!has") {
            const has = typeof val === 'object' && compare in val;
            return op === "has" ? has : !has;
        }
        if (op === "contains" || op === "!contains") {
            // TODO: rename to "includes"?
            const includes = typeof val === 'object' && val instanceof Array && val.includes(compare);
            return op === "contains" ? includes : !includes;
        }
        return false;
    }

    /**
     * Export a specific path's data to a stream
     * @param {Storage} storage
     * @param {string} path
     * @param {{ write(str: string) => void|Promise<void>}} stream stream object that has a write method that (optionally) returns a promise the export needs to wait for before continuing
     * @returns {Promise<void>} returns a promise that resolves once all data is exported
     */
    exportNode(path, stream, options = { format: 'json' }) {
        if (options && options.format !== 'json') {
            throw new Error(`Only json output is currently supported`);
        }

        const stringifyValue = (type, val) => {
            const escape = str => str.replace(/\\/i, "\\\\").replace(/"/g, '\\"');
            if (type === VALUE_TYPES.DATETIME) {
                val = `"${val.toISOString()}"`;
            }
            else if (type === VALUE_TYPES.STRING) {
                val = `"${escape(val)}"`;
            }
            else if (type === VALUE_TYPES.ARRAY) {
                val = `[]`;
            }
            else if (type === VALUE_TYPES.OBJECT) {
                val = `{}`;
            }
            else if (type === VALUE_TYPES.BINARY) {
                val = `"${escape(ascii85.encode(val))}"`; // TODO: use base64 instead, no escaping needed
            }
            else if (type === VALUE_TYPES.REFERENCE) {
                val = `"${val.path}"`;
            }
            return val;
        };

        const queue = [];
        let outputCount = 0;
        let objStart = '', objEnd = '';
        const buffer = {
            output: '',
            enable: false,
            promise: null
        }

        return this.getNodeInfo(path)
        .then(nodeInfo => {
            if (!nodeInfo.exists) {
                stream.write('null');
            }
            else if (nodeInfo.type === VALUE_TYPES.OBJECT) { objStart = '{'; objEnd = '}'; }
            else if (nodeInfo.type === VALUE_TYPES.ARRAY) { objStart = '{'; objEnd = '}'; } // TODO: export as arrays, and guarantee the right order!!!
            else {
                // Node has no children, get and export its value
                return this.getNodeValue(path)
                .then(value => {
                    const val = stringifyValue(nodeInfo.type, value);
                    return stream.write(val);
                });
            }

            let p = Promise.resolve();
            if (objStart) {
                p = stream.write(objStart);
                if (!(p instanceof Promise)) { p = Promise.resolve(); }
            }
            return p
            .then(() => {
                return this.getChildren(path)
                .next(childInfo => {
                    // if child is stored in the parent record, we can output it right now. 
                    // If a child needs value fetching, queue it for output
                    if (childInfo.address) {
                        queue.push(childInfo);
                    }
                    else {
                        const val = stringifyValue(childInfo.type, childInfo.value);
                        const comma = outputCount > 0 ? ',' : '';
                        const key = typeof childInfo.index === 'number' ? `"${childInfo.index}"` : `"${childInfo.key}"`;
                        const output = `${comma}${key}:${val}`;
                        outputCount++;
                        if (buffer.enable) {
                            // Output must be buffered. Doing this will probably not cost a lot of memory because these 
                            // values are only the smaller (inline) ones being flushed. Larger ones will have been queued above
                            buffer.output += output;
                        }
                        else {
                            // Output can be flushed to the stream. If the write function resturns a promise, we need to buffer
                            // further output before flushing again.
                            const flush = output => {
                                const p = stream.write(output);
                                if (p instanceof Promise) {
                                    // buffer all output until write promise resolves
                                    buffer.enable = true;
                                    buffer.promise = p.then(() => {
                                        // We can flush now
                                        const buffered = buffer.output;
                                        buffer.enable = false;
                                        buffer.output = '';
                                        buffer.promise = null;
                                        if (buffered.length > 0) {
                                            return flush(buffered);
                                        }
                                    });
                                    return buffer.promise;
                                }
                            }
                            flush(output);
                        }
                    }
                });
            });
        })
        .then(() => {
            return buffer.promise; // Wait for any buffered output to be flushed before continuing
        })
        .then(() => {
            // process queueu
            const next = () => {
                if (queue.length === 0) { 
                    // Done
                    return; 
                }
                const childInfo = queue.shift();

                const comma = outputCount > 0 ? ',' : '';
                const key = typeof childInfo.index === 'number' ? `"${childInfo.index}"` : `"${childInfo.key}"`;
                let p = stream.write(`${comma}${key}:`);
                outputCount++;
                if (!(p instanceof Promise)) {
                    p = Promise.resolve(p);
                }
                return p.then(() => {
                    return this.exportNode(childInfo.address.path, stream);
                })
                .then(() => {
                    return next();
                });
            };
            return next();
        })
        .then(() => {
            if (objEnd) {
                return stream.write(objEnd);
            }
        });
    }

}

module.exports = {
    Storage,
    StorageSettings,
    NodeNotFoundError,
    NodeRevisionError
};
}).call(this,require('_process'))
},{"./data-index":39,"./node-info":33,"./node-lock":34,"./node-value-types":35,"./promise-fs":39,"_process":43,"acebase-core":11,"colors":22,"events":40}],39:[function(require,module,exports){

},{}],40:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var objectCreate = Object.create || objectCreatePolyfill
var objectKeys = Object.keys || objectKeysPolyfill
var bind = Function.prototype.bind || functionBindPolyfill

function EventEmitter() {
  if (!this._events || !Object.prototype.hasOwnProperty.call(this, '_events')) {
    this._events = objectCreate(null);
    this._eventsCount = 0;
  }

  this._maxListeners = this._maxListeners || undefined;
}
module.exports = EventEmitter;

// Backwards-compat with node 0.10.x
EventEmitter.EventEmitter = EventEmitter;

EventEmitter.prototype._events = undefined;
EventEmitter.prototype._maxListeners = undefined;

// By default EventEmitters will print a warning if more than 10 listeners are
// added to it. This is a useful default which helps finding memory leaks.
var defaultMaxListeners = 10;

var hasDefineProperty;
try {
  var o = {};
  if (Object.defineProperty) Object.defineProperty(o, 'x', { value: 0 });
  hasDefineProperty = o.x === 0;
} catch (err) { hasDefineProperty = false }
if (hasDefineProperty) {
  Object.defineProperty(EventEmitter, 'defaultMaxListeners', {
    enumerable: true,
    get: function() {
      return defaultMaxListeners;
    },
    set: function(arg) {
      // check whether the input is a positive number (whose value is zero or
      // greater and not a NaN).
      if (typeof arg !== 'number' || arg < 0 || arg !== arg)
        throw new TypeError('"defaultMaxListeners" must be a positive number');
      defaultMaxListeners = arg;
    }
  });
} else {
  EventEmitter.defaultMaxListeners = defaultMaxListeners;
}

// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
EventEmitter.prototype.setMaxListeners = function setMaxListeners(n) {
  if (typeof n !== 'number' || n < 0 || isNaN(n))
    throw new TypeError('"n" argument must be a positive number');
  this._maxListeners = n;
  return this;
};

function $getMaxListeners(that) {
  if (that._maxListeners === undefined)
    return EventEmitter.defaultMaxListeners;
  return that._maxListeners;
}

EventEmitter.prototype.getMaxListeners = function getMaxListeners() {
  return $getMaxListeners(this);
};

// These standalone emit* functions are used to optimize calling of event
// handlers for fast cases because emit() itself often has a variable number of
// arguments and can be deoptimized because of that. These functions always have
// the same number of arguments and thus do not get deoptimized, so the code
// inside them can execute faster.
function emitNone(handler, isFn, self) {
  if (isFn)
    handler.call(self);
  else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      listeners[i].call(self);
  }
}
function emitOne(handler, isFn, self, arg1) {
  if (isFn)
    handler.call(self, arg1);
  else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      listeners[i].call(self, arg1);
  }
}
function emitTwo(handler, isFn, self, arg1, arg2) {
  if (isFn)
    handler.call(self, arg1, arg2);
  else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      listeners[i].call(self, arg1, arg2);
  }
}
function emitThree(handler, isFn, self, arg1, arg2, arg3) {
  if (isFn)
    handler.call(self, arg1, arg2, arg3);
  else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      listeners[i].call(self, arg1, arg2, arg3);
  }
}

function emitMany(handler, isFn, self, args) {
  if (isFn)
    handler.apply(self, args);
  else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      listeners[i].apply(self, args);
  }
}

EventEmitter.prototype.emit = function emit(type) {
  var er, handler, len, args, i, events;
  var doError = (type === 'error');

  events = this._events;
  if (events)
    doError = (doError && events.error == null);
  else if (!doError)
    return false;

  // If there is no 'error' event listener then throw.
  if (doError) {
    if (arguments.length > 1)
      er = arguments[1];
    if (er instanceof Error) {
      throw er; // Unhandled 'error' event
    } else {
      // At least give some kind of context to the user
      var err = new Error('Unhandled "error" event. (' + er + ')');
      err.context = er;
      throw err;
    }
    return false;
  }

  handler = events[type];

  if (!handler)
    return false;

  var isFn = typeof handler === 'function';
  len = arguments.length;
  switch (len) {
      // fast cases
    case 1:
      emitNone(handler, isFn, this);
      break;
    case 2:
      emitOne(handler, isFn, this, arguments[1]);
      break;
    case 3:
      emitTwo(handler, isFn, this, arguments[1], arguments[2]);
      break;
    case 4:
      emitThree(handler, isFn, this, arguments[1], arguments[2], arguments[3]);
      break;
      // slower
    default:
      args = new Array(len - 1);
      for (i = 1; i < len; i++)
        args[i - 1] = arguments[i];
      emitMany(handler, isFn, this, args);
  }

  return true;
};

function _addListener(target, type, listener, prepend) {
  var m;
  var events;
  var existing;

  if (typeof listener !== 'function')
    throw new TypeError('"listener" argument must be a function');

  events = target._events;
  if (!events) {
    events = target._events = objectCreate(null);
    target._eventsCount = 0;
  } else {
    // To avoid recursion in the case that type === "newListener"! Before
    // adding it to the listeners, first emit "newListener".
    if (events.newListener) {
      target.emit('newListener', type,
          listener.listener ? listener.listener : listener);

      // Re-assign `events` because a newListener handler could have caused the
      // this._events to be assigned to a new object
      events = target._events;
    }
    existing = events[type];
  }

  if (!existing) {
    // Optimize the case of one listener. Don't need the extra array object.
    existing = events[type] = listener;
    ++target._eventsCount;
  } else {
    if (typeof existing === 'function') {
      // Adding the second element, need to change to array.
      existing = events[type] =
          prepend ? [listener, existing] : [existing, listener];
    } else {
      // If we've already got an array, just append.
      if (prepend) {
        existing.unshift(listener);
      } else {
        existing.push(listener);
      }
    }

    // Check for listener leak
    if (!existing.warned) {
      m = $getMaxListeners(target);
      if (m && m > 0 && existing.length > m) {
        existing.warned = true;
        var w = new Error('Possible EventEmitter memory leak detected. ' +
            existing.length + ' "' + String(type) + '" listeners ' +
            'added. Use emitter.setMaxListeners() to ' +
            'increase limit.');
        w.name = 'MaxListenersExceededWarning';
        w.emitter = target;
        w.type = type;
        w.count = existing.length;
        if (typeof console === 'object' && console.warn) {
          console.warn('%s: %s', w.name, w.message);
        }
      }
    }
  }

  return target;
}

EventEmitter.prototype.addListener = function addListener(type, listener) {
  return _addListener(this, type, listener, false);
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.prependListener =
    function prependListener(type, listener) {
      return _addListener(this, type, listener, true);
    };

function onceWrapper() {
  if (!this.fired) {
    this.target.removeListener(this.type, this.wrapFn);
    this.fired = true;
    switch (arguments.length) {
      case 0:
        return this.listener.call(this.target);
      case 1:
        return this.listener.call(this.target, arguments[0]);
      case 2:
        return this.listener.call(this.target, arguments[0], arguments[1]);
      case 3:
        return this.listener.call(this.target, arguments[0], arguments[1],
            arguments[2]);
      default:
        var args = new Array(arguments.length);
        for (var i = 0; i < args.length; ++i)
          args[i] = arguments[i];
        this.listener.apply(this.target, args);
    }
  }
}

function _onceWrap(target, type, listener) {
  var state = { fired: false, wrapFn: undefined, target: target, type: type, listener: listener };
  var wrapped = bind.call(onceWrapper, state);
  wrapped.listener = listener;
  state.wrapFn = wrapped;
  return wrapped;
}

EventEmitter.prototype.once = function once(type, listener) {
  if (typeof listener !== 'function')
    throw new TypeError('"listener" argument must be a function');
  this.on(type, _onceWrap(this, type, listener));
  return this;
};

EventEmitter.prototype.prependOnceListener =
    function prependOnceListener(type, listener) {
      if (typeof listener !== 'function')
        throw new TypeError('"listener" argument must be a function');
      this.prependListener(type, _onceWrap(this, type, listener));
      return this;
    };

// Emits a 'removeListener' event if and only if the listener was removed.
EventEmitter.prototype.removeListener =
    function removeListener(type, listener) {
      var list, events, position, i, originalListener;

      if (typeof listener !== 'function')
        throw new TypeError('"listener" argument must be a function');

      events = this._events;
      if (!events)
        return this;

      list = events[type];
      if (!list)
        return this;

      if (list === listener || list.listener === listener) {
        if (--this._eventsCount === 0)
          this._events = objectCreate(null);
        else {
          delete events[type];
          if (events.removeListener)
            this.emit('removeListener', type, list.listener || listener);
        }
      } else if (typeof list !== 'function') {
        position = -1;

        for (i = list.length - 1; i >= 0; i--) {
          if (list[i] === listener || list[i].listener === listener) {
            originalListener = list[i].listener;
            position = i;
            break;
          }
        }

        if (position < 0)
          return this;

        if (position === 0)
          list.shift();
        else
          spliceOne(list, position);

        if (list.length === 1)
          events[type] = list[0];

        if (events.removeListener)
          this.emit('removeListener', type, originalListener || listener);
      }

      return this;
    };

EventEmitter.prototype.removeAllListeners =
    function removeAllListeners(type) {
      var listeners, events, i;

      events = this._events;
      if (!events)
        return this;

      // not listening for removeListener, no need to emit
      if (!events.removeListener) {
        if (arguments.length === 0) {
          this._events = objectCreate(null);
          this._eventsCount = 0;
        } else if (events[type]) {
          if (--this._eventsCount === 0)
            this._events = objectCreate(null);
          else
            delete events[type];
        }
        return this;
      }

      // emit removeListener for all listeners on all events
      if (arguments.length === 0) {
        var keys = objectKeys(events);
        var key;
        for (i = 0; i < keys.length; ++i) {
          key = keys[i];
          if (key === 'removeListener') continue;
          this.removeAllListeners(key);
        }
        this.removeAllListeners('removeListener');
        this._events = objectCreate(null);
        this._eventsCount = 0;
        return this;
      }

      listeners = events[type];

      if (typeof listeners === 'function') {
        this.removeListener(type, listeners);
      } else if (listeners) {
        // LIFO order
        for (i = listeners.length - 1; i >= 0; i--) {
          this.removeListener(type, listeners[i]);
        }
      }

      return this;
    };

function _listeners(target, type, unwrap) {
  var events = target._events;

  if (!events)
    return [];

  var evlistener = events[type];
  if (!evlistener)
    return [];

  if (typeof evlistener === 'function')
    return unwrap ? [evlistener.listener || evlistener] : [evlistener];

  return unwrap ? unwrapListeners(evlistener) : arrayClone(evlistener, evlistener.length);
}

EventEmitter.prototype.listeners = function listeners(type) {
  return _listeners(this, type, true);
};

EventEmitter.prototype.rawListeners = function rawListeners(type) {
  return _listeners(this, type, false);
};

EventEmitter.listenerCount = function(emitter, type) {
  if (typeof emitter.listenerCount === 'function') {
    return emitter.listenerCount(type);
  } else {
    return listenerCount.call(emitter, type);
  }
};

EventEmitter.prototype.listenerCount = listenerCount;
function listenerCount(type) {
  var events = this._events;

  if (events) {
    var evlistener = events[type];

    if (typeof evlistener === 'function') {
      return 1;
    } else if (evlistener) {
      return evlistener.length;
    }
  }

  return 0;
}

EventEmitter.prototype.eventNames = function eventNames() {
  return this._eventsCount > 0 ? Reflect.ownKeys(this._events) : [];
};

// About 1.5x faster than the two-arg version of Array#splice().
function spliceOne(list, index) {
  for (var i = index, k = i + 1, n = list.length; k < n; i += 1, k += 1)
    list[i] = list[k];
  list.pop();
}

function arrayClone(arr, n) {
  var copy = new Array(n);
  for (var i = 0; i < n; ++i)
    copy[i] = arr[i];
  return copy;
}

function unwrapListeners(arr) {
  var ret = new Array(arr.length);
  for (var i = 0; i < ret.length; ++i) {
    ret[i] = arr[i].listener || arr[i];
  }
  return ret;
}

function objectCreatePolyfill(proto) {
  var F = function() {};
  F.prototype = proto;
  return new F;
}
function objectKeysPolyfill(obj) {
  var keys = [];
  for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) {
    keys.push(k);
  }
  return k;
}
function functionBindPolyfill(context) {
  var fn = this;
  return function () {
    return fn.apply(context, arguments);
  };
}

},{}],41:[function(require,module,exports){
if (typeof Object.create === 'function') {
  // implementation from standard node.js 'util' module
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    ctor.prototype = Object.create(superCtor.prototype, {
      constructor: {
        value: ctor,
        enumerable: false,
        writable: true,
        configurable: true
      }
    });
  };
} else {
  // old school shim for old browsers
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    var TempCtor = function () {}
    TempCtor.prototype = superCtor.prototype
    ctor.prototype = new TempCtor()
    ctor.prototype.constructor = ctor
  }
}

},{}],42:[function(require,module,exports){
exports.endianness = function () { return 'LE' };

exports.hostname = function () {
    if (typeof location !== 'undefined') {
        return location.hostname
    }
    else return '';
};

exports.loadavg = function () { return [] };

exports.uptime = function () { return 0 };

exports.freemem = function () {
    return Number.MAX_VALUE;
};

exports.totalmem = function () {
    return Number.MAX_VALUE;
};

exports.cpus = function () { return [] };

exports.type = function () { return 'Browser' };

exports.release = function () {
    if (typeof navigator !== 'undefined') {
        return navigator.appVersion;
    }
    return '';
};

exports.networkInterfaces
= exports.getNetworkInterfaces
= function () { return {} };

exports.arch = function () { return 'javascript' };

exports.platform = function () { return 'browser' };

exports.tmpdir = exports.tmpDir = function () {
    return '/tmp';
};

exports.EOL = '\n';

exports.homedir = function () {
	return '/'
};

},{}],43:[function(require,module,exports){
// shim for using process in browser
var process = module.exports = {};

// cached from whatever global is present so that test runners that stub it
// don't break things.  But we need to wrap it in a try catch in case it is
// wrapped in strict mode code which doesn't define any globals.  It's inside a
// function because try/catches deoptimize in certain engines.

var cachedSetTimeout;
var cachedClearTimeout;

function defaultSetTimout() {
    throw new Error('setTimeout has not been defined');
}
function defaultClearTimeout () {
    throw new Error('clearTimeout has not been defined');
}
(function () {
    try {
        if (typeof setTimeout === 'function') {
            cachedSetTimeout = setTimeout;
        } else {
            cachedSetTimeout = defaultSetTimout;
        }
    } catch (e) {
        cachedSetTimeout = defaultSetTimout;
    }
    try {
        if (typeof clearTimeout === 'function') {
            cachedClearTimeout = clearTimeout;
        } else {
            cachedClearTimeout = defaultClearTimeout;
        }
    } catch (e) {
        cachedClearTimeout = defaultClearTimeout;
    }
} ())
function runTimeout(fun) {
    if (cachedSetTimeout === setTimeout) {
        //normal enviroments in sane situations
        return setTimeout(fun, 0);
    }
    // if setTimeout wasn't available but was latter defined
    if ((cachedSetTimeout === defaultSetTimout || !cachedSetTimeout) && setTimeout) {
        cachedSetTimeout = setTimeout;
        return setTimeout(fun, 0);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedSetTimeout(fun, 0);
    } catch(e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't trust the global object when called normally
            return cachedSetTimeout.call(null, fun, 0);
        } catch(e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error
            return cachedSetTimeout.call(this, fun, 0);
        }
    }


}
function runClearTimeout(marker) {
    if (cachedClearTimeout === clearTimeout) {
        //normal enviroments in sane situations
        return clearTimeout(marker);
    }
    // if clearTimeout wasn't available but was latter defined
    if ((cachedClearTimeout === defaultClearTimeout || !cachedClearTimeout) && clearTimeout) {
        cachedClearTimeout = clearTimeout;
        return clearTimeout(marker);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedClearTimeout(marker);
    } catch (e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't  trust the global object when called normally
            return cachedClearTimeout.call(null, marker);
        } catch (e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error.
            // Some versions of I.E. have different rules for clearTimeout vs setTimeout
            return cachedClearTimeout.call(this, marker);
        }
    }



}
var queue = [];
var draining = false;
var currentQueue;
var queueIndex = -1;

function cleanUpNextTick() {
    if (!draining || !currentQueue) {
        return;
    }
    draining = false;
    if (currentQueue.length) {
        queue = currentQueue.concat(queue);
    } else {
        queueIndex = -1;
    }
    if (queue.length) {
        drainQueue();
    }
}

function drainQueue() {
    if (draining) {
        return;
    }
    var timeout = runTimeout(cleanUpNextTick);
    draining = true;

    var len = queue.length;
    while(len) {
        currentQueue = queue;
        queue = [];
        while (++queueIndex < len) {
            if (currentQueue) {
                currentQueue[queueIndex].run();
            }
        }
        queueIndex = -1;
        len = queue.length;
    }
    currentQueue = null;
    draining = false;
    runClearTimeout(timeout);
}

process.nextTick = function (fun) {
    var args = new Array(arguments.length - 1);
    if (arguments.length > 1) {
        for (var i = 1; i < arguments.length; i++) {
            args[i - 1] = arguments[i];
        }
    }
    queue.push(new Item(fun, args));
    if (queue.length === 1 && !draining) {
        runTimeout(drainQueue);
    }
};

// v8 likes predictible objects
function Item(fun, array) {
    this.fun = fun;
    this.array = array;
}
Item.prototype.run = function () {
    this.fun.apply(null, this.array);
};
process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];
process.version = ''; // empty string to avoid regexp issues
process.versions = {};

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;
process.prependListener = noop;
process.prependOnceListener = noop;

process.listeners = function (name) { return [] }

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};
process.umask = function() { return 0; };

},{}],44:[function(require,module,exports){
module.exports = function isBuffer(arg) {
  return arg && typeof arg === 'object'
    && typeof arg.copy === 'function'
    && typeof arg.fill === 'function'
    && typeof arg.readUInt8 === 'function';
}
},{}],45:[function(require,module,exports){
(function (process,global){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var formatRegExp = /%[sdj%]/g;
exports.format = function(f) {
  if (!isString(f)) {
    var objects = [];
    for (var i = 0; i < arguments.length; i++) {
      objects.push(inspect(arguments[i]));
    }
    return objects.join(' ');
  }

  var i = 1;
  var args = arguments;
  var len = args.length;
  var str = String(f).replace(formatRegExp, function(x) {
    if (x === '%%') return '%';
    if (i >= len) return x;
    switch (x) {
      case '%s': return String(args[i++]);
      case '%d': return Number(args[i++]);
      case '%j':
        try {
          return JSON.stringify(args[i++]);
        } catch (_) {
          return '[Circular]';
        }
      default:
        return x;
    }
  });
  for (var x = args[i]; i < len; x = args[++i]) {
    if (isNull(x) || !isObject(x)) {
      str += ' ' + x;
    } else {
      str += ' ' + inspect(x);
    }
  }
  return str;
};


// Mark that a method should not be used.
// Returns a modified function which warns once by default.
// If --no-deprecation is set, then it is a no-op.
exports.deprecate = function(fn, msg) {
  // Allow for deprecating things in the process of starting up.
  if (isUndefined(global.process)) {
    return function() {
      return exports.deprecate(fn, msg).apply(this, arguments);
    };
  }

  if (process.noDeprecation === true) {
    return fn;
  }

  var warned = false;
  function deprecated() {
    if (!warned) {
      if (process.throwDeprecation) {
        throw new Error(msg);
      } else if (process.traceDeprecation) {
        console.trace(msg);
      } else {
        console.error(msg);
      }
      warned = true;
    }
    return fn.apply(this, arguments);
  }

  return deprecated;
};


var debugs = {};
var debugEnviron;
exports.debuglog = function(set) {
  if (isUndefined(debugEnviron))
    debugEnviron = process.env.NODE_DEBUG || '';
  set = set.toUpperCase();
  if (!debugs[set]) {
    if (new RegExp('\\b' + set + '\\b', 'i').test(debugEnviron)) {
      var pid = process.pid;
      debugs[set] = function() {
        var msg = exports.format.apply(exports, arguments);
        console.error('%s %d: %s', set, pid, msg);
      };
    } else {
      debugs[set] = function() {};
    }
  }
  return debugs[set];
};


/**
 * Echos the value of a value. Trys to print the value out
 * in the best way possible given the different types.
 *
 * @param {Object} obj The object to print out.
 * @param {Object} opts Optional options object that alters the output.
 */
/* legacy: obj, showHidden, depth, colors*/
function inspect(obj, opts) {
  // default options
  var ctx = {
    seen: [],
    stylize: stylizeNoColor
  };
  // legacy...
  if (arguments.length >= 3) ctx.depth = arguments[2];
  if (arguments.length >= 4) ctx.colors = arguments[3];
  if (isBoolean(opts)) {
    // legacy...
    ctx.showHidden = opts;
  } else if (opts) {
    // got an "options" object
    exports._extend(ctx, opts);
  }
  // set default options
  if (isUndefined(ctx.showHidden)) ctx.showHidden = false;
  if (isUndefined(ctx.depth)) ctx.depth = 2;
  if (isUndefined(ctx.colors)) ctx.colors = false;
  if (isUndefined(ctx.customInspect)) ctx.customInspect = true;
  if (ctx.colors) ctx.stylize = stylizeWithColor;
  return formatValue(ctx, obj, ctx.depth);
}
exports.inspect = inspect;


// http://en.wikipedia.org/wiki/ANSI_escape_code#graphics
inspect.colors = {
  'bold' : [1, 22],
  'italic' : [3, 23],
  'underline' : [4, 24],
  'inverse' : [7, 27],
  'white' : [37, 39],
  'grey' : [90, 39],
  'black' : [30, 39],
  'blue' : [34, 39],
  'cyan' : [36, 39],
  'green' : [32, 39],
  'magenta' : [35, 39],
  'red' : [31, 39],
  'yellow' : [33, 39]
};

// Don't use 'blue' not visible on cmd.exe
inspect.styles = {
  'special': 'cyan',
  'number': 'yellow',
  'boolean': 'yellow',
  'undefined': 'grey',
  'null': 'bold',
  'string': 'green',
  'date': 'magenta',
  // "name": intentionally not styling
  'regexp': 'red'
};


function stylizeWithColor(str, styleType) {
  var style = inspect.styles[styleType];

  if (style) {
    return '\u001b[' + inspect.colors[style][0] + 'm' + str +
           '\u001b[' + inspect.colors[style][1] + 'm';
  } else {
    return str;
  }
}


function stylizeNoColor(str, styleType) {
  return str;
}


function arrayToHash(array) {
  var hash = {};

  array.forEach(function(val, idx) {
    hash[val] = true;
  });

  return hash;
}


function formatValue(ctx, value, recurseTimes) {
  // Provide a hook for user-specified inspect functions.
  // Check that value is an object with an inspect function on it
  if (ctx.customInspect &&
      value &&
      isFunction(value.inspect) &&
      // Filter out the util module, it's inspect function is special
      value.inspect !== exports.inspect &&
      // Also filter out any prototype objects using the circular check.
      !(value.constructor && value.constructor.prototype === value)) {
    var ret = value.inspect(recurseTimes, ctx);
    if (!isString(ret)) {
      ret = formatValue(ctx, ret, recurseTimes);
    }
    return ret;
  }

  // Primitive types cannot have properties
  var primitive = formatPrimitive(ctx, value);
  if (primitive) {
    return primitive;
  }

  // Look up the keys of the object.
  var keys = Object.keys(value);
  var visibleKeys = arrayToHash(keys);

  if (ctx.showHidden) {
    keys = Object.getOwnPropertyNames(value);
  }

  // IE doesn't make error fields non-enumerable
  // http://msdn.microsoft.com/en-us/library/ie/dww52sbt(v=vs.94).aspx
  if (isError(value)
      && (keys.indexOf('message') >= 0 || keys.indexOf('description') >= 0)) {
    return formatError(value);
  }

  // Some type of object without properties can be shortcutted.
  if (keys.length === 0) {
    if (isFunction(value)) {
      var name = value.name ? ': ' + value.name : '';
      return ctx.stylize('[Function' + name + ']', 'special');
    }
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    }
    if (isDate(value)) {
      return ctx.stylize(Date.prototype.toString.call(value), 'date');
    }
    if (isError(value)) {
      return formatError(value);
    }
  }

  var base = '', array = false, braces = ['{', '}'];

  // Make Array say that they are Array
  if (isArray(value)) {
    array = true;
    braces = ['[', ']'];
  }

  // Make functions say that they are functions
  if (isFunction(value)) {
    var n = value.name ? ': ' + value.name : '';
    base = ' [Function' + n + ']';
  }

  // Make RegExps say that they are RegExps
  if (isRegExp(value)) {
    base = ' ' + RegExp.prototype.toString.call(value);
  }

  // Make dates with properties first say the date
  if (isDate(value)) {
    base = ' ' + Date.prototype.toUTCString.call(value);
  }

  // Make error with message first say the error
  if (isError(value)) {
    base = ' ' + formatError(value);
  }

  if (keys.length === 0 && (!array || value.length == 0)) {
    return braces[0] + base + braces[1];
  }

  if (recurseTimes < 0) {
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    } else {
      return ctx.stylize('[Object]', 'special');
    }
  }

  ctx.seen.push(value);

  var output;
  if (array) {
    output = formatArray(ctx, value, recurseTimes, visibleKeys, keys);
  } else {
    output = keys.map(function(key) {
      return formatProperty(ctx, value, recurseTimes, visibleKeys, key, array);
    });
  }

  ctx.seen.pop();

  return reduceToSingleString(output, base, braces);
}


function formatPrimitive(ctx, value) {
  if (isUndefined(value))
    return ctx.stylize('undefined', 'undefined');
  if (isString(value)) {
    var simple = '\'' + JSON.stringify(value).replace(/^"|"$/g, '')
                                             .replace(/'/g, "\\'")
                                             .replace(/\\"/g, '"') + '\'';
    return ctx.stylize(simple, 'string');
  }
  if (isNumber(value))
    return ctx.stylize('' + value, 'number');
  if (isBoolean(value))
    return ctx.stylize('' + value, 'boolean');
  // For some reason typeof null is "object", so special case here.
  if (isNull(value))
    return ctx.stylize('null', 'null');
}


function formatError(value) {
  return '[' + Error.prototype.toString.call(value) + ']';
}


function formatArray(ctx, value, recurseTimes, visibleKeys, keys) {
  var output = [];
  for (var i = 0, l = value.length; i < l; ++i) {
    if (hasOwnProperty(value, String(i))) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
          String(i), true));
    } else {
      output.push('');
    }
  }
  keys.forEach(function(key) {
    if (!key.match(/^\d+$/)) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
          key, true));
    }
  });
  return output;
}


function formatProperty(ctx, value, recurseTimes, visibleKeys, key, array) {
  var name, str, desc;
  desc = Object.getOwnPropertyDescriptor(value, key) || { value: value[key] };
  if (desc.get) {
    if (desc.set) {
      str = ctx.stylize('[Getter/Setter]', 'special');
    } else {
      str = ctx.stylize('[Getter]', 'special');
    }
  } else {
    if (desc.set) {
      str = ctx.stylize('[Setter]', 'special');
    }
  }
  if (!hasOwnProperty(visibleKeys, key)) {
    name = '[' + key + ']';
  }
  if (!str) {
    if (ctx.seen.indexOf(desc.value) < 0) {
      if (isNull(recurseTimes)) {
        str = formatValue(ctx, desc.value, null);
      } else {
        str = formatValue(ctx, desc.value, recurseTimes - 1);
      }
      if (str.indexOf('\n') > -1) {
        if (array) {
          str = str.split('\n').map(function(line) {
            return '  ' + line;
          }).join('\n').substr(2);
        } else {
          str = '\n' + str.split('\n').map(function(line) {
            return '   ' + line;
          }).join('\n');
        }
      }
    } else {
      str = ctx.stylize('[Circular]', 'special');
    }
  }
  if (isUndefined(name)) {
    if (array && key.match(/^\d+$/)) {
      return str;
    }
    name = JSON.stringify('' + key);
    if (name.match(/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/)) {
      name = name.substr(1, name.length - 2);
      name = ctx.stylize(name, 'name');
    } else {
      name = name.replace(/'/g, "\\'")
                 .replace(/\\"/g, '"')
                 .replace(/(^"|"$)/g, "'");
      name = ctx.stylize(name, 'string');
    }
  }

  return name + ': ' + str;
}


function reduceToSingleString(output, base, braces) {
  var numLinesEst = 0;
  var length = output.reduce(function(prev, cur) {
    numLinesEst++;
    if (cur.indexOf('\n') >= 0) numLinesEst++;
    return prev + cur.replace(/\u001b\[\d\d?m/g, '').length + 1;
  }, 0);

  if (length > 60) {
    return braces[0] +
           (base === '' ? '' : base + '\n ') +
           ' ' +
           output.join(',\n  ') +
           ' ' +
           braces[1];
  }

  return braces[0] + base + ' ' + output.join(', ') + ' ' + braces[1];
}


// NOTE: These type checking functions intentionally don't use `instanceof`
// because it is fragile and can be easily faked with `Object.create()`.
function isArray(ar) {
  return Array.isArray(ar);
}
exports.isArray = isArray;

function isBoolean(arg) {
  return typeof arg === 'boolean';
}
exports.isBoolean = isBoolean;

function isNull(arg) {
  return arg === null;
}
exports.isNull = isNull;

function isNullOrUndefined(arg) {
  return arg == null;
}
exports.isNullOrUndefined = isNullOrUndefined;

function isNumber(arg) {
  return typeof arg === 'number';
}
exports.isNumber = isNumber;

function isString(arg) {
  return typeof arg === 'string';
}
exports.isString = isString;

function isSymbol(arg) {
  return typeof arg === 'symbol';
}
exports.isSymbol = isSymbol;

function isUndefined(arg) {
  return arg === void 0;
}
exports.isUndefined = isUndefined;

function isRegExp(re) {
  return isObject(re) && objectToString(re) === '[object RegExp]';
}
exports.isRegExp = isRegExp;

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}
exports.isObject = isObject;

function isDate(d) {
  return isObject(d) && objectToString(d) === '[object Date]';
}
exports.isDate = isDate;

function isError(e) {
  return isObject(e) &&
      (objectToString(e) === '[object Error]' || e instanceof Error);
}
exports.isError = isError;

function isFunction(arg) {
  return typeof arg === 'function';
}
exports.isFunction = isFunction;

function isPrimitive(arg) {
  return arg === null ||
         typeof arg === 'boolean' ||
         typeof arg === 'number' ||
         typeof arg === 'string' ||
         typeof arg === 'symbol' ||  // ES6 symbol
         typeof arg === 'undefined';
}
exports.isPrimitive = isPrimitive;

exports.isBuffer = require('./support/isBuffer');

function objectToString(o) {
  return Object.prototype.toString.call(o);
}


function pad(n) {
  return n < 10 ? '0' + n.toString(10) : n.toString(10);
}


var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
              'Oct', 'Nov', 'Dec'];

// 26 Feb 16:19:34
function timestamp() {
  var d = new Date();
  var time = [pad(d.getHours()),
              pad(d.getMinutes()),
              pad(d.getSeconds())].join(':');
  return [d.getDate(), months[d.getMonth()], time].join(' ');
}


// log is just a thin wrapper to console.log that prepends a timestamp
exports.log = function() {
  console.log('%s - %s', timestamp(), exports.format.apply(exports, arguments));
};


/**
 * Inherit the prototype methods from one constructor into another.
 *
 * The Function.prototype.inherits from lang.js rewritten as a standalone
 * function (not on Function.prototype). NOTE: If this file is to be loaded
 * during bootstrapping this function needs to be rewritten using some native
 * functions as prototype setup using normal JavaScript does not work as
 * expected during bootstrapping (see mirror.js in r114903).
 *
 * @param {function} ctor Constructor function which needs to inherit the
 *     prototype.
 * @param {function} superCtor Constructor function to inherit prototype from.
 */
exports.inherits = require('inherits');

exports._extend = function(origin, add) {
  // Don't do anything if add isn't an object
  if (!add || !isObject(add)) return origin;

  var keys = Object.keys(add);
  var i = keys.length;
  while (i--) {
    origin[keys[i]] = add[keys[i]];
  }
  return origin;
};

function hasOwnProperty(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./support/isBuffer":44,"_process":43,"inherits":41}]},{},[32])(32)
});
