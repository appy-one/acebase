const { Api } = require('acebase-core');
const { LocalAceBase } = require('./acebase-local');
const { StorageSettings } = require('./storage');
const { AceBaseStorage, AceBaseStorageSettings } = require('./storage-acebase');
const { SQLiteStorage, SQLiteStorageSettings } = require('./storage-sqlite');
const { MSSQLStorage, MSSQLStorageSettings } = require('./storage-mssql');
const { LocalStorage, LocalStorageSettings } = require('./storage-localstorage');
const { Node } = require('./node');
const { DataIndex } = require('./data-index');

class LocalApi extends Api {
    // All api methods for local database instance
    
    /**
     * 
     * @param {{db: LocalAceBase, storage: StorageSettings }} settings
     */
    constructor(dbname = "default", settings, readyCallback) {
        super();
        this.db = settings.db;

        if (SQLiteStorageSettings && (settings.storage instanceof SQLiteStorageSettings || settings.storage.type === 'sqlite')) {
            this.storage = new SQLiteStorage(dbname, settings.storage);
        }
        else if (MSSQLStorageSettings && (settings.storage instanceof MSSQLStorageSettings || settings.storage.type === 'mssql')) {
            this.storage = new MSSQLStorage(dbname, settings.storage);
        }
        else if (LocalStorageSettings && (settings.storage instanceof LocalStorageSettings || settings.storage.type === 'localstorage')) {
            this.storage = new LocalStorage(dbname, settings.storage);
        }
        else {
            const storageSettings = settings.storage instanceof AceBaseStorageSettings
                ? settings.storage
                : new AceBaseStorageSettings(settings.storage);
            this.storage = new AceBaseStorage(dbname, storageSettings);
        }
        this.storage.on("ready", readyCallback);
        // this.storage.on("datachanged", (event) => {
        //     debug.warn(`datachanged event fired for path ${event.path}`);
        //     //debug.warn(event);
        //     //storage.subscriptions.trigger(db, event.type, event.path, event.previous);
        //     this.emit("datachanged", event);
        // });        
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

    set(path, value, flags = undefined) {
        return Node.update(this.storage, path, value, { merge: false });
    }

    update(path, updates, flags = undefined) {
        return Node.update(this.storage, path, updates, { merge: true });
    }

    get(path, options) {
        return Node.getValue(this.storage, path, options);
    }

    transaction(path, callback) {
        return Node.transaction(this.storage, path, callback);
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

    query(path, query, options = { snapshots: false, include: undefined, exclude: undefined, child_objects: undefined, eventHandler: event => {} }) {
        if (typeof options !== "object") { options = {}; }
        if (typeof options.snapshots === "undefined") { options.snapshots = false; }

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
                            console.warn(`Indexed result "/${path}" does not have a record!`);
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
                            if (!stepsExecuted.skipped && results.length > query.skip + query.take) {
                                // we can toss a value! sort, toss last one 
                                sortMatches(results);
                                results.pop(); // toss last value
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

        let isWildcardPath = path.indexOf('*') >= 0;

        const availableIndexes = this.storage.indexes.get(path);
        const usingIndexes = [];
        query.filters.forEach(filter => {
            if (filter.index) { 
                // Index has been assigned already
                return; 
            }
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
                        sorting: forSorting.length * (query.take > 0 ? forSorting.length : 1),
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

        if (query.order.length > 0 && query.take > 0) {
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
        usingIndexes.length > 0 && console.log(`Using indexes for query: ${indexDescriptions}`);

        // Filters that should run on all nodes after indexed results:
        const tableScanFilters = query.filters.filter(filter => !filter.index);

        // Check if there are filters that require an index to run (such as "fulltext:contains", and "geo:nearby" etc)
        const specialOpsRegex = /^[a-z]+\:/i;
        if (tableScanFilters.some(filter => specialOpsRegex.test(filter.op))) {
            const f = tableScanFilters.find(filter => specialOpsRegex.test(filter.op));
            const err = new Error(`query contains operator "${f.op}" which requires a special index that was not found on path "${path}", key "${f.key}"`)
            return Promise.reject(err);
        }

        // Check if the filters are using valid operators
        const allowedTableScanOperators = ["<","<=","==","!=",">=",">","in","!in","matches","!matches","between","!between","has","!has","contains","!contains"]; // DISABLED "custom" because it is not fully implemented and only works locally
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
            const keys =  tableScanFilters.reduce((keys, f) => { 
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
                    options.eventHandler && options.eventHandler({ event: 'stats', type: 'index_query', source: filter.index.description, stats: results.stats });
                    if (results.hints.length > 0) {
                        options.eventHandler && options.eventHandler({ event: 'hints', type: 'index_query', source: filter.index.description, hints: results.hints });
                    }
                    return results;
                });
                
                // Get other filters that can be executed on these indexed results (eg filters on included keys of the index)
                const resultFilters = query.filters.filter(f => f.index === filter.index && f.indexUsage === 'filter');
                if (resultFilters.length > 0) {
                    // Hook into the promise
                    promise = promise.then(results => {
                        resultFilters.forEach(filter => {
                            results = results.filterMetadata(filter.key, filter.op, filter.compare);
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
            console.error(`Filterless queries must use .take to limit the results. Defaulting to 100 for query on path "${path}"`);
            query.take = 100;
        }

        if (query.filters.length === 0 && query.order.length > 0 && query.order[0].index) {
            const sortIndex = query.order[0].index;
            console.log(`Using index for sorting: ${sortIndex.description}`);
            const promise = sortIndex.take(query.skip, query.take, query.order[0].ascending)
            .then(results => {
                options.eventHandler && options.eventHandler({ event: 'stats', type: 'sort_index_take', source: filter.index.description, stats: results.stats });
                if (results.hints.length > 0) {
                    options.eventHandler && options.eventHandler({ event: 'hints', type: 'sort_index_take', source: filter.index.description, hints: results.hints });
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
                    const matchedInAllSets = otherSets.every(set => set.findIndex(m => match.path === match.path) >= 0);
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
                        indexedResults = indexedResults.slice(query.skip);
                    }
                    if (!stepsExecuted.taken && query.take > 0) {
                        indexedResults = indexedResults.slice(0, query.take);
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
                            results = results.slice(query.skip);
                        }
                        if (query.take > 0) {
                            results = results.slice(0, query.take);
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
                            if (query.take > 0 && matches.length > query.take + query.skip) {
                                if (query.order.length > 0) {
                                    // A query order has been set. If this value falls in between it can replace some other value
                                    // matched before. 
                                    sortMatches(matches);
                                }
                                else {
                                    // No query order set, we can stop after 'take' + 'skip' results
                                    preliminaryStop = true; // Flags the loop that no more nodes have to be checked
                                }
                                matches.pop(); // toss last value
                            }
                        }
                    });
                    promises.push(p);
                }
            })
            .catch(reason => {
                // No record?
                console.warn(`Error getting child stream: ${reason}`);
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
                        matches = matches.slice(query.skip);
                    }
                    stepsExecuted.skipped = true;
                    if (query.take > 0) {
                        // (should not be necessary, basically it has already been done in the loop?)
                        matches = matches.slice(0, query.take);
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
                matches = matches.slice(query.skip);
            }
            if (!stepsExecuted.taken && query.take > 0) {
                matches = matches.slice(0, query.take);
            }

            return matches;
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

    reflect(path, type, args) {
        const getChildren = (path, limit = 50) => {
            const children = [];
            let n = 0;
            return Node.getChildren(this.storage, path)
            .next(childInfo => {
                n++;
                if (limit === 0 || n <= limit) {
                    children.push({
                        key: typeof childInfo.key === 'string' ? childInfo.key : childInfo.index,
                        type: childInfo.valueTypeName,
                        value: childInfo.value,
                        // TODO: fix .address properties being used on different storage types (sqlite, mssql, localstorage etc)
                        address: childInfo.address ? { pageNr: childInfo.address.pageNr, recordNr: childInfo.address.recordNr } : undefined
                    });
                }
                if (limit > 0 && n > limit) {
                    return false; // Stop iterating
                }
            })
            .then(() => {
                return {
                    more: limit !== 0 && n > limit,
                    list: children
                };
            });
        }
        switch(type) {
            case "children": {
                return getChildren(path, args.limit);
            }
            case "info": {
                const info = {
                    key: '',
                    exists: false,
                    type: 'unknown',
                    value: undefined,
                    children: {
                        more: false,
                        list: []
                    }
                };
                return Node.getInfo(this.storage, path)
                .then(nodeInfo => {
                    info.key = nodeInfo.key;
                    info.exists = nodeInfo.exists;
                    info.type = nodeInfo.valueTypeName;
                    info.value = nodeInfo.value;
                    let hasChildren = nodeInfo.exists && nodeInfo.address && ~[Node.VALUE_TYPES.OBJECT, Node.VALUE_TYPES.ARRAY].indexOf(nodeInfo.type);
                    if (hasChildren) {
                        return getChildren(path, args.child_limit);
                    }
                })
                .then(children => {
                    info.children = children;
                    return info;
                });
            }
        }
    }

    export(path, stream, options = { format: 'json' }) {
        return this.storage.exportNode(path, stream, options);
    }
}

module.exports = { LocalApi };