import * as acebasecore from 'acebase-core';

export class AceBase extends acebasecore.AceBaseBase {
    /**
     * 
     * @param {string} dbname | Name of the database to open or create
     * @param {AceBaseLocalSettings} options | 
     */
    constructor(dbname: string, options?: AceBaseLocalSettings);

    /**
     * Waits for the database to be ready before running your callback. Do this before performing any other actions on your database
     * @param {()=>void} [callback] (optional) callback function that is called when ready. You can also use the returned promise
     * @returns {Promise<void>} returns a promise that resolves when ready
     */
    ready(callback?: () => void): Promise<void>;

    /**
     * Closes the database 
     */
    close(): Promise<void>;

    /** 
     * Only available in browser context - Creates an AceBase database instance using IndexedDB as storage engine. Creates a dedicated IndexedDB instance.
     * @param dbname Name of the database
     * @param settings optional settings
     * @param settings.logLevel what level to use for logging to the console. Default is 'error'
     * @param settings.removeVoidProperties Whether to remove undefined property values of objects being stored, instead of throwing an error.
     * @param settings.maxInlineValueSize Maximum size of binary data/strings to store in parent object records. Larger values are stored in their own records. Default is 50.
     * @param settings.multipleTabs Whether to enable cross-tab synchronization
     * @param settings.cacheSeconds How many seconds to keep node info in memory, to speed up IndexedDB performance.
     * @param settings.lockTimeout timeout setting for read and write locks in seconds. Operations taking longer than this will be aborted. Default is 120 seconds.
     */
    static WithIndexedDB(name: string, settings?: { logLevel?: 'verbose'|'log'|'warn'|'error'; removeVoidProperties?: boolean; maxInlineValueSize?: number; multipleTabs?: boolean; cacheSeconds?: number; lockTimeout?: number }): AceBase;

    /**
     * Creates an AceBase database instance using LocalStorage or SessionStorage as storage engine. When running in non-browser environments, set
     * settings.provider to a custom LocalStorage provider, eg 'node-localstorage'
     * @param dbname Name of the database
     * @param settings optional settings
     * @param settings.logLevel what level to use for logging to the console
     * @param settings.temp whether to use sessionStorage instead of localStorage
     * @param settings.provider Alternate localStorage provider for running in non-browser environments. Eg using 'node-localstorage'
     * @param settings.removeVoidProperties Whether to remove undefined property values of objects being stored, instead of throwing an error.
     * @param settings.maxInlineValueSize Maximum size of binary data/strings to store in parent object records. Larger values are stored in their own records. Default is 50.
     * @param settings.multipleTabs Whether to enable cross-tab synchronization
     * @param settings.lockTimeout timeout setting for read and write locks in seconds. Operations taking longer than this will be aborted. Default is 120 seconds.
     */    
    static WithLocalStorage(dbname: string, settings: { logLevel?: 'verbose'|'log'|'warn'|'error', temp?: boolean, provider?: any, removeVoidProperties?: boolean, maxInlineValueSize?: number, multipleTabs?: boolean, lockTimeout?: number }): AceBase
}

export interface AceBaseLocalSettings {
    logLevel?: 'verbose'|'log'|'warn'|'error';
    storage?: StorageSettings;
    transactions?: TransactionLogSettings;
    ipc?: IPCClientSettings
}

export abstract class StorageSettings {
    maxInlineValueSize?: number;
    removeVoidProperties?: boolean;
    path?: string;
    /**@deprecated Moved to main settings */
    ipc?: IPCClientSettings
    lockTimeout?: number
}

export interface IPCClientSettings {
    /** IPC Server hostname. Default is "localhost" */
    host?: string
    /** IPC Server port */
    port: number
    /** IPC Server token needed to access the server. Only needed if the server does not use a token */
    token?: string
    /** Whether to use a secure connection to the IPC server, default is `false` */
    ssl?: boolean
    /** Role of the IPC Client. There can only be 1 `master`, all other need to be a `worker`. */
    role: 'master'|'worker'
}
export abstract class TransactionLogSettings {
    log?: boolean;
    maxAge?: number;
    noWait?: boolean;
}

export class AceBaseStorageSettings extends StorageSettings {
    constructor(settings: AceBaseStorageSettings);
    recordSize?: number;
    pageSize?: number;
}

export class SQLiteStorageSettings extends StorageSettings {
    constructor(settings: SQLiteStorageSettings);
}

