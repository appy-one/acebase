import type { Storage } from '../storage';
import { BPlusTreeBuilder, BinaryBPlusTree, BlacklistingSearchOperator } from '../btree';
import { DataIndexOptions } from './options';
import { IndexableValue, IndexableValueOrArray, IndexMetaData, IndexRecordPointer } from './shared';
import { BinaryBPlusTreeTransactionOperation } from '../btree/binary-tree-transaction-operation';
import { IndexQueryResults } from './query-results';
export declare class DataIndex {
    protected storage: Storage;
    static KnownIndexTypes: Record<string, typeof DataIndex>;
    static get STATE(): {
        INIT: string;
        READY: string;
        BUILD: string;
        REBUILD: string;
        ERROR: string;
        REMOVED: string;
        CLOSED: string;
    };
    state: string;
    /**
     * Path of the index target, with all named variables replaced by wildcard characters (*)
     */
    path: string;
    /**
     * Indexed key name
     */
    key: string;
    caseSensitive: boolean;
    textLocale: string;
    textLocaleKey?: string;
    includeKeys: string[];
    indexMetadataKeys: string[];
    private _buildError;
    private _updateQueue;
    private _cache;
    private _cacheTimeoutSettings;
    private trees;
    private _idx?;
    private _fileName?;
    /**
     * Creates a new index
     */
    constructor(storage: Storage, path: string, key: string, options?: DataIndexOptions);
    get allMetadataKeys(): string[];
    setCacheTimeout(seconds: number, sliding?: boolean): void;
    cache(op: string, param: unknown, results?: any): any;
    delete(): Promise<void>;
    close(): Promise<void>;
    /**
     * Reads an existing index from a file
     * @param storage Used storage engine
     * @param fileName
     */
    static readFromFile(storage: Storage, fileName: string): Promise<DataIndex>;
    get type(): string;
    get fileName(): string;
    get description(): string;
    _getWildcardKeys(path: string): any[];
    _updateTree(path: string, oldValue: IndexableValue, newValue: IndexableValue, oldRecordPointer: IndexRecordPointer, newRecordPointer: IndexRecordPointer, metadata: IndexMetaData): Promise<void>;
    _rebuild(idx: {
        tree: BinaryBPlusTree;
        close(): Promise<void>;
        release(): void;
    }): Promise<void>;
    _processTreeOperations(path: string, operations: BinaryBPlusTreeTransactionOperation[]): Promise<void>;
    clearCache(forPath: string): void;
    _processUpdateQueue(): Promise<void>;
    handleRecordUpdate(path: string, oldValue: unknown, newValue: unknown, indexMetadata?: IndexMetaData): Promise<void>;
    _lock(mode?: string, timeout?: number): Promise<import("../thread-safe").ThreadSafeLock>;
    count(op: string, val: IndexableValueOrArray): Promise<any>;
    take(skip: number, take: number, options?: Partial<{
        ascending: boolean;
        metadataSort: Array<{
            key: string;
            ascending: boolean;
        }>;
    }>): Promise<any>;
    static get validOperators(): string[];
    get validOperators(): string[];
    query(op: BlacklistingSearchOperator): Promise<IndexQueryResults>;
    query(op: string, val: IndexableValueOrArray, options?: {
        /** previous results to filter upon */
        filter?: IndexQueryResults;
    }): Promise<IndexQueryResults>;
    build(options?: {
        addCallback?: (callback: (value: IndexableValue, recordPointer: IndexRecordPointer, metadata: IndexMetaData) => void, value: unknown, // unknown on purpose
        recordPointer: IndexRecordPointer, metadata?: IndexMetaData, env?: {
            path: string;
            wildcards: string[];
            key: string | number;
            locale: string;
        }) => void;
        valueTypes?: number[];
    }): Promise<this>;
    test(obj: unknown, op: string, val: unknown): void;
    private _getIndexHeaderBytes;
    private _writeIndexHeader;
    _writeIndex(builder: BPlusTreeBuilder): Promise<void>;
    _getTree(lockMode?: 'shared' | 'exclusive'): Promise<{
        tree: BinaryBPlusTree;
        /** Closes the index file, does not release the lock! */
        close: () => Promise<void>;
        /** Releases the acquired tree lock */
        release(): void;
    }>;
}
//# sourceMappingURL=data-index.d.ts.map