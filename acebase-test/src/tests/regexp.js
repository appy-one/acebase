const { AceBase } = require('acebase');
/**
 * 
 * @param {AceBase} db 
 */
const run = (db) => {
    // Add type mapping for a native class
    const toRegularExpression = (plainObj) => {
        return new RegExp(plainObj.pattern, plainObj.flags);
    }
    const toPlainObject = (regexp) => {
        return { pattern: regexp.source, flags: regexp.flags };
    }

    // Bind all child objects of /regular_expressions to our serializing and deserialization function
    db.types.bind("regular_expressions", toRegularExpression, { instantiate: false, serializer: toPlainObject });

    // Now store a regular expression
    return db.ref("regular_expressions/words").set(/\w+/g)
    .then(ref => {
        // regular expression was successfully stored as a plain object in the database
        return ref.get();
    })
    .then(snap => {
        let re = snap.val();
        console.log(re);
        let text = "value is a regular expression that was loaded from the database and deserialized to a real RegExp object";
        let allWords = text.match(re);
        console.log(allWords);
        console.assert(allWords.length === 18, "there should be 18 matched words in the array");
    });
};

module.exports = run;