export class MSSQLStorageSettings extends StorageSettings {
    constructor(settings: MSSQLStorageSettings);
    driver?: 'tedious'|'native';
    domain?: string;
    user?: string;
    password?: string;
    server?: string;
    port?: number;
    database?: string;
    encrypt?: boolean;
    appName?: string;
    connectionTimeout?: number;
    requestTimeout?: number;
    maxConnections?: number;
    minConnections?: number;
    idleTimeout?: number;
}

export class LocalStorageSettings extends StorageSettings {
    constructor(settings: LocalStorageSettings);
    session?: boolean;
    provider?: object;
}

export interface ICustomStorageNodeMetaData {
    /** cuid (time sortable revision id). Nodes stored in the same operation share this id */
    revision: string; 
    /** Number of revisions, starting with 1. Resets to 1 after deletion and recreation */
    revision_nr: number;
    /** Creation date/time in ms since epoch UTC */
    created: number;
    /** Last modification date/time in ms since epoch UTC */
    modified: number;
    /** Type of the node's value. 1=object, 2=array, 3=number, 4=boolean, 5=string, 6=date, 7=reserved, 8=binary, 9=reference */
    type: number;
}
export interface ICustomStorageNode extends ICustomStorageNodeMetaData {
    /** only Object, Array, large string and binary values */
    value: any
}

export abstract class CustomStorageTransaction {
    /**
     * @param target Which path the transaction is taking place on, and whether it is a read or read/write lock. If your storage backend does not support transactions, is synchronous, or if you are able to lock resources based on path: use storage.nodeLocker to ensure threadsafe transactions
     */
    constructor(target: { path: string, write: boolean });

    readonly target: { path: string, readonly originalPath: string, readonly write: boolean };

    /** Function that gets the node with given path from your custom data store, must return null if it doesn't exist */
    abstract get(path: string): Promise<ICustomStorageNode|null>;
    /** Function that inserts or updates a node with given path in your custom data store */
    abstract set(path: string, value: ICustomStorageNode): Promise<void>;
    /** Function that removes the node with given path from your custom data store */
    abstract remove(path: string): Promise<void>;
    
    /** 
     * Function that streams all stored nodes that are direct children of the given path. For path "parent/path", results must include paths such as "parent/path/key" AND "parent/path[0]". 👉🏻 You can use CustomStorageHelpers for logic. Keep calling the add callback for each node until it returns false. 
     * @param path Parent path to load children of
     * @param include 
     * @param include.metadata Whether metadata needs to be loaded
     * @param include.value  Whether value needs to be loaded
     * @param checkCallback callback method to precheck if child needs to be added, perform before loading metadata/value if possible
     * @param addCallback callback method that adds the child node. Returns whether or not to keep calling with more children
     * @returns Returns a promise that resolves when there are no more children to be streamed
     */
    abstract childrenOf(path: string, include: { value: boolean, metadata: boolean }, checkCallback: (childPath: string) => boolean, addCallback: (childPath: string, node?: ICustomStorageNodeMetaData|ICustomStorageNode) => boolean): Promise<any>;
    
    /** 
     * Function that streams all stored nodes that are descendants of the given path. For path "parent/path", results must include paths such as "parent/path/key", "parent/path/key/subkey", "parent/path[0]", "parent/path[12]/key" etc. 👉🏻 You can use CustomStorageHelpers for logic. Keep calling the add callback for each node until it returns false. 
     * @param path Parent path to load descendants of
     * @param include 
     * @param include.metadata Whether metadata needs to be loaded
     * @param include.value  Whether value needs to be loaded
     * @param checkCallback callback method to precheck if descendant needs to be added, perform before loading metadata/value if possible. NOTE: if include.metadata === true, you should load and pass the metadata to the checkCallback if doing so has no or small performance impact
     * @param addCallback callback method that adds the descendant node. Returns whether or not to keep calling with more children
     * @returns Returns a promise that resolves when there are no more descendants to be streamed
     */
    abstract descendantsOf(path: string, include: { value: boolean, metadata: boolean }, checkCallback: (descPath: string, metadata?: ICustomStorageNodeMetaData) => boolean, addCallback: (descPath: string, node?: ICustomStorageNodeMetaData|ICustomStorageNode) => boolean): Promise<any>;
    
