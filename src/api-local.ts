import { AceBaseBase, IStreamLike, Api, EventSubscriptionCallback,
    ReflectionType, IReflectionNodeInfo, IReflectionChildrenInfo,
    StreamReadFunction, StreamWriteFunction, TransactionLogFilter,
    LoggingLevel, Query, QueryOptions, LoggerPlugin } from 'acebase-core';
import { AceBaseStorage, AceBaseStorageSettings } from './storage/binary';
import { SQLiteStorage, SQLiteStorageSettings } from './storage/sqlite';
import { MSSQLStorage, MSSQLStorageSettings } from './storage/mssql';
import { CustomStorage, CustomStorageSettings } from './storage/custom';
import { VALUE_TYPES } from './node-value-types';
import { executeQuery } from './query';
import { Storage, StorageEnv } from './storage';
import { CreateIndexOptions } from './storage/indexes';
import type { BinaryNodeAddress } from './storage/binary/node-address';
import { AceBaseLocalSettings } from '.';
import { NodeNotFoundError } from './node-errors';

export class LocalApi extends Api {
    // All api methods for local database instance
    public db: AceBaseBase;
    public storage: Storage;
    public logLevel: LoggingLevel;
    public logger: LoggerPlugin;

    constructor(dbname = 'default', init: { db: AceBaseBase, settings: AceBaseLocalSettings }, readyCallback: () => any) {
        super();
        this.db = init.db;
        this.logger = init.db.logger;

        const storageEnv: StorageEnv = { logLevel: init.settings.logLevel, logColors: init.settings.logColors, logger: init.settings.logger };
        if (typeof init.settings.storage === 'object') {
            // settings.storage.logLevel = settings.logLevel;
            if (SQLiteStorageSettings && (init.settings.storage instanceof SQLiteStorageSettings)) { //  || env.settings.storage.type === 'sqlite'
                this.storage = new SQLiteStorage(dbname, init.settings.storage, storageEnv);
            }
            else if (MSSQLStorageSettings && (init.settings.storage instanceof MSSQLStorageSettings)) { //  || env.settings.storage.type === 'mssql'
                this.storage = new MSSQLStorage(dbname, init.settings.storage, storageEnv);
            }
            else if (CustomStorageSettings && (init.settings.storage instanceof CustomStorageSettings)) { //  || settings.storage.type === 'custom'
                this.storage = new CustomStorage(dbname, init.settings.storage as CustomStorageSettings, storageEnv);
            }
            else {
                const storageSettings = init.settings.storage instanceof AceBaseStorageSettings
                    ? init.settings.storage
                    : new AceBaseStorageSettings(init.settings.storage as AceBaseStorageSettings);
                this.storage = new AceBaseStorage(dbname, storageSettings, storageEnv);
            }
        }
        else {
            this.storage = new AceBaseStorage(dbname, new AceBaseStorageSettings(), storageEnv);
        }
        this.storage.on('ready', readyCallback);
    }

    async stats(options?: any) {
        return this.storage.stats;
    }

    subscribe(path: string, event: string, callback: EventSubscriptionCallback) {
        this.storage.subscriptions.add(path, event, callback);
    }

    unsubscribe(path: string, event?: string, callback?: EventSubscriptionCallback) {
        this.storage.subscriptions.remove(path, event, callback);
    }

    /**
     * Creates a new node or overwrites an existing node
     * @param path
     * @param value Any value will do. If the value is small enough to be stored in a parent record, it will take care of it
     * @returns returns a promise with the new cursor (if transaction logging is enabled)
     */
    async set(path: string, value: any, options: {
        /**
         * whether to suppress the execution of event subscriptions
         * @default false
         */
        suppress_events?: boolean;
        /**
         * Context to be passed along with data events
         * @default null
         */
        context?: any;
    } = {
        suppress_events: false,
        context: null,
    }) {
        const cursor = await this.storage.setNode(path, value, { suppress_events: options.suppress_events, context: options.context });
        return { ...(cursor && { cursor }) };
    }

    /**
     * Updates an existing node, or creates a new node.
     * @returns returns a promise with the new cursor (if transaction logging is enabled)
     */
    async update(path: string, updates: any, options: {
        /**
         * whether to suppress the execution of event subscriptions
         * @default false
         */
        suppress_events?: boolean;
        /**
         * Context to be passed along with data events
         * @default null
         */
        context?: any;
    } = {
        suppress_events: false,
        context: null,
    }) {
        const cursor = await this.storage.updateNode(path, updates, { suppress_events: options.suppress_events, context: options.context });
        return { ...(cursor && { cursor }) };
    }

    get transactionLoggingEnabled() {
        return this.storage.settings.transactions && this.storage.settings.transactions.log === true;
    }

