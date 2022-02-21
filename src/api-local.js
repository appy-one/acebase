const { Api, ID } = require('acebase-core');
const { StorageSettings, NodeNotFoundError } = require('./storage');
const { AceBaseStorage, AceBaseStorageSettings } = require('./storage-acebase');
const { SQLiteStorage, SQLiteStorageSettings } = require('./storage-sqlite');
const { MSSQLStorage, MSSQLStorageSettings } = require('./storage-mssql');
const { CustomStorage, CustomStorageSettings } = require('./storage-custom');
const { Node } = require('./node');
const { DataIndex } = require('./data-index');

class LocalApi extends Api {
    // All api methods for local database instance
    
    /**
     * 
     * @param {{db: AceBase, storage: StorageSettings, logLevel?: string }} settings
     */
    constructor(dbname = "default", settings, readyCallback) {
        super();
        this.db = settings.db;

        if (typeof settings.storage === 'object') {
            settings.storage.logLevel = settings.logLevel;
            if (SQLiteStorageSettings && (settings.storage instanceof SQLiteStorageSettings || settings.storage.type === 'sqlite')) {
                this.storage = new SQLiteStorage(dbname, settings.storage);
            }
            else if (MSSQLStorageSettings && (settings.storage instanceof MSSQLStorageSettings || settings.storage.type === 'mssql')) {
                this.storage = new MSSQLStorage(dbname, settings.storage);
            }
            else if (CustomStorageSettings && (settings.storage instanceof CustomStorageSettings || settings.storage.type === 'custom')) {
                this.storage = new CustomStorage(dbname, settings.storage);
            }
            else {
                const storageSettings = settings.storage instanceof AceBaseStorageSettings
                    ? settings.storage
                    : new AceBaseStorageSettings(settings.storage);
                this.storage = new AceBaseStorage(dbname, storageSettings);
            }
        }
        else {
            settings.storage = new AceBaseStorageSettings({ logLevel: settings.logLevel });
            this.storage = new AceBaseStorage(dbname, settings.storage);
        }
        this.storage.on("ready", readyCallback);
    }

    stats(options) {
        return Promise.resolve(this.storage.stats);
    }

    subscribe(path, event, callback) {
        this.storage.subscriptions.add(path, event, callback);
    }

    unsubscribe(path, event = undefined, callback = undefined) {
        this.storage.subscriptions.remove(path, event, callback);
    }

    set(path, value, options = { suppress_events: false, context: null }) {
        return Node.update(this.storage, path, value, { merge: false, suppress_events: options.suppress_events, context: options.context });
    }

    update(path, updates, options = { suppress_events: false, context: null }) {
        return Node.update(this.storage, path, updates, { merge: true, suppress_events: options.suppress_events, context: options.context });
    }

    get transactionLoggingEnabled() {
        return this.storage.settings.transactions && this.storage.settings.transactions.log === true;
    }

    async get(path, options) {
        const context = {};
        if (this.transactionLoggingEnabled) {
            context.acebase_cursor = ID.generate();
        }
        const value = await Node.getValue(this.storage, path, options);
        return { value, context };
    }

    transaction(path, callback, options = { suppress_events: false, context: null }) {
        return Node.transaction(this.storage, path, callback, { suppress_events: options.suppress_events, context: options.context });
    }

    exists(path) {
        return Node.exists(this.storage, path);
    }

    query2(path, query, options = { snapshots: false, include: undefined, exclude: undefined, child_objects: undefined }) {
        /*
        
        Now that we're using indexes to filter data and order upon, each query requires a different strategy
        to get the results the quickest.

        So, we'll analyze the query first, build a strategy and then execute the strategy

        Analyze stage:
        - what path is being queried (wildcard path or single parent)
        - which indexes are available for the path
        - which indexes can be used for filtering
        - which indexes can be used for sorting
        - is take/skip used to limit the result set
        
        Strategy stage:
        - chain index filtering
        - ....

        TODO!
        */
    }

