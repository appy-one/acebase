const { AceBase } = require('acebase');
/**
 * 
 * @param {AceBase} db 
 */
const run = (db) => {
    // Load some test data to store in the database
    
    const moviesRef = db.ref("movies");
    return moviesRef.exists()
    .then(exists => {
        if (!exists) {
            const movies = require("./testdata").movies;
            return moviesRef.set(movies);
        }
    })
    .then(() => {
        // Optional: creates indexes on year and rating keys to speed up query
        return Promise.all([
            db.indexes.create("movies", "year"),
            db.indexes.create("movies", "rating")
        ]);
    })
    .then(() => {
        return moviesRef.query()
            .where("year", "between", [1995, 2010]) // Uses index
            .where("rating", ">=", 9)               // Uses index
            .where("genres", "contains", "action")
            .order("rating", false)
            .order("votes", false)
            .skip(0)
            .take(3)
            .get({ snapshots: true });
    })
    .then(snaps => {
        let movies = snaps.map(snap => snap.val());
        console.log(`Found ${movies.length} matching movies`);
        movies.forEach(movie => {
            console.log(movie);
        });
    });

    /*
    *      // Update a movie's rating
    *      db.ref("movies/shawshank_redemption")
    *      .update({ rating: 9.8 })
    *      .then((result) => {
    *          // Done
    *      })
    * 
    *      // Monitor changes to a movies votes
    *      db.ref("movies/top_gun/votes")
    *      .on("value", (err, snapshot) => {
    *          // New value in in snapshot.value()
    *          // Note: .on does not use a promise because callback needs to run each time value changes
    *      })
    * 
    *      // Query movies with a rating higher than 5
    *      db.query("movies")
    *      .where("rating", ">=", 5)
    *      .get({ snapshots: false })
    *      .then(references => {
    *          // An array of references to matching movies
    *      })
    * 
    *      // Query movies whose title match a pattern (starts with "top ", ignoring case)
    *      // Also gets the snapshots data right away
    *      db.query("movies")
    *      .where("title", "matches", /^top /i)
    *      .get()
    *      .then(snapshots => {
    *          // An array of snapshots to matching movies
    *      })
    *
    *      // Query multiple conditions
    *      db.query("movies")
    *      .where("rating", "between", [5,8])
    *      .where("title", "matches", /^sing/i)
    *      .where("genres", "contains", "thriller") // genres array has a value "thriller"?
    *      .get()
    *      .then(snapshots => {
    *          // An array of snapshots to matching movies
    *      })
    * */    
};

module.exports = run;