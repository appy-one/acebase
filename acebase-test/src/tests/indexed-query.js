const { AceBase } = require('acebase');
const { Storage } = require('acebase/src/storage');
/**
 * 
 * @param {AceBase} db 
 */
const run = (db) => {
    // Create an index on "/movies" as soon as it is created, or changed.
    db.ref("movies")
    .on("value")
    .subscribe(snapshot => {
        if (!snapshot.exists()) { 
            return; 
        }
        /**
         * @type Storage
         */
        const storage = db.api.storage; // This manual plumbing is temporary (won't work in client/server mode), will be refactored once indexing is solid
        const indexes = storage.indexes;    
        return Promise.all(
            indexes.create("movies", "year"),
            indexes.create("movies", "rating")
        )
        .then(indexes => {
            return Promise.all(
                indexes[0].query(indexes[0], "between", [1990, 2000]),
                indexes[1].query(indexes[1], ">=", 9)
            );
        })
        .then(results => {
            console.log(`Got ${results.length} indexed query results`);
            console.log(results);
        });
    });
}

module.exports = run;