    /**
     * 
     * @param {string} path 
     * @param {object} query 
     * @param {Array<{ key: string, op: string, compare: any}>} query.filters
     * @param {number} query.skip number of results to skip, useful for paging
     * @param {number} query.take max number of results to return
     * @param {Array<{ key: string, ascending: boolean }>} query.order
     * @param {object} [options]
     * @param {boolean} [options.snapshots=false] whether to return matching data, or paths to matching nodes only
     * @param {string[]} [options.include] when using snapshots, keys or relative paths to include in result data
     * @param {string[]} [options.exclude] when using snapshots, keys or relative paths to exclude from result data
     * @param {boolean} [options.child_objects] when using snapshots, whether to include child objects in result data
     * @param {(event: { name: string, [key]: any }) => void} [options.eventHandler]
     * @param {object} [options.monitor] NEW (BETA) monitor changes
     * @param {boolean} [options.monitor.add=false] monitor new matches (either because they were added, or changed and now match the query)
     * @param {boolean} [options.monitor.change=false] monitor changed children that still match this query
     * @param {boolean} [options.monitor.remove=false] monitor children that don't match this query anymore
     * @ param {(event:string, path: string, value?: any) => boolean} [options.monitor.callback] NEW (BETA) callback with subscription to enable monitoring of new matches
     * @returns {Promise<{ results: object[]|string[]>, context: any }} returns a promise that resolves with matching data or paths in `results`
     */
    query(path, query, options = { snapshots: false, include: undefined, exclude: undefined, child_objects: undefined, eventHandler: event => {} }) {
        // TODO: Refactor to async

        if (typeof options !== "object") { options = {}; }
        if (typeof options.snapshots === "undefined") { options.snapshots = false; }
        
        const context = {};
        if (this.transactionLoggingEnabled) {
            context.acebase_cursor = ID.generate();
        }

        const sortMatches = (matches) => {
            matches.sort((a,b) => {
                const compare = (i) => {
                    const o = query.order[i];
                    let left = a.val[o.key];
                    let right = b.val[o.key];
                    // if (typeof left !== typeof right) {
                    //     // Wow. Using 2 different types in your data, AND sorting on it. 
                    //     // compare the types instead of their values ;-)
                    //     left = typeof left;
                    //     right = typeof right;
                    // }
                    if (typeof left === 'undefined' && typeof right !== 'undefined') { return o.ascending ? -1 : 1; }
                    if (typeof left !== 'undefined' && typeof right === 'undefined') { return o.ascending ? 1 : -1; }
                    if (typeof left === 'undefined' && typeof right === 'undefined') { return 0; }
                    // TODO: add collation options using Intl.Collator. Note this also has to be implemented in the matching engines (inclusing indexes)
                    // See discussion https://github.com/appy-one/acebase/discussions/27
                    if (left == right) {
                        if (i < query.order.length - 1) { return compare(i+1); }
                        else { return a.path < b.path ? -1 : 1; } // Sort by path if property values are equal
                    }
                    else if (left < right) {
                        return o.ascending ? -1 : 1;
                    }
                    else if (left > right) {
                        return o.ascending ? 1 : -1;
                    }
                };
                return compare(0);
            });
        };
        const loadResultsData = (preResults, options) => {
            // Limit the amount of concurrent getValue calls by batching them
            if (preResults.length === 0) {
                return Promise.resolve([]);
            }
            const maxBatchSize = 50;
            let batches = [];
            const items = preResults.map((result, index) => ({ path: result.path, index }));
            while (items.length > 0) {
                let batchItems= items.splice(0, maxBatchSize);
                batches.push(batchItems);
            }
            const results = [];
            const nextBatch = () => {
                const batch = batches.shift();
                return Promise.all(batch.map(item => {
                    const { path, index } = item;
                    return Node.getValue(this.storage, path, options)
                    .then(val => {
                        if (val === null) { 
                            // Record was deleted, but index isn't updated yet?
                            this.storage.debug.warn(`Indexed result "/${path}" does not have a record!`);
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
                                if (query.take < 0) { 
                                    results.shift(); // toss first value
                                }
                                else {
                                    results.pop(); // toss last value
                                }
                            }
                        }
                    });
                }))
                .then(() => {
                    if (batches.length > 0) { 
                        return nextBatch(); 
                    }
                });
            };
            return nextBatch()
            .then(() => {
                // Got all values
                return results;
            });                
        };

