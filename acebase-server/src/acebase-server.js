
const { EventEmitter } = require('events');
const { AceBase, AceBaseSettings, transport } = require('acebase');

class AceBaseClusterSettings {
    constructor(settings) {
        this.enabled = typeof settings === "object" ? true : false;
        this.isMaster = this.enabled && settings.isMaster;
        this.master = this.enabled ? settings.master : process;
        this.workers = this.enabled ? settings.workers : [process];
    }
}

class AceBaseServerSettings {
    constructor(settings) {
        if (typeof settings !== "object") { settings = {}; }
        this.logLevel = settings.logLevel || "error";
        this.host = settings.host || "localhost";
        this.port = settings.port || 3000;
        this.cluster = new AceBaseClusterSettings(settings.cluster);
    }
}

class AceBaseServer extends EventEmitter {

    /**
     * 
     * @param {string} dbname 
     * @param {AceBaseServerSettings} options 
     */
    constructor(dbname, options = new AceBaseServerSettings()) {

        const app = require('express')();
        const bodyParser = require('body-parser');
        const server = require('http').createServer(app);
        const io = require('socket.io').listen(server);
        
        super();
        this.config = {
            hostname: options.host,
            port: options.port
        };
        this.url = `http://${options.host}:${options.port}`;
        
        const dbOptions = new AceBaseSettings({
            logLevel: options.logLevel,
            storage: {
                cluster: options.cluster
            },
        });

        const db = new AceBase(dbname, dbOptions);

        // process.on("unhandledRejection", (reason, p) => {
        //     console.log("Unhandled Rejection at: ", reason.stack);
        // });
        db.once("ready", () => {
            //console.log(`Database "${dbname}" is ready to use`);
            
            server.on("error", (err) => {
                console.log(err);
            });

            server.listen(this.config.port, this.config.hostname, () => {
                console.log(`"${dbname}" database server running at http://${this.config.hostname}:${this.config.port}/`);
                this.emit("ready");
            });

            app.use(bodyParser.json());
            app.get("/", (req, res) => {
                res.sendFile(__dirname + "/index.html");
            });

            app.get("/info", (req, res) => {
                let obj = {
                    time: new Date(), 
                    process: process.pid,
                    dbname: dbname
                }
                res.send(obj);
            });

            app.get(`/data/${dbname}/*`, (req, res) => {
                // Request data
                const options = {};
                if (req.query.include) {
                    options.include = req.query.include.split(',');
                }
                if (req.query.exclude) {
                    options.exclude = req.query.exclude.split(',');
                }
                if (typeof req.query.child_objects === "boolean") {
                    options.child_objects = req.query.child_objects;
                }

                const path = req.path.substr(dbname.length + 7);
                db.ref(path)
                .get(options) //.once("value")
                .then(snap => {
                    const ser = transport.serialize(snap.val());
                    const data = {
                        exists: snap.exists(),
                        val: ser.val,
                        map: ser.map
                    }         
                    res.send(data);
                })
                .catch(err => {
                    res.statusCode = 500;
                    res.send(err);
                });
            });

            app.get(`/exists/${dbname}/*`, (req, res) => {
                // Exists query
                const path = req.path.substr(dbname.length + 9);
                db.ref(path)
                .exists()
                .then(exists => {
                    res.send({ exists });
                })
                .catch(err => {
                    res.statusCode = 500;
                    res.send(err);
                });
            });

            app.get(`/stats/${dbname}`, (req, res) => {
                // Exists query
                const path = req.path.substr(dbname.length + 8);
                db.api.stats()
                .then(stats => {
                    res.send(stats);
                })
                .catch(err => {
                    res.statusCode = 500;
                    res.send(err);
                });
            });
            
            app.post(`/data/${dbname}/*`, (req, res) => {
                // update data
                const path = req.path.substr(dbname.length + 7);
                const data = req.body;
                const val = transport.deserialize(data);

                db.ref(path)
                .update(val)
                .then(ref => {
                    res.send({
                        success: true
                    });
                })
                .catch(err => {
                    console.error(err);
                    res.statusCode = 500;
                    res.send(err);
                });
            });

            app.put(`/data/${dbname}/*`, (req, res) => {
                // Set data
                const path = req.path.substr(dbname.length + 7);
                const data = req.body;
                const val = transport.deserialize(data);

                db.ref(path)
                .set(val)
                .then(ref => {
                    res.send({
                        success: true
                    });
                })
                .catch(err => {
                    console.error(err);
                    res.statusCode = 500;
                    res.send(err);
                });
            });

            app.post(`/query/${dbname}/*`, (req, res) => {
                // Execute query
                const path = req.path.substr(dbname.length + 8);
                const data = transport.deserialize(req.body);
                //const ref = db.ref(path);
                const query = db.query(path);
                data.query.filters.forEach(filter => {
                    query.where(filter.key, filter.op, filter.compare);
                });
                data.query.order.forEach(order => {
                    query.order(order.key, order.ascending);
                });
                if (data.query.skip > 0) {
                    query.skip(data.query.skip);
                }
                if (data.query.take > 0) {
                    query.take(data.query.take);
                }
                query.get(data.options).then(results => {
                    const response = {
                        count: results.length,
                        list: []
                    };
                    results.forEach(result => {
                        if (data.options.snapshots) {
                            response.list.push({ path: result.ref.path, val: result.val() });
                        }
                        else {
                            response.list.push(result.path);
                        }
                    });
                    res.send(transport.serialize(response));
                });
            });

            app.get(`/index/${dbname}`, (req, res) => {
                // Get all indexes
                db.indexes.list()
                .then(indexes => {
                    res.send(indexes);
                });
            });

            app.post(`/index/${dbname}`, (req, res) => {
                // create index
                const data = req.body;
                if (data.action === "create") {
                    db.indexes.create(data.path, data.key)
                    .then(() => {
                        res.send({ success: true });
                    })
                    .catch(err => {
                        console.error(err);
                        res.statusCode = 500;
                        res.send(err);         
                    })
                }
            });

            // Websocket implementation:
            const clients = {
                list: [],
                get(id) {
                    return this.list.find(client => client.id === id);
                },
                add(id) {
                    const client = {
                        id,
                        subscriptions: {},
                        transactions: {}
                    };
                    this.list.push(client);
                    return client;
                },
                /**
                 * @param {string|object} client | client id or object 
                 */
                remove(client) {
                    let index = -1;
                    if (typeof client === "object") {
                        index = this.list.indexOf(client);
                    }
                    else {
                        index = this.list.findIndex(c => c.id === client);
                    }
                    if (index >= 0) {
                        this.list.splice(index, 1);
                    }
                }
            };

            io.sockets.on("connection", socket => {
                clients.add(socket.id);
                console.log(`New client connected, total: ${clients.list.length}`);
                //socket.emit("welcome");

                socket.on("disconnect", data => {
                    // We lost one
                    const client = clients.get(socket.id);
                    if (client.subscriptions.length > 0) {
                        let remove = [];
                        Object.keys(client.subscriptions).forEach(path => {
                            remove.push(...client.subscriptions[path]);
                        })
                        remove.forEach(subscr => {
                            // Unsubscribe them at db level and remove from our list
                            db.ref(data.path).off(subscr.event, subscr.callback);
                            pathSubs.splice(pathSubs.indexOf(subscr), 1);
                        });
                    }
                    clients.remove(client);
                    console.log(`Socket disconnected, total: ${clients.list.length}`);
                });

                socket.on("subscribe", data => {
                    // Client wants to subscribe to events on a node
                    const subscriptionPath = data.path;
                    const callback = (err, path, result) => {
                        if (err) {
                            return;
                        }
                        let val = transport.serialize(result);
                        console.log(`Sending data event ${data.event} for path "${data.path}" to client ${socket.id}`);
                        socket.emit("data-event", {
                            subscr_path: subscriptionPath,
                            path,
                            event: data.event,
                            val
                        });
                    };
                    console.log(`Client ${socket.id} subscribes to event ${data.event} on path "${data.path}"`);
                    const client = clients.get(socket.id);
                    let pathSubs = client.subscriptions[subscriptionPath];
                    if (!pathSubs) { pathSubs = client.subscriptions[subscriptionPath] = []; }
                    pathSubs.push({ path: subscriptionPath, event: data.event, callback });

                    db.api.subscribe(db.ref(subscriptionPath), data.event, callback);
                    //db.ref(data.path).on(data.event, callback);
                });

                socket.on("unsubscribe", data => {
                    // Client unsubscribes from events on a node
                    console.log(`Client ${socket.id} is unsubscribing from event ${data.event || "(any)"} on path "${data.path}"`);
                    
                    const client = clients.get(socket.id);
                    let pathSubs = client.subscriptions[data.path];
                    if (!pathSubs) {
                        return; // We have no knowledge of any active subscriptions on this path
                    }
                    let remove = pathSubs;
                    if (data.event) {
                        // Unsubscribe from a specific event
                        remove = pathSubs.filter(subscr => subscr.event === data.event);
                    }
                    remove.forEach(subscr => {
                        // Unsubscribe them at db level and remove from our list
                        //console.log(`   - unsubscribing from event ${subscr.event} with${subscr.callback ? "" : "out"} callback on path "${data.path}"`);
                        db.api.unsubscribe(db.ref(data.path), subscr.event, subscr.callback);
                        pathSubs.splice(pathSubs.indexOf(subscr), 1);
                    });
                    if (pathSubs.length === 0) {
                        // No subscriptions left on this path, remove the path entry
                        delete client.subscriptions[data.path];
                    }
                });

                socket.on("transaction", data => {
                    console.log(`Client ${socket.id} is sending ${data.action} transaction request on path "${data.path}"`);
                    const client = clients.get(socket.id);

                    if (data.action === "start") {
                        // Start a transaction
                        let tx = {
                            id: data.id,
                            started: Date.now(),
                            path: data.path,
                            finish: undefined
                        };
                        client.transactions[data.id] = tx;
                        console.log(`Transaction ${tx.id} starting...`);
                        const ref = db.ref(tx.path);
                        db.api.transaction(ref, val => { //db.ref(tx.path).transaction(snap => {
                            console.log(`Transaction ${tx.id} started with value: `, val);
                            //let currentValue = snap.val();
                            let currentValue = transport.serialize(val);
                            socket.emit("tx_started", { id: tx.id, value: currentValue });
                            return new Promise((resolve) => {
                                tx.finish = resolve;
                            });
                        })
                        .then(res => {
                            console.log(`Transaction ${tx.id} finished`);
                            socket.emit("tx_completed", { id: tx.id });
                            delete client.transactions[tx.id];
                        });
                    }

                    if (data.action === "finish") {
                        // Finish transaction
                        let tx = client.transactions[data.id];
                        if (!tx) {
                            console.error(`Can't finish unknown transaction with id: ${data.id}`);
                            return;
                        }
                        const newValue = transport.deserialize(data.value);
                        tx.finish(newValue);
                    }
                            
                });

            });
        });
    }
}

if (__filename.replace(/\\/g,"/").endsWith("/acebase-server.js") && process.argv[2] === "start") {
    // If one executed "node server.js start [hostname] [port]"
    const dbname = process.argv[3] || "default";
    const options = { host: process.argv[4], port: process.argv[5] };
    const server = new AceBaseServer(dbname, options);
    server.once("ready", () => {
        console.log(`AceBase server running`);
    });
}

module.exports = { AceBaseServer, AceBaseServerSettings, AceBaseClusterSettings };