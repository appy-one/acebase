import { AceBaseBase, IStreamLike, Api, EventSubscriptionCallback, IReflectionNodeInfo, IReflectionChildrenInfo, StreamReadFunction, StreamWriteFunction, TransactionLogFilter, LoggingLevel, Query, QueryOptions } from 'acebase-core';
import { Storage } from './storage';
import { CreateIndexOptions } from './storage/indexes';
import { AceBaseLocalSettings } from '.';
export declare class LocalApi extends Api {
    db: AceBaseBase;
    storage: Storage;
    logLevel: LoggingLevel;
    constructor(dbname: string, init: {
        db: AceBaseBase;
        settings: AceBaseLocalSettings;
    }, readyCallback: () => any);
    stats(options?: any): Promise<any>;
    subscribe(path: string, event: string, callback: EventSubscriptionCallback): void;
    unsubscribe(path: string, event?: string, callback?: EventSubscriptionCallback): void;
    /**
     * Creates a new node or overwrites an existing node
     * @param path
     * @param value Any value will do. If the value is small enough to be stored in a parent record, it will take care of it
     * @returns returns a promise with the new cursor (if transaction logging is enabled)
     */
    set(path: string, value: any, options?: {
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
    }): Promise<{
        cursor: string;
    }>;
    /**
     * Updates an existing node, or creates a new node.
     * @returns returns a promise with the new cursor (if transaction logging is enabled)
     */
    update(path: string, updates: any, options?: {
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
    }): Promise<{
        cursor: string;
    }>;
    get transactionLoggingEnabled(): boolean;
    /**
     * Gets the value of a node
     * @param options when omitted retrieves all nested data. If `include` is set to an array of keys it will only return those children.
     * If `exclude` is set to an array of keys, those values will not be included
     */
    get(path: string, options?: {
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
    }): Promise<{
        value: any;
        context: {
            acebase_cursor: string;
        };
        cursor: string;
    }>;
    /**
     * Performs a transaction on a Node
     * @param path
     * @param callback callback is called with the current value. The returned value (or promise) will be used as the new value. When the callbacks returns undefined, the transaction will be canceled. When callback returns null, the node will be removed.
     * @returns returns a promise with the new cursor (if transaction logging is enabled)
     */
    transaction(path: string, callback: (currentValue: any) => Promise<any>, options?: {
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
    }): Promise<{
        cursor: string;
    }>;
    exists(path: string): Promise<boolean>;
    /**
     * @returns Returns a promise that resolves with matching data or paths in `results`
     */
    query(path: string, query: Query, options?: QueryOptions): ReturnType<Api['query']>;
    /**
     * Creates an index on key for all child nodes at path
     */
    createIndex(path: string, key: string, options: CreateIndexOptions): Promise<import("./data-index").DataIndex>;
    /**
     * Gets all indexes
     */
    getIndexes(): Promise<import("./data-index").DataIndex[]>;
    /**
     * Deletes an existing index from the database
     */
    deleteIndex(filePath: string): Promise<void>;
    reflect(path: string, type: 'children', args: any): Promise<IReflectionChildrenInfo>;
    reflect(path: string, type: 'info', args: any): Promise<IReflectionNodeInfo>;
    export(path: string, stream: StreamWriteFunction | IStreamLike, options?: {
        format: string;
        type_safe: boolean;
    }): Promise<void>;
    import(path: string, read: StreamReadFunction, options?: {
        format: 'json';
        suppress_events: boolean;
        method: 'set' | 'update' | 'merge';
    }): Promise<void>;
    setSchema(path: string, schema: Record<string, any> | string, warnOnly?: boolean): Promise<void>;
    getSchema(path: string): Promise<{
        path: string;
        schema: string | object;
        text: string;
    }>;
    getSchemas(): Promise<{
        path: string;
        schema: string | object;
        text: string;
    }[]>;
    validateSchema(path: string, value: any, isUpdate: boolean): Promise<import("acebase-core").ISchemaCheckResult>;
    /**
     * Gets all relevant mutations for specific events on a path and since specified cursor
     */
    getMutations(filter: TransactionLogFilter): Promise<{
        used_cursor: string;
        new_cursor: string;
        mutations: {
            path: string;
            type: "set" | "update";
            value: any;
            context: any;
            id: string;
            timestamp: number;
            changes: import("./storage/binary").IAppliedMutations;
        }[];
    }>;
    /**
     * Gets all relevant effective changes for specific events on a path and since specified cursor
     */
    getChanges(filter: TransactionLogFilter): Promise<{
        used_cursor: string;
        new_cursor: string;
        changes: {
            path: string;
            type: "set" | "update";
            previous: any;
            value: any;
            context: any;
        }[];
    }>;
}
//# sourceMappingURL=api-local.d.ts.map