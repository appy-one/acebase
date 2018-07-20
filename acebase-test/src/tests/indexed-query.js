const { AceBase } = require('acebase');
const { Storage } = require('acebase/src/storage');
/**
 * 
 * @param {AceBase} db 
 */
const run = (db) => {
    /**
     * @type Storage
     */
    const storage = db.api.storage; // This manual plumbing is temporary (won't work in client/server mode), will be refactored once indexing is solid
    const indexes = storage.indexes;
    return indexes.create("movies", "year")
    .then(() => {
        return indexes.query("movies", "year", "between", [1990, 2000]);
    })
    .then(results => {
        console.log(`Got ${results.length} indexed query results`);
        console.log(results);
        //console.assert(results.length === 7, "There must be 7 movies matching")
    });
}

module.exports = run;