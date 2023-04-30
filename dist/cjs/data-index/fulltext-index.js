"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FullTextIndex = void 0;
const data_index_1 = require("./data-index");
const query_results_1 = require("./query-results");
const node_value_types_1 = require("../node-value-types");
const btree_1 = require("../btree");
const query_stats_1 = require("./query-stats");
const fulltext_index_query_hint_1 = require("./fulltext-index-query-hint");
const unidecode_1 = require("../unidecode");
const assert_1 = require("../assert");
class WordInfo {
    constructor(word, indexes, sourceIndexes) {
        this.word = word;
        this.indexes = indexes;
        this.sourceIndexes = sourceIndexes;
    }
    get occurs() {
        return this.indexes.length;
    }
}
// const _wordsRegex = /[\w']+/gmi; // TODO: should use a better pattern that supports non-latin characters
class TextInfo {
    static get locales() {
        return {
            'default': {
                pattern: '[A-Za-z0-9\']+',
                flags: 'gmi',
            },
            'en': {
                // English stoplist from https://gist.github.com/sebleier/554280
                stoplist: ['i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', 'your', 'yours', 'yourself', 'yourselves', 'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself', 'it', 'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves', 'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those', 'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing', 'a', 'an', 'the', 'and', 'but', 'if', 'or', 'because', 'as', 'until', 'while', 'of', 'at', 'by', 'for', 'with', 'about', 'against', 'between', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'to', 'from', 'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 's', 't', 'can', 'will', 'just', 'don', 'should', 'now'],
            },
            get(locale) {
                const settings = {};
                Object.assign(settings, this.default);
                if (typeof this[locale] === 'undefined' && locale.indexOf('-') > 0) {
                    locale = locale.split('-')[1];
                }
                if (typeof this[locale] === 'undefined') {
                    return settings;
                }
                Object.keys(this[locale]).forEach(key => {
                    settings[key] = this[locale][key];
                });
                return settings;
            },
        };
    }
    getWordInfo(word) {
        return this.words.get(word);
    }
    /**
     * Reconstructs an array of words in the order they were encountered
     */
    toSequence() {
        const arr = [];
        for (const { word, indexes } of this.words.values()) {
            for (const index of indexes) {
                arr[index] = word;
            }
        }
        return arr;
    }
    /**
     * Returns all unique words in an array
     */
    toArray() {
        const arr = [];
        for (const word of this.words.keys()) {
            arr.push(word);
        }
        return arr;
    }
    get uniqueWordCount() {
        return this.words.size; //.length;
    }
    get wordCount() {
        let total = 0;
        for (const wordInfo of this.words.values()) {
            total += wordInfo.occurs;
        }
        return total;
        // return this.words.reduce((total, word) => total + word.occurs, 0);
    }
    constructor(text, options) {
        var _a;
        // this.text = text; // Be gone later...
        this.locale = options.locale || 'en';
        const localeSettings = TextInfo.locales.get(this.locale);
        let pattern = localeSettings.pattern;
        if (options.pattern && options.pattern instanceof RegExp) {
            pattern = options.pattern.source;
        }
        else if (typeof options.pattern === 'string') {
            pattern = options.pattern;
        }
        if (options.includeChars) {
            (0, assert_1.assert)(pattern.indexOf('[') >= 0, 'pattern does not contain []');
            let insert = '';
            for (let i = 0; i < options.includeChars.length; i++) {
                insert += '\\' + options.includeChars[i];
            }
            let pos = -1;
            while (true) {
                const index = pattern.indexOf('[', pos + 1) + 1;
                if (index === 0) {
                    break;
                }
                pattern = pattern.slice(0, index) + insert + pattern.slice(index);
                pos = index;
            }
        }
        let flags = localeSettings.flags;
        if (typeof options.flags === 'string') {
            flags = options.flags;
        }
        const re = new RegExp(pattern, flags);
        const minLength = typeof options.minLength === 'number' ? options.minLength : 1;
        const maxLength = typeof options.maxLength === 'number' ? options.maxLength : 25;
        let blacklist = options.blacklist instanceof Array ? options.blacklist : [];
        if (localeSettings.stoplist instanceof Array && options.useStoplist === true) {
            blacklist = blacklist.concat(localeSettings.stoplist);
        }
        const whitelist = options.whitelist instanceof Array ? options.whitelist : [];
        const words = this.words = new Map();
        this.ignored = [];
        if (text === null || typeof text === 'undefined') {
            return;
        }
        if (options.prepare) {
            // Pre-process text. Allows decompression, decrypting, custom stemming etc
            text = options.prepare(text, this.locale, `"${(_a = options.includeChars) !== null && _a !== void 0 ? _a : ''}`);
        }
        // Unidecode text to get ASCII characters only
        function safe_unidecode(str) {
            // Fix for occasional multi-pass issue, copied from https://github.com/FGRibreau/node-unidecode/issues/16
            let ret;
            while (str !== (ret = (0, unidecode_1.default)(str))) {
                str = ret;
            }
            return ret;
        }
        text = safe_unidecode(text);
        // Remove any single quotes, so "don't" will be stored as "dont", "isn't" as "isnt" etc
        text = text.replace(/'/g, '');
        // Process the text
        // const wordsRegex = /[\w']+/gu;
        let wordIndex = 0;
        while (true) {
            const match = re.exec(text);
            if (match === null) {
                break;
            }
            let word = match[0];
            // TODO: use stemming such as snowball (https://www.npmjs.com/package/snowball-stemmers)
            // to convert words like "having" to "have", and "cycles", "cycle", "cycling" to "cycl"
            if (typeof options.stemming === 'function') {
                // Let callback function perform word stemming
                const stemmed = options.stemming(word, this.locale);
                if (typeof stemmed !== 'string') {
                    // Ignore this word
                    if (this.ignored.indexOf(word) < 0) {
                        this.ignored.push(word);
                    }
                    // Do not increase wordIndex
                    continue;
                }
                word = stemmed;
            }
            word = word.toLocaleLowerCase(this.locale);
            if (word.length < minLength || ~blacklist.indexOf(word)) {
                // Word does not meet set criteria
                if (!~whitelist.indexOf(word)) {
                    // Not whitelisted either
                    if (this.ignored.indexOf(word) < 0) {
                        this.ignored.push(word);
                    }
                    // Do not increase wordIndex
                    continue;
                }
            }
            else if (word.length > maxLength) {
                // Use the word, but cut it to the max length
                word = word.slice(0, maxLength);
            }
            let wordInfo = words.get(word);
            if (wordInfo) {
                wordInfo.indexes.push(wordIndex);
                wordInfo.sourceIndexes.push(match.index);
            }
            else {
                wordInfo = new WordInfo(word, [wordIndex], [match.index]);
                words.set(word, wordInfo);
            }
            wordIndex++;
        }
    }
}
/**
 * A full text index allows all words in text nodes to be indexed and searched.
 * Eg: "Every word in this text must be indexed." will be indexed with every word
 * and can be queried with filters 'contains' and '!contains' a word, words or pattern.
 * Eg: 'contains "text"', 'contains "text indexed"', 'contains "text in*"' will all match the text above.
 * This does not use a thesauris or word lists (yet), so 'contains "query"' will not match.
 * Each word will be stored and searched in lowercase
 */
class FullTextIndex extends data_index_1.DataIndex {
    constructor(storage, path, key, options) {
        if (key === '{key}') {
            throw new Error('Cannot create fulltext index on node keys');
        }
        super(storage, path, key, options);
        // this.enableReverseLookup = true;
        this.indexMetadataKeys = ['_occurs_']; //,'_indexes_'
        this.config = options.config || {};
        if (this.config.localeKey) {
            // localeKey is supported by all indexes now
            storage.debug.warn(`fulltext index config option "localeKey" has been deprecated, as it is now supported for all indexes. Move the setting to the global index settings`);
            this.textLocaleKey = this.config.localeKey; // Do use it now
        }
    }
    // get fileName() {
    //     return super.fileName.slice(0, -4) + '.fulltext.idx';
    // }
    get type() {
        return 'fulltext';
    }
    getTextInfo(val, locale) {
        return new TextInfo(val, {
            locale: locale !== null && locale !== void 0 ? locale : this.textLocale,
            prepare: this.config.prepare,
            stemming: this.config.transform,
            blacklist: this.config.blacklist,
            whitelist: this.config.whitelist,
            useStoplist: this.config.useStoplist,
            minLength: this.config.minLength,
            maxLength: this.config.maxLength,
        });
    }
    test(obj, op, val) {
        var _a;
        if (obj === null) {
            return op === 'fulltext:!contains';
        }
        const text = obj[this.key];
        if (typeof text === 'undefined') {
            return op === 'fulltext:!contains';
        }
        const locale = (_a = obj === null || obj === void 0 ? void 0 : obj[this.textLocaleKey]) !== null && _a !== void 0 ? _a : this.textLocale;
        const textInfo = this.getTextInfo(text, locale);
        if (op === 'fulltext:contains') {
            if (~val.indexOf(' OR ')) {
                // split
                const tests = val.split(' OR ');
                return tests.some(val => this.test(text, op, val));
            }
            else if (~val.indexOf('"')) {
                // Phrase(s) used. We have to make sure the words used are not only in the text,
                // but also in that exact order.
                const phraseRegex = /"(.+?)"/g;
                const phrases = [];
                while (true) {
                    const match = phraseRegex.exec(val);
                    if (match === null) {
                        break;
                    }
                    const phrase = match[1];
                    phrases.push(phrase);
                    val = val.slice(0, match.index) + val.slice(match.index + match[0].length);
                    phraseRegex.lastIndex = 0;
                }
                if (val.length > 0) {
                    phrases.push(val);
                }
                return phrases.every(phrase => {
                    const phraseInfo = this.getTextInfo(phrase, locale);
                    // This was broken before TS port because WordInfo had an array of words that was not
                    // in the same order as the source words were.
                    // TODO: Thoroughly test this new code
                    const phraseWords = phraseInfo.toSequence();
                    const occurrencesPerWord = phraseWords.map((word, i) => {
                        // Find word in text
                        const { indexes } = textInfo.words.get(word);
                        return indexes;
                    });
                    const hasSequenceAtIndex = (wordIndex, occurrenceIndex) => {
                        var _a;
                        const startIndex = (_a = occurrencesPerWord[wordIndex]) === null || _a === void 0 ? void 0 : _a[occurrenceIndex];
                        return occurrencesPerWord.slice(wordIndex + 1).every((occurences, i) => {
                            return occurences.some((index, j) => {
                                if (index !== startIndex + 1) {
                                    return false;
                                }
                                return hasSequenceAtIndex(wordIndex + i, j);
                            });
                        });
                    };
                    // Find the existence of a sequence of words
                    // Loop: for each occurrence of the first word in text, remember its index
                    // Try to find second word in text with index+1
                    //  - found: try to find third word in text with index+2, etc (recursive)
                    //  - not found: stop, proceed with next occurrence in main loop
                    return occurrencesPerWord[0].some((occurrence, i) => {
                        return hasSequenceAtIndex(0, i);
                    });
                    // const indexes = phraseInfo.words.map(word => textInfo.words.indexOf(word));
                    // if (indexes[0] < 0) { return false; }
                    // for (let i = 1; i < indexes.length; i++) {
                    //     if (indexes[i] - indexes[i-1] !== 1) {
                    //         return false;
                    //     }
                    // }
                    // return true;
                });
            }
            else {
                // test 1 or more words
                const wordsInfo = this.getTextInfo(val, locale);
                return wordsInfo.toSequence().every(word => {
                    return textInfo.words.has(word);
                });
            }
        }
    }
    async handleRecordUpdate(path, oldValue, newValue) {
        var _a, _b;
        let oldText = oldValue !== null && typeof oldValue === 'object' && this.key in oldValue ? oldValue[this.key] : null;
        let newText = newValue !== null && typeof newValue === 'object' && this.key in newValue ? newValue[this.key] : null;
        const oldLocale = (_a = oldValue === null || oldValue === void 0 ? void 0 : oldValue[this.textLocaleKey]) !== null && _a !== void 0 ? _a : this.textLocale, newLocale = (_b = newValue === null || newValue === void 0 ? void 0 : newValue[this.textLocaleKey]) !== null && _b !== void 0 ? _b : this.textLocale;
        if (typeof oldText === 'object' && oldText instanceof Array) {
            oldText = oldText.join(' ');
        }
        if (typeof newText === 'object' && newText instanceof Array) {
            newText = newText.join(' ');
        }
        const oldTextInfo = this.getTextInfo(oldText, oldLocale);
        const newTextInfo = this.getTextInfo(newText, newLocale);
        // super._updateReverseLookupKey(
        //     path,
        //     oldText ? textEncoder.encode(oldText) : null,
        //     newText ? textEncoder.encode(newText) : null,
        //     metadata
        // );
        const oldWords = oldTextInfo.toArray(); //.words.map(w => w.word);
        const newWords = newTextInfo.toArray(); //.words.map(w => w.word);
        const removed = oldWords.filter(word => newWords.indexOf(word) < 0);
        const added = newWords.filter(word => oldWords.indexOf(word) < 0);
        const changed = oldWords.filter(word => newWords.indexOf(word) >= 0).filter(word => {
            const oldInfo = oldTextInfo.getWordInfo(word);
            const newInfo = newTextInfo.getWordInfo(word);
            return oldInfo.occurs !== newInfo.occurs || oldInfo.indexes.some((index, i) => newInfo.indexes[i] !== index);
        });
        changed.forEach(word => {
            // Word metadata changed. Simplest solution: remove and add again
            removed.push(word);
            added.push(word);
        });
        const promises = [];
        // TODO: Prepare operations batch, then execute 1 tree update.
        // Now every word is a seperate update which is not necessary!
        removed.forEach(word => {
            const p = super.handleRecordUpdate(path, { [this.key]: word }, { [this.key]: null });
            promises.push(p);
        });
        added.forEach(word => {
            const mutated = {};
            Object.assign(mutated, newValue);
            mutated[this.key] = word;
            const wordInfo = newTextInfo.getWordInfo(word);
            // const indexMetadata = {
            //     '_occurs_': wordInfo.occurs,
            //     '_indexes_': wordInfo.indexes.join(',')
            // };
            let occurs = wordInfo.indexes.join(',');
            if (occurs.length > 255) {
                console.warn(`FullTextIndex ${this.description}: word "${word}" occurs too many times in "${path}/${this.key}" to store in index metadata. Truncating occurrences`);
                const cutIndex = occurs.lastIndexOf(',', 255);
                occurs = occurs.slice(0, cutIndex);
            }
            const indexMetadata = {
                '_occurs_': occurs,
            };
            const p = super.handleRecordUpdate(path, { [this.key]: null }, mutated, indexMetadata);
            promises.push(p);
        });
        await Promise.all(promises);
    }
    build() {
        return super.build({
            addCallback: (add, text, recordPointer, metadata, env) => {
                if (typeof text === 'object' && text instanceof Array) {
                    text = text.join(' ');
                }
                if (typeof text === 'undefined') {
                    text = '';
                }
                const locale = env.locale || this.textLocale;
                const textInfo = this.getTextInfo(text, locale);
                if (textInfo.words.size === 0) {
                    this.storage.debug.warn(`No words found in "${typeof text === 'string' && text.length > 50 ? text.slice(0, 50) + '...' : text}" to fulltext index "${env.path}"`);
                }
                // const revLookupKey = super._getRevLookupKey(env.path);
                // tree.add(revLookupKey, textEncoder.encode(text), metadata);
                textInfo.words.forEach(wordInfo => {
                    // IDEA: To enable fast '*word' queries (starting with wildcard), we can also store
                    // reversed words and run reversed query 'drow*' on it. we'd have to enable storing
                    // multiple B+Trees in a single index file: a 'forward' tree & a 'reversed' tree
                    // IDEA: Following up on previous idea: being able to backtrack nodes within an index would
                    // help to speed up sorting queries on an indexed key,
                    // eg: query .take(10).filter('rating','>=', 8).sort('title')
                    // does not filter on key 'title', but can then use an index on 'title' for the sorting:
                    // it can take the results from the 'rating' index and backtrack the nodes' titles to quickly
                    // get a sorted top 10. We'd have to store a seperate 'backtrack' tree that uses recordPointers
                    // as the key, and 'title' values as recordPointers. Caveat: max string length for sorting would
                    // then be 255 ASCII chars, because that's the recordPointer size limit.
                    // The same boost can currently only be achieved by creating an index that includes 'title' in
                    // the index on 'rating' ==> db.indexes.create('movies', 'rating', { include: ['title'] })
                    // Extend metadata with more details about the word (occurrences, positions)
                    // const wordMetadata = {
                    //     '_occurs_': wordInfo.occurs,
                    //     '_indexes_': wordInfo.indexes.join(',')
                    // };
                    let occurs = wordInfo.indexes.join(',');
                    if (occurs.length > 255) {
                        console.warn(`FullTextIndex ${this.description}: word "${wordInfo.word}" occurs too many times to store in index metadata. Truncating occurrences`);
                        const cutIndex = occurs.lastIndexOf(',', 255);
                        occurs = occurs.slice(0, cutIndex);
                    }
                    const wordMetadata = {
                        '_occurs_': occurs,
                    };
                    Object.assign(wordMetadata, metadata);
                    add(wordInfo.word, recordPointer, wordMetadata);
                });
                return textInfo.toArray(); //words.map(info => info.word);
            },
            valueTypes: [node_value_types_1.VALUE_TYPES.STRING],
        });
    }
    static get validOperators() {
        return ['fulltext:contains', 'fulltext:!contains'];
    }
    get validOperators() {
        return FullTextIndex.validOperators;
    }
    async query(op, val, options) {
        if (op instanceof btree_1.BlacklistingSearchOperator) {
            throw new Error(`Not implemented: Can't query fulltext index with blacklisting operator yet`);
        }
        if (op === 'fulltext:contains' || op === 'fulltext:!contains') {
            return this.contains(op, val, options);
        }
        else {
            throw new Error(`Fulltext indexes can only be queried with operators ${FullTextIndex.validOperators.map(op => `"${op}"`).join(', ')}`);
        }
    }
    /**
     *
     * @param op Operator to use, can be either "fulltext:contains" or "fulltext:!contains"
     * @param val Text to search for. Can include * and ? wildcards, OR's for combined searches, and "quotes" for phrase searches
     */
    async contains(op, val, options = {
        phrase: false,
        locale: undefined,
        minimumWildcardWordLength: 2,
    }) {
        if (!FullTextIndex.validOperators.includes(op)) { //if (op !== 'fulltext:contains' && op !== 'fulltext:not_contains') {
            throw new Error(`Fulltext indexes can only be queried with operators ${FullTextIndex.validOperators.map(op => `"${op}"`).join(', ')}`);
        }
        // Check cache
        const cache = this.cache(op, val);
        if (cache) {
            // Use cached results
            return Promise.resolve(cache);
        }
        const stats = new query_stats_1.IndexQueryStats(options.phrase ? 'fulltext_phrase_query' : 'fulltext_query', val, true);
        // const searchWordRegex = /[\w'?*]+/g; // Use TextInfo to find and transform words using index settings
        const getTextInfo = (text) => {
            const info = new TextInfo(text, {
                locale: options.locale || this.textLocale,
                prepare: this.config.prepare,
                stemming: this.config.transform,
                minLength: this.config.minLength,
                maxLength: this.config.maxLength,
                blacklist: this.config.blacklist,
                whitelist: this.config.whitelist,
                useStoplist: this.config.useStoplist,
                includeChars: '*?',
            });
            // Ignore any wildcard words that do not meet the set minimum length
            // This is to safeguard the system against (possibly unwanted) very large
            // result sets
            const words = info.toArray();
            let i;
            while (i = words.findIndex(w => /^[*?]+$/.test(w)), i >= 0) {
                // Word is wildcards only. Ignore
                const word = words[i];
                info.ignored.push(word);
                info.words.delete(word);
            }
            if (options.minimumWildcardWordLength > 0) {
                for (const word of words) {
                    const starIndex = word.indexOf('*');
                    // min = 2, word = 'an*', starIndex = 2, ok!
                    // min = 3: starIndex < min: not ok!
                    if (starIndex > 0 && starIndex < options.minimumWildcardWordLength) {
                        info.ignored.push(word);
                        info.words.delete(word);
                        i--;
                    }
                }
            }
            return info;
        };
        if (val.includes(' OR ')) {
            // Multiple searches in one query: 'secret OR confidential OR "don't tell"'
            // TODO: chain queries instead of running simultanious?
            const queries = val.split(' OR ');
            const promises = queries.map(q => this.query(op, q, options));
            const resultSets = await Promise.all(promises);
            stats.steps.push(...resultSets.map(results => results.stats));
            const mergeStep = new query_stats_1.IndexQueryStats('merge_expand', { sets: resultSets.length, results: resultSets.reduce((total, set) => total + set.length, 0) }, true);
            stats.steps.push(mergeStep);
            const merged = resultSets[0];
            resultSets.slice(1).forEach(results => {
                results.forEach(result => {
                    const exists = ~merged.findIndex(r => r.path === result.path);
                    if (!exists) {
                        merged.push(result);
                    }
                });
            });
            const results = query_results_1.IndexQueryResults.fromResults(merged, this.key);
            mergeStep.stop(results.length);
            stats.stop(results.length);
            results.stats = stats;
            results.hints.push(...resultSets.reduce((hints, set) => { hints.push(...set.hints); return hints; }, []));
            return results;
        }
        if (val.includes('"')) {
            // Phrase(s) used. We have to make sure the words used are not only in the text,
            // but also in that exact order.
            const phraseRegex = /"(.+?)"/g;
            const phrases = [];
            while (true) {
                const match = phraseRegex.exec(val);
                if (match === null) {
                    break;
                }
                const phrase = match[1];
                phrases.push(phrase);
                val = val.slice(0, match.index) + val.slice(match.index + match[0].length);
                phraseRegex.lastIndex = 0;
            }
            const phraseOptions = {};
            Object.assign(phraseOptions, options);
            phraseOptions.phrase = true;
            const promises = phrases.map(phrase => this.query(op, phrase, phraseOptions));
            // Check if what is left over still contains words
            if (val.length > 0 && getTextInfo(val).wordCount > 0) { //(val.match(searchWordRegex) !== null) {
                // Add it
                const promise = this.query(op, val, options);
                promises.push(promise);
            }
            const resultSets = await Promise.all(promises);
            stats.steps.push(...resultSets.map(results => results.stats));
            // Take shortest set, only keep results that are matched in all other sets
            const mergeStep = new query_stats_1.IndexQueryStats('merge_reduce', { sets: resultSets.length, results: resultSets.reduce((total, set) => total + set.length, 0) }, true);
            resultSets.length > 1 && stats.steps.push(mergeStep);
            const shortestSet = resultSets.sort((a, b) => a.length < b.length ? -1 : 1)[0];
            const otherSets = resultSets.slice(1);
            const matches = shortestSet.reduce((matches, match) => {
                // Check if the key is present in the other result sets
                const path = match.path;
                const matchedInAllSets = otherSets.every(set => set.findIndex(match => match.path === path) >= 0);
                if (matchedInAllSets) {
                    matches.push(match);
                }
                return matches;
            }, new query_results_1.IndexQueryResults());
            matches.filterKey = this.key;
            mergeStep.stop(matches.length);
            stats.stop(matches.length);
            matches.stats = stats;
            matches.hints.push(...resultSets.reduce((hints, set) => { hints.push(...set.hints); return hints; }, []));
            return matches;
        }
        const info = getTextInfo(val);
        /**
         * Add ignored words to the result hints
         */
        function addIgnoredWordHints(results) {
            // Add hints for ignored words
            info.ignored.forEach(word => {
                const hint = new fulltext_index_query_hint_1.FullTextIndexQueryHint(fulltext_index_query_hint_1.FullTextIndexQueryHint.types.ignoredWord, word);
                results.hints.push(hint);
            });
        }
        const words = info.toArray();
        if (words.length === 0) {
            // Resolve with empty array
            stats.stop(0);
            const results = query_results_1.IndexQueryResults.fromResults([], this.key);
            results.stats = stats;
            addIgnoredWordHints(results);
            return results;
        }
        if (op === 'fulltext:!contains') {
            // NEW: Use BlacklistingSearchOperator that uses all (unique) values in the index,
            // besides the ones that get blacklisted along the way by our callback function
            const wordChecks = words.map(word => {
                if (word.includes('*') || word.includes('?')) {
                    const pattern = '^' + word.replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
                    const re = new RegExp(pattern, 'i');
                    return re;
                }
                return word;
            });
            const customOp = new btree_1.BlacklistingSearchOperator(entry => {
                const blacklist = wordChecks.some(word => {
                    if (word instanceof RegExp) {
                        return word.test(entry.key);
                    }
                    return entry.key === word;
                });
                if (blacklist) {
                    return entry.values;
                }
            });
            stats.type = 'fulltext_blacklist_scan';
            const results = await super.query(customOp);
            stats.stop(results.length);
            results.filterKey = this.key;
            results.stats = stats;
            addIgnoredWordHints(results);
            // Cache results
            this.cache(op, val, results);
            return results;
        }
        // op === 'fulltext:contains'
        // Get result count for each word
        const countPromises = words.map(word => {
            const wildcardIndex = ~(~word.indexOf('*') || ~word.indexOf('?')); // TODO: improve readability
            const wordOp = wildcardIndex >= 0 ? 'like' : '==';
            const step = new query_stats_1.IndexQueryStats('count', { op: wordOp, word }, true);
            stats.steps.push(step);
            return super.count(wordOp, word)
                .then(count => {
                step.stop(count);
                return { word, count };
            });
        });
        const counts = await Promise.all(countPromises);
        // Start with the smallest result set
        counts.sort((a, b) => {
            if (a.count < b.count) {
                return -1;
            }
            else if (a.count > b.count) {
                return 1;
            }
            return 0;
        });
        let results;
        if (counts[0].count === 0) {
            stats.stop(0);
            this.storage.debug.log(`Word "${counts[0].word}" not found in index, 0 results for query ${op} "${val}"`);
            results = new query_results_1.IndexQueryResults(0);
            results.filterKey = this.key;
            results.stats = stats;
            addIgnoredWordHints(results);
            // Add query hints for each unknown word
            counts.forEach(c => {
                if (c.count === 0) {
                    const hint = new fulltext_index_query_hint_1.FullTextIndexQueryHint(fulltext_index_query_hint_1.FullTextIndexQueryHint.types.missingWord, c.word);
                    results.hints.push(hint);
                }
            });
            // Cache the empty result set
            this.cache(op, val, results);
            return results;
        }
        const allWords = counts.map(c => c.word);
        // Sequentual method: query 1 word, then filter results further and further
        // More or less performs the same as parallel, but uses less memory
        // NEW: Start with the smallest result set
        // OLD: Use the longest word to search with, then filter those results
        // const allWords = words.slice().sort((a,b) => {
        //     if (a.length < b.length) { return 1; }
        //     else if (a.length > b.length) { return -1; }
        //     return 0;
        // });
        const queryWord = async (word, filter) => {
            const wildcardIndex = ~(~word.indexOf('*') || ~word.indexOf('?')); // TODO: improve readability
            const wordOp = wildcardIndex >= 0 ? 'like' : '==';
            // const step = new IndexQueryStats('query', { op: wordOp, word }, true);
            // stats.steps.push(step);
            const results = await super.query(wordOp, word, { filter });
            stats.steps.push(results.stats);
            // step.stop(results.length);
            return results;
        };
        let wordIndex = 0;
        const resultsPerWord = new Array(words.length);
        const nextWord = async () => {
            const word = allWords[wordIndex];
            const t1 = Date.now();
            const fr = await queryWord(word, results);
            const t2 = Date.now();
            this.storage.debug.log(`fulltext search for "${word}" took ${t2 - t1}ms`);
            resultsPerWord[words.indexOf(word)] = fr;
            results = fr;
            wordIndex++;
            if (results.length === 0 || wordIndex === allWords.length) {
                return;
            }
            await nextWord();
        };
        await nextWord();
        if (options.phrase === true && allWords.length > 1) {
            // Check which results have the words in the right order
            const step = new query_stats_1.IndexQueryStats('phrase_check', val, true);
            stats.steps.push(step);
            results = results.reduce((matches, match) => {
                // the order of the resultsPerWord is in the same order as the given words,
                // check if their metadata._occurs_ say the same about the indexed content
                const path = match.path;
                const wordMatches = resultsPerWord.map(results => {
                    return results.find(result => result.path === path);
                });
                // Convert the _occurs_ strings to arrays we can use
                wordMatches.forEach(match => {
                    match.metadata._occurs_ = match.metadata._occurs_.split(',').map(parseInt);
                });
                const check = (wordMatchIndex, prevWordIndex) => {
                    const sourceIndexes = wordMatches[wordMatchIndex].metadata._occurs_;
                    if (typeof prevWordIndex !== 'number') {
                        // try with each sourceIndex of the first word
                        for (let i = 0; i < sourceIndexes.length; i++) {
                            const found = check(1, sourceIndexes[i]);
                            if (found) {
                                return true;
                            }
                        }
                        return false;
                    }
                    // We're in a recursive call on the 2nd+ word
                    if (sourceIndexes.includes(prevWordIndex + 1)) {
                        // This word came after the previous word, hooray!
                        // Proceed with next word, or report success if this was the last word to check
                        if (wordMatchIndex === wordMatches.length - 1) {
                            return true;
                        }
                        return check(wordMatchIndex + 1, prevWordIndex + 1);
                    }
                    else {
                        return false;
                    }
                };
                if (check(0)) {
                    matches.push(match); // Keep!
                }
                return matches;
            }, new query_results_1.IndexQueryResults());
            step.stop(results.length);
        }
        results.filterKey = this.key;
        stats.stop(results.length);
        results.stats = stats;
        addIgnoredWordHints(results);
        // Cache results
        delete results.entryValues; // No need to cache these. Free the memory
        this.cache(op, val, results);
        return results;
        // Parallel method: query all words at the same time, then combine results
        // Uses more memory
        // const promises = words.map(word => {
        //     const wildcardIndex = ~(~word.indexOf('*') || ~word.indexOf('?'));
        //     let wordOp;
        //     if (op === 'fulltext:contains') {
        //         wordOp = wildcardIndex >= 0 ? 'like' : '==';
        //     }
        //     else if (op === 'fulltext:!contains') {
        //         wordOp = wildcardIndex >= 0 ? '!like' : '!=';
        //     }
        //     // return super.query(wordOp, word)
        //     return super.query(wordOp, word)
        // });
        // return Promise.all(promises)
        // .then(resultSets => {
        //     // Now only use matches that exist in all result sets
        //     const sortedSets = resultSets.slice().sort((a,b) => a.length < b.length ? -1 : 1)
        //     const shortestSet = sortedSets[0];
        //     const otherSets = sortedSets.slice(1);
        //     let matches = shortestSet.reduce((matches, match) => {
        //         // Check if the key is present in the other result sets
        //         const path = match.path;
        //         const matchedInAllSets = otherSets.every(set => set.findIndex(match => match.path === path) >= 0);
        //         if (matchedInAllSets) { matches.push(match); }
        //         return matches;
        //     }, new IndexQueryResults());
        //     if (options.phrase === true && resultSets.length > 1) {
        //         // Check if the words are in the right order
        //         console.log(`Breakpoint time`);
        //         matches = matches.reduce((matches, match) => {
        //             // the order of the resultSets is in the same order as the given words,
        //             // check if their metadata._indexes_ say the same about the indexed content
        //             const path = match.path;
        //             const wordMatches = resultSets.map(set => {
        //                 return set.find(match => match.path === path);
        //             });
        //             // Convert the _indexes_ strings to arrays we can use
        //             wordMatches.forEach(match => {
        //                 // match.metadata._indexes_ = match.metadata._indexes_.split(',').map(parseInt);
        //                 match.metadata._occurs_ = match.metadata._occurs_.split(',').map(parseInt);
        //             });
        //             const check = (wordMatchIndex, prevWordIndex) => {
        //                 const sourceIndexes = wordMatches[wordMatchIndex].metadata._occurs_; //wordMatches[wordMatchIndex].metadata._indexes_;
        //                 if (typeof prevWordIndex !== 'number') {
        //                     // try with each sourceIndex of the first word
        //                     for (let i = 0; i < sourceIndexes.length; i++) {
        //                         const found = check(1, sourceIndexes[i]);
        //                         if (found) { return true; }
        //                     }
        //                     return false;
        //                 }
        //                 // We're in a recursive call on the 2nd+ word
        //                 if (~sourceIndexes.indexOf(prevWordIndex + 1)) {
        //                     // This word came after the previous word, hooray!
        //                     // Proceed with next word, or report success if this was the last word to check
        //                     if (wordMatchIndex === wordMatches.length-1) { return true; }
        //                     return check(wordMatchIndex+1, prevWordIndex+1);
        //                 }
        //                 else {
        //                     return false;
        //                 }
        //             }
        //             if (check(0)) {
        //                 matches.push(match); // Keep!
        //             }
        //             return matches;
        //         }, new IndexQueryResults());
        //     }
        //     matches.filterKey = this.key;
        //     return matches;
        // });
    }
}
exports.FullTextIndex = FullTextIndex;
//# sourceMappingURL=fulltext-index.js.map