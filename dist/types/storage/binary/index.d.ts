/// <reference types="node" />
import { BinaryNodeAddress } from './node-address';
import { NodeCache } from '../../node-cache';
import { BinaryNodeInfo } from './node-info';
import { InternalDataRetrievalOptions, Storage, StorageEnv, StorageSettings } from '../index';
export interface IAppliedMutations {
    path: string;
    list: Array<{
        target: (string | number)[];
        prev: any;
        val: any;
    }>;
}
export declare class AceBaseStorageSettings extends StorageSettings {
    /**
     * record size in bytes, defaults to 128 (recommended). Max is 65536
     * @default 128
     */
    recordSize: number;
    /**
     * page size in records, defaults to 1024 (recommended). Max is 65536
     * @default 1024
     */
    pageSize: number;
    /**
     * type of database content. Determines the name of the file within the .acebase directory
     */
    type: 'data' | 'transaction' | 'auth';
    /**
     * settings to use for transaction logging
     */
    transactions: AceBaseTransactionLogSettings;
    /**
     * Use future FST version (not implemented yet)
     */
    fst2: boolean;
    constructor(settings?: Partial<AceBaseStorageSettings>);
}
declare class AceBaseTransactionLogSettings {
    /**
     * Whether transaction logging is enabled.
     * @default false
     */
    log: boolean;
    /**
     * Max age of transactions to keep in logfile. Set to 0 to disable cleaning up and keep all transactions
     * @default 30
     */
    maxAge: number;
    /**
     * Whether write operations wait for the transaction to be logged before resolving their promises.
     */
    noWait: boolean;
    /**
     * BETA functionality - logs mutations made to a separate database file so they can be retrieved later
     * for database syncing / replication. Implementing this into acebase itself will allow the current
     * sync implementation in acebase-client to become better: it can simply request a mutations stream from
     * the server after disconnects by passing a cursor or timestamp, instead of downloading whole nodes before
     * applying local changes. This will also enable horizontal scaling: replication with remote db instances
     * becomes possible.
     *
     * Still under development, disabled by default. See transaction-logs.spec for tests
     */
    constructor(settings?: Partial<AceBaseTransactionLogSettings>);
}
export declare class AceBaseStorage extends Storage {
    settings: AceBaseStorageSettings;
    stats: {
        writes: number;
        reads: number;
        bytesRead: number;
        bytesWritten: number;
    };
    type: AceBaseStorageSettings['type'];
    private txStorage?;
    private _ready;
    private file;
    nodeCache: NodeCache;
    /**
     * Stores data in a binary file
     */
    constructor(name: string, settings: AceBaseStorageSettings, env: StorageEnv);
    get isReady(): boolean;
    get fileName(): string;
    isLocked: (forUs?: boolean) => boolean;
    lock: (forUs?: boolean) => Promise<void>;
    unlock: () => Promise<void>;
    writeData(fileIndex: number, buffer: Buffer | ArrayBuffer | ArrayBufferView | Uint8Array, offset?: number, length?: number): Promise<number>;
    /**
     *
     * @param fileIndex Index of the file to read
     * @param buffer Buffer object, ArrayBuffer or TypedArray (Uint8Array, Int8Array, Uint16Array etc) to read data into
     * @param offset byte offset in the buffer to read data into, default is 0
     * @param length total bytes to read (if omitted or -1, it will use buffer.byteLength)
     * @returns returns the total bytes read
     */
    readData(fileIndex: number, buffer: Buffer | ArrayBuffer | ArrayBufferView, offset?: number, length?: number): Promise<number>;
    /**
     * The "Key Index Table" contains key names used in the database, so they can be referenced
     * with an index in the KIT instead of with its name. This saves space, improves performance,
     * and will allow quick key "property" renaming in the future.
     */
    KIT: {
        fileIndex: number;
        length: number;
        bytesUsed: number;
        keys: string[];
        /**
         * Gets a key's index, or attempts to add a new key to the KIT
         * @param {string} key | key to store in the KIT
         * @returns {number} | returns the index of the key in the KIT when successful, or -1 if the key could not be added
         */
        getOrAdd(key: string): number;
        write(): Promise<void>;
        load(): Promise<string[]>;
    };
    /**
     * The "Free Space Table" keeps track of areas in the db file that are available to
     * be allocated for storage.
     */
    FST: {
        readonly fileIndex: number;
        readonly length: number;
        readonly bytesUsed: number;
        readonly pages: number;
        readonly ranges: {
            page: number;
            start: number;
            end: number;
        }[];
        allocate(requiredRecords: number): Promise<StorageAddressRange[]>;
        release(ranges: StorageAddressRange[]): Promise<void>;
        sort(): void;
        write(updatedPageCount?: boolean): Promise<void>;
        load(): Promise<AceBaseStorage['FST']['ranges']>;
        readonly maxScraps: number;
    };
    rootRecord: {
        /** This is not necessarily the ROOT record, it's the FIRST record (which _is_ the root record at very start) */
        readonly fileIndex: number;
        readonly pageNr: number;
        readonly recordNr: number;
        readonly exists: boolean;
        readonly address: BinaryNodeAddress;
        /**
         * Updates the root node address
         * @param address
         * @param fromIPC whether this update comes from an IPC notification, prevent infinite loopbacks. Default is `false`
         */
        update(address: BinaryNodeAddress, fromIPC?: boolean): Promise<void>;
    };
    /**
     * Use this method to update cache, instead of through `this.nodeCache`
     * @param fromIPC Whether this update came from an IPC notification to prevent infinite loop
     * @param nodeInfo
     * @param hasMoved set to false when reading a record's children - not because the address is actually changing
     */
    updateCache(fromIPC: boolean, nodeInfo: BinaryNodeInfo, hasMoved?: boolean): void;
    invalidateCache(fromIPC: boolean, path: string, recursive: boolean | Record<string, 'delete' | 'invalidate'>, reason?: string): void;
    close(): Promise<void>;
    get pageByteSize(): number;
    getRecordFileIndex(pageNr: number, recordNr: number): number;
    /**
     * Repairs a broken record by removing the reference to it from the parent node. It does not overwrite the target record to prevent possibly breaking other data.
     * Example: repairNode('books/l74fm4sg000009jr1iyt93a5/reviews') will remove the reference to the 'reviews' record in 'books/l74fm4sg000009jr1iyt93a5'
     */
    repairNode(targetPath: string, options?: {
        /**
         * Included for testing purposes: whether to proceed if the target node does not appear broken.
         * @default false
         */
        ignoreIntact?: boolean;
        /**
         * Whether to mark the target as removed (getting its value will yield `"[[removed]]"`). Set to `false` to completely remove it.
         * @default true
         */
        markAsRemoved?: boolean;
    }): Promise<void>;
    /**
     * Repairs a broken B+Tree key index of an object collection. Use this if you are unable to load every child of an object collection.
     * @param path
     */
    repairNodeTree(path: string): Promise<void>;
    get transactionLoggingEnabled(): boolean;
    logMutation(type: 'set' | 'update', path: string, value: any, context: {
        acebase_cursor: string;
    }, mutations: IAppliedMutations): string | Promise<string>;
    /**
     * Gets all mutations from a given cursor or timestamp on a given path, or on multiple paths that are relevant for given events
     */
    getMutations(filter: {
        /**
         * cursor is a generated key (ID.generate) that represents a point of time
         */
        cursor?: string;
        /**
         * earliest transaction to include, will be converted to a cursor
         */
        timestamp?: number;
        /**
         * top-most paths to include. Can include wildcards to facilitate wildcard event listeners. Only used if `for` filter is not used, equivalent to `for: { path, events: ['value] }
         */
        path?: string;
        /**
         * Specifies which paths and events to get all relevant mutations for
         */
        for?: Array<{
            path: string;
            events: string[];
        }>;
    }): Promise<{
        used_cursor: string;
        new_cursor: string;
        mutations: Array<{
            path: string;
            type: 'set' | 'update';
            value: any;
            context: any;
            id: string;
            timestamp: number;
            changes: IAppliedMutations;
        }>;
    }>;
    /**
     * Gets all effective changes from a given cursor or timestamp on a given path, or on multiple paths that are relevant for given events.
     * Multiple mutations will be merged so the returned changes will not have their original updating contexts and order of the original timeline.
     */
    getChanges(filter: {
        /**
         * cursor is a generated key (ID.generate) that represents a point of time
         */
        cursor?: string;
        /**
         * earliest transaction to include, will be converted to a cursor
         */
        timestamp?: number;
        /**
         * top-most paths to include. Can include wildcards to facilitate wildcard event listeners. Only used if `for` filter is not used,
         * equivalent to `for: { path, events: ['value] }
         */
        path?: string;
        /**
         * Specifies which paths and events to get all relevant mutations for
         */
        for?: Array<{
            path: string;
            events: string[];
        }>;
    }): Promise<{
        used_cursor: string;
        new_cursor: string;
        changes: Array<{
            path: string;
            type: 'set' | 'update';
            previous: any;
            value: any;
            context: any;
        }>;
    }>;
    get oldestValidCursor(): string;
    /**
     * Enumerates all children of a given Node for reflection purposes
     * @param path
     * @param options optional options used by implementation for recursive calls
     * @returns returns a generator object that calls .next for each child until the .next callback returns false
     */
    getChildren(path: string, options?: {
        /** specify the child keys to get callbacks for, skips .next callbacks for other keys */
        keyFilter?: string[] | number[];
        /** optional transaction id for node locking purposes */
        tid?: string | number;
        /**
         * whether to use an async/await flow for each `.next` call
         * @default false
         */
        async?: boolean;
    }): {
        /**
         *
         * @param valueCallback callback function to run for each child. Return false to stop iterating
         * @returns returns a promise that resolves with a boolean indicating if all children have been enumerated, or was canceled by the valueCallback function
         */
        next(valueCallback: (child: BinaryNodeInfo) => boolean | void | Promise<boolean | void>, useAsync?: boolean): Promise<boolean>;
    };
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
     * @param path
     * @param options optional options used by implementation for recursive calls
     */
    getNodeInfo(path: string, options?: {
        /**
         * optional transaction id for node locking purposes
         */
        tid?: string | number;
        no_cache?: boolean;
        /**
         * whether to include child count if node is an object or array
         * @default false
         */
        include_child_count?: boolean;
        /**
         * whether to allow expansion of path references (follow "symbolic links")
         * @default false
         * */
        allow_expand?: boolean;
    }): Promise<BinaryNodeInfo>;
    /**
     * Delegates to legacy update method that handles everything
     * @param options optional options used by implementation for recursive calls
     * @returns Returns a new cursor if transaction logging is enabled
     */
    setNode(path: string, value: any, options?: {
        /** optional transaction id for node locking purposes */
        tid?: string | number;
        /**
         * whether to suppress the execution of event subscriptions
         * @default false
         * */
        suppress_events?: boolean;
        /** @default null */
        context?: any;
    }): Promise<string | void>;
    /**
     * Delegates to legacy update method that handles everything
     * @param options optional options used by implementation for recursive calls
     * @returns Returns a new cursor if transaction logging is enabled
     */
    updateNode(path: string, updates: any, options?: {
        /** optional transaction id for node locking purposes */
        tid?: string | number;
        /**
         * whether to suppress the execution of event subscriptions
         * @default false
         */
        suppress_events?: boolean;
        /**
         * @default null
         */
        context?: any;
    }): Promise<string | void>;
    /**
     * Updates or overwrite an existing node, or creates a new node. Handles storing of subnodes,
     * freeing old node and subnodes allocation, updating/creation of parent nodes, and removing
     * old cache entries. Triggers event notifications and index updates after the update succeeds.
     *
     * @param path
     * @param value object with key/value pairs
     * @param options optional options used by implementation for recursive calls
     * @returns If transaction logging is enabled, returns a promise that resolves with the applied mutations
     */
    _updateNode(path: string, value: any, options?: {
        /** @default true */
        merge?: boolean;
        /** optional transaction id for node locking purposes */
        tid?: string | number;
        /**
         * whether to suppress the execution of event subscriptions
         * @default false
         */
        suppress_events?: boolean;
        /** @default null */
        context?: any;
        /** @default false */
        _internal?: boolean;
    }): Promise<IAppliedMutations>;
}
declare class StorageAddressRange {
    pageNr: number;
    recordNr: number;
    length: number;
    constructor(pageNr: number, recordNr: number, length: number);
}
export {};
//# sourceMappingURL=index.d.ts.map