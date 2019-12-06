const { Utils, debug, PathInfo, ID, PathReference } = require('acebase-core');
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
     */
    constructor(settings) {
        settings = settings || {};
        this.maxInlineValueSize = typeof settings.maxInlineValueSize === 'number' ? settings.maxInlineValueSize : 50;
        this.removeVoidProperties = settings.removeVoidProperties === true;
        this.cluster = new ClusterSettings(settings.cluster); // When running in a cluster, managing node locking must be done by the cluster master
        /** @type {string} */
        this.path = settings.path || '.';
        if (this.path.endsWith('/')) { this.path = this.path.slice(0, -1); }
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
            '   \\_| |_/\\___\\___\\____/ \\__,_|___/\\___|'.art + '\n'

        debug.log(logo);

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
        const self = this;
        this.indexes = {
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
                    debug.log(`Index on "/${path}/*/${key}" already exists`.inverse);
                    return Promise.resolve(existingIndex);
                }
                const index = existingIndex || (() => {
                    switch (indexType) {
                        case 'array': return new ArrayIndex(self, path, key, { include: options.include, config: options.config });
                        case 'fulltext': return new FullTextIndex(self, path, key, { include: options.include, config: options.config });
                        case 'geo': return new GeoIndex(self, path, key, { include: options.include, config: options.config });
                        default: return new DataIndex(self, path, key, { include: options.include, config: options.config });
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
                    debug.error(`Index build on "/${path}/*/${key}" failed: ${err.message} (code: ${err.code})`.red);
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
             * Returns all indexes on a target path, optionally includes indexes on child paths
             * @param {string} targetPath 
             * @param {boolean} [childPaths=true] 
             * @returns {DataIndex[]}
             */
            getAll(targetPath, childPaths = true) {
                const pathKeys = PathInfo.getPathKeys(targetPath);
                return _indexes.filter(index => {
                    // index can have wildcards
                    const indexKeys = PathInfo.getPathKeys(index.path + '/*');
                    if (!childPaths && indexKeys.length !== pathKeys.length) { return false; }
                    return pathKeys.every((key, i) => {
                        return key === indexKeys[i] || indexKeys[i] === '*';
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
                return pfs.readdir(`${self.settings.path}/${self.name}.acebase`)
                .then(files => {
                    const promises = [];
                    files.forEach(fileName => {
                        if (fileName.endsWith('.idx')) {
                            const p = DataIndex.readFromFile(self, fileName)
                            .then(index => {
                                _indexes.push(index);
                            })
                            .catch(err => {
                                console.error(err);
                            });
                            promises.push(p);
                        }
                    });
                    return Promise.all(promises);
                })
                .catch(err => {
                    console.error(err);
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
                //     debug.warn(`Identical subscription of type ${type} on path "${path}" being added`);
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
                        type ? ps.type === type : true 
                        && callback ? ps.callback === callback : true
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
                            if (dataPath !== null && subscribers.findIndex(s => s.type === sub.type && s.path === eventPath) < 0) {
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
                    if (event.startsWith('notify_')) {
                        // Notify only event, run callback without data
                        sub.callback(null, dataPath);
                    }
                    else {
                        // Run callback with data
                        sub.callback(null, dataPath, newValue, oldValue);
                    }
                });
            }
        };
       
    } // end of constructor

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
        // TODO: create and move to Storage base class, for shared use in SqlStorage, FileStorage etc
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
        }

        return this.getNodeInfo(topEventPath, { tid })
        .then(eventNodeInfo => {
            if (!eventNodeInfo.exists) {
                // Node doesn't exist
                return null;
            }
            let valueOptions = { tid };
            if (!hasValueSubscribers && options.merge === true) {
                // Only load current value for properties being updated.
                valueOptions.include = Object.keys(value);
                // Make sure the keys for any indexes on this path are also loaded
                this.indexes.getAll(path, false).forEach(index => {
                    const keys = [index.key].concat(index.includeKeys);
                    keys.forEach(key => valueOptions.include.indexOf(key) < 0 && valueOptions.include.push(key));
                });
            }
            return this.getNodeValue(topEventPath, valueOptions);
        })
        .then(currentValue => {
            topEventData = currentValue;

            // Now proceed with node updating
            if (typeof options._customWriteFunction === 'function') {
                return options._customWriteFunction();
            }
            return this._writeNode(path, value, options);
        })
        .then(result => {

            // Check if there are any event subscribers
            const indexes = this.indexes.getAll(path);
            if (eventSubscriptions.length === 0 && indexes.length === 0) {
                // Nobody's interested in changed values. We're done!
                return result;
            }

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
            const updatedData = (() => {
                let topPathKeys = PathInfo.getPathKeys(topEventPath);
                let trailKeys = PathInfo.getPathKeys(path).slice(topPathKeys.length);
                let oldValue = topEventData;
                let newValue = newTopEventData;
                while (trailKeys.length > 0) {
                    let subKey = trailKeys.shift();
                    let childValues = getChildValues(subKey, oldValue, newValue);
                    oldValue = childValues.oldValue;
                    newValue = childValues.newValue;
                }
                return { oldValue, newValue };
            })();

            // Trigger all index updates
            const indexUpdates = [];
            indexes.map(index => {
                const keys = PathInfo.getPathKeys(index.path);
                return {
                    index,
                    keys
                };
            })
            .sort((a, b) => {
                // Deepest paths should fire first, then bubble up the tree
                if (a.keys.length < b.keys.length) { return 1; }
                else if (a.keys.length > b.keys.length) { return -1; }
                return 0;
            })
            .forEach(({ index }) => {
                // Index is either on the updated data path, or on a child path

                // Example situation:
                // path = "users/ewout/posts/1" (a post was added)
                // topEventPath = "users/ewout" (a "child_changed" event was on "users")
                // index.path is "users/*/posts"
                // index must be called with data of "users/ewout/posts/1" 

                let pathKeys = PathInfo.getPathKeys(path); 
                let indexPathKeys = PathInfo.getPathKeys(index.path + '/*');
                let trailKeys = indexPathKeys.slice(pathKeys.length);
                let { oldValue, newValue } = updatedData;
                if (trailKeys.length === 0) {
                    // Index is on updated path
                    const p = index.handleRecordUpdate(path, oldValue, newValue);
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
                let results = getAllIndexUpdates(path, oldValue, newValue);
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
     * @returns {Promise<{ revision: string, value: any}>}
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
                    debug.error(`Error in transaction callback: ${err.message}`);
                }
                if (newValue instanceof Promise) {
                    return newValue.catch(err => {
                        debug.error(`Error in transaction callback: ${err.message}`);
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
            return this.getChildren(path, { tid })
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
                debug.error(`Error matching on "${path}": `, err);
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
                if (f.op === "!exists" || (f.op === "==" && (f.compare === null || f.compare === undefined))) { 
                    proceed = !child.exists;
                }
                else if (f.op === "exists" || (f.op === "!=" && (f.compare === null || f.compare === undefined))) {
                    proceed = child.exists;
                }
                else if (!child.exists) {
                    proceed = false;
                }
                else {
                    const isMatch = (val) => {
                        if (f.op === "<") { return val < f.compare; }
                        if (f.op === "<=") { return val <= f.compare; }
                        if (f.op === "==") { return val === f.compare; }
                        if (f.op === "!=") { return val !== f.compare; }
                        if (f.op === ">") { return val > f.compare; }
                        if (f.op === ">=") { return val >= f.compare; }
                        if (f.op === "in") { return f.compare.indexOf(val) >= 0; }
                        if (f.op === "!in") { return f.compare.indexOf(val) < 0; }
                        if (f.op === "matches") {
                            return f.compare.test(val.toString());
                        }
                        if (f.op === "!matches") {
                            return !f.compare.test(val.toString());
                        }
                        if (f.op === "between") {
                            return val >= f.compare[0] && val <= f.compare[1];
                        }
                        if (f.op === "!between") {
                            return val < f.compare[0] || val > f.compare[1];
                        }
                        // DISABLED 2019/10/23 because "custom" only works locally and is not fully implemented
                        // if (f.op === "custom") {
                        //     return f.compare(val);
                        // }
                        return false;
                    };
                    
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
                                return { key: child.key, isMatch: isMatch(val) };
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
                        const ret = isMatch(child.value);
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

}

module.exports = {
    Storage,
    StorageSettings,
    NodeNotFoundError,
    NodeRevisionError
};