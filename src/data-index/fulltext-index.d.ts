import { DataIndex } from './data-index';
import { DataIndexOptions } from './options';
import { IndexQueryResults } from './query-results';
import { Storage } from '../storage';
import { BlacklistingSearchOperator } from '../btree';
declare class WordInfo {
    word: string;
    indexes: number[];
    sourceIndexes: number[];
    constructor(word: string, indexes: number[], sourceIndexes: number[]);
    get occurs(): number;
}
declare class TextInfo {
    static get locales(): {
        default: {
            pattern: string;
            flags: string;
        };
        en: {
            stoplist: string[];
        };
        get(locale: string): {
            pattern?: string;
            flags?: string;
            stoplist?: string[];
        };
    };
    locale: string;
    words: Map<string, WordInfo>;
    ignored: string[];
    getWordInfo(word: string): WordInfo;
    /**
     * Reconstructs an array of words in the order they were encountered
     */
    toSequence(): string[];
    /**
     * Returns all unique words in an array
     */
    toArray(): string[];
    get uniqueWordCount(): number;
    get wordCount(): number;
    constructor(text: string, options?: {
        /**
         * Set the text locale to accurately convert words to lowercase
         * @default "en"
         */
        locale?: string;
        /**
         * Overrides the default RegExp pattern used
         * @default "[\w']+"
         */
        pattern?: RegExp | string;
        /**
         * Add characters to the word detection regular expression. Useful to keep wildcards such as * and ? in query texts
         */
        includeChars?: string;
        /**
         * Overrides the default RegExp flags (`gmi`) used
         * @default "gmi"
         */
        flags?: string;
        /**
         * Optional callback functions that pre-processes the value before performing word splitting.
         */
        prepare?: (value: any, locale: string, keepChars: string) => string;
        /**
         * Optional callback function that is able to perform word stemming. Will be executed before performing criteria checks
         */
        stemming?: (word: string, locale: string) => string;
        /**
         * Minimum length of words to include
         * @default 1
         */
        minLength?: number;
        /**
         * Maximum length of words to include, should be increased if you expect words in your texts
         * like "antidisestablishmentarianism" (28), "floccinaucinihilipilification" (29) or "pneumonoultramicroscopicsilicovolcanoconiosis" (45)
         * @default 25
         */
        maxLength?: number;
        /**
         * Words to ignore. You can use a default stoplist from TextInfo.locales
         */
        blacklist?: string[];
        /**
         * Words to include even if they do not meet the min & maxLength criteria
         */
        whitelist?: string[];
        /**
         * Whether to use a default stoplist to blacklist words (if available for locale)
         * @default false
         */
        useStoplist?: boolean;
    });
}
export interface FullTextIndexOptions extends DataIndexOptions {
    /**
     * FullText configuration settings.
     * NOTE: these settings are not stored in the index file because they contain callback functions
     * that might not work after a (de)serializion cycle. Besides this, it is also better for security
     * reasons not to store executable code in index files!
     *
     * That means that in order to keep fulltext indexes working as intended, you will have to:
     *  - call `db.indexes.create` for fulltext indexes each time your app starts, even if the index exists already
     *  - rebuild the index if you change this config. (pass `rebuild: true` in the index options)
     */
    config?: {
        /**
         * callback function that prepares a text value for indexing.
         * Useful to perform any actions on the text before it is split into words, such as:
         *  - transforming compressed / encrypted data to strings
         *  - perform custom word stemming: allows you to replace strings like `I've` to `I have`
         * Important: do not remove any of the characters passed in `keepChars` (`"*?`)!
         */
        prepare?: (value: any, locale: string, keepChars?: string) => string;
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
         * @deprecated move to options.textLocaleKey
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
export interface FullTextContainsQueryOptions {
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
    get type(): string;
    getTextInfo(val: string, locale?: string): TextInfo;
    test(obj: any, op: 'fulltext:contains' | 'fulltext:!contains', val: string): boolean;
    handleRecordUpdate(path: string, oldValue: any, newValue: any): Promise<void>;
    build(): Promise<this>;
    static get validOperators(): string[];
    get validOperators(): string[];
    query(op: string | BlacklistingSearchOperator, val?: string, options?: any): Promise<IndexQueryResults>;
    /**
     *
     * @param op Operator to use, can be either "fulltext:contains" or "fulltext:!contains"
     * @param val Text to search for. Can include * and ? wildcards, OR's for combined searches, and "quotes" for phrase searches
     */
    contains(op: 'fulltext:contains' | 'fulltext:!contains', val: string, options?: FullTextContainsQueryOptions): Promise<IndexQueryResults>;
}
export {};
//# sourceMappingURL=fulltext-index.d.ts.map