    /**
     * (optional) Returns the number of children stored in their own records. Default implementation uses `childrenOf` to count, override if storage supports a quicker way. 
     * Eg: For SQL databases, you can implement this with a single query like `SELECT count(*) FROM nodes WHERE ${CustomStorageHelpers.ChildPathsSql(path)}`
     * @returns Returns a promise that resolves with the number of children
     */
    getChildCount(path: string): Promise<number>

    /** (optional, not used yet) Function that gets multiple nodes (metadata AND value) from your custom data store at once. Must return a Promise that resolves with Map<path,value> */
    getMultiple?(paths: string[]): Promise<Map<string, ICustomStorageNode|null>>;
    /** (optional, not used yet) Function that sets multiple nodes at once */
    setMultiple?(nodes: Array<{ path: string, node: ICustomStorageNode }>): Promise<void>;
    /** (optional) Function that removes multiple nodes from your custom data store at once */
    removeMultiple?(paths: string[]): Promise<void>;

    abstract commit(): Promise<void>;
    abstract rollback(reason: Error): Promise<void>;
}

/**
 * Allows data to be stored in a custom storage backend of your choice! Simply provide a couple of functions
 * to get, set and remove data and you're done.
 */
export class CustomStorageSettings extends StorageSettings {
    constructor(settings: CustomStorageSettings);
    /** Name of the custom storage adapter */
    name?: string;
    /** Whether default node locking should be used (default). Set to false if your storage backend disallows multiple simultanious write transactions (eg IndexedDB). Set to true if your storage backend does not support transactions (eg LocalStorage) or allows multiple simultanious write transactions (eg AceBase binary). */
    locking?: boolean;
    /** Function that returns a Promise that resolves once your data store backend is ready for use */
    ready(): Promise<any>;
    /**
     * Function that starts a transaction for read/write operations on a specific path and/or child paths
     * @param target target path and mode to start transaction on
     */
    getTransaction(target: { path: string, write: boolean }): Promise<CustomStorageTransaction>
}

export class CustomStorageHelpers {
    /**
     * Helper function that returns a SQL where clause for all children of given path
     * @param path Path to get children of
     * @param columnName Name of the Path column in your SQL db, default is 'path'
     * @returns Returns the SQL where clause
     */
    static ChildPathsSql(path:string, columnName?:string): string;
    /**
     * Helper function that returns a regular expression to test if paths are children of the given path
     * @param path Path to test children of
     * @returns Returns regular expression to test paths with
     */
    static ChildPathsRegex(path: string): RegExp;
    /**
     * Helper function that returns a SQL where clause for all descendants of given path
     * @param path Path to get descendants of
     * @param columnName Name of the Path column in your SQL db, default is 'path'
     * @returns Returns the SQL where clause
     */
    static DescendantPathsSql(path:string, columnName?:string): string;
    /**
     * Helper function that returns a regular expression to test if paths are descendants of the given path
     * @param path Path to test descendants of
     * @returns Returns regular expression to test paths with
     */
    static DescendantPathsRegex(path: string): RegExp;

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
    static readonly PathInfo: typeof acebasecore.PathInfo
}

export class SchemaValidationError extends Error {
    reason: string
}

export import DataSnapshot = acebasecore.DataSnapshot;
export import DataReference = acebasecore.DataReference;
export import DataSnapshotsArray = acebasecore.DataSnapshotsArray;
export import DataReferencesArray = acebasecore.DataReferencesArray;
export import EventStream = acebasecore.EventStream;
export import EventSubscription = acebasecore.EventSubscription;
export import PathReference = acebasecore.PathReference;
export import TypeMappings = acebasecore.TypeMappings;
export import TypeMappingOptions = acebasecore.TypeMappingOptions;
export import IReflectionNodeInfo = acebasecore.IReflectionNodeInfo;
export import IReflectionChildrenInfo = acebasecore.IReflectionChildrenInfo;
export import IStreamLike = acebasecore.IStreamLike;
export import ILiveDataProxy = acebasecore.ILiveDataProxy;
export import ILiveDataProxyValue = acebasecore.ILiveDataProxyValue;
export import IObjectCollection = acebasecore.IObjectCollection;
export import ObjectCollection = acebasecore.ObjectCollection;
export import ID = acebasecore.ID;
export import proxyAccess = acebasecore.proxyAccess;
export import PartialArray = acebasecore.PartialArray;