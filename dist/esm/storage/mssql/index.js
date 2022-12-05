import { ID, PathReference, PathInfo, ascii85, ColorStyle } from 'acebase-core';
import { Storage, StorageSettings } from '../index.js';
import { NodeInfo } from '../../node-info.js';
import { VALUE_TYPES } from '../../node-value-types.js';
import { NodeNotFoundError, NodeRevisionError } from '../../node-errors.js';
import { pfs } from '../../promise-fs/index.js';
import { NodeAddress } from '../../node-address.js';
import { assert } from '../../assert.js';
export class MSSQLNodeAddress extends NodeAddress {
    constructor(containerPath) {
        super(containerPath);
    }
}
export class MSSQLNodeInfo extends NodeInfo {
    constructor(info) {
        super(info);
        this.revision = info.revision;
        this.revision_nr = info.revision_nr;
        this.created = info.created;
        this.modified = info.modified;
    }
}
export class MSSQLStorageSettings extends StorageSettings {
    constructor(options) {
        super(options);
        /**
         * Driver to use, 'tedious' by default. If you want to use Microsoft's native V8
         * driver on Windows, make sure to add msnodesqlv8 to your project dependencies
         */
        this.driver = 'tedious';
        /**
         * Server name, default is `'localhost'`
         * @default 'localhost'
         */
        this.server = 'localhost';
        /**
         * Server port, default is `1433`
         * @default 1433
         */
        this.port = 1433;
        /**
         * A boolean determining whether or not the connection will be encrypted. (default: `true`)
         * @default true
         */
        this.encrypt = true;
        /**
         * Name of the app to identify connection in SQL server manager
         */
        this.appName = 'AceBase';
        /**
         * default is `60000`ms (60s)
         */
        this.connectionTimeout = 60000;
        /**
         * default is `300000`ms (5m)
         */
        this.requestTimeout = 300000;
        /**
         * default is `10`
         */
        this.maxConnections = 10;
        /**
         * default is `0`
         */
        this.minConnections = 0;
        /**
         * default is `30000`ms (30s)
         */
        this.idleTimeout = 300000;
        /**
         * Whether to use Windows authentication.
         * @default false
         */
        this.trustedConnection = false;
        this.driver = options.driver === 'native' ? 'native' : 'tedious';
        this.domain = options.domain;
        this.user = options.user;
        this.password = options.password;
        this.server = options.server || 'localhost';
        this.port = typeof options.port === 'number' ? options.port : 1433;
        this.database = options.database;
        this.instance = options.instance;
        this.encrypt = typeof options.encrypt === 'boolean' ? options.encrypt : true;
        this.appName = 'AceBase';
        this.connectionTimeout = typeof options.connectionTimeout === 'number' ? options.connectionTimeout : 60 * 1000; // 60 seconds
        this.requestTimeout = typeof options.requestTimeout === 'number' ? options.requestTimeout : 5 * 60 * 1000; // 5 minutes
        this.maxConnections = typeof options.maxConnections === 'number' ? options.maxConnections : 10;
        this.minConnections = typeof options.minConnections === 'number' ? options.minConnections : 0;
        this.idleTimeout = typeof options.idleTimeout === 'number' ? options.idleTimeout : 30 * 1000; // 30s
        this.trustedConnection = options.trustedConnection === true;
        if (this.trustedConnection && this.driver !== 'native') {
            throw new Error(`Cannot use trusted connection (windows authentication) when not using the native driver`);
        }
    }
}
export class MSSQLStorage extends Storage {
    /**
     * @param name database name
     * @param settings settings to connect to a SQL Server database
     */
    constructor(name, settings, env) {
        settings = new MSSQLStorageSettings(settings);
        super(name, settings, env);
        // Lazy load MSSQL so it is only `require`d once MSSQLStorage is actually requested
        if (this.settings.driver === 'native') {
            // Use Microsft native V8 driver
            try {
                this.mssql = require('mssql/msnodesqlv8');
            }
            catch (err) {
                throw new Error(`Native driver for MSSQL not found. To use Microsoft's native V8 MSSQL driver, add msnodesqlv8 to your project dependencies: npm i msnodesqlv8 (also add mssql package)`);
            }
        }
        // Use default tedious driver
        try {
            this.mssql = require('mssql');
        }
        catch (err) {
            throw new Error(`MSSQL not found. To use MSSQL as storage, add mssql to your project dependencies: npm i mssql`);
        }
        this.init();
    }
    async init() {
        const path = `${this.settings.path}/${this.name}.acebase`;
        const exists = await pfs.exists(path);
        if (!exists) {
            try {
                await pfs.mkdir(path);
            }
            catch (err) {
                console.error(`Cannot create dir "${path}": ${err}`);
                throw err;
            }
        }
        // connect
        const settings = this.settings;
        this._db = new this.mssql.ConnectionPool({
            domain: settings.domain,
            user: settings.user,
            password: settings.password,
            server: settings.server,
            port: settings.port,
            database: settings.database,
            options: {
                encrypt: settings.encrypt,
                appName: settings.appName,
                abortTransactionOnError: true,
                instanceName: settings.instance,
                // native setting:
                trustedConnection: settings.trustedConnection,
            },
            connectionTimeout: settings.connectionTimeout,
            requestTimeout: settings.requestTimeout,
            pool: {
                max: settings.maxConnections,
                min: settings.minConnections,
                idleTimeoutMillis: settings.idleTimeout,
            },
        });
        try {
            await this._db.connect();
            this.rootRecord = null;
            // create tables that don't exist yet
            const tables = {
                settings: {
                    create: 'CREATE TABLE settings (name VARCHAR(50) NOT NULL PRIMARY KEY, value NVARCHAR(250))',
                    rows: [{ name: 'db_schema_version', value: '1' }],
                },
                nodes: {
                    create: `CREATE TABLE nodes (
                        path NVARCHAR(1000) NOT NULL PRIMARY KEY,
                        type TINYINT NOT NULL,  -- node type (1=object, 2=array, 5=string, 8=binary, 9=reference)
                        text_value NVARCHAR(MAX),        -- when type is string or reference (> max inline value length?)
                        binary_value VARBINARY(MAX),      -- when type is binary
                        json_value NVARCHAR(MAX),        -- when type is object, only simple/small value children are here (no objects, arrays, large strings)
                        
                        created BIGINT NOT NULL,       -- creation timestamp
                        modified BIGINT NOT NULL,      -- modification timestamp
                        revision_nr INT NOT NULL,   -- nr of times the node's value was updated
                        revision CHAR(24) NOT NULL  -- revision id that is shared with all nested nodes that were updated at the same time, should be time sortable so could be considered as a "transaction timestamp"
                    )`,
                    rows: [{
                            path: '',
                            type: VALUE_TYPES.OBJECT,
                            json_value: '{}',
                            created: Date.now(),
                            modified: Date.now(),
                            revision_nr: 0,
                            revision: ID.generate(),
                        }],
                },
                logs: {
                    create: `CREATE TABLE logs (
                        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                        action VARCHAR(25) NOT NULL, 
                        success BIT NOT NULL, 
                        error NVARCHAR(MAX), 
                        date BIGINT, 
                        details NVARCHAR(MAX)
                    )`,
                    rows: [{ action: 'db_created', success: 1, date: Date.now() }],
                },
            };
            const rows = await this._get(`SELECT TABLE_NAME AS name FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE'`);
            rows.forEach((row) => {
                delete tables[row.name];
            });
            // Create tables that didn't exist
            const promises = Object.keys(tables).map(async (name) => {
                // Create table
                const sql = tables[name].create;
                const result = await this._exec(sql);
                // Insert initialization data
                if (tables[name].rows) {
                    const rows = tables[name].rows;
                    const promises = rows.map(async (row) => {
                        const keys = Object.keys(row);
                        // let values = keys.map(key => row[key]).map(val => typeof val === 'number' ? val : `'${val.toString()}'`);
                        // let sql = `INSERT INTO ${name} (${keys.join(',')}) VALUES (${values.join(',')})`;
                        const sql = `INSERT INTO ${name} (${keys.join(',')}) VALUES (${keys.map(key => '@' + key).join(',')})`;
                        const params = keys.reduce((obj, key) => { obj[key] = row[key]; return obj; }, {});
                        await this._exec(sql, params);
                    });
                    await Promise.all(promises);
                }
                // Run action callback
                await tables[name].action?.();
            });
            await Promise.all(promises);
            // Get root record info
            this.rootRecord = await this.getNodeInfo('');
            this.debug.log(`Database "${this.name}" details:`.colorize(ColorStyle.dim));
            this.debug.log(`- Type: MSSQL`.colorize(ColorStyle.dim));
            this.debug.log(`- Server: ${this.settings.server}:${this.settings.port}`.colorize(ColorStyle.dim));
            this.debug.log(`- Database: ${this.settings.database}`.colorize(ColorStyle.dim));
            this.debug.log(`- Max inline value size: ${this.settings.maxInlineValueSize}`.colorize(ColorStyle.dim));
            // Load indexes
            await this.indexes.load();
            this.emit('ready');
        }
        catch (err) {
            this.debug.error(`Error initializing MSSQL database: ${err.message}`);
            this.emit('error', err);
        }
    }
    _executeRequest(request, sql, params) {
        const mssql = this.mssql;
        Object.keys(params ?? {}).forEach(name => {
            const value = params[name];
            if (value === null) {
                sql = sql.replace(new RegExp(`@${name}`, 'g'), 'null');
                delete params[name];
                return;
            }
            const type = (() => {
                switch (typeof value) {
                    case 'string': return mssql.NVarChar;
                    case 'number': return mssql.BigInt;
                    case 'object': {
                        if (value instanceof ArrayBuffer || value instanceof Buffer) {
                            return mssql.VarBinary(value.byteLength);
                        }
                        else {
                            throw new Error(`Unknown object parameter`);
                        }
                    }
                    default:
                        throw new Error(`Unknown parameter type`);
                }
            })();
            request.input(name, type, value);
        });
        return request.query(sql);
    }
    async _get(sql, params) {
        const request = new this.mssql.Request(this._db);
        const result = await this._executeRequest(request, sql, params);
        return result.recordset;
    }
    async _getOne(sql, params) {
        const rows = await this._get(sql, params);
        return rows[0];
    }
    async _exec(sql, params) {
        const request = new this.mssql.Request(this._db);
        const result = await this._executeRequest(request, sql, params);
        return result; //.rowsAffected;
    }
    /**
     * @param sql
     * @param params
     * @param callback function to call for every row until it returns false
     * @returns Resolves once all rows have been processed, or callback returned false
     */
    _each(sql, params = {}, callback) {
        // stream
        const request = new this.mssql.Request(this._db);
        request.stream = true;
        return new Promise((resolve, reject) => {
            let totalRows = 0;
            let canceled = false;
            request.on('row', (row) => {
                // Emitted for each row in a recordset
                if (canceled) {
                    return; // Just in case we do get more records after cancelation
                }
                totalRows++;
                canceled = callback(row) === false;
                if (canceled) {
                    request.cancel();
                    resolve({ rows: totalRows, canceled: true });
                }
            });
            request.on('error', (err) => {
                // May be emitted multiple times
                if (err.code !== 'ECANCEL') {
                    reject(err);
                }
            });
            request.on('done', (result) => {
                // Always emitted as the last one
                resolve({ rows: totalRows, canceled: false });
            });
            this._executeRequest(request, sql, params);
        });
    }
    _createTransaction() {
        const queue = [];
        const mssql = this.mssql;
        const run = async () => {
            const results = [];
            // create and run transaction
            const transaction = new mssql.Transaction(this._db);
            try {
                await transaction.begin();
                const exec = (sql, params) => {
                    const request = new mssql.Request(transaction);
                    return this._executeRequest(request, sql, params);
                };
                for (const statement of queue) {
                    const result = await exec(statement.sql, statement.params);
                    results.push(result);
                }
                await transaction.commit();
                return results;
            }
            catch (err) {
                // Any error will have triggered automatic rollback because we have specified this
                // in the connection
                const ourErr = new Error(`Error in statement #${results.length} (${queue[results.length].sql}): ${err.message}`);
                ourErr.inner = err;
                throw ourErr;
            }
        }; // run
        return {
            add(sql, params) {
                queue.push({ sql, params });
            },
            run,
        };
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
            const val = value[key];
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
            const arr = [];
            Object.keys(value).forEach(index => {
                arr[parseInt(index)] = value[index];
            });
            value = arr;
        }
        return value;
    }
    /**
     * Creates or updates a node in its own record. DOES NOT CHECK if path exists in parent node, or if parent paths exist! Calling code needs to do this
     */
    async _writeNode(path, value, options = {
        merge: false,
        revision: null,
        transaction: null,
    }) {
        if (this.valueFitsInline(value)) {
            throw new Error(`invalid value to store in its own node`);
        }
        // Setup transaction
        const transaction = options.transaction || this._createTransaction();
        // Get info about current node at path
        const currentRow = await this._getOne(`SELECT path, type, text_value, binary_value, json_value, revision, revision_nr FROM nodes WHERE path = @path`, { path }); //  OR path LIKE '${path}/*' OR path LIKE '${path}[%'
        const newRevision = (options && options.revision) || ID.generate();
        const mainNode = {
            type: VALUE_TYPES.OBJECT,
            value: {},
            storageType: 'json',
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
            new: [],
        };
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
                const sql = `UPDATE nodes SET type = @type, text_value = @text_value, binary_value = @binary_value, json_value = @json_value, modified = @modified, revision_nr = revision_nr + 1, revision = @revision
                    WHERE path = @path`;
                const params = {
                    path: path,
                    type: mainNode.type,
                    text_value: mainNode.storageType === 'text' ? mainNode.value : null,
                    binary_value: mainNode.storageType === 'binary' ? mainNode.value : null,
                    json_value: mainNode.storageType === 'json' ? this._createJSON(mainNode.value) : null,
                    modified: Date.now(),
                    // revision_nr: existingDetails.revision_nr + 1,
                    revision: newRevision,
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
                // Get current child nodes in dedicated child records
                let childRows = [];
                if (currentIsObjectOrArray) {
                    const where = path === ''
                        ? `path <> '' AND path NOT LIKE '%/%'`
                        : `(path LIKE '${path}/%' OR path LIKE '${path}[%') AND path NOT LIKE '${path}/%/%' AND path NOT LIKE '${path}[%]/%' AND path NOT LIKE '${path}[%][%'`;
                    // TODO: add parent_path to nodes table to make query easier and faster?
                    childRows = await this._get(`SELECT path FROM nodes WHERE ${where}`);
                }
                const keys = childRows.map(row => PathInfo.get(row.path).key);
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
                updateMainNode();
                await Promise.all(childUpdatePromises);
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
            await Promise.all(childCreatePromises);
            // Create current node
            const sql = `INSERT INTO nodes (path, type, text_value, binary_value, json_value, created, modified, revision_nr, revision)
                VALUES (@path, @type, @text_value, @binary_value, @json_value, @created, @modified, @revision_nr, @revision)`;
            const params = {
                path: path,
                type: mainNode.type,
                text_value: mainNode.storageType === 'text' ? mainNode.value : null,
                binary_value: mainNode.storageType === 'binary' ? mainNode.value : null,
                json_value: mainNode.storageType === 'json' ? this._createJSON(mainNode.value) : null,
                created: Date.now(),
                modified: Date.now(),
                revision_nr: 0,
                revision: newRevision,
            };
            transaction.add(sql, params); // return this._exec(sql, params);
        }
        if (!options.transaction) {
            // Our transaction, we can run it now!
            try {
                await transaction.run();
            }
            catch (err) {
                console.error(err);
                throw err;
            }
        }
    }
    /**
     * Deletes (dedicated) node and all subnodes without checking for existence. Use with care - all removed nodes will lose their revision stats! DOES NOT REMOVE INLINE CHILD NODES!
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
     */
    getChildren(path, options = {}) {
        let callback;
        const generator = {
            /**
             * @param valueCallback callback function to run for each child. Return false to stop iterating
             * @returns returns a promise that resolves with a boolean indicating if all children have been enumerated, or was canceled by the valueCallback function
             */
            next(valueCallback) {
                callback = valueCallback;
                return start();
            },
        };
        const start = async () => {
            let canceled = false;
            const tid = (options && options.tid) || ID.generate();
            const lock = await this.nodeLocker.lock(path, tid.toString(), false, 'getChildren');
            try {
                const row = await this._getOne(`SELECT type, json_value, revision, revision_nr, created, modified FROM nodes WHERE path = @path`, { path: path });
                if (!row) {
                    throw new NodeNotFoundError(`Node "/${path}" does not exist`);
                }
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
                    const child = this._getTypeFromStoredValue(value[key]);
                    const info = new MSSQLNodeInfo({
                        path: pathInfo.childPath(key),
                        ...(!isArray && { key }),
                        ...(isArray && { index: parseInt(key) }),
                        type: child.type,
                        address: null,
                        exists: true,
                        value: child.value,
                        revision: row.revision,
                        revision_nr: row.revision_nr,
                        created: parseInt(row.created),
                        modified: parseInt(row.modified),
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
                    : `path LIKE '${path}${isArray ? '[' : '/'}%' AND path NOT LIKE '${path}${isArray ? '[' : '/'}%/%' AND path NOT LIKE '${path}${isArray ? '[' : '/'}%[%'`;
                const q = `SELECT path, type, revision, revision_nr, created, modified FROM nodes WHERE ${where}`;
                await this._each(q, null, row => {
                    const key = PathInfo.get(row.path).key;
                    if (options.keyFilter && !options.keyFilter.includes(key)) {
                        return;
                    }
                    const info = new MSSQLNodeInfo({
                        path: row.path,
                        type: row.type,
                        ...(!isArray && { key: key }),
                        ...(isArray && { index: key }),
                        address: new MSSQLNodeAddress(row.path),
                        exists: true,
                        value: null,
                        revision: row.revision,
                        revision_nr: row.revision_nr,
                        created: parseInt(row.created),
                        modified: parseInt(row.modified), // parseInt because bigint is returned as string
                    });
                    canceled = callback(info) === false;
                    return !canceled; // stop ._each loop if canceled
                });
            }
            finally {
                lock.release();
            }
            return canceled;
        }; // start()
        return generator;
    }
    async getNode(path, options = { child_objects: true }) {
        // path = path.replace(/'/g, '');  // prevent sql injection, remove single quotes
        const tid = (options && options.tid) || ID.generate();
        let lock = await this.nodeLocker.lock(path, tid.toString(), false, 'getNode');
        try {
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
            let rows;
            let filtered = false;
            if (options && (options.include || options.exclude || options.child_objects === false)) {
                // A data filter is requested.
                // Building a where statement for this is impossible because we'd need regular expressions to filter paths (because LIKE 'users/%/posts' will also falsely match 'users/ewout/archive/posts')
                // Get all paths unfiltered, then filter them manually
                filtered = true;
                rows = await this._get(`SELECT path, type FROM nodes ${where}`);
                const paths = [path];
                const includeCheck = options.include
                    ? new RegExp('^' + options.include.map(p => `(?:${p.toString().replace(/\*/g, '[^/\\[]+')})`).join('|') + '(?:$|[/\\[])')
                    : null;
                const excludeCheck = options.exclude
                    ? new RegExp('^' + options.exclude.map(p => `(?:${p.toString().replace(/\*/g, '[^/\\[]+')})`).join('|') + '(?:$|[/\\[])')
                    : null;
                for (let i = 0; i < rows.length; i++) {
                    const row = rows[i];
                    if (row.path === path) {
                        continue; // No need to check the main path...
                    }
                    let checkPath = row.path.slice(path.length);
                    if (checkPath[0] === '/') {
                        checkPath = checkPath.slice(1);
                    }
                    const match = (includeCheck ? includeCheck.test(checkPath) : true)
                        && (excludeCheck ? !excludeCheck.test(checkPath) : true)
                        && (options.child_objects === false ? row.type !== VALUE_TYPES.OBJECT && !/[/[]/.test(checkPath) : true);
                    if (match) {
                        paths.push(row.path);
                    }
                }
                // Now query with all paths that met the requirement
                rows = await this._get(`SELECT path, type, text_value, binary_value, json_value, revision FROM nodes WHERE path IN (${paths.map(p => `'${p}'`).join(',')})`);
            }
            else {
                // No filtering
                rows = await this._get(`SELECT path, type, text_value, binary_value, json_value, revision FROM nodes ${where}`);
            }
            if (rows.length === 0) {
                // Lookup parent node
                lock = await lock.moveToParent();
                if (path === '') {
                    return null;
                } // path is root. There is no parent.
                const pathInfo = PathInfo.get(path);
                const parentRow = await this._getOne(`SELECT type, json_value, revision FROM nodes WHERE path = '${pathInfo.parentPath}'`);
                const result = {
                    revision: parentRow ? parentRow.revision : null,
                    value: null,
                };
                if (!parentRow) {
                    return result;
                } // parent node doesn't exist
                if (![VALUE_TYPES.OBJECT, VALUE_TYPES.ARRAY].includes(parentRow.type)) {
                    return result;
                } // parent node is not an object
                // WARNING: parentRow.json_value might be big!!
                // TODO: create JSON streamer if json_value length becomes larger than 10KB?
                const val = this._deserializeJSON(parentRow.type, parentRow.json_value);
                if (!(pathInfo.key in val)) {
                    return result;
                } // parent does not have a child with requested key
                result.value = val[pathInfo.key];
                return result;
            }
            this.debug.log(`Read node "/${path}" and ${filtered ? '(filtered) ' : ''}children from ${rows.length} records`.colorize(ColorStyle.magenta));
            const targetPathKeys = PathInfo.getPathKeys(path);
            const targetRow = rows.find(row => row.path === path);
            const result = {
                revision: targetRow ? targetRow.revision : null,
                value: null,
            };
            if (targetRow.type === VALUE_TYPES.OBJECT || targetRow.type === VALUE_TYPES.ARRAY) {
                // target node is an object or array
                const value = this._deserializeJSON(targetRow.type, targetRow.json_value);
                // merge with other found (child) records
                for (let i = 0; i < rows.length; i++) {
                    const otherRow = rows[i];
                    if (otherRow === targetRow) {
                        continue;
                    }
                    const pathKeys = PathInfo.getPathKeys(otherRow.path);
                    const trailKeys = pathKeys.slice(targetPathKeys.length);
                    let parent = value;
                    for (let j = 0; j < trailKeys.length; j++) {
                        assert(typeof parent === 'object', 'parent must be an object/array to have children!!');
                        const key = trailKeys[j];
                        const isLast = j === trailKeys.length - 1;
                        const nodeType = isLast
                            ? otherRow.type
                            : typeof trailKeys[j + 1] === 'number'
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
                            assert(typeof parent[key] === typeof nodeValue && [VALUE_TYPES.OBJECT, VALUE_TYPES.ARRAY].includes(nodeType), 'Merging child values can only be done if existing and current values are both an array or object');
                            Object.keys(nodeValue).forEach(childKey => {
                                assert(!(childKey in parent[key]), 'child key is in parent value already?! HOW?!');
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
                // BLOBs are returned as Uint8Array by MSSQL3
                const val = targetRow.binary_value;
                result.value = val.buffer.slice(val.byteOffset, val.byteOffset + val.byteLength);
            }
            else {
                result.value = targetRow.text_value;
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
                        assert(Object.keys(result.value[key]).length === 0);
                        delete result.value[key];
                    }
                });
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
                    const checkKeys = typeof path === 'number' ? [path] : PathInfo.getPathKeys(path);
                    process(result.value, checkKeys);
                });
            }
            return result;
        }
        finally {
            lock.release();
        }
    }
    async getNodeInfo(path, options = {}) {
        const lookupNode = async (path) => {
            const rows = await this._get(`SELECT type, text_value, binary_value, json_value, created, modified, revision, revision_nr FROM nodes WHERE path=@path`, { path });
            if (rows.length === 0) {
                return null;
            }
            const row = rows[0];
            let value = null;
            if (row.type === VALUE_TYPES.OBJECT || row.type === VALUE_TYPES.ARRAY) {
                value = JSON.parse(row.json_value);
            }
            else if (row.type === VALUE_TYPES.BINARY) {
                // BLOBs are returned as Uint8Array by MSSQL
                const val = row.binary_value;
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
                revision_nr: row.revision_nr,
            };
        };
        const pathInfo = PathInfo.get(path);
        const tid = (options && options.tid) || ID.generate();
        let lock = await this.nodeLocker.lock(path, tid.toString(), false, 'getNodeInfo');
        try {
            const node = await lookupNode(path);
            const info = new MSSQLNodeInfo({
                path,
                key: typeof pathInfo.key === 'string' ? pathInfo.key : null,
                index: typeof pathInfo.key === 'number' ? pathInfo.key : null,
                type: node ? node.type : 0,
                exists: node !== null,
                address: node ? new MSSQLNodeAddress(path) : null,
                created: node ? parseInt(node.created) : null,
                modified: node ? parseInt(node.modified) : null,
                revision: node ? node.revision : null,
                revision_nr: node ? node.revision_nr : null,
            });
            // info.created = node ? new Date(node.created) : null;
            // info.modified = node ? new Date(node.modified) : null;
            // info.revision = node ? node.revision : null;
            // info.revision_nr = node ? node.revision_nr : null;
            if (node || path === '') {
                return info;
            }
            // Try parent node
            lock = await lock.moveToParent();
            const parent = await lookupNode(pathInfo.parentPath);
            if (parent && [VALUE_TYPES.OBJECT, VALUE_TYPES.ARRAY].includes(parent.type) && pathInfo.key in parent.value) {
                // Stored in parent node
                info.exists = true;
                info.value = parent.value[pathInfo.key];
                info.address = null; // pathInfo.parentPath; //new SqlNodeAddress(pathInfo.parentPath);
                switch (typeof info.value) {
                    case 'string': {
                        info.type = VALUE_TYPES.STRING;
                        break;
                    }
                    case 'number': {
                        info.type = VALUE_TYPES.NUMBER;
                        break;
                    }
                    case 'boolean': {
                        info.type = VALUE_TYPES.BOOLEAN;
                        break;
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
                info.created = parseInt(parent.created);
                info.modified = parseInt(parent.modified);
                info.revision = parent.revision;
                info.revision_nr = parent.revision_nr;
            }
            else {
                // Parent doesn't exist, so the node we're looking for cannot exist either
                info.address = null;
            }
            return info;
        }
        finally {
            lock.release();
        }
    }
    async setNode(path, value, options = {
        suppress_events: false,
        context: null,
    }) {
        if (this.settings.readOnly) {
            throw new Error(`Database is opened in read-only mode`);
        }
        const pathInfo = PathInfo.get(path);
        const tid = (options && options.tid) || ID.generate();
        let lock = await this.nodeLocker.lock(path, tid.toString(), true, 'setNode');
        try {
            if (path === '') {
                if (value === null || typeof value !== 'object' || value instanceof Array || value instanceof ArrayBuffer || ('buffer' in value && value.buffer instanceof ArrayBuffer)) {
                    throw new Error(`Invalid value for root node: ${value}`);
                }
                await this._writeNodeWithTracking('', value, { merge: false, tid, suppress_events: options.suppress_events, context: options.context });
            }
            else if (options && typeof options.assert_revision !== 'undefined') {
                const info = await this.getNodeInfo(path, { tid: lock.tid });
                if (info.revision !== options.assert_revision) {
                    throw new NodeRevisionError(`revision '${info.revision}' does not match requested revision '${options.assert_revision}'`);
                }
                if (info.address && info.address.path === path && !this.valueFitsInline(value)) {
                    // Overwrite node
                    await this._writeNodeWithTracking(path, value, { merge: false, tid, suppress_events: options.suppress_events, context: options.context });
                }
                else {
                    // Update parent node
                    lock = await lock.moveToParent();
                    await this._writeNodeWithTracking(pathInfo.parentPath, { [pathInfo.key]: value }, { merge: true, tid, suppress_events: options.suppress_events, context: options.context });
                }
            }
            else {
                // Delegate operation to update on parent node
                lock = await lock.moveToParent();
                return this.updateNode(pathInfo.parentPath, { [pathInfo.key]: value }, { tid, suppress_events: options.suppress_events, context: options.context });
            }
        }
        finally {
            lock.release();
        }
    }
    async updateNode(path, updates, options = {
        suppress_events: false,
        context: null,
    }) {
        if (this.settings.readOnly) {
            throw new Error(`Database is opened in read-only mode`);
        }
        if (typeof updates !== 'object') { //  || Object.keys(updates).length === 0
            throw new Error(`invalid updates argument`); //. Must be a non-empty object or array
        }
        const tid = (options && options.tid) || ID.generate();
        let lock = await this.nodeLocker.lock(path, tid.toString(), true, 'updateNode');
        try {
            // Get info about current node
            const nodeInfo = await this.getNodeInfo(path, { tid: lock.tid });
            const pathInfo = PathInfo.get(path);
            if (nodeInfo.exists && nodeInfo.address && nodeInfo.address.path === path) {
                // Node exists and is stored in its own record.
                // Update it
                await this._writeNodeWithTracking(path, updates, { merge: true, tid, suppress_events: options.suppress_events, context: options.context });
            }
            else if (nodeInfo.exists) {
                // Node exists, but is stored in its parent node.
                const pathInfo = PathInfo.get(path);
                lock = await lock.moveToParent();
                await this._writeNodeWithTracking(pathInfo.parentPath, { [pathInfo.key]: updates }, { merge: true, tid, suppress_events: options.suppress_events, context: options.context });
            }
            else {
                // The node does not exist, it's parent doesn't have it either. Update the parent instead
                lock = await lock.moveToParent();
                await this.updateNode(pathInfo.parentPath, { [pathInfo.key]: updates }, { tid, suppress_events: options.suppress_events, context: options.context });
            }
        }
        finally {
            lock.release();
        }
    }
}
//# sourceMappingURL=index.js.map