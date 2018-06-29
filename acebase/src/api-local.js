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

    update(ref, updates, tid) {
        const path = ref.path;
        const storage = this.storage;

        if (!tid) { tid = uuid62.v1(); }
        return storage.lock(path, tid)
        .then(lock => {
            return Record.get(storage, { path })
        })
        .then(record => {
            if (!record) {
                return this.update(ref.parent, { [ref.key]: updates }, tid)
                .catch(err => {
                    // This currently only happens if an .update was moved to a parent, and
                    // our lock could not be moved because of (an)other conflicting transaction(s)
                    // It will have to unlock and try again (back in the line...)
                    return storage.unlock(path, tid)
                    .then(r => this.update(ref, updates, tid));
                });
            }
            else {
                return record.update(updates)
                .then(result => {
                    return storage.unlock(path, tid);
                })
                .then(() => {
                    return undefined;
                });
            }
        });

        // return Record.exists(storage, path)
        // .then(exists => {
        //     if (exists) {
        //         let tid = uuid62.v1();
        //         return storage.lock(path, tid)
        //         .then(lock => {
        //             return Record.get(storage, { path })
        //         })
        //         .then(record => {
        //             return record.update(updates);
        //         })
        //         .then(result => {
        //             return storage.unlock(path, tid);
        //         });
        //     }
        //     else {
        //         // Forward update to parent path
        //         return this.update(ref.parent, { [ref.key]: updates });
        //     }
        // })
        // .then(() => {
        //     return undefined;
        // });

        // return Record.get(this.storage, { path: ref.path })
        // .then(record => {
        //     if (!record) {
        //         // Record to update doesn't exist, forward the update to parent record 
        //         return this.update(ref.parent, { [ref.key]: updates });
        //     }
        //     //updates = this.db.types.serialize(ref.path, updates);
        //     return record.update(updates); //.then(r => this);
        // })
        // .then(() => {
        //     return undefined;
        // });
    }

    get(ref, options) {
        return Record.get(this.storage, { path: ref.path })
        .then(record => {
            if (!record) {
                return Record.get(this.storage, { path: ref.parent.path }).then(record => ({ parent: record }));
            }
            return { record };
        })
        .then(result => {
            if (!result.record && !result.parent) {
                return null;
            }
            if (result.parent) {
                return result.parent.getChildValue(ref.key);
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
        const transaction = new RecordTransaction(ref.path, callback);

        // Start by getting a lock on the record path
        const state = {
            record: undefined,
            parentRecord: undefined
        };
        this.storage.lock(ref.path, transaction.tid)
        .then(lock => {
            // Get current value
            if (ref.path === "") {
                return Record
                .get(this.storage, { path: "" })
                .then(record => {
                    state.record = record;
                    return record.getValue();
                });
            }
            else {
                // Get parent record
                //const pathInfo = getPathInfo(ref.path);
                return Record
                .get(this.storage, { path: ref.parent.path })
                .then(parentRecord => {
                    state.parentRecord = parentRecord;
                    if (!parentRecord) {
                        // Parent doesn't exist
                        return null;
                    }
                    else if (!parentRecord.hasChild(ref.key)) {
                        // Child doesn't exist
                        return null;
                    }
                    else if (parentRecord.getChildStorageType(ref.key) === "record") {
                        // Child is own record
                        return parentRecord
                        .getChildRecord(ref.key)
                        .then(record => {
                            state.record = record;
                            return record.getValue();
                        });
                    }
                    else {
                        // Child is a simple value stored within parent record
                        return parentRecord.getChildValue(ref.key);
                    }
                });
            }
        })
        .then(currentValue => {
            transaction.oldValue = cloneObject(currentValue); // Clone or it'll be adjustmented by the callback
            let newValue = callback(currentValue);
            if (newValue instanceof Promise) {
                return newValue.then(newValue => {
                    return { currentValue, newValue };
                });
            }
            return { currentValue, newValue };
        })
        .then(values => {
            const { currentValue, newValue } = values;
            if (typeof newValue === "undefined") {
                transaction.result = "canceled";
                return null; //record;
            }
            else if (newValue !== null) {
                // Mark any keys that are not present in the new value as deleted
                Object.keys(currentValue).forEach(key => {
                    if (typeof newValue[key] === "undefined") {
                        newValue[key] = null;
                    }
                });
            }                    
            transaction.newValue = newValue;
            if (state.record) {
                return state.record.update(newValue, { transaction });
            }
            else if (state.parentRecord) {
                return state.parentRecord.update( { [ref.key]: newValue })
            }
            else {
                return Record.create(this.storage, ref.path, newValue);
            }
        })
        .then(r => {
            return this.storage.unlock(ref.path, transaction.tid);
        })
        .then(success => {
            transaction.done();
        });

        return transaction.wait();
    }

    // transaction_old(ref, callback) {
    //     const transaction = new RecordTransaction(ref.path, callback);
    //     Record.resolve(this.storage, ref.path).then(address => {
    //         if (address) {
    //             let record = null;
    //             this.storage.lock(ref.path, transaction.tid)
    //             .then(lock => {
    //                 // if (!lock) {
    //                 //     transaction.fail(`Could not lock record on path "/${ref.path}"`);
    //                 // }
    //                 return Record.get(this.storage, address);
    //             })
    //             .then(rec => {
    //                 record = rec;
    //                 return record.getValue();
    //             })
    //             .then(currentValue => {
    //                 transaction.oldValue = cloneObject(currentValue); // Clone or it'll be adjustmented by the callback
    //                 let newValue = callback(currentValue);
    //                 if (newValue instanceof Promise) {
    //                     return newValue.then(newValue => {
    //                         return { currentValue, newValue };
    //                     });
    //                 }
    //                 return { currentValue, newValue };
    //             })
    //             .then(values => {
    //                 const { currentValue, newValue } = values;
    //                 if (typeof newValue === "undefined") {
    //                     transaction.result = "canceled";
    //                     return record;
    //                 }
    //                 else if (newValue !== null) {
    //                     // Mark any keys that are not present in the new value as deleted
    //                     Object.keys(currentValue).forEach(key => {
    //                         if (typeof newValue[key] === "undefined") {
    //                             newValue[key] = null;
    //                         }
    //                     });
    //                 }                    
    //                 transaction.newValue = newValue;
    //                 return record.update(newValue, { transaction });
    //             })
    //             .then(r => {
    //                 return this.storage.unlock(ref.path, transaction.tid);
    //             })
    //             .then(success => {
    //                 transaction.done();
    //             });
    //         }
    //         else {
    //             // No record at this path, check if the parent record does exist
    //             //transaction.path = ref.parent.path;
    //             Record.resolve(this.storage, ref.parent.path).then(address => {
    //                 if (!address) {
    //                     // No parent record either, nothing to lock
    //                     // Execute the callback with null as previous val
    //                     let newValue = callback(null); 
    //                     if (typeof newValue === "undefined" || newValue === null) {
    //                         transaction.result = "canceled";
    //                         transaction.done(); // nothing to do
    //                     }
    //                     else {
    //                         // Update through the ref, no need for locking because the data is all new
    //                         ref.parent.set(ref.key, newValue).then(r => {
    //                             transaction.done();
    //                         });
    //                     }
    //                 }
    //                 else {
    //                     // There is a parent record. Lock it and proceed
    //                     let record = null;
    //                     this.storage.lock(ref.parent.path, transaction.tid)
    //                     .then(lock => {
    //                         // if (!success) {
    //                         //     transaction.fail(`Could not lock record on path "/${ref.parent.path}"`);
    //                         // }
    //                         return Record.get(this.storage, address);
    //                     })
    //                     .then(rec => {
    //                         record = rec;
    //                         return record.getValue();
    //                     })
    //                     .then(parentValue => {
    //                         let currentValue = parentValue[ref.key]; //record.getChildValue(ref.key);
    //                         if (typeof currentValue === "undefined") {
    //                             // Parent didn't have this property 
    //                             currentValue = null;
    //                         }
    //                         transaction.oldValue = cloneObject(currentValue);
    //                         let newValue = callback(currentValue);
    //                         return newValue;
    //                     })
    //                     .then(newValue => {
    //                         if (typeof newValue === "undefined") {
    //                             transaction.result = "canceled";
    //                             return record;
    //                         }
    //                         transaction.newValue = newValue; //parentValue[ref.key] = ...
    //                         //return record.update(parentValue, { transaction });
    //                         return record.update({ [ref.key]: newValue }, { transaction });
    //                     })
    //                     .then(r => {
    //                         return this.storage.unlock(ref.parent.path, transaction.tid);
    //                     })
    //                     .then(success => {
    //                         transaction.done();
    //                     });
    //                 }
    //             });
    //         }
    //     });
    //     return transaction.wait();

    //     //return Record.transaction(this.storage, { path: ref.path }, callback);
    // }

    exists(ref) {
        return Record.get(this.storage, { path: ref.path })
        .then(record => {
            if (!record) {
                // Check parent
                return Record.get(this.storage, { path: ref.parent.path } ).then(record => {
                    if (!record) { return false; }
                    return record.hasChild(ref.key);
                });
            }
            return true;
        });
    }

    query(ref, query, options = { snapshots: false, include: undefined, exclude: undefined, child_objects: undefined }) {
        if (typeof options !== "object") { options = {}; }
        if (typeof options.snapshots === "undefined") { options.snapshots = false; }
        // return Record.get(this.storage, { path: ref.path })
        // .then(record => {
        //     if (!record) {
        //         return [];
        //     }
        //     const promises = [];
        //     // TODO: create a record.childStream().next() implementation that will prevent the memory 
        //     // from being filled with all children, which could be very many
        //     //record.children().forEach(child => {
        //     return record.childStream().next(child => {
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
                const p = Record.get(this.storage, child.address).then(childRecord => { // record.getChildRecord(child.key).then(childRecord => {
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
        //});
    }
}

module.exports = { LocalApi };