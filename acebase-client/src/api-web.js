const { Api, transport, debug } = require('acebase');
const http = require('http');
const connectSocket = require('socket.io-client');
const URL = require('url');

const _request = (method, url, postData) => {
    return new Promise((resolve, reject) => {
        let endpoint = URL.parse(url);

        if (typeof postData === "undefined") {
            postData = "";
        }
        const options = {
            method: method,
            protocol: endpoint.protocol,
            host: endpoint.hostname,
            port: endpoint.port,
            path: endpoint.path, //.pathname,
            headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(postData)
            }
        };
        const req = http.request(options, res => {
            if (res.statusCode !== 200) {
                return reject(new Error(`server error ${res.statusCode}: ${res.statusMessage}`));
            }
            res.setEncoding("utf8");
            let data = "";
            res.on("data", chunk => { data += chunk; });
            res.on("end", () => {
                let val = JSON.parse(data);
                resolve(val);
            });
        });
        if (postData.length > 0) {
            req.write(postData);
        }
        req.end();
    });
};

/**
 * Api to connect to a remote AceBase instance over http
 */
class WebApi extends Api {
    constructor(dbname = "default", url, readyCallback) {
        // operations are done through http calls,
        // events are triggered through a websocket
        super();

        this.url = url;
        this.dbname = dbname;
        debug.log(`Connecting to AceBase server" ${url}"`);

        let subscriptions = {};
        const socket = this.socket = connectSocket(url);
        
        socket.on("connect_error", (data) => {
            debug.error(`Websocket connection error: ${data}`);
            //debug.error(data);
        });

        socket.on("connect_timeout", (data) => {
            debug.error(`Websocket connection timeout`);
            //debug.error(data);
        });

        // socket.on("disconnect", (data) => {
        //     // Try to reconnect. Should do this in a retry loop
        //     socket.connect();
        // });

        let reconnectSubs = null;

        socket.on("connect", (data) => {
            if (readyCallback) {
                readyCallback();
                readyCallback = null; // once! :-)
            }
            // Resubscribe to any active subscriptions
            if (reconnectSubs === null) { return; }
            Object.keys(reconnectSubs).forEach(path => {
                reconnectSubs[path].forEach(subscr => {
                    this.subscribe(subscr.ref, subscr.event, subscr.callback);
                });
            });
            reconnectSubs = null;
        });

        socket.on("disconnect", (data) => {
            reconnectSubs = subscriptions;
            subscriptions = {};
        });

        socket.on("data-event", data => {
            const pathSubs = subscriptions[data.subscr_path];
            if (!pathSubs) {
                // weird. we are not subscribed on this path?
                debug.warn(`Received a data-event on a path we did not subscribe to: "${data.path}"`);
                return;
            }
            pathSubs.forEach(subscr => {
                if (subscr.event === data.event) {
                    let val = transport.deserialize(data.val);
                    subscr.callback(null, data.path, val);
                }
            });
        });

        this.subscribe = (ref, event, callback) => {
            let pathSubs = subscriptions[ref.path];
            if (!pathSubs) { pathSubs = subscriptions[ref.path] = []; }
            pathSubs.push({ ref, event, callback });
            socket.emit("subscribe", { path: ref.path, event });
        };

        this.unsubscribe = (ref, event = undefined, callback = undefined) => {
            let pathSubs = subscriptions[ref.path];
            if (!pathSubs) { return; }
            if (!event) {
                // Unsubscribe from all events
                pathSubs = [];
            }
            else if (!callback) {
                // Unsubscribe from specific event
                const remove = pathSubs.filter(subscr => subscr.event === event);
                remove.forEach(subscr => pathSubs.splice(pathSubs.indexOf(subscr), 1));
            }
            else {
                // Unsubscribe from a specific callback
                const remove = pathSubs.filter(subscr => subscr.event === event && subscr.callback === callback);
                remove.forEach(subscr => pathSubs.splice(pathSubs.indexOf(subscr), 1));
            }

            if (pathSubs.length === 0) {
                // Unsubscribe from all events on path
                delete subscriptions[ref.path];
                socket.emit("unsubscribe", { path: ref.path });
            }
            else if (pathSubs.reduce((c, subscr) => c + (subscr.event === event ? 1 : 0), 0) === 0) {
                // No callbacks left for specific event
                socket.emit("unsubscribe", { path: ref.path, event });
            }
        };

        this.transaction = (ref, callback) => {
            const id = require('uuid62').v1();
            const startedCallback = (data) => {
                if (data.id === id) {
                    socket.off("tx_started", startedCallback);
                    const currentValue = transport.deserialize(data.value);
                    const val = callback(currentValue);
                    const finish = (val) => {
                        const newValue = transport.serialize(val);
                        socket.emit("transaction", { action: "finish", id: id, path: ref.path, value: newValue });
                    };
                    if (val instanceof Promise) {
                        val.then(finish);
                    }
                    else {
                        finish(val);
                    }
                }
            }
            let txResolve;
            const completedCallback = (data) => {
                if (data.id === id) {
                    socket.off("tx_completed", completedCallback);
                    txResolve(this);
                }
            }
            socket.on("tx_started", startedCallback);
            socket.on("tx_completed", completedCallback);
            socket.emit("transaction", { action: "start", id, path: ref.path });
            return new Promise((resolve) => {
                txResolve = resolve;
            });
        };
    }

    stats(options = undefined) {
        return _request("GET", `${this.url}/stats/${this.dbname}`);
    }

    set(ref, value) {
        const data = JSON.stringify(transport.serialize(value));
        return _request("PUT", `${this.url}/data/${this.dbname}/${ref.path}`, data)
            .then(result => ref);
    }

    update(ref, updates) {
        const data = JSON.stringify(transport.serialize(updates));
        return _request("POST", `${this.url}/data/${this.dbname}/${ref.path}`, data)
            .then(result => ref);
    }
  
    get(ref, options = undefined) {
        let url = `${this.url}/data/${this.dbname}/${ref.path}`;
        if (options) {
            let query = [];
            if (options.exclude instanceof Array) { 
                query.push(`exclude=${options.exclude.join(',')}`); 
            }
            if (options.include instanceof Array) { 
                query.push(`include=${options.include.join(',')}`); 
            }
            if (typeof options.child_objects === "boolean") {
                query.push(`child_objects=${options.child_objects}`);
            }
            if (query.length > 0) {
                url += `?${query.join('&')}`;
            }
        }
        return _request("GET", url)
            .then(data => {
                let val = transport.deserialize(data);
                return val;                
            });
    }

    exists(ref) {
        return _request("GET", `${this.url}/exists/${this.dbname}/${ref.path}`)
            .then(res => res.exists);
    }

    query(ref, query, options = { snapshots: false }) {
        const data = JSON.stringify(transport.serialize({
            query,
            options
        }));
        return _request("POST", `${this.url}/query/${this.dbname}/${ref.path}`, data)
            .then(data => {
                let results = transport.deserialize(data);
                return results.list;
            });
    }
}

module.exports = { WebApi };