    /**
     * Gets the value of a node
     * @param options when omitted retrieves all nested data. If `include` is set to an array of keys it will only return those children.
     * If `exclude` is set to an array of keys, those values will not be included
     */
    async get(path: string, options?: {
        /**
         * child keys (properties) to include
         */
        include?: string[];
        /**
         * chld keys (properties) to exclude
         */
        exclude?: string[];
        /**
         * whether to include child objects
         */
        child_objects?: boolean;
    }) {
        if (!options) { options = {}; }
        if (typeof options.include !== 'undefined' && !(options.include instanceof Array)) {
            throw new TypeError(`options.include must be an array of key names`);
        }
        if (typeof options.exclude !== 'undefined' && !(options.exclude instanceof Array)) {
            throw new TypeError(`options.exclude must be an array of key names`);
        }
        if (['undefined','boolean'].indexOf(typeof options.child_objects) < 0) {
            throw new TypeError(`options.child_objects must be a boolean`);
        }
        const node = await this.storage.getNode(path, options);
        return { value: node.value, context: { acebase_cursor: node.cursor }, cursor: node.cursor };
    }

    /**
     * Performs a transaction on a Node
     * @param path
     * @param callback callback is called with the current value. The returned value (or promise) will be used as the new value. When the callbacks returns undefined, the transaction will be canceled. When callback returns null, the node will be removed.
     * @returns returns a promise with the new cursor (if transaction logging is enabled)
     */
    async transaction(path: string, callback: (currentValue: any) => Promise<any>, options: {
        /**
         * whether to suppress the execution of event subscriptions
         * @default false
         */
        suppress_events?: boolean;
        /**
         * Context to be passed along with data events
         * @default null
         */
        context?: any;
    } = {
        suppress_events: false,
        context: null,
    }) {
        const cursor = await this.storage.transactNode(path, callback, { suppress_events: options.suppress_events, context: options.context });
        return { ...(cursor && { cursor }) };
    }

    async exists(path: string) {
        const nodeInfo = await this.storage.getNodeInfo(path);
        return nodeInfo.exists;
    }

    // query2(path, query, options = { snapshots: false, include: undefined, exclude: undefined, child_objects: undefined }) {
    //     /*

    //     Now that we're using indexes to filter data and order upon, each query requires a different strategy
    //     to get the results the quickest.

    //     So, we'll analyze the query first, build a strategy and then execute the strategy

    //     Analyze stage:
    //     - what path is being queried (wildcard path or single parent)
    //     - which indexes are available for the path
    //     - which indexes can be used for filtering
    //     - which indexes can be used for sorting
    //     - is take/skip used to limit the result set

    //     Strategy stage:
    //     - chain index filtering
    //     - ....

    //     TODO!
    //     */
    // }

    /**
     * @returns Returns a promise that resolves with matching data or paths in `results`
     */
    async query(path: string, query: Query, options: QueryOptions = { snapshots: false }): ReturnType<Api['query']> {
        const results = await executeQuery(this, path, query, options);
        return results;
    }

    /**
     * Creates an index on key for all child nodes at path
     */
    createIndex(path: string, key: string, options: CreateIndexOptions) {
        return this.storage.indexes.create(path, key, options);
    }

    /**
     * Gets all indexes
     */
    async getIndexes() {
        return this.storage.indexes.list();
    }

    /**
     * Deletes an existing index from the database
     */
    async deleteIndex(filePath: string) {
        return this.storage.indexes.delete(filePath);
    }

