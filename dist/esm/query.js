import { ID, PathInfo } from 'acebase-core';
import { VALUE_TYPES } from './node-value-types.js';
import { NodeNotFoundError } from './node-errors.js';
import { DataIndex, FullTextIndex } from './data-index/index.js';
import { AsyncTaskBatch } from './async-task-batch.js';
// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = () => { };
/**
 *
 * @param storage Target storage instance
 * @param path Path of the object collection to perform query on
 * @param query Query to execute
 * @param options Additional options
 * @returns Returns a promise that resolves with matching data or paths in `results`
 */
export async function executeQuery(api, path, query, options = { snapshots: false, include: undefined, exclude: undefined, child_objects: undefined, eventHandler: noop }) {
    // TODO: Refactor to async
    if (typeof options !== 'object') {
        options = {};
    }
    if (typeof options.snapshots === 'undefined') {
        options.snapshots = false;
    }
    const context = {};
    if (api.storage.settings.transactions?.log) {
        context.acebase_cursor = ID.generate();
    }
    const queryFilters = query.filters.map(f => ({ ...f }));
    const querySort = query.order.map(s => ({ ...s }));
    const sortMatches = (matches) => {
        matches.sort((a, b) => {
            const compare = (i) => {
                const o = querySort[i];
                const trailKeys = PathInfo.getPathKeys(typeof o.key === 'number' ? `[${o.key}]` : o.key);
                const left = trailKeys.reduce((val, key) => val !== null && typeof val === 'object' && key in val ? val[key] : null, a.val);
                const right = trailKeys.reduce((val, key) => val !== null && typeof val === 'object' && key in val ? val[key] : null, b.val);
                if (left === null) {
                    return right === null ? 0 : o.ascending ? -1 : 1;
                }
                if (right === null) {
                    return o.ascending ? 1 : -1;
                }
                // TODO: add collation options using Intl.Collator. Note this also has to be implemented in the matching engines (inclusing indexes)
                // See discussion https://github.com/appy-one/acebase/discussions/27
                if (left == right) {
                    if (i < querySort.length - 1) {
                        return compare(i + 1);
                    }
                    else {
                        return a.path < b.path ? -1 : 1;
                    } // Sort by path if property values are equal
                }
                else if (left < right) {
                    return o.ascending ? -1 : 1;
                }
                // else if (left > right) {
                return o.ascending ? 1 : -1;
                // }
            };
            return compare(0);
        });
    };
    const loadResultsData = async (preResults, options) => {
        // Limit the amount of concurrent getValue calls by batching them
        if (preResults.length === 0) {
            return [];
        }
        const maxBatchSize = 50;
        const batch = new AsyncTaskBatch(maxBatchSize);
        const results = [];
        preResults.forEach(({ path }, index) => batch.add(async () => {
            const node = await api.storage.getNode(path, options);
            const val = node.value;
            if (val === null) {
                // Record was deleted, but index isn't updated yet?
                api.storage.debug.warn(`Indexed result "/${path}" does not have a record!`);
                // TODO: let index rebuild
                return;
            }
            const result = { path, val };
            if (stepsExecuted.sorted) {
                // Put the result in the same index as the preResult was
                results[index] = result;
            }
            else {
                results.push(result);
                if (!stepsExecuted.skipped && results.length > query.skip + Math.abs(query.take)) {
                    // we can toss a value! sort, toss last one
                    sortMatches(results);
                    results.pop(); // Always toss last value, results have been sorted already
                }
            }
        }));
        await batch.finish();
        return results;
    };
    const pathInfo = PathInfo.get(path);
    const isWildcardPath = pathInfo.keys.some(key => key === '*' || key.toString().startsWith('$')); // path.includes('*');
    const availableIndexes = api.storage.indexes.get(path);
    const usingIndexes = [];
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    let stop = async () => { };
    if (isWildcardPath) {
        // Check if path contains $vars with explicit filter values. If so, execute multiple queries and merge results
        const vars = pathInfo.keys.filter(key => typeof key === 'string' && key.startsWith('$'));
        const hasExplicitFilterValues = vars.length > 0 && vars.every(v => query.filters.some(f => f.key === v && ['==', 'in'].includes(f.op)));
        const isRealtime = typeof options.monitor === 'object' && [options.monitor?.add, options.monitor?.change, options.monitor?.remove].some(val => val === true);
        if (hasExplicitFilterValues && !isRealtime) {
            // create path combinations
            const combinations = [];
            for (const v of vars) {
                const filters = query.filters.filter(f => f.key === v);
                const filterValues = filters.reduce((values, f) => {
                    if (f.op === '==') {
                        values.push(f.compare);
                    }
                    if (f.op === 'in') {
                        if (!(f.compare instanceof Array)) {
                            throw new Error(`compare argument for 'in' operator must be an Array`);
                        }
                        values.push(...f.compare);
                    }
                    return values;
                }, []);
                // Expand all current combinations with these filter values
                const prevCombinations = combinations.splice(0);
                filterValues.forEach(fv => {
                    if (prevCombinations.length === 0) {
                        combinations.push({ [v]: fv });
                    }
                    else {
                        combinations.push(...prevCombinations.map(c => ({ ...c, [v]: fv })));
                    }
                });
            }
            // create queries
            const filters = query.filters.filter(f => !vars.includes(f.key));
            const paths = combinations.map(vars => PathInfo.get(PathInfo.getPathKeys(path).map(key => vars[key] ?? key)).path);
            const loadData = query.order.length > 0;
            const promises = paths.map(path => executeQuery(api, path, { filters, take: 0, skip: 0, order: [] }, {
                snapshots: loadData,
                cache_mode: options.cache_mode,
                include: [...(options.include ?? []), ...query.order.map(o => o.key)],
                exclude: options.exclude,
            }));
            const resultSets = await Promise.all(promises);
            let results = resultSets.reduce((results, set) => (results.push(...set.results), results), []);
            if (loadData) {
                sortMatches(results);
            }
            if (query.skip > 0) {
                results.splice(0, query.skip);
            }
            if (query.take > 0) {
                results.splice(query.take);
            }
            if (options.snapshots && (!loadData || options.include?.length > 0 || options.exclude?.length > 0 || !options.child_objects)) {
                const { include, exclude, child_objects } = options;
                results = await loadResultsData(results, { include, exclude, child_objects });
            }
            return { results, context: null, stop };
            // const results = options.snapshots ? results
        }
        else if (availableIndexes.length === 0) {
            // Wildcard paths require data to be indexed
            const err = new Error(`Query on wildcard path "/${path}" requires an index`);
            return Promise.reject(err);
        }
        if (queryFilters.length === 0) {
            // Filterless query on wildcard path. Use first available index with filter on non-null key value (all results)
            const index = availableIndexes.filter((index) => index.type === 'normal')[0];
            queryFilters.push({ key: index.key, op: '!=', compare: null });
        }
    }
    // Check if there are path specific indexes
    // eg: index on "users/$uid/posts", key "$uid", including "title" (or key "title", including "$uid")
    // Which are very useful for queries on "users/98sdfkb37/posts" with filter or sort on "title"
    // const indexesOnPath = availableIndexes
    //     .map(index => {
    //         if (!index.path.includes('$')) { return null; }
    //         const pattern = '^' + index.path.replace(/(\$[a-z0-9_]+)/gi, (match, name) => `(?<${name}>[a-z0-9_]+|\\*)`) + '$';
    //         const re = new RegExp(pattern, 'i');
    //         const match = path.match(re);
    //         const canBeUsed = index.key[0] === '$'
    //             ? match.groups[index.key] !== '*' // Index key value MUST be present in the path
    //             : null !== ourFilters.find(filter => filter.key === index.key); // Index key MUST be in a filter
    //         if (!canBeUsed) { return null; }
    //         return {
    //             index,
    //             wildcards: match.groups, // eg: { "$uid": "98sdfkb37" }
    //             filters: Object.keys(match.groups).filter(name => match.groups[name] !== '*').length
    //         }
    //     })
    //     .filter(info => info !== null)
    //     .sort((a, b) => {
    //         a.filters > b.filters ? -1 : 1
    //     });
    // TODO:
    // if (ourFilters.length === 0 && indexesOnPath.length > 0) {
    //     ourFilters = ourFilters.concat({ key: })
    //     usingIndexes.push({ index: filter.index, description: filter.index.description});
    // }
    queryFilters.forEach(filter => {
        if (filter.index) {
            // Index has been assigned already
            return;
        }
        // // Check if there are path indexes we can use
        // const pathIndexesWithKey = DataIndex.validOperators.includes(filter.op)
        //     ? indexesOnPath.filter(info => info.index.key === filter.key || info.index.includeKeys.includes(filter.key))
        //     : [];
        // Check if there are indexes on this filter key
        const indexesOnKey = availableIndexes
            .filter(index => index.key === filter.key)
            .filter(index => {
            return index.validOperators.includes(filter.op);
        });
        if (indexesOnKey.length >= 1) {
            // If there are multiple indexes on 1 key (happens when index includes other keys),
            // we should check other .filters and .order to determine the best one to use
            // TODO: Create a good strategy here...
            const otherFilterKeys = queryFilters.filter(f => f !== filter).map(f => f.key);
            const sortKeys = querySort.map(o => o.key).filter(key => key !== filter.key);
            const beneficialIndexes = indexesOnKey.map(index => {
                const availableKeys = index.includeKeys.concat(index.key);
                const forOtherFilters = availableKeys.filter(key => otherFilterKeys.includes(key));
                const forSorting = availableKeys.filter(key => sortKeys.includes(key));
                const forBoth = forOtherFilters.concat(forSorting.filter(index => !forOtherFilters.includes(index)));
                const points = {
                    filters: forOtherFilters.length,
                    sorting: forSorting.length * (query.take !== 0 ? forSorting.length : 1),
                    both: forBoth.length * forBoth.length,
                    get total() {
                        return this.filters + this.sorting + this.both;
                    },
                };
                return { index, points: points.total, filterKeys: forOtherFilters, sortKeys: forSorting };
            });
            // Use index with the most points
            beneficialIndexes.sort((a, b) => a.points > b.points ? -1 : 1);
            const bestBenificialIndex = beneficialIndexes[0];
            // Assign to this filter
            filter.index = bestBenificialIndex.index;
            // Assign to other filters and sorts
            bestBenificialIndex.filterKeys.forEach(key => {
                queryFilters.filter(f => f !== filter && f.key === key).forEach(f => {
                    if (!DataIndex.validOperators.includes(f.op)) {
                        // The used operator for this filter is invalid for use on metadata
                        // Probably because it is an Array/Fulltext/Geo query operator
                        return;
                    }
                    f.indexUsage = 'filter';
                    f.index = bestBenificialIndex.index;
                });
            });
            bestBenificialIndex.sortKeys.forEach(key => {
                querySort.filter(s => s.key === key).forEach(s => {
                    s.index = bestBenificialIndex.index;
                });
            });
        }
        if (filter.index) {
            usingIndexes.push({ index: filter.index, description: filter.index.description });
        }
    });
    if (querySort.length > 0 && query.take !== 0 && queryFilters.length === 0) {
        // Check if we can use assign an index to sorts in a filterless take & sort query
        querySort.forEach(sort => {
            if (sort.index) {
                // Index has been assigned already
                return;
            }
            sort.index = availableIndexes
                .filter(index => index.key === sort.key)
                .find(index => index.type === 'normal');
            // if (sort.index) {
            //     usingIndexes.push({ index: sort.index, description: `${sort.index.description} (for sorting)`});
            // }
        });
    }
    // const usingIndexes = ourFilters.map(filter => filter.index).filter(index => index);
    const indexDescriptions = usingIndexes.map(index => index.description).join(', ');
    usingIndexes.length > 0 && api.storage.debug.log(`Using indexes for query: ${indexDescriptions}`);
    // Filters that should run on all nodes after indexed results:
    const tableScanFilters = queryFilters.filter(filter => !filter.index);
    // Check if there are filters that require an index to run (such as "fulltext:contains", and "geo:nearby" etc)
    const specialOpsRegex = /^[a-z]+:/i;
    if (tableScanFilters.some(filter => specialOpsRegex.test(filter.op))) {
        const f = tableScanFilters.find(filter => specialOpsRegex.test(filter.op));
        const err = new Error(`query contains operator "${f.op}" which requires a special index that was not found on path "${path}", key "${f.key}"`);
        return Promise.reject(err);
    }
    // Check if the filters are using valid operators
    const allowedTableScanOperators = ['<', '<=', '==', '!=', '>=', '>', 'like', '!like', 'in', '!in', 'matches', '!matches', 'between', '!between', 'has', '!has', 'contains', '!contains', 'exists', '!exists']; // DISABLED "custom" because it is not fully implemented and only works locally
    for (let i = 0; i < tableScanFilters.length; i++) {
        const f = tableScanFilters[i];
        if (!allowedTableScanOperators.includes(f.op)) {
            return Promise.reject(new Error(`query contains unknown filter operator "${f.op}" on path "${path}", key "${f.key}"`));
        }
    }
    // Check if the available indexes are sufficient for this wildcard query
    if (isWildcardPath && tableScanFilters.length > 0) {
        // There are unprocessed filters, which means the fields aren't indexed.
        // We're not going to get all data of a wildcard path to query manually.
        // Indexes must be created
        const keys = tableScanFilters.reduce((keys, f) => {
            if (keys.indexOf(f.key) < 0) {
                keys.push(f.key);
            }
            return keys;
        }, []).map(key => `"${key}"`);
        const err = new Error(`This wildcard path query on "/${path}" requires index(es) on key(s): ${keys.join(', ')}. Create the index(es) and retry`);
        return Promise.reject(err);
    }
    // Run queries on available indexes
    const indexScanPromises = [];
    queryFilters.forEach(filter => {
        if (filter.index && filter.indexUsage !== 'filter') {
            let promise = filter.index.query(filter.op, filter.compare)
                .then(results => {
                options.eventHandler?.({ name: 'stats', type: 'index_query', source: filter.index.description, stats: results.stats });
                if (results.hints.length > 0) {
                    options.eventHandler?.({ name: 'hints', type: 'index_query', source: filter.index.description, hints: results.hints });
                }
                return results;
            });
            // Get other filters that can be executed on these indexed results (eg filters on included keys of the index)
            const resultFilters = queryFilters.filter(f => f.index === filter.index && f.indexUsage === 'filter');
            if (resultFilters.length > 0) {
                // Hook into the promise
                promise = promise.then(results => {
                    resultFilters.forEach(filter => {
                        const { key, op, index } = filter;
                        let { compare } = filter;
                        if (typeof compare === 'string' && !index.caseSensitive) {
                            compare = compare.toLocaleLowerCase(index.textLocale);
                        }
                        results = results.filterMetadata(key, op, compare);
                    });
                    return results;
                });
            }
            indexScanPromises.push(promise);
        }
    });
    const stepsExecuted = {
        filtered: queryFilters.length === 0,
        skipped: query.skip === 0,
        taken: query.take === 0,
        sorted: querySort.length === 0,
        preDataLoaded: false,
        dataLoaded: false,
    };
    if (queryFilters.length === 0 && query.take === 0) {
        api.storage.debug.warn(`Filterless queries must use .take to limit the results. Defaulting to 100 for query on path "${path}"`);
        query.take = 100;
    }
    if (querySort.length > 0 && querySort[0].index) {
        const sortIndex = querySort[0].index;
        const ascending = query.take < 0 ? !querySort[0].ascending : querySort[0].ascending;
        if (queryFilters.length === 0 && querySort.slice(1).every(s => sortIndex.allMetadataKeys.includes(s.key))) {
            api.storage.debug.log(`Using index for sorting: ${sortIndex.description}`);
            const metadataSort = querySort.slice(1).map(s => {
                s.index = sortIndex; // Assign index to skip later processing of this sort operation
                return { key: s.key, ascending: s.ascending };
            });
            const promise = sortIndex.take(query.skip, Math.abs(query.take), { ascending, metadataSort })
                .then(results => {
                options.eventHandler?.({ name: 'stats', type: 'sort_index_take', source: sortIndex.description, stats: results.stats });
                if (results.hints.length > 0) {
                    options.eventHandler?.({ name: 'hints', type: 'sort_index_take', source: sortIndex.description, hints: results.hints });
                }
                return results;
            });
            indexScanPromises.push(promise);
            stepsExecuted.skipped = true;
            stepsExecuted.taken = true;
            stepsExecuted.sorted = true;
        }
        // else if (queryFilters.every(f => [sortIndex.key, ...sortIndex.includeKeys].includes(f.key))) {
        //  TODO: If an index can be used for sorting, and all filter keys are included in its metadata: query the index!
        //  Implement:
        //  sortIndex.query(ourFilters);
        //  etc
        // }
    }
    return Promise.all(indexScanPromises)
        .then(async (indexResultSets) => {
        // Merge all results in indexResultSets, get distinct nodes
        let indexedResults = [];
        if (indexResultSets.length === 1) {
            const resultSet = indexResultSets[0];
            indexedResults = resultSet.map(match => {
                const result = { key: match.key, path: match.path, val: { [resultSet.filterKey]: match.value } };
                match.metadata && Object.assign(result.val, match.metadata);
                return result;
            });
            stepsExecuted.filtered = true;
        }
        else if (indexResultSets.length > 1) {
            indexResultSets.sort((a, b) => a.length < b.length ? -1 : 1); // Sort results, shortest result set first
            const shortestSet = indexResultSets[0];
            const otherSets = indexResultSets.slice(1);
            indexedResults = shortestSet.reduce((results, match) => {
                // Check if the key is present in the other result sets
                const result = { key: match.key, path: match.path, val: { [shortestSet.filterKey]: match.value } };
                const matchedInAllSets = otherSets.every(set => set.findIndex(m => m.path === match.path) >= 0);
                if (matchedInAllSets) {
                    match.metadata && Object.assign(result.val, match.metadata);
                    otherSets.forEach(set => {
                        const otherResult = set.find(r => r.path === result.path);
                        result.val[set.filterKey] = otherResult.value;
                        otherResult.metadata && Object.assign(result.val, otherResult.metadata);
                    });
                    results.push(result);
                }
                return results;
            }, []);
            stepsExecuted.filtered = true;
        }
        if (isWildcardPath || (indexScanPromises.length > 0 && tableScanFilters.length === 0)) {
            if (querySort.length === 0 || querySort.every(o => o.index)) {
                // No sorting, or all sorts are on indexed keys. We can use current index results
                stepsExecuted.preDataLoaded = true;
                if (!stepsExecuted.sorted && querySort.length > 0) {
                    sortMatches(indexedResults);
                }
                stepsExecuted.sorted = true;
                if (!stepsExecuted.skipped && query.skip > 0) {
                    indexedResults = query.take < 0
                        ? indexedResults.slice(0, -query.skip)
                        : indexedResults.slice(query.skip);
                }
                if (!stepsExecuted.taken && query.take !== 0) {
                    indexedResults = query.take < 0
                        ? indexedResults.slice(query.take)
                        : indexedResults.slice(0, query.take);
                }
                stepsExecuted.skipped = true;
                stepsExecuted.taken = true;
                if (!options.snapshots) {
                    return indexedResults;
                }
                // TODO: exclude already known key values, merge loaded with known
                const childOptions = { include: options.include, exclude: options.exclude, child_objects: options.child_objects };
                return loadResultsData(indexedResults, childOptions)
                    .then(results => {
                    stepsExecuted.dataLoaded = true;
                    return results;
                });
            }
            if (options.snapshots || !stepsExecuted.sorted) {
                const loadPartialResults = querySort.length > 0;
                const childOptions = loadPartialResults
                    ? { include: querySort.map(order => order.key) }
                    : { include: options.include, exclude: options.exclude, child_objects: options.child_objects };
                return loadResultsData(indexedResults, childOptions)
                    .then(results => {
                    if (querySort.length > 0) {
                        sortMatches(results);
                    }
                    stepsExecuted.sorted = true;
                    if (query.skip > 0) {
                        results = query.take < 0
                            ? results.slice(0, -query.skip)
                            : results.slice(query.skip);
                    }
                    if (query.take !== 0) {
                        results = query.take < 0
                            ? results.slice(query.take)
                            : results.slice(0, query.take);
                    }
                    stepsExecuted.skipped = true;
                    stepsExecuted.taken = true;
                    if (options.snapshots && loadPartialResults) {
                        // Get the rest
                        return loadResultsData(results, { include: options.include, exclude: options.exclude, child_objects: options.child_objects });
                    }
                    return results;
                });
            }
            else {
                // No need to take further actions, return what we have now
                return indexedResults;
            }
        }
        // If we get here, this is a query on a regular path (no wildcards) with additional non-indexed filters left,
        // we can get child records from a single parent. Merge index results by key
        let indexKeyFilter;
        if (indexedResults.length > 0) {
            indexKeyFilter = indexedResults.map(result => result.key);
        }
        let matches = [];
        let preliminaryStop = false;
        const loadPartialData = querySort.length > 0;
        const childOptions = loadPartialData
            ? { include: querySort.map(order => order.key) }
            : { include: options.include, exclude: options.exclude, child_objects: options.child_objects };
        const batch = {
            promises: [],
            add(promise) {
                this.promises.push(promise);
                if (this.promises.length >= 1000) {
                    return Promise.all(this.promises.splice(0)).then(_ => undefined);
                }
            },
        };
        try {
            await api.storage.getChildren(path, { keyFilter: indexKeyFilter, async: true }).next(child => {
                if (child.type !== VALUE_TYPES.OBJECT) {
                    return;
                }
                if (!child.address) {
                    // Currently only happens if object has no properties
                    // ({}, stored as a tiny_value in parent record). In that case,
                    // should it be matched in any query? -- That answer could be YES, when testing a property for !exists. Ignoring for now
                    return;
                }
                if (preliminaryStop) {
                    return false;
                }
                const matchNode = async () => {
                    const isMatch = await api.storage.matchNode(child.address.path, tableScanFilters);
                    if (!isMatch) {
                        return;
                    }
                    const childPath = child.address.path;
                    let result;
                    if (options.snapshots || querySort.length > 0) {
                        const node = await api.storage.getNode(childPath, childOptions);
                        result = { path: childPath, val: node.value };
                    }
                    else {
                        result = { path: childPath };
                    }
                    // If a maximumum number of results is requested, we can check if we can preliminary toss this result
                    // This keeps the memory space used limited to skip + take
                    // TODO: see if we can limit it to the max number of results returned (.take)
                    matches.push(result);
                    if (query.take !== 0 && matches.length > Math.abs(query.take) + query.skip) {
                        if (querySort.length > 0) {
                            // A query order has been set. If this value falls in between it can replace some other value
                            // matched before.
                            sortMatches(matches);
                        }
                        else if (query.take > 0) {
                            // No query order set, we can stop after 'take' + 'skip' results
                            preliminaryStop = true; // Flags the loop that no more nodes have to be checked
                        }
                        // const ascending = querySort.length === 0 || (query.take >= 0 ? querySort[0].ascending : !querySort[0].ascending);
                        // if (ascending) {
                        //     matches.pop(); // ascending sort order, toss last value
                        // }
                        // else {
                        //     matches.shift(); // descending, toss first value
                        // }
                        matches.pop(); // Always toss last value, results have been sorted already
                    }
                };
                const p = batch.add(matchNode());
                if (p instanceof Promise) {
                    // If this returns a promise, child iteration should pause automatically
                    return p;
                }
            });
        }
        catch (reason) {
            // No record?
            if (!(reason instanceof NodeNotFoundError)) {
                api.storage.debug.warn(`Error getting child stream: ${reason}`);
            }
            return [];
        }
        // Done iterating all children, wait for all match promises to resolve
        await Promise.all(batch.promises);
        stepsExecuted.preDataLoaded = loadPartialData;
        stepsExecuted.dataLoaded = !loadPartialData;
        if (querySort.length > 0) {
            sortMatches(matches);
        }
        stepsExecuted.sorted = true;
        if (query.skip > 0) {
            matches = query.take < 0
                ? matches.slice(0, -query.skip)
                : matches.slice(query.skip);
        }
        stepsExecuted.skipped = true;
        if (query.take !== 0) {
            // (should not be necessary, basically it has already been done in the loop?)
            matches = query.take < 0
                ? matches.slice(query.take)
                : matches.slice(0, query.take);
        }
        stepsExecuted.taken = true;
        if (!stepsExecuted.dataLoaded) {
            matches = await loadResultsData(matches, { include: options.include, exclude: options.exclude, child_objects: options.child_objects });
            stepsExecuted.dataLoaded = true;
        }
        return matches;
    })
        .then(matches => {
        // Order the results
        if (!stepsExecuted.sorted && querySort.length > 0) {
            sortMatches(matches);
        }
        if (!options.snapshots) {
            // Remove the loaded values from the results, because they were not requested (and aren't complete, we only have data of the sorted keys)
            matches = matches.map(match => match.path);
        }
        // Limit result set
        if (!stepsExecuted.skipped && query.skip > 0) {
            matches = query.take < 0
                ? matches.slice(0, -query.skip)
                : matches.slice(query.skip);
        }
        if (!stepsExecuted.taken && query.take !== 0) {
            matches = query.take < 0
                ? matches.slice(query.take)
                : matches.slice(0, query.take);
        }
        // NEW: Check if this is a realtime query - future updates must send query result updates
        if (options.monitor === true) {
            options.monitor = { add: true, change: true, remove: true };
        }
        if (typeof options.monitor === 'object' && (options.monitor.add || options.monitor.change || options.monitor.remove)) {
            // TODO: Refactor this to use 'mutations' event instead of 'notify_child_*'
            const monitor = options.monitor;
            const matchedPaths = options.snapshots ? matches.map(match => match.path) : matches.slice();
            const ref = api.db.ref(path);
            const removeMatch = (path) => {
                const index = matchedPaths.indexOf(path);
                if (index < 0) {
                    return;
                }
                matchedPaths.splice(index, 1);
            };
            const addMatch = (path) => {
                if (matchedPaths.includes(path)) {
                    return;
                }
                matchedPaths.push(path);
            };
            const stopMonitoring = () => {
                api.unsubscribe(ref.path, 'child_changed', childChangedCallback);
                api.unsubscribe(ref.path, 'child_added', childAddedCallback);
                api.unsubscribe(ref.path, 'notify_child_removed', childRemovedCallback);
            };
            stop = async () => { stopMonitoring(); };
            const childChangedCallback = async (err, path, newValue, oldValue) => {
                const wasMatch = matchedPaths.includes(path);
                let keepMonitoring = true;
                // check if the properties we already have match filters,
                // and if we have to check additional properties
                const checkKeys = [];
                queryFilters.forEach(f => !checkKeys.includes(f.key) && checkKeys.push(f.key));
                const seenKeys = [];
                typeof oldValue === 'object' && Object.keys(oldValue).forEach(key => !seenKeys.includes(key) && seenKeys.push(key));
                typeof newValue === 'object' && Object.keys(newValue).forEach(key => !seenKeys.includes(key) && seenKeys.push(key));
                const missingKeys = [];
                let isMatch = seenKeys.every(key => {
                    if (!checkKeys.includes(key)) {
                        return true;
                    }
                    const filters = queryFilters.filter(filter => filter.key === key);
                    return filters.every(filter => {
                        if (filter.index?.textLocaleKey && !seenKeys.includes(filter.index.textLocaleKey)) {
                            // Can't check because localeKey is missing
                            missingKeys.push(filter.index.textLocaleKey);
                            return true; // so we'll know if all others did match
                        }
                        else if (allowedTableScanOperators.includes(filter.op)) {
                            return api.storage.test(newValue[key], filter.op, filter.compare);
                        }
                        else {
                            // specific index filter
                            return filter.index.test(newValue, filter.op, filter.compare);
                        }
                    });
                });
                if (isMatch) {
                    // Matches all checked (updated) keys. BUT. Did we have all data needed?
                    // If it was a match before, other properties don't matter because they didn't change and won't
                    // change the current outcome
                    missingKeys.push(...checkKeys.filter(key => !seenKeys.includes(key)));
                    // let promise = Promise.resolve(true);
                    if (!wasMatch && missingKeys.length > 0) {
                        // We have to check if this node becomes a match
                        const filterQueue = queryFilters.filter(f => missingKeys.includes(f.key));
                        const simpleFilters = filterQueue.filter(f => allowedTableScanOperators.includes(f.op));
                        const indexFilters = filterQueue.filter(f => !allowedTableScanOperators.includes(f.op));
                        if (simpleFilters.length > 0) {
                            isMatch = await api.storage.matchNode(path, simpleFilters);
                        }
                        if (isMatch && indexFilters.length > 0) {
                            // TODO: ask index what keys to load (eg: FullTextIndex might need key specified by localeKey)
                            const keysToLoad = indexFilters.reduce((keys, filter) => {
                                if (!keys.includes(filter.key)) {
                                    keys.push(filter.key);
                                }
                                if (filter.index instanceof FullTextIndex && filter.index.config.localeKey && !keys.includes(filter.index.config.localeKey)) {
                                    keys.push(filter.index.config.localeKey);
                                }
                                return keys;
                            }, []);
                            const node = await api.storage.getNode(path, { include: keysToLoad });
                            if (node.value === null) {
                                return false;
                            }
                            isMatch = indexFilters.every(filter => filter.index.test(node.value, filter.op, filter.compare));
                        }
                    }
                }
                if (isMatch) {
                    if (!wasMatch) {
                        addMatch(path);
                    }
                    // load missing data if snapshots are requested
                    if (options.snapshots) {
                        const loadOptions = { include: options.include, exclude: options.exclude, child_objects: options.child_objects };
                        const node = await api.storage.getNode(path, loadOptions);
                        newValue = node.value;
                    }
                    if (wasMatch && monitor.change) {
                        keepMonitoring = options.eventHandler({ name: 'change', path, value: newValue }) !== false;
                    }
                    else if (!wasMatch && monitor.add) {
                        keepMonitoring = options.eventHandler({ name: 'add', path, value: newValue }) !== false;
                    }
                }
                else if (wasMatch) {
                    removeMatch(path);
                    if (monitor.remove) {
                        keepMonitoring = options.eventHandler({ name: 'remove', path: path, value: oldValue }) !== false;
                    }
                }
                if (keepMonitoring === false) {
                    stopMonitoring();
                }
            };
            const childAddedCallback = (err, path, newValue) => {
                const isMatch = queryFilters.every(filter => {
                    if (allowedTableScanOperators.includes(filter.op)) {
                        return api.storage.test(newValue[filter.key], filter.op, filter.compare);
                    }
                    else {
                        return filter.index.test(newValue, filter.op, filter.compare);
                    }
                });
                let keepMonitoring = true;
                if (isMatch) {
                    addMatch(path);
                    if (monitor.add) {
                        keepMonitoring = options.eventHandler({ name: 'add', path: path, value: options.snapshots ? newValue : null }) !== false;
                    }
                }
                if (keepMonitoring === false) {
                    stopMonitoring();
                }
            };
            const childRemovedCallback = (err, path, newValue, oldValue) => {
                let keepMonitoring = true;
                removeMatch(path);
                if (monitor.remove) {
                    keepMonitoring = options.eventHandler({ name: 'remove', path: path, value: options.snapshots ? oldValue : null }) !== false;
                }
                if (keepMonitoring === false) {
                    stopMonitoring();
                }
            };
            if (options.monitor.add || options.monitor.change || options.monitor.remove) {
                // Listen for child_changed events
                api.subscribe(ref.path, 'child_changed', childChangedCallback);
            }
            if (options.monitor.remove) {
                api.subscribe(ref.path, 'notify_child_removed', childRemovedCallback);
            }
            if (options.monitor.add) {
                api.subscribe(ref.path, 'child_added', childAddedCallback);
            }
        }
        return { results: matches, context, stop };
    });
}
//# sourceMappingURL=query.js.map