const { AceBase } = require('acebase');
/**
 * 
 * @param {AceBase} db 
 */
const run = (db) => {
    return db.ref("ewout")
    .set({ 
        name: "Ewout"
    })
    .then(ref => {
        return ref.get();
    })
    .then(snap => {
        let val = snap.val();
        console.log(val);
    });
}

module.exports = run;