const { DataReference } = require('./data-reference');

class Api {
    // interface for local and web api's
    stats(options = undefined) {}

    /**
     * 
     * @param {DataReference} ref | reference
     * @param {string} event | event to subscribe to ("value", "child_added" etc)
     * @param {function} callback | callback function(err, path, value)
     */
    subscribe(ref, event, callback) {}

    // TODO: add jsdoc comments

    unsubscribe(ref, event, callback) {}
    update(ref, updates) {}
    set(ref, value) {}
    get(ref, options) {}
    exists(ref) {}
    query(ref, query, options) {}
    createIndex(path, key) {}
    getIndexes() {}
}

module.exports = { Api };