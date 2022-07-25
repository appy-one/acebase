import { DebugLogger, SimpleEventEmitter } from 'acebase-core';
export declare class SchemaValidationError extends Error {
    reason: string;
    constructor(reason: string);
}
export interface IWriteNodeResult {
    mutations: Array<{
        target: Array<string | number>;
        prev: any;
        val: any;
    }>;
}
/**
 * Client config for usage with an acebase-ipc-server
 */
export interface IPCClientSettings {
    /**
     * IPC Server host to connect to. Default is `"localhost"`
     * @default 'localhost'
     */
    host?: string;
    /**
     * IPC Server port number
     */
    port: number;
    /**
     * Whether to use a secure connection to the server. Strongly recommended if `host` is not `"localhost"`. Default is `false`
     * @default false
     */
    ssl?: boolean;
    /**
     * Token used in the IPC Server configuration (optional). The server will refuse connections using the wrong token.
     */
    token: string;
    /**
     * Determines the role of this IPC client. Only 1 process can be assigned the 'master' role, all other processes must use the role 'worker'
     */
    role: 'master' | 'worker';
}
export interface TransactionLogSettings {
    log?: boolean;
    maxAge?: number;
    noWait?: boolean;
}
/**
 * Storage Settings
 */
export declare class StorageSettings {
    logLevel: 'error' | 'verbose' | 'log' | 'warn';
    /**
     *  in bytes, max amount of child data to store within a parent record before moving to a dedicated record. Default is 50
     * @default 50
     */
    maxInlineValueSize: number;
    /**
     * Instead of throwing errors on undefined values, remove the properties automatically. Default is false
     * @default false
     */
    removeVoidProperties: boolean;
    /**
     * Target path to store database files in, default is `'.'`
     * @default '.'
     */
    path: string;
    /**
     * optional info to be written to the console output underneith the logo
     * @default 'realtime database'
     */
    info?: string;
    /**
     * optional type of storage class - used by `AceBaseStorage` to create different db files in the future (data, transaction, auth etc)
     * TODO: move to `AcebaseStorageSettings`
     */
    type?: string;
    /**
     * External IPC server configuration. You need this if you are running multiple AceBase processes using the same database files in a pm2 or cloud-based cluster so the individual processes can communicate with each other.
     */
    ipc?: IPCClientSettings;
    /**
     * timeout setting for read /and write locks in seconds. Operations taking longer than this will be aborted. Default is 120 seconds.
     * @default 120
     */
    lockTimeout?: number;
    transactions?: TransactionLogSettings;
    constructor(settings?: Partial<StorageSettings>);
}
export declare class Storage extends SimpleEventEmitter {
    name: string;
    settings: StorageSettings;
    debug: DebugLogger;
    indexes: {
        readonly supported: boolean;
        close(): Promise<void>;
    };
    private ipc;
    private nodeLocker;
    private _lastTid;
    createTid(): string | number;
    /**
     * Base class for database storage, must be extended by back-end specific methods.
     * Currently implemented back-ends are AceBaseStorage, SQLiteStorage, MSSQLStorage, CustomStorage
     * @param name name of the database
     * @param settings instance of AceBaseStorageSettings or SQLiteStorageSettings
     */
    constructor(name: string, settings: StorageSettings);
    close(): Promise<void>;
    get path(): string;
    /**
     * Checks if a value can be stored in a parent object, or if it should
     * move to a dedicated record. Uses settings.maxInlineValueSize
     * @param {any} value
     */
    valueFitsInline(value: any): boolean;
    /**
     * Creates or updates a node in its own record. DOES NOT CHECK if path exists in parent node, or if parent paths exist! Calling code needs to do this
     * @param {string} path
     * @param {any} value
     * @param {object} [options]
     * @param {boolean} [options.merge=false]
     * @returns {Promise<any>}
     */
    _writeNode(path: any, value: any, options: any): void;
    /**
     *
     * @param {string} path
     * @param {boolean} suppressEvents
     * @returns
     */
    getUpdateImpact(path: any, suppressEvents: any): {
        topEventPath: any;
        eventSubscriptions: any;
        valueSubscribers: any;
        hasValueSubscribers: boolean;
        indexes: any;
        keysFilter: any[];
    };
    /**
     * Wrapper for _writeNode, handles triggering change events, index updating.
     * @param {string} path
     * @param {any} value
     * @param {object} [options]
     * @returns {Promise<IWriteNodeResult>} Returns a promise that resolves with an object that contains storage specific details, plus the applied mutations if transaction logging is enabled
     */
    _writeNodeWithTracking(path: any, value: any, options?: {
        merge: boolean;
        transaction: any;
        tid: any;
        _customWriteFunction: any;
        waitForIndexUpdates: boolean;
        suppress_events: boolean;
        context: any;
        impact: any;
    }): Promise<any>;
    /**
     * Enumerates all children of a given Node for reflection purposes
     * @param {string} path
     * @param {object} [options] optional options used by implementation for recursive calls
     * @param {string[]|number[]} [options.keyFilter] specify the child keys to get callbacks for, skips .next callbacks for other keys
     * @param {string} [options.tid] optional transaction id for node locking purposes
     * @param {boolean} [options.async] whether to use an async/await flow for each `.next` call
     * @returns {{ next: (callback: (child: NodeInfo) => boolean|void) => Promise<boolean>}} returns a generator object that calls .next for each child until the .next callback returns false
     */
    getChildren(path: any, options: any): void;
    /**
     * @deprecated Use `getNode` instead
     * Gets a node's value by delegating to getNode, returning only the value
     * @param {string} path
     * @param {object} [options] optional options that can limit the amount of (sub)data being loaded, and any other implementation specific options for recusrsive calls
     * @param {string[]} [options.include] child paths to include
     * @param {string[]} [options.exclude] child paths to exclude
     * @param {boolean} [options.child_objects] whether to inlcude child objects and arrays
     * @param {string} [options.tid] optional transaction id for node locking purposes
     * @returns {Promise<any>}
     */
    getNodeValue(path: any, options?: {}): Promise<any>;
    /**
     * Gets a node's value and (if supported) revision
     * @param {string} path
     * @param {object} [options] optional options that can limit the amount of (sub)data being loaded, and any other implementation specific options for recusrsive calls
     * @param {string[]} [options.include] child paths to include
     * @param {string[]} [options.exclude] child paths to exclude
     * @param {boolean} [options.child_objects] whether to inlcude child objects and arrays
     * @param {string} [options.tid] optional transaction id for node locking purposes
     * @returns {Promise<{ revision?: string, value: any, cursor?: string }>}
     */
    getNode(path: any, options: any): void;
    /**
     * Retrieves info about a node (existence, wherabouts etc)
     * @param {string} path
     * @param {object} [options] optional options used by implementation for recursive calls
     * @param {string} [options.tid] optional transaction id for node locking purposes
     * @param {boolean} [options.include_child_count=false] whether to include child count if node is an object or array
     * @returns {Promise<NodeInfo>}
     */
    getNodeInfo(path: any, options: any): void;
    /**
     * Creates or overwrites a node. Delegates to updateNode on a parent if
     * path is not the root.
     * @param {string} path
     * @param {any} value
     * @param {object} [options] optional options used by implementation for recursive calls
     * @param {string} [options.tid] optional transaction id for node locking purposes
     * @param {any} [options.context] context info used by the client
     * @returns {Promise<string|void>} Returns a new cursor if transaction logging is enabled
     */
    setNode(path: any, value: any, options: any): void;
    /**
     * Updates a node by merging an existing node with passed updates object,
     * or creates it by delegating to updateNode on the parent path.
     * @param {string} path
     * @param {object} updates object with key/value pairs
     * @param {object} [options] optional options used by implementation for recursive calls
     * @param {string} [options.tid] optional transaction id for node locking purposes
     * @param {any} [options.context] context info used by the client
     * @returns {Promise<string|void>} Returns a new cursor if transaction logging is enabled
     */
    updateNode(path: any, updates: any, options: any): void;
    /**
     * Updates a node by getting its value, running a callback function that transforms
     * the current value and returns the new value to be stored. Assures the read value
     * does not change while the callback runs, or runs the callback again if it did.
     * @param {string} path
     * @param {(value: any) => any} callback function that transforms current value and returns the new value to be stored. Can return a Promise
     * @param {object} [options] optional options used by implementation for recursive calls
     * @param {string} [options.tid] optional transaction id for node locking purposes
     * @param {boolean} [options.suppress_events=false] whether to suppress the execution of event subscriptions
     * @param {any} [options.context] context info used by the client
     * @returns {Promise<string|void>} Returns a new cursor if transaction logging is enabled
     */
    transactNode(path: any, callback: any, options?: {
        no_lock: boolean;
        suppress_events: boolean;
        context: any;
    }): any;
    /**
     * Checks if a node's value matches the passed criteria
     * @param {string} path
     * @param {Array<{ key: string, op: string, compare: string }>} criteria criteria to test
     * @param {object} [options] optional options used by implementation for recursive calls
     * @param {string} [options.tid] optional transaction id for node locking purposes
     * @returns {Promise<boolean>} returns a promise that resolves with a boolean indicating if it matched the criteria
     */
    matchNode(path: any, criteria: any, options?: {
        tid: any;
    }): any;
    test(val: any, op: any, compare: any): any;
    /**
     * Export a specific path's data to a stream
     * @param {string} path
     * @param {(str: string) => void|Promise<void> | { write(str: string): void|Promise<void>}} write function that writes to a stream, or stream object that has a write method that (optionally) returns a promise the export needs to wait for before continuing
     * @returns {Promise<void>} returns a promise that resolves once all data is exported
     */
    exportNode(path: any, write: any, options?: {
        format: string;
        type_safe: boolean;
    }): Promise<any>;
    /**
     * Import a specific path's data from a stream
     * @param {string} path
     * @param {(bytes: number) => string|ArrayBufferView|Promise<string|ArrayBufferView>} read read function that streams a new chunk of data
     * @param {object} [options]
     * @param {'json'} [options.format]
     * @param {'set'|'update'|'merge'} [options.method] How to store the imported data: 'set' and 'update' will use the same logic as when calling 'set' or 'update' on the target,
     * 'merge' will do something special: it will use 'update' logic on all nested child objects:
     * consider existing data `{ users: { ewout: { name: 'Ewout Stortenbeker', age: 42 } } }`:
     * importing `{ users: { ewout: { country: 'The Netherlands', age: 43 } } }` with `method: 'merge'` on the root node
     * will effectively add `country` and update `age` properties of "users/ewout", and keep all else the same.4
     * This method is extremely useful to replicate effective data changes to remote databases.
     * @returns {Promise<void>} returns a promise that resolves once all data is imported
     */
    importNode(path: any, read: any, options?: {
        format: string;
        method: string;
    }): Promise<void>;
    /**
     * Adds, updates or removes a schema definition to validate node values before they are stored at the specified path
     * @param {string} path target path to enforce the schema on, can include wildcards. Eg: 'users/*\/posts/*' or 'users/$uid/posts/$postid'
     * @param {string|Object} schema schema type definitions. When null value is passed, a previously set schema is removed.
     */
    setSchema(path: any, schema: any): void;
    /**
     * Gets currently active schema definition for the specified path
     * @param {string} path
     * @returns {{ path: string, schema: string|Object, text: string }}
     */
    getSchema(path: any): {
        path: any;
        schema: any;
        text: any;
    };
    /**
     * Gets all currently active schema definitions
     * @returns {Array<{ path: string, schema: string|Object, text: string }>}
     */
    getSchemas(): any;
    /**
     * Validates the schemas of the node being updated and its children
     * @param {string} path path being written to
     * @param {any} value the new value, or updates to current value
     * @param {object} [options]
     * @param {boolean} [options.updates] If an existing node is being updated (merged), this will only enforce schema rules set on properties being updated.
     * @returns {{ ok: true }|{ ok: false; reason: string }}
     * @example
     * // define schema for each tag of each user post:
     * db.schema.set(
     *  'users/$uid/posts/$postId/tags/$tagId',
     *  { name: 'string', 'link_id?': 'number' }
     * );
     *
     * // Insert that will fail:
     * db.ref('users/352352/posts/572245').set({
     *  text: 'this is my post',
     *  tags: { sometag: 'deny this' } // <-- sometag must be typeof object
     * });
     *
     * // Insert that will fail:
     * db.ref('users/352352/posts/572245').set({
     *  text: 'this is my post',
     *  tags: {
     *      tag1: { name: 'firstpost', link_id: 234 },
     *      tag2: { name: 'newbie' },
     *      tag3: { title: 'Not allowed' } // <-- title property not allowed
     *  }
     * });
     *
     * // Update that fails if post does not exist:
     * db.ref('users/352352/posts/572245/tags/tag1').update({
     *  name: 'firstpost'
     * }); // <-- post is missing property text
     */
    validateSchema(path: any, value: any, options?: {
        updates: boolean;
    }): {
        ok: boolean;
    };
}
