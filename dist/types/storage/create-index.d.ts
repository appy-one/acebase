import { DataIndex } from '../data-index';
import { IndexesContext } from './context';
export interface CreateIndexOptions {
    rebuild?: boolean;
    /**
     * special index to create: 'array', 'fulltext' or 'geo'
     */
    type?: 'normal' | 'array' | 'fulltext' | 'geo';
    /**
     * keys to include with the indexed values. Can be used to speed up results sorting and
     * to quickly apply additional filters.
     */
    include?: string[];
    /**
     * Specifies whether texts should be indexed using case sensitivity. Setting this to `true`
     * will cause words with mixed casings (eg "word", "Word" and "WORD") to be indexed separately.
     * Default is `false`
     * @default false
     */
    caseSensitive?: boolean;
    /**
     * Specifies the default locale of indexed texts. Used to convert indexed strings
     * to lowercase if `caseSensitive` is set to `true`.
     * Should be a 2-character language code such as "en" for English and "nl" for Dutch,
     * or an LCID string for country specific locales such as "en-us" for American English,
     * "en-gb" for British English, etc
     */
    textLocale?: string;
    /**
     * Specifies a key in the source data that contains the locale to use
     * instead of the default specified in `textLocale`
     */
    textLocaleKey?: string;
    /**
     * additional index-specific configuration settings
     */
    config?: any;
}
/**
* Creates an index on specified path and key(s)
* @param path location of objects to be indexed. Eg: "users" to index all children of the "users" node; or "chats/*\/members" to index all members of all chats
* @param key for now - one key to index. Once our B+tree implementation supports nested trees, we can allow multiple fields
*/
export declare function createIndex(context: IndexesContext, path: string, key: string, options: CreateIndexOptions): Promise<DataIndex>;
//# sourceMappingURL=create-index.d.ts.map