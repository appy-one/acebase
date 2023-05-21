/// <reference types="node" />
import { Utils, DebugLogger, SimpleEventEmitter, DataRetrievalOptions, ISchemaCheckResult, LoggingLevel } from 'acebase-core';
import { NodeInfo } from '../node-info';
import { IPCPeer, RemoteIPCPeer, IPCSocketPeer, NetIPCServer } from '../ipc';
import { DataIndex } from '../data-index';
import { CreateIndexOptions } from './indexes';
export declare class SchemaValidationError extends Error {
    reason: string;
    constructor(reason: string);
}
export interface IWriteNodeResult {
    mutations: Array<{
        target: (string | number)[];
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
    token?: string;
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
    /**
     * in bytes, max amount of child data to store within a parent record before moving to a dedicated record. Default is 50
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
     * timeout setting for read and write locks in seconds. Operations taking longer than this will be aborted. Default is 120 seconds.
     * @default 120
     */
    lockTimeout: number;
    /**
     * optional type of storage class - used by `AceBaseStorage` to create different specific db files (data, transaction, auth etc)
     * @see AceBaseStorageSettings see `AceBaseStorageSettings.type` for more info
     */
    type: string;
    /**
     * Whether the database should be opened in readonly mode
     * @default false
     */
    readOnly: boolean;
    /**
     * IPC settings if you are using AceBase in pm2 or cloud-based clusters, or (NEW) `'socket'` to connect
     * to an automatically spawned IPC service ("daemon") on this machine
     */
    ipc?: IPCClientSettings | 'socket' | NetIPCServer;
    /**
     * Settings for optional transaction logging
     */
    transactions?: TransactionLogSettings;
    constructor(settings?: Partial<StorageSettings>);
}
export interface StorageEnv {
    logLevel: LoggingLevel;
}
export type SubscriptionCallback = (err: Error, path: string, newValue: any, oldValue: any, context: any) => void;
export type InternalDataRetrievalOptions = DataRetrievalOptions & {
    tid?: string | number;
};
export declare class Storage extends SimpleEventEmitter {
    name: string;
    settings: StorageSettings;
    debug: DebugLogger;
    stats: any;
    ipc: IPCPeer | RemoteIPCPeer | IPCSocketPeer;
    nodeLocker: {
        lock(path: string, tid: string, write: boolean, comment?: string): ReturnType<IPCPeer['lock']>;
    };
    private _lastTid;
    createTid(): string | number;
    private _schemas;
    /**
     * Base class for database storage, must be extended by back-end specific methods.
     * Currently implemented back-ends are AceBaseStorage, SQLiteStorage, MSSQLStorage, CustomStorage
     * @param name name of the database
     * @param settings instance of AceBaseStorageSettings or SQLiteStorageSettings
     */
    constructor(name: string, settings: StorageSettings, env: StorageEnv);
    private _indexes;
    private _annoucedIndexes;
    indexes: {
        /**
         * Tests if (the default storage implementation of) indexes are supported in the environment.
         * They are currently only supported when running in Node.js because they use the fs filesystem.
         * TODO: Implement storage specific indexes (eg in SQLite, MySQL, MSSQL, in-memory)
         */
        readonly supported: boolean;
        create: (path: string, key: string, options?: CreateIndexOptions) => Promise<DataIndex>;
        /**
         * Returns indexes at a path, or a specific index on a key in that path
         */
        get: (path: string, key?: string) => DataIndex[];
        /**
         * Returns all indexes on a target path, optionally includes indexes on child and parent paths
         */
        getAll: (targetPath: string, options?: {
            parentPaths: boolean;
            childPaths: boolean;
        }) => DataIndex[];
        /**
         * Returns all indexes
         */
        list: () => DataIndex[];
        /**
         * Discovers and populates all created indexes
         */
        load: () => Promise<void>;
        add: (fileName: string) => Promise<DataIndex>;
        /**
         * Deletes an index from the database
         */
        delete: (fileName: string) => Promise<void>;
        /**
         * Removes an index from the list. Does not delete the actual file, `delete` does that!
         * @returns returns the removed index
         */
        remove: (fileName: string) => Promise<DataIndex>;
        close: () => Promise<void>;
    };
    private _eventSubscriptions;
    subscriptions: {
        /**
         * Adds a subscription to a node
         * @param path Path to the node to add subscription to
         * @param type Type of the subscription
         * @param callback Subscription callback function
         */
        add: (path: string, type: string, callback: SubscriptionCallback) => void;
        /**
         * Removes 1 or more subscriptions from a node
         * @param path Path to the node to remove the subscription from
         * @param type Type of subscription(s) to remove (optional: if omitted all types will be removed)
         * @param callback Callback to remove (optional: if omitted all of the same type will be removed)
         */
        remove: (path: string, type?: string, callback?: SubscriptionCallback) => void;
        /**
         * Checks if there are any subscribers at given path that need the node's previous value when a change is triggered
         * @param path
         */
        hasValueSubscribersForPath(path: string): boolean;
        /**
         * Gets all subscribers at given path that need the node's previous value when a change is triggered
         * @param path
         */
        getValueSubscribersForPath: (path: string) => {
            type: string;
            eventPath: string;
            dataPath: string;
            subscriptionPath: string;
        }[];
        /**
         * Gets all subscribers at given path that could possibly be invoked after a node is updated
         */
        getAllSubscribersForPath: (path: string) => {
            type: string;
            eventPath: string;
            dataPath: string;
            subscriptionPath: string;
        }[];
        /**
         * Triggers subscription events to run on relevant nodes
         * @param event Event type: "value", "child_added", "child_changed", "child_removed"
         * @param path Path to the node the subscription is on
         * @param dataPath path to the node the value is stored
         * @param oldValue old value
         * @param newValue new value
         * @param context context used by the client that updated this data
         */
        trigger: (event: string, path: string, dataPath: string, oldValue: any, newValue: any, context: any) => void;
    };
    /**
     * If Storage class supports a node address or value caching mechanism, it must override this method.
     * @param fromIPC if the request originated from a remote IPC peer. If not, it must notify other peers itself.
     * @param path cache path to invalidate
     * @param recursive whether to invalidate all cached child paths
     * @param reason reason for this invalidation request, for debugging purposes.
     */
    invalidateCache?(fromIPC: boolean, path: string, recursive: boolean, reason: string): any;
    close(): Promise<void>;
    get path(): string;
    /**
     * Checks if a value can be stored in a parent object, or if it should
     * move to a dedicated record. Uses settings.maxInlineValueSize
     * @param value
     */
    valueFitsInline(value: any): boolean;
    /**
     * Creates or updates a node in its own record. DOES NOT CHECK if path exists in parent node, or if parent paths exist! Calling code needs to do this
     */
    protected _writeNode(path: string, value: any, options?: {
        merge?: boolean;
    }): Promise<void>;
    getUpdateImpact(path: string, suppressEvents: boolean): {
        topEventPath: string;
        eventSubscriptions: {
            type: string;
            eventPath: string;
            dataPath: string;
            subscriptionPath: string;
        }[];
        valueSubscribers: {
            type: string;
            eventPath: string;
            dataPath: string;
            subscriptionPath: string;
        }[];
        hasValueSubscribers: boolean;
        indexes: (DataIndex & {
            _pathKeys: Array<string | number>;
        })[];
        keysFilter: string[];
    };
    /**
     * Wrapper for _writeNode, handles triggering change events, index updating.
     * @returns Returns a promise that resolves with an object that contains storage specific details,
     * plus the applied mutations if transaction logging is enabled
     */
    _writeNodeWithTracking(path: string, value: any, options?: Partial<{
        merge: boolean;
        transaction: unknown;
        tid: string | number;
        _customWriteFunction: () => any;
        waitForIndexUpdates: boolean;
        suppress_events: boolean;
        context: any;
        impact: ReturnType<Storage['getUpdateImpact']>;
        currentValue: any;
    }>): Promise<IWriteNodeResult>;
    /**
     * Enumerates all children of a given Node for reflection purposes
     * @param path
     * @param options optional options used by implementation for recursive calls
     * @returns returns a generator object that calls .next for each child until the .next callback returns false
     */
    getChildren(path: string, options?: {
        /**
         * specify the child keys to get callbacks for, skips .next callbacks for other keys
         */
        keyFilter?: string[] | number[];
        /**
         * optional transaction id for node locking purposes
         */
        tid?: string | number;
        /**
         * whether to use an async/await flow for each `.next` call
         */
        async?: boolean;
    }): {
        next: (callback: (child: NodeInfo) => boolean | void | Promise<boolean | void>) => Promise<boolean>;
    };
    /**
     * @deprecated Use `getNode` instead
     * Gets a node's value by delegating to getNode, returning only the value
     * @param path
     * @param options optional options that can limit the amount of (sub)data being loaded, and any other implementation specific options for recusrsive calls
     */
    getNodeValue(path: string, options?: InternalDataRetrievalOptions): Promise<any>;
    /**
     * Gets a node's value and (if supported) revision
     * @param path
     * @param options optional options that can limit the amount of (sub)data being loaded, and any other implementation specific options for recusrsive calls
     */
    getNode(path: string, options?: InternalDataRetrievalOptions): Promise<{
        revision?: string;
        value: any;
        cursor?: string;
    }>;
    /**
     * Retrieves info about a node (existence, wherabouts etc)
     * @param {string} path
     * @param {object} [options] optional options used by implementation for recursive calls
     */
    getNodeInfo(path: string, options?: Partial<{
        /**
         * optional transaction id for node locking purposes
         */
        tid: string | number;
        /**
         * transaction as implemented by sqlite/mssql storage
         */
        transaction: unknown;
        /**
         * whether to include child count if node is an object or array
         * @default false
         */
        include_child_count: boolean;
    }>): Promise<NodeInfo>;
    /**
     * Creates or overwrites a node. Delegates to updateNode on a parent if
     * path is not the root.
     * @param path
     * @param value
     * @param options optional options used by implementation for recursive calls
     * @returns Returns a new cursor if transaction logging is enabled
     */
    setNode(path: string, value: any, options: Partial<{
        /**
         * optional transaction id for node locking purposes
         */
        tid: string;
        /**
         * context info used by the client
         */
        context: object;
        /**
         * used internally
         */
        assert_revision: string;
        /**
         * Whether to supress any value events from firing
         */
        suppress_events: boolean;
    }>): Promise<string | void>;
    /**
     * Updates a node by merging an existing node with passed updates object,
     * or creates it by delegating to updateNode on the parent path.
     * @param path
     * @param updates object with key/value pairs
     * @returns Returns a new cursor if transaction logging is enabled
     */
    updateNode(path: string, updates: object, options: Partial<{
        /**
         * optional transaction id for node locking purposes
         */
        tid: string;
        /**
         * context info used by the client
         */
        context: object;
        /**
         * used internally
         */
        assert_revision: string;
        /**
         * Whether to supress any value events from firing
         */
        suppress_events: boolean;
    }>): Promise<string | void>;
    /**
     * Updates a node by getting its value, running a callback function that transforms
     * the current value and returns the new value to be stored. Assures the read value
     * does not change while the callback runs, or runs the callback again if it did.
     * @param path
     * @param callback function that transforms current value and returns the new value to be stored. Can return a Promise
     * @param options optional options used by implementation for recursive calls
     * @returns Returns a new cursor if transaction logging is enabled
     */
    transactNode(path: string, callback: (value: any) => any, options?: Partial<{
        /**
         * optional transaction id for node locking purposes
         */
        tid: string;
        /**
         * whether to suppress the execution of event subscriptions
         * @default false
         */
        suppress_events: boolean;
        /**
         * context info used by the client
         */
        context: object;
        no_lock: boolean;
    }>): Promise<string | void>;
    /**
     * Checks if a node's value matches the passed criteria
     * @param path
     * @param criteria criteria to test
     * @param options optional options used by implementation for recursive calls
     * @returns returns a promise that resolves with a boolean indicating if it matched the criteria
     */
    matchNode(path: string, criteria: Array<{
        key: string | number;
        op: string;
        compare: any;
    }>, options?: {
        /**
         * optional transaction id for node locking purposes
         */
        tid?: string;
    }): Promise<boolean>;
    test(val: any, op: string, compare: any): any;
    /**
     * Export a specific path's data to a stream
     * @param path
     * @param write function that writes to a stream, or stream object that has a write method that (optionally) returns a promise the export needs to wait for before continuing
     * @returns returns a promise that resolves once all data is exported
     */
    exportNode(path: string, writeFn: ((str: string) => void | Promise<void>) | {
        write(str: string): void | Promise<void>;
    }, options?: {
        format: string;
        type_safe: boolean;
    }): Promise<void>;
    /**
     * Import a specific path's data from a stream
     * @param path
     * @param read read function that streams a new chunk of data
     * @returns returns a promise that resolves once all data is imported
     */
    importNode(path: string, read: (bytes: number) => string | Utils.TypedArrayLike | Promise<string | Utils.TypedArrayLike>, options?: Partial<{
        format: 'json';
        /**
        * How to store the imported data: 'set' and 'update' will use the same logic as when calling 'set' or 'update' on the target,
        * 'merge' will do something special: it will use 'update' logic on all nested child objects:
        * consider existing data `{ users: { ewout: { name: 'Ewout Stortenbeker', age: 42 } } }`:
        * importing `{ users: { ewout: { country: 'The Netherlands', age: 43 } } }` with `method: 'merge'` on the root node
        * will effectively add `country` and update `age` properties of "users/ewout", and keep all else the same.4
        * This method is extremely useful to replicate effective data changes to remote databases.
        */
        method: 'set' | 'update' | 'merge';
        suppress_events: boolean;
    }>): Promise<void>;
    /**
     * Adds, updates or removes a schema definition to validate node values before they are stored at the specified path
     * @param path target path to enforce the schema on, can include wildcards. Eg: 'users/*\/posts/*' or 'users/$uid/posts/$postid'
     * @param schema schema type definitions. When null value is passed, a previously set schema is removed.
     */
    setSchema(path: string, schema: string | object, warnOnly?: boolean): void;
    /**
     * Gets currently active schema definition for the specified path
     */
    getSchema(path: string): {
        path: string;
        schema: string | object;
        text: string;
    } | null;
    /**
     * Gets all currently active schema definitions
     */
    getSchemas(): {
        path: string;
        schema: string | object;
        text: string;
    }[];
    /**
     * Validates the schemas of the node being updated and its children
     * @param path path being written to
     * @param value the new value, or updates to current value
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
    validateSchema(path: string, value: any, options?: {
        /**
         * If an existing node is being updated (merged), this will only enforce schema rules set on properties being updated.
         */
        updates: boolean;
    }): ISchemaCheckResult;
}
//# sourceMappingURL=index.d.ts.map