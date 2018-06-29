const { AceBase } = require('acebase');
const { WebApi } = require('./api-web');
//const { EventEmitter } = require('events');

class AceBaseClient extends AceBase {
    constructor(host, port, dbname) {
        //TODO: https
        super(dbname, { api: { class: WebApi, settings: `http://${host}:${port}` } });
    }
}

// class AceBaseClient extends EventEmitter {
//     constructor(host, port, dbname) {
//         super();
        
//         //TODO: https
//         //const api = new WebApi(, dbname, (ready) => {
//             const db = new AceBase(dbname, { api: { class: WebApi, settings: `http://${host}:${port}` } }); // 
//             this.types = db.types;
//             //this.schema = db.schema;
//             this.ref = db.ref;

//             db.on("ready", () => {
//                 this.emit("ready");
//             });
//         //    this.emit("ready");
//         //});

//     }
// }

module.exports = { AceBaseClient };