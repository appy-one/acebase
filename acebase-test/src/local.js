const { AceBase } = require('acebase');

const db = new AceBase("local");
db.on("ready", ()=> {
    console.log(`LOCAL ready`);
});

module.exports = db;