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
        return true;
    })
    .then(() => {
        return moviesRef.query()
            .where("year", "between", [1990, 2010])
            .where("genres", "contains", "action")
            .order("rating", false)
            .order("votes", false)
            .skip(0)
            .take(3)
            .get({ snapshots: true, exclude: ["genres"] });
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
    *      db.ref("top100/shawshank_redemption")
    *      .update({ rating: 9.8 })
    *      .then((result) => {
    *          // Done
    *      })
    * 
    *      // Monitor changes to a movies votes
    *      db.ref("top100/top_gun/votes")
    *      .on("value", (err, snapshot) => {
    *          // New value in in snapshot.value()
    *          // Note: .on does not use a promise because callback needs to run each time value changes
    *      })
    * 
    *      // Query movies with a rating higher than 5
    *      db.ref("top100")
    *      .filter("rating", ">=", 5)
    *      .query()
    *      .then(references => {
    *          // An array of references to matching movies
    *      })
    * 
    *      // Query movies whose title match a pattern (starts with "top ", ignoring case)
    *      // Also gets the snapshots data right away
    *      db.ref("top100")
    *      .filter("title", "matches", /^top /i)
    *      .query({ snapshots: true })
    *      .then(snapshots => {
    *          // An array of snapshots to matching movies
    *      })
    *
    *      // Query multiple conditions
    *      db.ref("top100")
    *      .filter("rating", "between", [5,8])
    *      .filter("title", "matches", /^sing/i)
    *      .filter("genres", "contains", "thriller") // genres array has a value "thriller"?
    *      .query({ snapshots: true })
    *      .then(snapshots => {
    *          // An array of snapshots to matching movies
    *      })
    * */    
};

module.exports = run;