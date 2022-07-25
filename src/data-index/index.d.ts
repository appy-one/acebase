import type { Storage } from '../storage';
import { BPlusTreeBuilder, BinaryBPlusTree, BlacklistingSearchOperator } from '../btree';
import { NodeEntryKeyType } from '../btree/entry-key-type';
import { LeafEntryRecordPointer } from '../btree/leaf-entry-recordpointer';
import { LeafEntryMetaData } from '../btree/leaf-entry-metadata';
import { BinaryBPlusTreeTransactionOperation } from '../btree/binary-tree-transaction-operation';
import { BPlusTreeLeafEntryValue } from '../btree/tree-leaf-entry-value';
declare type IndexableValue = NodeEntryKeyType;
declare type IndexableValueOrArray = IndexableValue | IndexableValue[];
declare type IndexRecordPointer = LeafEntryRecordPointer;
declare type IndexMetaData = LeafEntryMetaData;
declare type KnownIndexType = 'normal' | 'array' | 'fulltext' | 'geo';
interface DataIndexOptions {
    /**
     * if strings in the index should be indexed case-sensitive. defaults to `false`
     * @default false
     */
    caseSensitive?: boolean;
    /**
     * locale to use when comparing case insensitive string values. Can be a language code (`"nl"`, `"en"` etc), or LCID (`"en-us"`, `"en-au"` etc).
     * Defaults to English (`"en"`)
     * @default "en"
     */
    textLocale?: string;
    /**
     * To allow multiple languages to be indexed, you can specify the name of the key in the source records that contains the locale.
     * When this key is not present in the data, the specified textLocale will be used as default. Eg with textLocaleKey: 'locale',
     * 1 record might contain `{ text: 'Hello World', locale: 'en' }` (text will be indexed with English locale), and another
     * `{ text: 'Hallo Wereld', locale: 'nl' }` (Dutch locale)
     */
    textLocaleKey?: string;
    /**
     * Other keys' data to include in the index, for faster sorting topN (`.limit.order`) query results
     */
    include?: string[];
}
export declare class DataIndex {
    protected storage: Storage;
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
    protected indexMetadataKeys: string[];
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
    cache(op: string, param: unknown, results?: IndexQueryResults): IndexQueryResults;
    delete(): Promise<void>;
    close(): Promise<void>;
    /**
     * Reads an existing index from a file
     * @param storage Used storage engine
     * @param fileName
     */
    static readFromFile(storage: Storage, fileName: string): Promise<DataIndex>;
    get type(): KnownIndexType;
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
    _processUpdateQueue(): Promise<void>;
    handleRecordUpdate(path: string, oldValue: unknown, newValue: unknown, indexMetadata?: IndexMetaData): Promise<void>;
    _lock(mode?: string, timeout?: number): Promise<import("../thread-safe").ThreadSafeLock>;
    count(op: string, val: IndexableValueOrArray): Promise<number | IndexQueryResults>;
    take(skip: number, take: number, ascending: boolean): Promise<IndexQueryResults>;
    static get validOperators(): string[];
    get validOperators(): string[];
    query(op: BlacklistingSearchOperator): Promise<IndexQueryResults>;
    query(op: string, val: IndexableValueOrArray, options?: {
        /** previous results to filter upon */
        filter?: IndexQueryResults;
    }): Promise<IndexQueryResults>;
    build(options: {
        addCallback?: (callback: (key: string, recordPointer: IndexRecordPointer, metadata: IndexMetaData) => void, value: unknown, // unknown on purpose
        recordPointer: IndexRecordPointer, metadata?: IndexMetaData, env?: {
            path: string;
            wildcards: string[];
            key: string;
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
declare class IndexQueryResult {
    key: string | number;
    path: string;
    value: IndexableValue;
    metadata: IndexMetaData;
    values: BPlusTreeLeafEntryValue[];
    constructor(key: string | number, path: string, value: IndexableValue, metadata: IndexMetaData);
}
declare class IndexQueryResults extends Array<IndexQueryResult> {
    static from(results: IndexQueryResults | IndexQueryResult[], filterKey: string): IndexQueryResults;
    values: BPlusTreeLeafEntryValue[];
    hints: IndexQueryHint[];
    stats: IndexQueryStats;
    private _filterKey;
    set filterKey(key: string);
    get filterKey(): string;
    filterMetadata(key: string, op: string, compare: IndexableValueOrArray): IndexQueryResults;
    constructor(length: number);
    constructor(...results: IndexQueryResult[]);
}
declare class IndexQueryStats {
    type: string;
    args: unknown;
    started: number;
    stopped: number;
    steps: IndexQueryStats[];
    result: any;
    /**
     * Used by GeoIndex: amount of queries executed to get results
     */
    queries: number;
    constructor(type: string, args: unknown, start?: boolean);
    start(): void;
    stop(result?: any): void;
    get duration(): number;
}
/**
 * An array index allows all values in an array node to be indexed and searched
 */
export declare class ArrayIndex extends DataIndex {
    constructor(storage: Storage, path: string, key: string, options: DataIndexOptions);
    get type(): KnownIndexType;
    handleRecordUpdate(path: string, oldValue: unknown, newValue: unknown): Promise<void>;
    build(): Promise<this>;
    static get validOperators(): string[];
    get validOperators(): string[];
    /**
     * @param op "contains" or "!contains"
     * @param val value to search for
     */
    query(op: 'contains' | '!contains', val: IndexableValueOrArray): Promise<IndexQueryResults>;
}
export interface FullTextIndexOptions extends DataIndexOptions {
    config?: {
        /**
         * callback function that transforms (or filters) words being indexed
         */
        transform?: (word: string, locale: string) => string;
        /**
         * words to be ignored
         */
        blacklist?: string[];
        /**
         * Uses a locale specific stoplist to automatically blacklist words
         * @default true
         */
        useStoplist?: boolean;
        /**
         * Words to be included if they did not match other criteria
         */
        whitelist?: string[];
        /**
         * Uses the value of a specific key as locale. Allows different languages to be indexed correctly,
         * overrides options.textLocale
         */
        localeKey?: string;
        /**
         * Minimum length for words to be indexed (after transform)
         */
        minLength?: number;
        /**
         * Maximum length for words to be indexed (after transform)
         */
        maxLength?: number;
    };
}
/**
 * A full text index allows all words in text nodes to be indexed and searched.
 * Eg: "Every word in this text must be indexed." will be indexed with every word
 * and can be queried with filters 'contains' and '!contains' a word, words or pattern.
 * Eg: 'contains "text"', 'contains "text indexed"', 'contains "text in*"' will all match the text above.
 * This does not use a thesauris or word lists (yet), so 'contains "query"' will not match.
 * Each word will be stored and searched in lowercase
 */
export declare class FullTextIndex extends DataIndex {
    config: FullTextIndexOptions['config'];
    constructor(storage: Storage, path: string, key: string, options: FullTextIndexOptions);
    get type(): KnownIndexType;
    test(obj: any, op: 'fulltext:contains' | 'fulltext:!contains', val: string): boolean;
    handleRecordUpdate(path: string, oldValue: unknown, newValue: unknown): Promise<void>;
    build(): Promise<this>;
    static get validOperators(): string[];
    get validOperators(): string[];
    /**
     *
     * @param op Operator to use, can be either "fulltext:contains" or "fulltext:!contains"
     * @param val Text to search for. Can include * and ? wildcards, OR's for combined searches, and "quotes" for phrase searches
     */
    query(op: string, val: string, options?: {
        /**
         * Locale to use for the words in the query. When omitted, the default index locale is used
         */
        locale?: string;
        /**
         *  Used internally: treats the words in val as a phrase, eg: "word1 word2 word3": words need to occur in this exact order
         */
        phrase?: boolean;
        /**
         * Sets minimum amount of characters that have to be used for wildcard (sub)queries such as "a%" to guard the
         * system against extremely large result sets. Length does not include the wildcard characters itself. Default
         * value is 2 (allows "an*" but blocks "a*")
         * @default 2
         */
        minimumWildcardWordLength?: number;
    }): Promise<IndexQueryResults>;
}
export declare class GeoIndex extends DataIndex {
    constructor(storage: Storage, path: string, key: string, options: DataIndexOptions);
    get type(): KnownIndexType;
    handleRecordUpdate(path: string, oldValue: unknown, newValue: unknown): Promise<void>;
    build(): Promise<this>;
    static get validOperators(): string[];
    get validOperators(): string[];
    test(obj: any, op: 'geo:nearby', val: {
        lat: number;
        long: number;
        radius: number;
    }): boolean;
    /**
     * @param op Only 'geo:nearby' is supported at the moment
     */
    query(op: 'geo:nearby', val: {
        /**
         * nearby query center latitude
         */
        lat: number;
        /**
         * nearby query center longitude
         */
        long: number;
        /**
         * nearby query radius in meters
         */
        radius: number;
    }): Promise<IndexQueryResults>;
}
declare class IndexQueryHint {
    type: string;
    value: unknown;
    constructor(type: string, value: unknown);
}
export {};