    reflect(path: string, type: 'children', args: any): Promise<IReflectionChildrenInfo>;
    reflect(path: string, type: 'info', args: any): Promise<IReflectionNodeInfo>;
    async reflect(path: string, type: ReflectionType, args: any): Promise<IReflectionNodeInfo | IReflectionChildrenInfo> {
        args = args || {};
        const getChildren = async (path: string, limit = 50, skip = 0, from: string = null) => {
            if (typeof limit === 'string') { limit = parseInt(limit); }
            if (typeof skip === 'string') { skip = parseInt(skip); }
            if (['null','undefined'].includes(from)) { from = null; }
            const children = [] as IReflectionChildrenInfo['list']; // Array<{ key: string | number; type: string; value: any; address?: any }>;
            let n = 0, stop = false, more = false; //stop = skip + limit,
            await this.storage.getChildren(path)
                .next(childInfo => {
                    if (stop) {
                        // Stop 1 child too late on purpose to make sure there's more
                        more = true;
                        return false; // Stop iterating
                    }
                    n++;
                    const include = from !== null ? childInfo.key > from : skip === 0 || n > skip;
                    if (include) {
                        children.push({
                            key: typeof childInfo.key === 'string' ? childInfo.key : childInfo.index,
                            type: childInfo.valueTypeName,
                            value: childInfo.value,
                            // address is now only added when storage is acebase. Not when eg sqlite, mssql
                            ...(typeof childInfo.address === 'object' && 'pageNr' in childInfo.address && {
                                address: {
                                    pageNr: (childInfo.address as BinaryNodeAddress).pageNr,
                                    recordNr: (childInfo.address as BinaryNodeAddress).recordNr,
                                },
                            }),
                        });
                    }
                    stop = limit > 0 && children.length === limit; // flag, but don't stop now. Otherwise we won't know if there's more
                })
                .catch(err => {
                    // Node doesn't exist? No children..
                    if (!(err instanceof NodeNotFoundError)) {
                        throw err;
                    }
                });
            return {
                more,
                list: children,
            } as IReflectionChildrenInfo;
        };
        switch(type) {
            case 'children': {
                const result: IReflectionChildrenInfo = await getChildren(path, args.limit, args.skip, args.from);
                return result;
            }
            case 'info': {
                const info: IReflectionNodeInfo = {
                    key: '' as string | number,
                    exists: false,
                    type: 'unknown',
                    value: undefined as any,
                    address: undefined as any,
                    children: {
                        count: 0,
                        more: false,
                        list: [],
                    },
                };
                const nodeInfo = await this.storage.getNodeInfo(path, { include_child_count: args.child_count === true });
                info.key = typeof nodeInfo.key !== 'undefined' ? nodeInfo.key : nodeInfo.index;
                info.exists = nodeInfo.exists;
                info.type = nodeInfo.exists ? nodeInfo.valueTypeName : undefined;
                info.value = nodeInfo.value;
                info.address = typeof nodeInfo.address === 'object' && 'pageNr' in nodeInfo.address
                    ? {
                        pageNr: (nodeInfo.address as BinaryNodeAddress).pageNr,
                        recordNr: (nodeInfo.address as BinaryNodeAddress).recordNr,
                    }
                    : undefined;
                const isObjectOrArray = nodeInfo.exists && nodeInfo.address && ([VALUE_TYPES.OBJECT, VALUE_TYPES.ARRAY] as number[]).includes(nodeInfo.type);
                if (args.child_count === true) {
                    // set child count instead of enumerating
                    info.children = { count: isObjectOrArray ? nodeInfo.childCount : 0 };
                }
                else if (typeof args.child_limit === 'number' && args.child_limit > 0) {
                    if (isObjectOrArray) {
                        info.children = await getChildren(path, args.child_limit, args.child_skip, args.child_from);
                    }
                }
                return info;
            }
        }
    }

    export(path: string, stream: StreamWriteFunction | IStreamLike, options: {
        format: string;
        type_safe: boolean;
    } = {
        format: 'json',
        type_safe: true,
    }) {
        return this.storage.exportNode(path, stream, options);
    }

    import(path: string, read: StreamReadFunction, options: {
        format: 'json';
        suppress_events: boolean;
        method: 'set' | 'update' | 'merge';
    } = {
        format: 'json',
        suppress_events: false,
        method: 'set',
    }) {
        return this.storage.importNode(path, read, options);
    }

    async setSchema(path: string, schema: Record<string, any> | string, warnOnly = false) {
        return this.storage.setSchema(path, schema, warnOnly);
    }

    async getSchema(path: string) {
        return this.storage.getSchema(path);
    }

    async getSchemas() {
        return this.storage.getSchemas();
    }

    async validateSchema(path: string, value: any, isUpdate: boolean) {
        return this.storage.validateSchema(path, value, { updates: isUpdate });
    }

    /**
     * Gets all relevant mutations for specific events on a path and since specified cursor
     */
    async getMutations(filter: TransactionLogFilter) {
        if (typeof (this.storage as AceBaseStorage).getMutations !== 'function') { throw new Error('Used storage type does not support getMutations'); }
        if (typeof filter !== 'object') { throw new Error('No filter specified'); }
        if (typeof (filter as any).cursor !== 'string' && typeof (filter as any).timestamp !== 'number') { throw new Error('No cursor or timestamp given'); }
        return (this.storage as AceBaseStorage).getMutations(filter);
    }

    /**
     * Gets all relevant effective changes for specific events on a path and since specified cursor
     */
    async getChanges(filter: TransactionLogFilter) {
        if (typeof (this.storage as AceBaseStorage).getChanges !== 'function') { throw new Error('Used storage type does not support getChanges'); }
        if (typeof filter !== 'object') { throw new Error('No filter specified'); }
        if (typeof (filter as any).cursor !== 'string' && typeof (filter as any).timestamp !== 'number') { throw new Error('No cursor or timestamp given'); }
        return (this.storage as AceBaseStorage).getChanges(filter);
    }
}
