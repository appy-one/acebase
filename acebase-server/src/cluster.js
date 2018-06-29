const JasonDB = require('./jasondb');
const JasonServer = require('./acebase-server');
const cluster = require('cluster');
const numCPUs = 2; // require('os').cpus().length;

let dbname = "default";
let options = { /* default options */ }; // Load from cluster.config.js!

if (cluster.isMaster) {
    // Startup master
    console.log(`Master ${process.pid} is running`);

    options.cluster = {
        enabled: true,
        isMaster: true,
        workers: []
    };

    for (let i = 0; i < numCPUs; i++) {
        let worker = cluster.fork();
        worker.on("disconnect", (worker, code, signal) => {
            console.error(`worker ${worker.process.pid} disconnected`);
        });
        options.cluster.workers.push(worker);
    }

    process.on("unhandledRejection", (reason, p) => {
        console.log("Unhandled Rejection in master ", process.pid, " at: ", reason.stack);
    });

    console.log(`Starting database server with ${options.cluster.workers.length} workers`);
    const master = new JasonDB(dbname, options);
    master.once("ready", () => {
        console.log(`Master database server started on process ${process.pid}`);
    });

    cluster.on("exit", (worker, code, signal) => {
        console.error(`worker ${worker.process.pid} died`);
    });
}
else {
    console.log(`Worker ${process.pid} is running`);

    options.cluster = {
        enabled: true,
        isMaster: false,
        master: process
    };
    process.on("unhandledRejection", (reason, p) => {
        console.log("Unhandled Rejection in worker ", process.pid, " at: ", reason.stack);
    });

    const workerServer = new JasonServer(dbname, options);
    workerServer.once("ready", () => {
        console.log(`Worker database server started on process ${process.pid}`);
    });

}
