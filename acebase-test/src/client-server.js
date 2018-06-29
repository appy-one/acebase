const { AceBaseServer } = require('acebase-server');
const { AceBaseClient } = require('acebase-client');

const dbname = "server";
const server = new AceBaseServer(dbname, { host: "localhost", port: 3454 });
server.on("ready", () => {
    console.log("SERVER ready");
});

const db = new AceBaseClient("localhost", 3454, dbname);
db.on("ready", () => {
    console.log("CLIENT ready");
});

module.exports = db;