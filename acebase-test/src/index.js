// require("./tests/indexing");
// return;

const local = true;
const db = local 
    ? require('./local') 
    : require('./client-server');

db.on("ready", () => {
    console.log(`database ready to use`);

    // Run tests
    let tests = [
        require("./tests/movies")(db),
        require("./tests/users")(db),
        require("./tests/exclude")(db),
        require("./tests/regexp")(db),
        require("./tests/binary")(db),
        require("./tests/transaction")(db),
        require("./tests/getset")(db),
        local ? require("./tests/indexed-query")(db) : null,
        // require("./tests/stats")(db)
    ];

    Promise.all(tests)
    .then(results => {
        console.log("All tests completed");

        // db.root.get()
        // .then(snapshot => {
        //     const allData = snapshot.val();
        //     //console.log(JSON.stringify(allData));
        //     console.log(Object.keys(allData.binary).length + " keys in /binary");
        //     console.log(Object.keys(allData.binary));
        // });
    });
    //require("./tests/indexing");

});