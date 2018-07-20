const { AceBase } = require('acebase');
const { TextEncoder, TextDecoder } = require('text-encoding');
/**
 * 
 * @param {AceBase} db 
 */
const run = (db) => {
    let text = "Is this binary data stored correctly? 😎";
    let binary = new TextEncoder().encode(text);
    
    return db.ref("/binary")
    .push(binary.buffer)
    .then((ref) => {
        console.log(`Binary data was stored at "/${ref.path}"`);
        return ref.get(); //res.ref.once("value");
    })
    .then(snap => {
        console.log(`Binary reloaded from database`);
        let binary = snap.val();
        let str = new TextDecoder().decode(binary);
        console.log(`${str}`);
        console.assert(str === text, "loaded text must be the same as the stored text");
    });
};

module.exports = run;