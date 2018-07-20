const { Api } = require('./api');
const { AceBase } = require('./acebase');
const { Storage } = require('./storage');
const { Record, RecordTransaction, VALUE_TYPES } = require('./record');
//const { DataSnapshot } = require('./data-snapshot');
const uuid62 = require('uuid62');
const { cloneObject } = require('./utils');

class LocalApi extends Api {
    // All api methods for local database instance
    
    /**
     * 
     * @param {AceBase} db | reference to the database
     * @param {Storage} storage | reference to the used Storage
     */
    constructor(db, storage) {
        super();
        this.db = db;
        this.storage = storage;
    }

    stats(options) {
        return Promise.resolve(this.storage.stats);
    }

    subscribe(ref, event, callback) {
        this.storage.subscriptions.add(ref.path, event, callback);
    }

    unsubscribe(ref, event = undefined, callback = undefined) {
        this.storage.subscriptions.remove(ref.path, event, callback);
    }

    set(ref, value) {
        // Pass set onto parent.update
        return ref.parent.update({ [ref.key]: value });
    }

    update(ref, updates) {
        return Record.update(this.storage, ref.path, updates);
    }

    get(ref, options) {
        return Record.get(this.storage, { path: ref.path })
        .then(record => {
            if (!record) {
                return Record.get(this.storage, { path: ref.parent.path })
                .then(record => ({ parent: record }));
            }
            return { record };
        })
        .then(result => {
            if (!result.record && !result.parent) {
                return null;
            }
            if (result.parent) {
                return result.parent.getChildInfo(ref.key)
                .then(info => info.exists ? info.value : null);
            }
            // if (!options) { options = {}; }
            // else { options = cloneObject(options); }
            // options.types = this.db.types;
            return result.record.getValue(options);
        })
        .then(value => {
            return value;
        });
    }

    transaction(ref, callback) {
        return Record.transaction(this.storage, ref.path, callback);
    }

    exists(ref) {
        return Record.exists(this.storage, ref.path);
    }

    query(ref, query, options = { snapshots: false, include: undefined, exclude: undefined, child_objects: undefined }) {
        if (typeof options !== "object") { options = {}; }
        if (typeof options.snapshots === "undefined") { options.snapshots = false; }
        const promises = [];
        return Record.getChildStream(this.storage, { path: ref.path })
        .next(child => {
            if (child.type === VALUE_TYPES.OBJECT) { // if (child.valueType === VALUE_TYPES.OBJECT) {
                if (!child.address) { //if (child.storageType !== "record") {
                    // Currently only happens if object has no properties 
                    // ({}, stored as a tiny_value in parent record). In that case, 
                    // should it be matched in any query? -- That answer could be YES, when testing a property for !exists
                    return;
                }
                const p = Record.get(this.storage, child.address)
                .then(childRecord => { // record.getChildRecord(child.key).then(childRecord => {
                    return childRecord.matches(query.filters).then(isMatch => {
                        if (isMatch) {
                            const childPath = ref.child(child.key).path; //const childRef = ref.child(child.key);
                            if (options.snapshots) {
                                // TODO: Refactor usage of types to global include/exclude
                                // return childRecord.getValue({ types: ref.db.types }).then(val => {
                                //     val = ref.db.types.deserialize(childRef.path, val);
                                //     return { path: childPath, val }; //new DataSnapshot(childRef, val);
                                // });
                                const childOptions = {
                                    include: options.include,
                                    exclude: options.exclude,
                                    child_objects: options.child_objects
                                };
                                return childRecord.getValue(childOptions).then(val => {
                                    return { path: childPath, val }; //new DataSnapshot(childRef, val);
                                });
                            }
                            return childPath; //return childRef;
                        }
                        return null;
                    });
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
            // Done iterating all children
            return Promise.all(promises).then(matches => {
                // All records have been processed, ones that didn't match will have resolved with null
                matches = matches.filter(m => m !== null); // Only keep real records

                // Order the results
                if (query.order.length > 0) {
                    matches = matches.sort((a,b) => {
                        const compare = (i) => {
                            const o = query.order[i];
                            const left = a[o.key];//a.val()[o.key];
                            const right = b[o.key]; //b.val()[o.key];
                            if (typeof left !== typeof right) {
                                // Wow. Using 2 different types in your data, AND sorting on it. 
                                // compare the types instead of their values ;-)
                                left = typeof left;
                                right = typeof right;
                            }
                            if (left === right) {
                                if (i < query.order.length - 1) { return compare(i+1); }
                                else { return 0; }
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
                }

                // Limit result set
                if (query.skip > 0) {
                    matches = matches.slice(query.skip);
                }
                if (query.take > 0) {
                    matches = matches.slice(0, query.take);
                }

                return matches;
            });
        });
    }

}

module.exports = { LocalApi };