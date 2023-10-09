import { ColorStyle } from 'acebase-core';
import { DataIndex, ArrayIndex, FullTextIndex, GeoIndex } from '../data-index';
import { pfs } from '../promise-fs';
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
    config?: any
}

/**
* Creates an index on specified path and key(s)
* @param path location of objects to be indexed. Eg: "users" to index all children of the "users" node; or "chats/*\/members" to index all members of all chats
* @param key for now - one key to index. Once our B+tree implementation supports nested trees, we can allow multiple fields
*/
export async function createIndex(
    context: IndexesContext,
    path: string,
    key: string,
    options: CreateIndexOptions,
): Promise<DataIndex> {
    if (!context.storage.indexes.supported) {
        throw new Error('Indexes are not supported in current environment because it requires Node.js fs');
    }
    // path = path.replace(/\/\*$/, ""); // Remove optional trailing "/*"
    const { ipc, logger, indexes, storage } = context;

    const rebuild = options && options.rebuild === true;
    const indexType = (options && options.type) || 'normal';
    let includeKeys = (options && options.include) || [];
    if (typeof includeKeys === 'string') { includeKeys = [includeKeys]; }
    const existingIndex = indexes.find(index =>
        index.path === path && index.key === key && index.type === indexType
        && index.includeKeys.length === includeKeys.length
        && index.includeKeys.every((key, index) => includeKeys[index] === key),
    );

    if (existingIndex && options.config) {
        // Additional index config params are not saved to index files, apply them to the in-memory index now
        (existingIndex as any).config = options.config;
    }

    if (existingIndex && rebuild !== true) {
        logger.info(`Index on "/${path}/*/${key}" already exists`.colorize(ColorStyle.inverse));
        return existingIndex;
    }

    if (!ipc.isMaster) {
        // Pass create request to master
        const result = await ipc.sendRequest({ type: 'index.create', path, key, options });
        if (result.ok) {
            return storage.indexes.add(result.fileName);
        }
        throw new Error(result.reason);
    }

    await pfs.mkdir(`${storage.settings.path}/${storage.name}.acebase`).catch(err => {
        if (err.code !== 'EEXIST') {
            throw err;
        }
    });

    const index = existingIndex || (() => {
        const { include, caseSensitive, textLocale, textLocaleKey } = options;
        const indexOptions = { include, caseSensitive, textLocale, textLocaleKey };
        switch (indexType) {
            case 'array': return new ArrayIndex(storage, path, key, { ...indexOptions });
            case 'fulltext': return new FullTextIndex(storage, path, key, { ...indexOptions, config: options.config });
            case 'geo': return new GeoIndex(storage, path, key, { ...indexOptions });
            default: return new DataIndex(storage, path, key, { ...indexOptions });
        }
    })();
    if (!existingIndex) {
        indexes.push(index);
    }
    try {
        await index.build();
    }
    catch(err) {
        context.logger.error(`Index build on "/${path}/*/${key}" failed: ${err.message} (code: ${err.code})`.colorize(ColorStyle.red));
        if (!existingIndex) {
            // Only remove index if we added it. Build may have failed because someone tried creating the index more than once, or rebuilding it while it was building...
            indexes.splice(indexes.indexOf(index), 1);
        }
        throw err;
    }
    ipc.sendNotification({ type: 'index.created', fileName: index.fileName, path, key, options });
    return index;
}