        const isWildcardPath = path.includes('*');

        const availableIndexes = this.storage.indexes.get(path);
        const usingIndexes = [];

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
        //             : null !== query.filters.find(filter => filter.key === index.key); // Index key MUST be in a filter
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
        // if (query.filters.length === 0 && indexesOnPath.length > 0) {
        //     query.filters = query.filters.concat({ key: })
        //     usingIndexes.push({ index: filter.index, description: filter.index.description});
        // }

        query.filters.forEach(filter => {
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
                const otherFilterKeys = query.filters.filter(f => f !== filter).map(f => f.key);
                const sortKeys = query.order.map(o => o.key).filter(key => key !== filter.key);
                const beneficialIndexes = indexesOnKey.map(index => {
                    const availableKeys = index.includeKeys.concat(index.key);
                    const forOtherFilters = availableKeys.filter(key => otherFilterKeys.indexOf(key) >= 0);
                    const forSorting = availableKeys.filter(key => sortKeys.indexOf(key) >= 0);
                    const forBoth = forOtherFilters.concat(forSorting.filter(index => forOtherFilters.indexOf(index) < 0));
                    const points = {
                        filters: forOtherFilters.length,
                        sorting: forSorting.length * (query.take !== 0 ? forSorting.length : 1),
                        both: forBoth.length * forBoth.length,
                        get total() {
                            return this.filters + this.sorting + this.both;
                        }
                    }
                    return { index, points: points.total, filterKeys: forOtherFilters, sortKeys: forSorting };
                });
                // Use index with the most points
                beneficialIndexes.sort((a,b) => a.points > b.points ? -1 : 1);
                const bestBenificialIndex = beneficialIndexes[0];
                
                // Assign to this filter
                filter.index = bestBenificialIndex.index;

                // Assign to other filters and sorts
                bestBenificialIndex.filterKeys.forEach(key => {
                    query.filters.filter(f => f !== filter && f.key === key).forEach(f => {
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
                    query.order.filter(s => s.key === key).forEach(s => {
                        s.index = bestBenificialIndex.index;
                    });
                });
            }
            if (filter.index) {
                usingIndexes.push({ index: filter.index, description: filter.index.description});
            }
        });

        if (query.order.length > 0 && query.take !== 0) {
            query.order.forEach(sort => {
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

        // const usingIndexes = query.filters.map(filter => filter.index).filter(index => index);
        const indexDescriptions = usingIndexes.map(index => index.description).join(', ');
        usingIndexes.length > 0 && this.storage.debug.log(`Using indexes for query: ${indexDescriptions}`);

        // Filters that should run on all nodes after indexed results:
        const tableScanFilters = query.filters.filter(filter => !filter.index);

        // Check if there are filters that require an index to run (such as "fulltext:contains", and "geo:nearby" etc)
        const specialOpsRegex = /^[a-z]+:/i;
        if (tableScanFilters.some(filter => specialOpsRegex.test(filter.op))) {
            const f = tableScanFilters.find(filter => specialOpsRegex.test(filter.op));
            const err = new Error(`query contains operator "${f.op}" which requires a special index that was not found on path "${path}", key "${f.key}"`)
            return Promise.reject(err);
        }

        // Check if the filters are using valid operators
        const allowedTableScanOperators = ["<","<=","==","!=",">=",">","like","!like","in","!in","matches","!matches","between","!between","has","!has","contains","!contains","exists","!exists"]; // DISABLED "custom" because it is not fully implemented and only works locally
        for(let i = 0; i < tableScanFilters.length; i++) {
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
                if (keys.indexOf(f.key) < 0) { keys.push(f.key); }
                return keys;
            }, []).map(key => `"${key}"`);
            const err = new Error(`This wildcard path query on "/${path}" requires index(es) on key(s): ${keys.join(", ")}. Create the index(es) and retry`);
            return Promise.reject(err);
        }

        // Run queries on available indexes
        const indexScanPromises = [];
        query.filters.forEach(filter => {
            if (filter.index && filter.indexUsage !== 'filter') {
                let promise = filter.index.query(filter.op, filter.compare)
                .then(results => {
                    options.eventHandler && options.eventHandler({ name: 'stats', type: 'index_query', source: filter.index.description, stats: results.stats });
                    if (results.hints.length > 0) {
                        options.eventHandler && options.eventHandler({ name: 'hints', type: 'index_query', source: filter.index.description, hints: results.hints });
                    }
                    return results;
                });
                
                // Get other filters that can be executed on these indexed results (eg filters on included keys of the index)
                const resultFilters = query.filters.filter(f => f.index === filter.index && f.indexUsage === 'filter');
                if (resultFilters.length > 0) {
                    // Hook into the promise
                    promise = promise.then(results => {
                        resultFilters.forEach(filter => {
                            let { key, op, compare, index } = filter;
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
            filtered: query.filters.length === 0,
            skipped: query.skip === 0,
            taken: query.take === 0,
            sorted: query.order.length === 0,
            preDataLoaded: false,
            dataLoaded: false
        };

        if (query.filters.length === 0 && query.take === 0) { 
            this.storage.debug.warn(`Filterless queries must use .take to limit the results. Defaulting to 100 for query on path "${path}"`);
            query.take = 100;
        }

        if (query.filters.length === 0 && query.order.length > 0 && query.order[0].index) {
            const sortIndex = query.order[0].index;
            this.storage.debug.log(`Using index for sorting: ${sortIndex.description}`);
            let ascending = query.take < 0 ? !query.order[0].ascending : query.order[0].ascending;
            const promise = sortIndex.take(query.skip, Math.abs(query.take), ascending)
            .then(results => {
                options.eventHandler && options.eventHandler({ name: 'stats', type: 'sort_index_take', source: sortIndex.description, stats: results.stats });
                if (results.hints.length > 0) {
                    options.eventHandler && options.eventHandler({ name: 'hints', type: 'sort_index_take', source: sortIndex.description, hints: results.hints });
                }
                return results;
            });
            indexScanPromises.push(promise);
            stepsExecuted.skipped = true;
            stepsExecuted.taken = true;
            stepsExecuted.sorted = true;
        }

        return Promise.all(indexScanPromises)
        .then(indexResultSets => {
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
                indexResultSets.sort((a,b) => a.length < b.length ? -1 : 1); // Sort results, shortest result set first
                const shortestSet = indexResultSets[0];
                const otherSets = indexResultSets.slice(1);

                indexedResults = shortestSet.reduce((results, match) => {
                    // Check if the key is present in the other result sets
                    const result = { key: match.key, path: match.path, val: { [shortestSet.filterKey]: match.value } };
                    const matchedInAllSets = otherSets.every(set => set.findIndex(m => m.path === match.path) >= 0);
                    if (matchedInAllSets) { 
                        match.metadata && Object.assign(result.val, match.metadata);
                        otherSets.forEach(set => {
                            const otherResult = set.find(r => r.path === result.path)
                            result.val[set.filterKey] = otherResult.value;
                            otherResult.metadata && Object.assign(result.val, otherResult.metadata)
                        });
                        results.push(result); 
                    }
                    return results;
                }, []);

                stepsExecuted.filtered = true;
            }
        
            if (isWildcardPath || (indexScanPromises.length > 0 && tableScanFilters.length === 0)) {

                if (query.order.length === 0 || query.order.every(o => o.index)) {
                    // No sorting, or all sorts are on indexed keys. We can use current index results
                    stepsExecuted.preDataLoaded = true;
                    if (!stepsExecuted.sorted && query.order.length > 0) {
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
                    const loadPartialResults = query.order.length > 0;
                    const childOptions = loadPartialResults
                        ? { include: query.order.map(order => order.key) }
                        : { include: options.include, exclude: options.exclude, child_objects: options.child_objects };
                    return loadResultsData(indexedResults, childOptions)
                    .then(results => {
                        if (query.order.length > 0) {
                            sortMatches(results);
                        }
                        stepsExecuted.sorted = true;
                        if (query.skip > 0) {
                            results = results.take < 0
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
            // const queue = [];
            const promises = [];
            let matches = [];
            let preliminaryStop = false;
            const loadPartialData = query.order.length > 0;
            const childOptions = loadPartialData
                ? { include: query.order.map(order => order.key) }
                : { include: options.include, exclude: options.exclude, child_objects: options.child_objects };

            return Node.getChildren(this.storage, path, indexKeyFilter)
            .next(child => {
                if (child.type === Node.VALUE_TYPES.OBJECT) { // if (child.valueType === VALUE_TYPES.OBJECT) {
                    if (!child.address) {
                        // Currently only happens if object has no properties 
                        // ({}, stored as a tiny_value in parent record). In that case, 
                        // should it be matched in any query? -- That answer could be YES, when testing a property for !exists. Ignoring for now
                        return;
                    }
                    if (preliminaryStop) {
                        return false;
                    }
                    // TODO: Queue it, then process in batches later... If the amount of children we're about to process is
                    // large, this will go very wrong.
                    // queue.push({ path: child.path });

                    const p = Node.matches(this.storage, child.address.path, tableScanFilters)
                    .then(isMatch => {
                        if (!isMatch) { return null; }

                        const childPath = child.address.path;
                        if (options.snapshots || query.order.length > 0) {
                            return Node.getValue(this.storage, childPath, childOptions).then(val => {
                                return { path: childPath, val };
                            });                                
                        }
                        else {
                            return { path: childPath };
                        }
                    })
                    .then(result => {
                        // If a maximumum number of results is requested, we can check if we can preliminary toss this result
                        // This keeps the memory space used limited to skip + take
                        // TODO: see if we can limit it to the max number of results returned (.take)

                        if (result !== null) {
                            matches.push(result);
                            if (query.take !== 0 && matches.length > Math.abs(query.take) + query.skip) {
                                if (query.order.length > 0) {
                                    // A query order has been set. If this value falls in between it can replace some other value
                                    // matched before. 
                                    sortMatches(matches);
                                }
                                else if (query.take > 0) {
                                    // No query order set, we can stop after 'take' + 'skip' results
                                    preliminaryStop = true; // Flags the loop that no more nodes have to be checked
                                }
                                if (query.take < 0) {
                                    matches.shift(); // toss first value
                                }
                                else {
                                    matches.pop(); // toss last value
                                }
                            }
                        }
                    });
                    promises.push(p);
                }
            })
            .catch(reason => {
                // No record?
                if (!(reason instanceof NodeNotFoundError)) {
                    this.storage.debug.warn(`Error getting child stream: ${reason}`);
                }
                return [];
            })
            .then(() => {
                // Done iterating all children, wait for all match promises to resolve

                return Promise.all(promises)
                .then(() => {
                    stepsExecuted.preDataLoaded = loadPartialData;
                    stepsExecuted.dataLoaded = !loadPartialData;
                    if (query.order.length > 0) {
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
                        return loadResultsData(matches, { include: options.include, exclude: options.exclude, child_objects: options.child_objects })
                        .then(results => {
                            stepsExecuted.dataLoaded = true;
                            return results;
                        });
                    }
                    return matches;
                });
            });
        })
        .then(matches => {
            // Order the results
            if (!stepsExecuted.sorted && query.order.length > 0) {
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

                const matchedPaths = options.snapshots ? matches.map(match => match.path) : matches.slice();
                const ref = this.db.ref(path);
                const removeMatch = (path) => {
                    const index = matchedPaths.indexOf(path);
                    if (index < 0) { return; }
                    matchedPaths.splice(index, 1);
                };
                const addMatch = (path) => {
                    if (matchedPaths.includes(path)) { return; }
                    matchedPaths.push(path);
                };
                const stopMonitoring = () => {
                    this.unsubscribe(ref.path, 'child_changed', childChangedCallback);
                    this.unsubscribe(ref.path, 'child_added', childAddedCallback);
                    this.unsubscribe(ref.path, 'notify_child_removed', childRemovedCallback);
                };
                const childChangedCallback = (err, path, newValue, oldValue) => {
                    const wasMatch = matchedPaths.includes(path);

                    let keepMonitoring = true;
                    // check if the properties we already have match filters, 
                    // and if we have to check additional properties
                    const checkKeys = [];
                    query.filters.forEach(f => !checkKeys.includes(f.key) && checkKeys.push(f.key));
                    const seenKeys = [];
                    typeof oldValue === 'object' && Object.keys(oldValue).forEach(key => !seenKeys.includes(key) && seenKeys.push(key));
                    typeof newValue === 'object' && Object.keys(newValue).forEach(key => !seenKeys.includes(key) && seenKeys.push(key));
                    const missingKeys = [];
                    let isMatch = seenKeys.every(key => {
                        if (!checkKeys.includes(key)) { return true; }
                        const filters = query.filters.filter(filter => filter.key === key);
                        return filters.every(filter => {
                            if (allowedTableScanOperators.includes(filter.op)) {
                                return this.storage.test(newValue[key], filter.op, filter.compare);
                            }
                            // specific index filter
                            if (filter.index.constructor.name === 'FullTextDataIndex' && filter.index.localeKey && !seenKeys.includes(filter.index.localeKey)) {
                                // Can't check because localeKey is missing
                                missingKeys.push(filter.index.localeKey);
                                return true; // so we'll know if all others did match
                            }
                            return filter.index.test(newValue, filter.op, filter.compare);
                        });
                    });
                    if (isMatch) {
                        // Matches all checked (updated) keys. BUT. Did we have all data needed?
                        // If it was a match before, other properties don't matter because they didn't change and won't
                        // change the current outcome

                        missingKeys.push(...checkKeys.filter(key => !seenKeys.includes(key)));

                        let promise = Promise.resolve(true);
                        if (!wasMatch && missingKeys.length > 0) {
                            // We have to check if this node becomes a match
                            const filterQueue = query.filters.filter(f => missingKeys.includes(f.key)); 
                            const simpleFilters = filterQueue.filter(f => allowedTableScanOperators.includes(f.op));
                            const indexFilters = filterQueue.filter(f => !allowedTableScanOperators.includes(f.op));
                            
                            const processFilters = () => {
                                const checkIndexFilters = () => {
                                    // TODO: ask index what keys to load (eg: FullTextIndex might need key specified by localeKey)
                                    const keysToLoad = indexFilters.reduce((keys, filter) => {
                                        if (!keys.includes(filter.key)) {
                                            keys.push(filter.key);
                                        }
                                        if (filter.index.constructor.name === 'FullTextDataIndex' && filter.index.localeKey && !keys.includes(filter.index.localeKey)) {
                                            keys.push(filter.index.localeKey);
                                        }
                                        return keys;
                                    }, []);
                                    return Node.getValue(this.storage, path, { include: keysToLoad })
                                    .then(val => {
                                        if (val === null) { return false; }
                                        return indexFilters.every(filter => filter.index.test(val, filter.op, filter.compare));
                                    })
                                }
                                if (simpleFilters.length > 0) {
                                    return Node.matches(this.storage, path, simpleFilters)
                                    .then(isMatch => {
                                        if (isMatch) {
                                            if (indexFilters.length === 0) { return true; }
                                            return checkIndexFilters();
                                        }
                                        return false;
                                    })
                                }
                                else {
                                    return checkIndexFilters();
                                }
                            }
                            promise = processFilters();
                        }
                        return promise
                        .then(isMatch => {
                            if (isMatch) {
                                if (!wasMatch) { addMatch(path); }
                                // load missing data if snapshots are requested
                                let gotValue = value => {
                                    if (wasMatch && options.monitor.change) {
                                        keepMonitoring = options.eventHandler({ name: 'change', path, value });
                                    }
                                    else if (!wasMatch && options.monitor.add) {
                                        keepMonitoring = options.eventHandler({ name: 'add', path, value });
                                    }
                                    if (keepMonitoring === false) { stopMonitoring(); }
                                };
                                if (options.snapshots) {
                                    const loadOptions = { include: options.include, exclude: options.exclude, child_objects: options.child_objects };
                                    return this.storage.getNodeValue(path, loadOptions)
                                    .then(gotValue);
                                }
                                else {
                                    return gotValue(newValue);
                                }
                            }
                            else if (wasMatch) {
                                removeMatch(path);
                                if (options.monitor.remove) {
                                    keepMonitoring = options.eventHandler({ name: 'remove', path: path, value: oldValue });
                                }
                            }
                            if (keepMonitoring === false) { stopMonitoring(); }
                        });
                    }
                    else {
                        // No match
                        if (wasMatch) {
                            removeMatch(path);
                            if (options.monitor.remove) {
                                keepMonitoring = options.eventHandler({ name: 'remove', path: path, value: oldValue });
                                if (keepMonitoring === false) { stopMonitoring(); }
                            }                                
                        }
                    }
                };
                const childAddedCallback = (err, path, newValue, oldValue) => {
                    let isMatch = query.filters.every(filter => {
                        if (allowedTableScanOperators.includes(filter.op)) {
                            return this.storage.test(newValue[filter.key], filter.op, filter.compare);
                        }
                        else {
                            return filter.index.test(newValue, filter.op, filter.compare);
                        }
                    });
                    let keepMonitoring = true;
                    if (isMatch) {
                        addMatch(path);
                        if (options.monitor.add) {
                            keepMonitoring = options.eventHandler({ name: 'add', path: path, value: options.snapshots ? newValue : null });
                        }
                    }
                    if (keepMonitoring === false) { stopMonitoring(); }
                };
                const childRemovedCallback = (err, path, newValue, oldValue) => {
                    let keepMonitoring = true;
                    removeMatch(path);
                    if (options.monitor.remove) {
                        keepMonitoring = options.eventHandler({ name: 'remove', path: path, value: options.snapshots ? oldValue : null });
                    }
                    if (keepMonitoring === false) { stopMonitoring(); }
                };
                if (options.monitor.add || options.monitor.change || options.monitor.remove) {
                    // Listen for child_changed events
                    this.subscribe(ref.path, 'child_changed', childChangedCallback);
                }
                if (options.monitor.remove) {
                    this.subscribe(ref.path, 'notify_child_removed', childRemovedCallback);
                }
                if (options.monitor.add) {
                    this.subscribe(ref.path, 'child_added', childAddedCallback);
                }
            }
        
            return { results: matches, context };
        });
    }

    /**
     * Creates an index on key for all child nodes at path
     * @param {string} path
     * @param {string} key
     * @param {object} [options]
     * @returns {Promise<DataIndex>}
     */
    createIndex(path, key, options) {
        return this.storage.indexes.create(path, key, options);
    }

    /**
     * Gets all indexes
     * @returns {Promise<DataIndex[]>}
     */
    getIndexes() {
        return Promise.resolve(this.storage.indexes.list());
    }

    async reflect(path, type, args) {
        args = args || {};
        const getChildren = async (path, limit = 50, skip = 0, from = null) => {
            if (typeof limit === 'string') { limit = parseInt(limit); }
            if (typeof skip === 'string') { skip = parseInt(skip); }
            if (['null','undefined'].includes(from)) { from = null; }
            const children = [];
            let n = 0, stop = false, more = false; //stop = skip + limit, 
            await Node.getChildren(this.storage, path)
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
                        address: typeof childInfo.address === 'object' && 'pageNr' in childInfo.address ? { pageNr: childInfo.address.pageNr, recordNr: childInfo.address.recordNr } : undefined
                    });
                }
                stop = limit > 0 && children.length === limit; // flag, but don't stop now. Otherwise we won't know if there's more
            })
            .catch(err => {
                // Node doesn't exist? No children..
            });
            return {
                more,
                list: children
            };
        }
        switch(type) {
            case "children": {
                return getChildren(path, args.limit, args.skip, args.from);
            }
            case "info": {
                const info = {
                    key: '',
                    exists: false,
                    type: 'unknown',
                    value: undefined,
                    children: {
                        count: 0,
                        more: false,
                        list: []
                    }
                };
                const nodeInfo = await Node.getInfo(this.storage, path, { include_child_count: args.child_count === true });
                info.key = typeof nodeInfo.key !== 'undefined' ? nodeInfo.key : nodeInfo.index;
                info.exists = nodeInfo.exists;
                info.type = nodeInfo.valueTypeName;
                info.value = nodeInfo.value;
                let isObjectOrArray = nodeInfo.exists && nodeInfo.address && [Node.VALUE_TYPES.OBJECT, Node.VALUE_TYPES.ARRAY].includes(nodeInfo.type);
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

    export(path, stream, options = { format: 'json' }) {
        return this.storage.exportNode(path, stream, options);
    }

    import(path, read, options = { format: 'json', suppress_events: false, method: 'set' }) {
        return this.storage.importNode(path, read, options);
    }

    async setSchema(path, schema) { 
        return this.storage.setSchema(path, schema);
    }

    async getSchema(path) { 
        return this.storage.getSchema(path);
    }

    async getSchemas() { 
        return this.storage.getSchemas();
    }

    async validateSchema(path, value, isUpdate) {
        return this.storage.validateSchema(path, value, { updates: isUpdate });
    }

    /**
     * Gets all relevant mutations for specific events on a path and since specified cursor
     * @param {object} filter
     * @param {string} [filter.path] path to get all mutations for, only used if `for` property isn't used
     * @param {Array<{ path: string, events: string[] }>} [filter.for] paths and events to get relevant mutations for
     * @param {string} filter.cursor cursor to use
     * @param {number} filter.timestamp timestamp to use
     * @returns {Promise<{ used_cursor: string, new_cursor: string, mutations: object[] }>}
     */
    async getMutations(filter) {
        if (typeof this.storage.getMutations !== 'function') { throw new Error('Used storage type does not support getMutations'); }
        if (typeof filter !== 'object') { throw new Error('No filter specified'); }
        if (typeof filter.cursor !== 'string' && typeof filter.timestamp !== 'number') { throw new Error('No cursor or timestamp given'); }
        return this.storage.getMutations(filter);
    }

    /**
     * Gets all relevant effective changes for specific events on a path and since specified cursor
     * @param {object} filter
     * @param {string} [filter.path] path to get all mutations for, only used if `for` property isn't used
     * @param {Array<{ path: string, events: string[] }>} [filter.for] paths and events to get relevant mutations for
     * @param {string} filter.cursor cursor to use
     * @param {number} filter.timestamp timestamp to use
     * @returns {Promise<{ used_cursor: string, new_cursor: string, changes: object[] }>}
     */
    async getChanges(filter) {
        if (typeof this.storage.getChanges !== 'function') { throw new Error('Used storage type does not support getChanges'); }
        if (typeof filter !== 'object') { throw new Error('No filter specified'); }
        if (typeof filter.cursor !== 'string' && typeof filter.timestamp !== 'number') { throw new Error('No cursor or timestamp given'); }
        return this.storage.getChanges(filter);
    }
}

module.exports = { LocalApi };