const local = false;
const db = local 
    ? require('./local') 
    : require('./client-server');

db.on("ready", () => {
    console.log(`database ready to use`);

    // Run tests
    require("./tests/movies")(db);
    require("./tests/users")(db);
    require("./tests/exclude")(db);
    require("./tests/regexp")(db);
    require("./tests/binary")(db);
    require("./tests/transaction")(db);
    require("./tests/getset")(db);
    require("./tests/stats")(db);
    //require("./tests/indexing");

});