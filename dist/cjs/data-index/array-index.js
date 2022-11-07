"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArrayIndex = void 0;
const btree_1 = require("../btree");
const data_index_1 = require("./data-index");
const node_value_types_1 = require("../node-value-types");
const query_results_1 = require("./query-results");
const query_stats_1 = require("./query-stats");
const array_index_query_hint_1 = require("./array-index-query-hint");
/**
 * An array index allows all values in an array node to be indexed and searched
 */
class ArrayIndex extends data_index_1.DataIndex {
    constructor(storage, path, key, options) {
        if (key === '{key}') {
            throw new Error('Cannot create array index on node keys');
        }
        super(storage, path, key, options);
    }
    // get fileName() {
    //     return super.fileName.slice(0, -4) + '.array.idx';
    // }
    get type() {
        return 'array';
    }
    async handleRecordUpdate(path, oldValue, newValue) {
        const tmpOld = oldValue !== null && typeof oldValue === 'object' && this.key in oldValue ? oldValue[this.key] : null;
        const tmpNew = newValue !== null && typeof newValue === 'object' && this.key in newValue ? newValue[this.key] : null;
        let oldEntries;
        if (tmpOld instanceof Array) {
            // Only use unique values
            oldEntries = tmpOld.reduce((unique, entry) => {
                !unique.includes(entry) && unique.push(entry);
                return unique;
            }, []);
        }
        else {
            oldEntries = [];
        }
        if (oldEntries.length === 0) {
            // Add undefined entry to indicate empty array
            oldEntries.push(undefined);
        }
        let newEntries;
        if (tmpNew instanceof Array) {
            // Only use unique values
            newEntries = tmpNew.reduce((unique, entry) => {
                !unique.includes(entry) && unique.push(entry);
                return unique;
            }, []);
        }
        else {
            newEntries = [];
        }
        if (newEntries.length === 0) {
            // Add undefined entry to indicate empty array
            newEntries.push(undefined);
        }
        const removed = oldEntries.filter(entry => !newEntries.includes(entry));
        const added = newEntries.filter(entry => !oldEntries.includes(entry));
        const mutated = { old: {}, new: {} };
        Object.assign(mutated.old, oldValue);
        Object.assign(mutated.new, newValue);
        const promises = [];
        removed.forEach(entry => {
            mutated.old[this.key] = entry;
            mutated.new[this.key] = null;
            const p = super.handleRecordUpdate(path, mutated.old, mutated.new);
            promises.push(p);
        });
        added.forEach(entry => {
            mutated.old[this.key] = null;
            mutated.new[this.key] = entry;
            const p = super.handleRecordUpdate(path, mutated.old, mutated.new);
            promises.push(p);
        });
        await Promise.all(promises);
    }
    build() {
        return super.build({
            addCallback: (add, array, recordPointer, metadata) => {
                if (!(array instanceof Array) || array.length === 0) {
                    // Add undefined entry to indicate empty array
                    add(undefined, recordPointer, metadata);
                    return [];
                }
                // index unique items only
                array.reduce((unique, value) => {
                    !unique.includes(value) && unique.push(value);
                    return unique;
                }, []).forEach(value => {
                    add(value, recordPointer, metadata);
                });
                return array;
            },
            valueTypes: [node_value_types_1.VALUE_TYPES.ARRAY],
        });
    }
    static get validOperators() {
        // This is the only special index that does not use prefixed operators
        // because these can also be used to query non-indexed arrays (but slower, of course..)
        return ['contains', '!contains'];
    }
    get validOperators() {
        return ArrayIndex.validOperators;
    }
    /**
     * @param op "contains" or "!contains"
     * @param val value to search for
     */
    async query(op, val, options) {
        if (op instanceof btree_1.BlacklistingSearchOperator) {
            throw new Error(`Not implemented: Can't query array index with blacklisting operator yet`);
        }
        if (!ArrayIndex.validOperators.includes(op)) {
            throw new Error(`Array indexes can only be queried with operators ${ArrayIndex.validOperators.map(op => `"${op}"`).join(', ')}`);
        }
        if (options) {
            this.storage.debug.warn('Not implemented: query options for array indexes are ignored');
        }
        // Check cache
        const cache = this.cache(op, val);
        if (cache) {
            // Use cached results
            return cache;
        }
        const stats = new query_stats_1.IndexQueryStats('array_index_query', val, true);
        if ((op === 'contains' || op === '!contains') && val instanceof Array && val.length === 0) {
            // Added for #135: empty compare array for contains/!contains must match all values
            stats.type = 'array_index_scan';
            const results = await super.query(new btree_1.BlacklistingSearchOperator((_) => []));
            stats.stop(results.length);
            results.filterKey = this.key;
            results.stats = stats;
            // Don't cache results
            return results;
        }
        else if (op === 'contains') {
            if (val instanceof Array) {
                // recipesIndex.query('contains', ['egg','bacon'])
                // Get result count for each value in array
                const countPromises = val.map(value => {
                    const wildcardIndex = typeof value !== 'string' ? -1 : ~(~value.indexOf('*') || ~value.indexOf('?'));
                    const valueOp = ~wildcardIndex ? 'like' : '==';
                    const step = new query_stats_1.IndexQueryStats('count', value, true);
                    stats.steps.push(step);
                    return this.count(valueOp, value)
                        .then(count => {
                        step.stop(count);
                        return { value, count };
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
                    this.storage.debug.log(`Value "${counts[0].value}" not found in index, 0 results for query ${op} ${val}`);
                    results = new query_results_1.IndexQueryResults(0);
                    results.filterKey = this.key;
                    results.stats = stats;
                    // Add query hints for each unknown item
                    counts.forEach(c => {
                        if (c.count === 0) {
                            const hint = new array_index_query_hint_1.ArrayIndexQueryHint(array_index_query_hint_1.ArrayIndexQueryHint.types.missingValue, c.value);
                            results.hints.push(hint);
                        }
                    });
                    // Cache the empty result set
                    this.cache(op, val, results);
                    return results;
                }
                const allValues = counts.map(c => c.value);
                // Query 1 value, then filter results further and further
                // Start with the smallest result set
                const queryValue = (value, filter) => {
                    const wildcardIndex = typeof value !== 'string' ? -1 : ~(~value.indexOf('*') || ~value.indexOf('?'));
                    const valueOp = ~wildcardIndex ? 'like' : '==';
                    return super.query(valueOp, value, { filter })
                        .then(results => {
                        stats.steps.push(results.stats);
                        return results;
                    });
                };
                let valueIndex = 0;
                // let resultsPerValue = new Array(values.length);
                const nextValue = async () => {
                    const value = allValues[valueIndex];
                    const fr = await queryValue(value, results);
                    results = fr;
                    valueIndex++;
                    if (results.length === 0 || valueIndex === allValues.length) {
                        return;
                    }
                    await nextValue();
                };
                await nextValue();
                results.filterKey = this.key;
                stats.stop(results.length);
                results.stats = stats;
                // Cache results
                delete results.entryValues; // No need to cache these. Free the memory
                this.cache(op, val, results);
                return results;
            }
            else {
                // Single value query
                const valueOp = typeof val === 'string' && (val.includes('*') || val.includes('?'))
                    ? 'like'
                    : '==';
                const results = await super.query(valueOp, val);
                stats.steps.push(results.stats);
                results.stats = stats;
                delete results.entryValues;
                return results;
            }
        }
        else if (op === '!contains') {
            // DISABLED executing super.query('!=', val) because it returns false positives
            // for arrays that "!contains" val, but does contain other values...
            // Eg: an indexed array value of: ['bacon', 'egg', 'toast', 'sausage'],
            // when executing index.query('!contains', 'bacon'),
            // it will falsely match that record because the 2nd value 'egg'
            // matches the filter ('egg' is not 'bacon')
            // NEW: BlacklistingSearchOperator will take all values in the index unless
            // they are blacklisted along the way. Our callback determines whether to blacklist
            // an entry's values, which we'll do if its key matches val
            const customOp = new btree_1.BlacklistingSearchOperator(entry => {
                const blacklist = val === entry.key
                    || (val instanceof Array && val.includes(entry.key));
                if (blacklist) {
                    return entry.values;
                }
            });
            stats.type = 'array_index_blacklist_scan';
            const results = await super.query(customOp);
            stats.stop(results.length);
            results.filterKey = this.key;
            results.stats = stats;
            // Cache results
            this.cache(op, val, results);
            return results;
        }
    }
}
exports.ArrayIndex = ArrayIndex;
//# sourceMappingURL=array-index.js.map