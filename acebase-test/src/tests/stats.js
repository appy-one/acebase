const { AceBase } = require('acebase');
/**
 * 
 * @param {AceBase} db 
 */
const run = (db) => {

    if (!db.api) {
        return console.error(`No api available`);
    }
    db.api.stats().then(stats => {
        console.log(stats);
    });

};

module.exports = run;