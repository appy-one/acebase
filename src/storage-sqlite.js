const { ID, PathReference, PathInfo, ascii85, ColorStyle } = require('acebase-core');
const { Storage, StorageSettings } = require('./storage');
const { NodeInfo } = require('./node-info');
const { VALUE_TYPES } = require('./node-value-types');
const { NodeNotFoundError, NodeRevisionError } = require('./node-errors');
const { pfs } = require('./promise-fs');
const { ThreadSafe } = require('./thread-safe');

let sqlite; // sqlite dependency is lazy loaded in SQLiteStorage constructor

class SQLiteNodeAddress {
    constructor(containerPath) {
        this.path = containerPath;
    }
}

class SQLiteNodeInfo extends NodeInfo {
    constructor(info) {
        super(info);

        /** @type {SQLiteNodeAddress} */
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

class SQLiteStorageSettings extends StorageSettings {

    constructor(options) {
        super(options);
        options = options || {};
    }
}

class SQLiteStorage extends Storage {

    /**
     * 
     * @param {string} name database name
     * @param {SQLiteStorageSettings} [settings]
     */
    constructor(name, settings = { path: '.' }) {

        settings = new SQLiteStorageSettings(settings);
        super(name, settings);

        // Lazy load sqlite3 so it is required once SQLiteStorage is actually requested
        sqlite = sqlite || (function() {
            try {
                return require('sqlite3').verbose();
            }
            catch (err) {
                throw new Error(`sqlite3 not found. To use SQLite as storage, add sqlite3 to your project dependencies: npm i sqlite3`);
            }
        })();        

        const path = `${this.settings.path}/${this.name}.acebase`;
        pfs.exists(path)
        .then(exists => {
            const proceed = () => {
                this._db = new sqlite.Database(`${path}/data.sqlite`, sqlite.OPEN_CREATE | sqlite.OPEN_READWRITE);
                this.rootRecord = null; //new NodeInfo({ path: '', exists: false, address: null });
    
                this._init() // Initialize
                .then(() => {
                    this.emit('ready'); // this._setReady(true);
                })
                .catch(err => {
                    this.emit('error', err); // this._setReady(false, err);
                });
            }

            if (!exists) {
                return pfs.mkdir(path)
                .then(proceed)
                .catch(err => {
                    console.error(`Cannot create dir "${path}": ${err}`);
                    throw err;
                });
            }
            else {
                return proceed();
            }
        })
    }

    /**
     * 
     * @param {string} sql 
     * @returns {Promise<Array<object>>}
     */
    _get(sql, params) {
        const stack = new Error('').stack;
        return new Promise((resolve, reject) => {
            this._db.all(sql, params || {}, (err, rows) => {
                if (err) { err.stack = stack; err.statement = sql; err.params = params; return reject(err); }
                resolve(rows);
            });
        });
    }

    _getOne(sql, params) {
        const stack = new Error('').stack;
        return new Promise((resolve, reject) => {
            this._db.get(sql, params || {}, (err, row) => {
                if (err) { err.stack = stack; err.statement = sql; err.params = params; return reject(err); }
                resolve(row);
            });
        });
    }

    _exec(sql, params) {
        const stack = new Error('').stack;
        return new Promise((resolve, reject) => {
            this._db.run(sql, params || {}, err => {
                if (err) { err.stack = stack; err.statement = sql; err.params = params; return reject(err); }
                resolve(this);
            });
        });
    }

    /**
     * 
     * @param {string} sql 
     * @param {object} params
     * @param {(row: object) => boolean} callback function to call for every row until it returns false
     * @returns {Promise<{ rows: number, canceled: boolean }>} Resolves once all rows have been processed, or callback returned false
     */
    _each(sql, params = {}, callback) {
        return new Promise((resolve, reject) => {
            const take = 100;
            let skip = 0;
            let totalRows = 0;
            const nextBatch = () => {
                const batchSql = `${sql} LIMIT ${take} OFFSET ${skip}`;
                this._get(batchSql, params)
                .then(rows => {
                    let cancel = false;
                    let i = 0;
                    while (i < rows.length && !cancel) {
                        const proceed = callback(rows[i]);
                        cancel = proceed === false;
                        i++;
                    }
                    if (cancel || rows.length < take) {
                        // Done
                        resolve(totalRows + i);
                    }
                    else {
                        totalRows += rows.length;
                        skip += take;
                        nextBatch();
                    }
                })
            };
            nextBatch();
        });
    }

    _createTransaction() {
        const queue = [];
        const run = () => {

            // Use dedicated connection for transactions, so other statements being executed won't end up in our transaction
            if (!this._transactionConnection) {
                this._transactionConnection = new sqlite.Database(`${this.settings.path}/${this.name}.acebase/data.sqlite`, sqlite.OPEN_READWRITE);
            }

            // Create and run batch
            const results = [];
            return ThreadSafe.lock('sqlite_transaction', { critical: false, timeout: 30000 }) // only let 1 transaction be performed at a time, to prevent SQLITE_BUSY errors
            .catch(err => {
                throw new Error(`could not get lock to perform transaction on sqlite database: ${err.message}`);
            })
            .then(lock => {
                const db = this._transactionConnection;

                const exec = (sql, params) => {
                    return new Promise((resolve, reject) => {
                        const callback = function(err) {
                            if (err) { return reject(err); }
                            resolve(this);
                        };
                        const args = [sql, callback];
                        params && args.splice(1, 0, params);
                        db.run(...args);
                    });
                }

                let promise = exec('BEGIN IMMEDIATE');
                queue.forEach(statement => promise = promise.then(() => {
                    return exec(statement.sql, statement.params)
                    .then(result => {
                        results.push(result);
                    });
                }));
                return promise.then(() => {
                    return exec('COMMIT');
                })
                .catch(err => {
                    return results.length > 0 ? exec('ROLLBACK') : Promise.resolve() // Only issue rollback if 1 or more statements succeeded
                    .then(() => {
                        lock.release();
                        if (err.contains('SQLITE_BUSY')) {
                            // Other process is currently writing, retry
                            return run();
                        }
                        else {
                            const ourErr = new Error(`${err} in statement #${results.length} (${queue[results.length].sql})`);
                            return Promise.reject(ourErr);
                        }
                    })
                })
                .then(() => {
                    // Return all results
                    lock.release();
                    return results;
                });
            });
        };
        return {
            add(sql, params) {
                queue.push({ sql, params });
            },
            run
        }
    }

    _init() {
        // create tables that don't exist yet
        const tables = {
            settings: {
                create: 'CREATE TABLE settings (name TEXT PRIMARY KEY, value TEXT) WITHOUT ROWID',
                rows: [{ name: 'db_schema_version', value: '1' }]
            },
            nodes: {
                create: `CREATE TABLE nodes (
                    path TEXT PRIMARY KEY,
                    type INTEGER NOT NULL,  -- node type (1=object, 2=array, 5=string, 8=binary, 9=reference)
                    text_value TEXT,        -- when type is string or reference (> max inline value length?)
                    binary_value BLOB,      -- when type is binary
                    json_value TEXT,        -- when type is object, only simple/small value children are here (no objects, arrays, large strings)
                    
                    created INTEGER NOT NULL,       -- creation timestamp
                    modified INTEGER NOT NULL,      -- modification timestamp
                    revision_nr INTEGER NOT NULL,   -- nr of times the node's value was updated
                    revision TEXT NOT NULL          -- revision id that is shared with all nested nodes that were updated at the same time, should be time sortable so could be considered as a "transaction timestamp"
                ) WITHOUT ROWID`,
                rows: [{ 
                    path: '',
                    type: VALUE_TYPES.OBJECT,
                    json_value: '{}',
                    created: Date.now(),
                    modified: Date.now(),
                    revision_nr: 0,
                    revision: ID.generate()
                }]
            },
            // history: {
            //     create: `CREATE TABLE history (
            //         path TEXT NOT NULL,
            //         action TEXT NOT NULL,   -- insert, set, update, delete
            //         time INTEGER NOT NULL,
            //         revision_nr INTEGER NOT NULL, -- affected revision
            //         revision TEXT NOT NULL
            //     )`
            // },
            // indexes: {
            //     create: `CREATE TABLE indexes ( -- TODO
            //         name TEXT NOT NULL PRIMARY KEY,
            //         path TEXT NOT NULL,
            //         type TEXT NOT NULL,
            //         key TEXT NOT NULL,
            //         included_keys TEXT,
            //         table_name TEXT NOT NULL,
            //         created INTEGER NOT NULL,
            //         updated INTEGER NOT NULL,
            //         stats_entries INTEGER NOT NULL,
            //         stats_values INTEGER NOT NULL
            //     ) WITHOUT ROWID`,
            //     action() {
            //         // load created indexes
            //     }
            // },
            logs: {
                create: `CREATE TABLE logs (
                    action TEXT NOT NULL, 
                    success TINYINT NOT NULL, 
                    error TEXT, date INTEGER, 
                    details TEXT
                )`,
                rows: [{ action: 'db_created', success: 1, date: Date.now() }]
            }
        }

        return this._get(`SELECT name FROM sqlite_master WHERE type='table'`)
        .then(rows => {
            rows.forEach(row => {
                delete tables[row.name];
            });

            // Create tables that didn't exist
            const promises = Object.keys(tables).map(name => {
                // Create table
                let sql = tables[name].create;
                return this._exec(sql)
                .catch(err => {
                    throw err;
                })
                .then(result => {
                    // Insert initialization data
                    if (tables[name].rows) {
                        let rows = tables[name].rows;
                        const promises = rows.map(row => {
                            let keys = Object.keys(row);
                            // let values = keys.map(key => row[key]).map(val => typeof val === 'number' ? val : `'${val.toString()}'`);
                            // let sql = `INSERT INTO ${name} (${keys.join(',')}) VALUES (${values.join(',')})`;
                            const sql = `INSERT INTO ${name} (${keys.join(',')}) VALUES (${keys.map(key => '$' + key).join(',')})`;
                            const params = keys.reduce((obj, key) => { obj['$' + key] = row[key]; return obj; }, {});
                            return this._exec(sql, params);
                        });
                        return Promise.all(promises);
                    }
                })
                .then(result => {
                    // Run action callback
                    return tables[name].action && tables[name].action();
                });
            });
            return Promise.all(promises);
        })
        .then(() => {
            // Get root record info
            return this.getNodeInfo('')
            .then(info => {
                this.rootRecord = info;
            });
        })
        .then(() => {
            this.debug.log(`Database "${this.name}" details:`.colorize(ColorStyle.dim));
            this.debug.log(`- Type: SQLite`.colorize(ColorStyle.dim));
            this.debug.log(`- Max inline value size: ${this.settings.maxInlineValueSize}`.colorize(ColorStyle.dim));

            // Load indexes
            return this.indexes.load();
        });
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

    _createJSON(obj) {
        Object.keys(obj).forEach(key => {
            let child = obj[key];
            if (child instanceof Date) {
                child = { type: VALUE_TYPES.DATETIME, value: child.getTime() };
            }
            else if (child instanceof PathReference) {
                child = { type: VALUE_TYPES.REFERENCE, value: child.path };
            }
            else if (child instanceof ArrayBuffer) {
                child = { type: VALUE_TYPES.BINARY, value: ascii85.encode(child) };
            }            
            else if (typeof child === 'object') {
                child = this._createJSON(child);
            }
            obj[key] = child;
        });
        return JSON.stringify(obj);
    }

    _deserializeJSON(type, json) {
        let value = JSON.parse(json);

        // Check if there any typed values stored in object's children that need deserializing
        Object.keys(value).forEach(key => {
            let val = value[key];
            if (typeof val === 'object' && 'type' in val) {
                // Typed value stored in parent record
                if (val.type === VALUE_TYPES.BINARY) {
                    // binary stored in a parent record as a string
                    value[key] = ascii85.decode(val.value);
                }
                else if (val.type === VALUE_TYPES.DATETIME) {
                    // Date value stored as number
                    value[key] = new Date(val.value);
                }
                else if (val.type === VALUE_TYPES.REFERENCE) {
                    // Path reference stored as string
                    value[key] = new PathReference(val.value);
                }
                else {
                    throw new Error(`Unhandled child value type ${val.type}`);
                }
            }
        });

        if (type === VALUE_TYPES.ARRAY) {
            // Convert object { 0: (...), 1: (...) } to array 
            let arr = [];
            Object.keys(value).forEach(index => {
                arr[index] = value[index];
            })
            value = arr;
        }            

        return value;
    }

    /**
     * Creates or updates a node in its own record. DOES NOT CHECK if path exists in parent node, or if parent paths exist! Calling code needs to do this
     * @param {string} path 
     * @param {any} value 
     * @param {object} [options] 
     * @returns {Promise<void>}
     */
    _writeNode(path, value, options = { merge: false, revision: null, transaction: null }) {
        if (this.valueFitsInline(value)) {
            throw new Error(`invalid value to store in its own node`);
        }

        // Setup transaction
        const transaction = options.transaction || this._createTransaction();

        // Get info about current node at path
        return this._getOne(`SELECT path, type, text_value, binary_value, json_value, revision, revision_nr FROM nodes WHERE path = $path`, { $path: path }) //  OR path LIKE '${path}/*' OR path LIKE '${path}[%'
        .then(currentRow => {
            const newRevision = (options && options.revision) || ID.generate();

            let mainNode = {
                type: VALUE_TYPES.OBJECT,
                value: {},
                storageType: 'json'
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
                mainNode.storageType = 'text';
            }
            else if (value instanceof ArrayBuffer) {
                mainNode.type = VALUE_TYPES.BINARY;
                mainNode.value = Buffer.from(value);
                mainNode.storageType = 'binary';
            }
            else if (typeof value === 'string') {
                mainNode.type = VALUE_TYPES.STRING;
                mainNode.value = value;
                mainNode.storageType = 'text';
            }

            const currentIsObjectOrArray = currentRow ? [VALUE_TYPES.OBJECT, VALUE_TYPES.ARRAY].includes(currentRow.type) : false;
            const newIsObjectOrArray = [VALUE_TYPES.OBJECT, VALUE_TYPES.ARRAY].includes(mainNode.type);
            const children = {
                current: [],
                new: []
            }
            let currentObject = null;
            if (currentIsObjectOrArray) {
                currentObject = this._deserializeJSON(currentRow.type, currentRow.json_value);
                children.current = Object.keys(currentObject);
                if (newIsObjectOrArray) {
                    mainNode.value = currentObject;
                }
            }
            if (newIsObjectOrArray) {
                // Object or array. Determine which properties can be stored in the main node, 
                // and which should be stored in their own nodes
                // children.new = options.merge ? children.current : [];
                Object.keys(value).forEach(key => {
                    const val = value[key];
                    delete mainNode.value[key]; // key is being overwritten, moved from inline to dedicated, or deleted.
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
                this.debug.log(`Node "/${path}" is being ${options.merge ? 'updated' : 'overwritten'}`.colorize(ColorStyle.cyan));

                const updateMainNode = () => {
                    const sql = `UPDATE nodes SET type = $type, text_value = $text_value, binary_value = $binary_value, json_value = $json_value, modified = $modified, revision_nr = revision_nr + 1, revision = $revision
                        WHERE path = $path`;
                    const params = { 
                        $path: path, 
                        $type: mainNode.type, 
                        $text_value: mainNode.storageType === 'text' ? mainNode.value : null,
                        $binary_value: mainNode.storageType === 'binary' ? mainNode.value : null,
                        $json_value: mainNode.storageType === 'json' ? this._createJSON(mainNode.value) : null,
                        $modified: Date.now(),
                        // $revision_nr: existingDetails.revision_nr + 1,
                        $revision: newRevision
                    };
                    // if (transaction) { 
                    transaction.add(sql, params); 
                    // }
                    // else {
                    //     return this._exec(sql, params);
                    // }
                };

                // If existing is an array or object, we have to find out which children are affected
                if (currentIsObjectOrArray || newIsObjectOrArray) {

                    // Track changes in properties:
                    // const oldObject = currentIsObjectOrArray 
                    //     ? this._deserializeJSON(currentRow.type, currentRow.json_value)
                    //     : null;
                    // const children = {
                    //     old: currentIsObjectOrArray
                    //         ? Object.keys(oldObject)
                    //         : [],
                    //     new: newIsObjectOrArray 
                    //         ? Object.keys(value).filter(key => value[key] !== null && typeof value[key] !== 'undefined')
                    //         : []
                    // };

                    // Get current child nodes in dedicated child records
                    let childrenPromise = Promise.resolve([]);
                    if (currentIsObjectOrArray) {
                        const where = path === '' 
                            ? `path <> '' AND path NOT LIKE '%/%'` 
                            : `(path LIKE '${path}/%' OR path LIKE '${path}[%') AND path NOT LIKE '${path}/%/%' AND path NOT LIKE '${path}[%]/%' AND path NOT LIKE '${path}[%][%'`
                        // TODO: add parent_path to nodes table to make query easier and faster?
                        childrenPromise = this._get(`SELECT path FROM nodes WHERE ${where}`);
                    }
                    return childrenPromise
                    .then(childRows => {
                        const keys = childRows.map(row => PathInfo.get(row.path).key);
                        // = childRows.map(row => PathInfo.get(row.path))
                        //     .filter(info => info.parentPath === path)
                        //     .map(info => info.key);
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

                        // TODO: convert changes to details about changed values for change tracking
                        const changes = {
                            insert: children.new.filter(key => !children.current.includes(key)),
                            update: children.new.filter(key => children.current.includes(key)),
                            delete: options && options.merge ? Object.keys(value).filter(key => value[key] === null) : children.current.filter(key => !children.new.includes(key)),
                        };

                        // (over)write all child nodes that must be stored in their own record
                        const childUpdatePromises = Object.keys(childNodeValues).map(key => {
                            const childPath = PathInfo.getChildPath(path, key);
                            const childValue = childNodeValues[key];
                            return this._writeNode(childPath, childValue, { revision: newRevision, merge: false, transaction }); // return this._writeNode(childPath, childValue, { revision: newRevision, merge: false, transaction });
                        });

                        // Delete all child nodes that were stored in their own record, but are being removed 
                        // Also delete nodes that are being moved from a dedicated record to inline
                        const movingNodes = keys.filter(key => key in mainNode.value); // moving from dedicated to inline value
                        const deleteDedicatedKeys = changes.delete.concat(movingNodes);
                        // const deletePromises = deleteDedicatedKeys.map(key => {
                        deleteDedicatedKeys.forEach(key => {
                            const childPath = PathInfo.getChildPath(path, key);
                            this._deleteNode(childPath, { transaction }); // return this._deleteNode(childPath, { transaction });
                        });

                        // const promises = updatePromises.concat(deletePromises);
                        // promises.push(updateMainNode(transaction));
                        updateMainNode();

                        // return Promise.all(promises)
                        // .then(() => {                            
                        //     return changes;
                        // })
                        return Promise.all(childUpdatePromises);
                    });
                }
                else {
                    // The current and/or new node is not an object/array
                    updateMainNode();
                }
            }
            else {
                // Current node does not exist, create it and any child nodes
                // write all child nodes that must be stored in their own record
                this.debug.log(`Node "/${path}" is being created`.colorize(ColorStyle.cyan));

                const childCreatePromises = Object.keys(childNodeValues).map(key => {
                    const childPath = PathInfo.getChildPath(path, key);
                    const childValue = childNodeValues[key];
                    return this._writeNode(childPath, childValue, { revision: newRevision, merge: false, transaction }); // return this._writeNode(childPath, childValue, { revision: newRevision, merge: false });
                });
                return Promise.all(childCreatePromises)
                .then(() => {
                    // Create current node
                    const sql = `INSERT INTO nodes (path, type, text_value, binary_value, json_value, created, modified, revision_nr, revision)
                        VALUES ($path, $type, $text_value, $binary_value, $json_value, $created, $modified, $revision_nr, $revision)`;
                    const params = { 
                        $path: path, 
                        $type: mainNode.type, 
                        $text_value: mainNode.storageType === 'text' ? mainNode.value : null,
                        $binary_value: mainNode.storageType === 'binary' ? mainNode.value : null,
                        $json_value: mainNode.storageType === 'json' ? this._createJSON(mainNode.value) : null,
                        $created: Date.now(),
                        $modified: Date.now(),
                        $revision_nr: 0,
                        $revision: newRevision
                    };
                        
                    transaction.add(sql, params); // return this._exec(sql, params);
                    // return transaction.run()
                    // .then(results => {
                    //     console.log(`Transaction successful!`, results);
                    // })
                    // .catch(err => {
                    //     console.error(err);
                    //     throw err;
                    // })
                });
            }
        })
        .then(() => {
            if (!options.transaction) {
                // Our transaction, we can run it now!
                return transaction.run()
                // .then(results => {
                //     console.log(`Transaction successful!`, results);
                // })
                .catch(err => {
                    console.error(err);
                    throw err;
                });
            }
        });
    }

    /**
     * Deletes (dedicated) node and all subnodes without checking for existence. Use with care - all removed nodes will lose their revision stats! DOES NOT REMOVE INLINE CHILD NODES!
     * @param {string} path 
     */
    _deleteNode(path, options = { transaction: null }) {
        const where = path === '' ? '' : `WHERE path = '${path}' OR path LIKE '${path}/%' OR path LIKE '${path}[%'`;
        const sql = `DELETE FROM nodes ${where}`;
        if (options && options.transaction) {
            options.transaction.add(sql);
        }
        else {
            return this._exec(sql);
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
                // const promise = new Promise((rs, rj) => { resolve = rs; reject = rj; });
                // return promise;
            }
        };
        const start = () => {
            let lock, canceled = false;
            const tid = (options && options.tid) || ID.generate();
            return this.nodeLocker.lock(path, tid, false, 'getChildren')
            .then(l => {
                lock = l;
                return this._getOne(`SELECT type, json_value, revision, revision_nr, created, modified FROM nodes WHERE path = $path`, { $path: path });
            })
            .then(row => {
                if (!row) { throw new NodeNotFoundError(`Node "/${path}" does not exist`); }
                if (![VALUE_TYPES.OBJECT, VALUE_TYPES.ARRAY].includes(row.type)) {
                    // No children
                    return false; //resolve(false);
                }
                const isArray = row.type === VALUE_TYPES.ARRAY;
                const value = JSON.parse(row.json_value);
                let keys = Object.keys(value);
                if (options.keyFilter) {
                    keys = keys.filter(key => options.keyFilter.includes(key));
                }
                const pathInfo = PathInfo.get(path);
                keys.length > 0 && keys.every(key => {
                    let child = this._getTypeFromStoredValue(value[key]);

                    const info = new SQLiteNodeInfo({
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
                    return; //resolve(true);
                }
                // Go on... query other children
                const where = path === '' 
                    ? `path <> '' AND instr(path,'/')=0 AND instr(path,'[')=0` //  AND path NOT LIKE '%/%' AND path NOT LIKE '%[%'
                    : `path LIKE '${path}${isArray ? '[' : '/'}%' AND path NOT LIKE '${path}${isArray ? '[' : '/'}%/%' AND path NOT LIKE '${path}${isArray ? '[' : '/'}%[%'`
                const q = `SELECT path, type, revision, revision_nr, created, modified FROM nodes WHERE ${where}`;
                return this._each(q, null, row => {
                    const key = PathInfo.get(row.path).key;
                    if (options.keyFilter && !options.keyFilter.includes(key)) { return; }

                    const info = new SQLiteNodeInfo({
                        path: row.path,
                        type: row.type,
                        key: isArray ? null : key,
                        index: isArray ? key : null,
                        address: new SQLiteNodeAddress(row.path), //new SqlNodeAddress(row.path),
                        exists: true,
                        value: null, // not loaded
                        revision: row.revision,
                        revision_nr: row.revision_nr,
                        created: row.created,
                        modified: row.modified
                    });

                    canceled = callback(info) === false;
                    return !canceled; // stop ._each loop if canceled
                });
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
        return this.nodeLocker.lock(path, tid, false, 'getNode')
        .then(lock => {
            // Get path, path/* and path[*
            let where = '';
            if (path === '') {
                if (options && options.child_objects === false) {
                    where = `WHERE path='' OR type NOT IN (${VALUE_TYPES.OBJECT},${VALUE_TYPES.ARRAY})`;
                }
            }
            else if (options && options.child_objects === false) {
                where = `WHERE path='${path}' OR ((path LIKE '${path}/%' OR path LIKE '${path}[%') AND type NOT IN (${VALUE_TYPES.OBJECT},${VALUE_TYPES.ARRAY}))`;
            }
            else {
                where = `WHERE path = '${path}' OR path LIKE '${path}/%' OR path LIKE '${path}[%'`;
            }
            let getPromise;
            let filtered = false;
            if (options && (options.include || options.exclude || options.child_objects === false)) {
                // A data filter is requested.
                // Building a where statement for this is impossible because we'd need regular expressions to filter paths (because LIKE 'users/%/posts' will also falsely match 'users/ewout/archive/posts')
                // Get all paths unfiltered, then filter them manually
                filtered = true;
                getPromise = this._get(`SELECT path, type FROM nodes ${where}`)
                .then(rows => {
                    const paths = [path];
                    const includeCheck = options.include 
                        ? new RegExp('^' + options.include.map(p => '(?:' + p.replace(/\*/g, '[^/\\[]+') + ')').join('|') + '(?:$|[/\\[])')
                        : null;
                    const excludeCheck = options.exclude 
                        ? new RegExp('^' + options.exclude.map(p => '(?:' + p.replace(/\*/g, '[^/\\[]+') + ')').join('|') + '(?:$|[/\\[])')
                        : null;

                    for (let i = 0; i < rows.length; i++) {
                        const row = rows[i];
                        if (row.path === path) {
                            continue; // No need to check the main path...
                        }
                        let checkPath = row.path.slice(path.length);
                        if (checkPath[0] === '/') { checkPath = checkPath.slice(1); }
                        const match = (includeCheck ? includeCheck.test(checkPath) : true) 
                            && (excludeCheck ? !excludeCheck.test(checkPath) : true)
                            && (options.child_objects === false ? row.type !== VALUE_TYPES.OBJECT && !/[/[]/.test(checkPath) : true);
                        if (match) {
                            paths.push(row.path);
                        }
                    }

                    // Now query with all paths that met the requirement
                    return this._get(`SELECT path, type, text_value, binary_value, json_value, revision FROM nodes WHERE path IN (${paths.map(p => `'${p}'`).join(',')})`);
                })
            }
            else {
                // No filtering
                getPromise = this._get(`SELECT path, type, text_value, binary_value, json_value, revision FROM nodes ${where}`);
            }
            return getPromise
            .then(rows => {                
                if (rows.length === 0) { 
                    // Lookup parent node
                    return lock.moveToParent()
                    .then(parentLock => {
                        lock = parentLock;

                        if (path === '') { return null; } // path is root. There is no parent.
                        const pathInfo = PathInfo.get(path);
                        return this._getOne(`SELECT type, json_value, revision FROM nodes WHERE path = '${pathInfo.parentPath}'`)
                        .then(parentRow => {
                            const result = {
                                revision: parentRow ? parentRow.revision : null,
                                value: null
                            };
                            if (!parentRow) { return result; } // parent node doesn't exist
                            if (![VALUE_TYPES.OBJECT, VALUE_TYPES.ARRAY].includes(parentRow.type)) { return result; } // parent node is not an object

                            // WARNING: parentRow.json_value might be big!!
                            // TODO: create JSON streamer if json_value length becomes larger than 10KB?
                            const val = this._deserializeJSON(parentRow.type, parentRow.json_value);
                            if (!(pathInfo.key in val)) { return result; } // parent does not have a child with requested key
                            result.value = val[pathInfo.key];
                            return result;
                        })
                    });
                }

                this.debug.log(`Read node "/${path}" and ${filtered ? '(filtered) ' : ''}children from ${rows.length} records`.colorize(ColorStyle.magenta));

                const targetPathKeys = PathInfo.getPathKeys(path);
                const targetRow = rows.find(row => row.path === path);
                const result = {
                    revision: targetRow ? targetRow.revision : null,
                    value: null
                };
                if (targetRow.type === VALUE_TYPES.OBJECT || targetRow.type === VALUE_TYPES.ARRAY) {
                    // target node is an object or array
                    let value = this._deserializeJSON(targetRow.type, targetRow.json_value);

                    // merge with other found (child) records
                    for (let i = 0; i < rows.length; i++) {
                        const otherRow = rows[i];
                        if (otherRow === targetRow) { continue; }
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
                            else if (nodeType === VALUE_TYPES.OBJECT || nodeType === VALUE_TYPES.ARRAY) {
                                nodeValue = this._deserializeJSON(otherRow.type, otherRow.json_value);
                            }
                            else if (nodeType === VALUE_TYPES.REFERENCE) {
                                nodeValue = new PathReference(otherRow.text_value);
                            }
                            else if (nodeType === VALUE_TYPES.BINARY) {
                                nodeValue = otherRow.binary_value;
                            }
                            else {
                                nodeValue = otherRow.text_value;
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

                    result.value = value;
                }
                else if (rows.length > 1) {
                    throw new Error(`more than 1 record found for non-object value!`);
                }
                else if (targetRow.type === VALUE_TYPES.REFERENCE) {
                    result.value = new PathReference(targetRow.text_value);
                }
                else if (targetRow.type === VALUE_TYPES.BINARY) {
                    // BLOBs are returned as Uint8Array by SQLite3
                    let val = targetRow.binary_value;
                    result.value = val.buffer.slice(val.byteOffset, val.byteOffset + val.byteLength);
                }
                else {
                    result.value = targetRow.text_value;
                }
                return result;
            })
            .then(result => {

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
        });
    }

    /**
     * 
     * @param {string} path 
     * @param {*} options 
     * @returns {Promise<SQLiteNodeInfo>}
     */
    getNodeInfo(path, options = { tid: undefined }) {
        // path = path.replace(/'/g, '');  // prevent sql injection, remove single quotes

        const lookupNode = path => {
            return this._get(`SELECT type, text_value, binary_value, json_value, created, modified, revision, revision_nr FROM nodes WHERE path='${path}'`)
            .then(rows => {
                if (rows.length === 0) {
                    return null; 
                }
                const row = rows[0];
                let value = null;
                if (row.type === VALUE_TYPES.OBJECT || row.type === VALUE_TYPES.ARRAY) {
                    value = JSON.parse(row.json_value);
                }
                else if (row.type === VALUE_TYPES.BINARY) {
                    // BLOBs are returned as Uint8Array by SQLite3
                    let val = row.binary_value;
                    value = val.buffer.slice(val.byteOffset, val.byteOffset + val.byteLength);
                }
                else {
                    value = row.text_value;
                }
                return {
                    path,
                    type: row.type, 
                    value, 
                    created: row.created, 
                    modified: row.modified, 
                    revision: row.revision, 
                    revision_nr: row.revision_nr 
                };
            });
        }

        const pathInfo = PathInfo.get(path);
        const tid = (options && options.tid) || ID.generate();
        let lock;
        return this.nodeLocker.lock(path, tid, false, 'getNodeInfo')
        .then(l => {
            lock = l;
            return lookupNode(path);
        })
        .then(node => {
            const info = new SQLiteNodeInfo({ 
                path, 
                key: typeof pathInfo.key === 'string' ? pathInfo.key : null,
                index: typeof pathInfo.key === 'number' ? pathInfo.key : null,
                type: node ? node.type : 0, 
                exists: node !== null,
                address: node ? new SQLiteNodeAddress(path) : null,
                created: node ? new Date(node.created) : null,
                modified: node ? new Date(node.modified) : null,
                revision: node ? node.revision : null,
                revision_nr: node ? node.revision_nr : null
            });
            // info.created = node ? new Date(node.created) : null;
            // info.modified = node ? new Date(node.modified) : null;
            // info.revision = node ? node.revision : null;
            // info.revision_nr = node ? node.revision_nr : null;

            if (node || path === '') {
                return info;
            }

            // Try parent node
            return lock.moveToParent()
            .then(parentLock => {
                lock = parentLock;
                return lookupNode(pathInfo.parentPath);
            })
            .then(parent => {
                if (parent && [VALUE_TYPES.OBJECT, VALUE_TYPES.ARRAY].includes(parent.type) && pathInfo.key in parent.value) {
                    // Stored in parent node
                    info.exists = true;
                    info.value = parent.value[pathInfo.key];
                    info.address = null; // pathInfo.parentPath; //new SqlNodeAddress(pathInfo.parentPath);
                    switch (typeof info.value) {
                        case 'string': {
                            info.type = VALUE_TYPES.STRING; break;
                        }
                        case 'number': {
                            info.type = VALUE_TYPES.NUMBER; break;
                        }
                        case 'boolean': {
                            info.type = VALUE_TYPES.BOOLEAN; break;
                        }
                        case 'object': {
                            // Only allowed if type is REFERENCE, DATETIME, empty ARRAY, empty OBJECT
                            info.type = info.value.type;
                            info.value = info.value.value; 
                            if (info.type === VALUE_TYPES.DATETIME) {
                                info.value = new Date(info.value); // Convert number to Date
                            }
                            break;
                        }
                    }
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

    // removeNode(path, options = { tid: undefined }) {
    //     if (path === '') { 
    //         return Promise.reject(new Error(`Cannot remove the root node`)); 
    //     }
        
    //     const pathInfo = PathInfo.get(path);
    //     const tid = (options && options.tid) || ID.generate();
    //     return this.nodeLocker.lock(pathInfo.parentPath, tid, true, 'removeNode')
    //     .then(lock => {
    //         return this.updateNode(pathInfo.parentPath, { [pathInfo.key]: null }, { tid })
    //         .then(result => {
    //             lock.release();
    //             return result;
    //         })
    //         .catch(err => {
    //             lock.release();
    //             throw err;
    //         });            
    //     });
    // }

    setNode(path, value, options = { assert_revision: undefined, tid: undefined, suppress_events: false, context: null }) {        
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

                return this._writeNodeWithTracking('', value, { merge: false, tid, suppress_events: options.suppress_events, context: options.context })
            }

            if (options && typeof options.assert_revision !== 'undefined') {
                return this.getNodeInfo(path, { tid: lock.tid })
                .then(info => {
                    if (info.revision !== options.assert_revision) {
                        throw new NodeRevisionError(`revision '${info.revision}' does not match requested revision '${options.assert_revision}'`);
                    }
                    if (info.address && info.address.path === path && !this.valueFitsInline(value)) {
                        // Overwrite node
                        return this._writeNodeWithTracking(path, value, { merge: false, tid, suppress_events: options.suppress_events, context: options.context });
                    }
                    else {
                        // Update parent node
                        return lock.moveToParent()
                        .then(parentLock => {
                            lock = parentLock;
                            return this._writeNodeWithTracking(pathInfo.parentPath, { [pathInfo.key]: value }, { merge: true, tid, suppress_events: options.suppress_events, context: options.context });
                        });
                    }
                })
            }
            else {
                // Delegate operation to update on parent node
                return lock.moveToParent()
                .then(parentLock => {
                    lock = parentLock;                
                    return this.updateNode(pathInfo.parentPath, { [pathInfo.key]: value }, { tid, suppress_events: options.suppress_events, context: options.context });
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

    updateNode(path, updates, options = { tid: undefined, suppress_events: false, context: null }) {

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
                return this._writeNodeWithTracking(path, updates, { merge: true, tid, suppress_events: options.suppress_events, context: options.context });
            }
            else if (nodeInfo.exists) {
                // Node exists, but is stored in its parent node.
                const pathInfo = PathInfo.get(path);
                return lock.moveToParent()
                .then(parentLock => {
                    lock = parentLock;
                    return this._writeNodeWithTracking(pathInfo.parentPath, { [pathInfo.key]: updates }, { merge: true, tid, suppress_events: options.suppress_events, context: options.context });
                });
            }
            else {
                // The node does not exist, it's parent doesn't have it either. Update the parent instead
                return lock.moveToParent()
                .then(parentLock => {
                    lock = parentLock;
                    return this.updateNode(pathInfo.parentPath, { [pathInfo.key]: updates }, { tid, suppress_events: options.suppress_events, context: options.context });
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
    SQLiteNodeAddress,
    SQLiteNodeInfo,
    SQLiteStorage,
    SQLiteStorageSettings
}