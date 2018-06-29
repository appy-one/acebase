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

    unsubscribe(ref, event = undefined, callback = undefined) {}
    update(ref, updates) {}
    set(ref, value) {}
    get(ref, options = undefined) {}
    exists(ref) {}
    query(ref, query, options = { snapshots: false }) {}
}

module.exports = { Api };