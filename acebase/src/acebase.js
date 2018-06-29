/**
 * ______________________________ AceBase v0.1a ___________________________________
 * 
 * A fast, low memory, transactional & query enabled JSON database server for node.js, 
 * inspired by the Firebase realtime database. Capable of storing up to 
 * 2^48 (281 trillion) object nodes in a binary database file that can theoretically 
 * grow to a max filesize of 8PB (petabytes)
 * 
 * Natively supports storing of objects, arrays, numbers, strings, booleans, dates 
 * and binary (ArrayBuffer) data. Custom classes can be automatically shapeshifted 
 * to and from plain objects by adding type mappings --> Store a User, get a User.
 * 
 * v0.1a - alpha release, don't use in production
 * 
 * Copyright 2018 by Ewout Stortenbeker (me@appy.one)
 * Published under MIT license
 * ________________________________________________________________________________
 * 
 */
const { EventEmitter } = require('events');
const { TypeMappings } = require('./type-mappings');
const { StorageOptions } = require('./storage');
const { DataReference } = require('./data-reference');
const debug = require('./debug');

class AceBaseSettings {
    constructor(options) {
        this.logLevel = options.logLevel || "log";
        //this.browser = options.browser || false;
        //this.server = options.server || null;
        this.api = options.api || null;
        this.storage = new StorageOptions(options.storage);
    }
}

class AceBase extends EventEmitter {

    /**
     * 
     * @param {string} dbname | Name of the database to open or create
     * @param {AceBaseSettings} options | 
     */
    constructor(dbname, options) {
        super();

        const db = this;
        if (!options) { options = {}; }
        if (options.logLevel) {
            debug.setLevel(options.logLevel);
        }

        // if (options.browser) {
        //     // Work in progress, don't use yet
        //     const { BrowserApi } = require('./api-browser');
        //     this.api = new BrowserApi(dbname, () => {
        //         this.emit("ready");
        //     });
        // }
        // else if (options.server) {
        //     // Use web API to connect to remote AceBase instance
        //     const { WebApi } = require('./api-web');
        //     this.api = new WebApi(options.server, dbname, () => {
        //         this.emit("ready");
        //     });
        // }
        if (options.api) {
            // Specific api given such as web api, or browser api etc
            this.api = new options.api.class(dbname, options.api.settings, (ready) => {
                this.emit("ready");
            });
            // this.api = options.api;
            // this.emit("ready");  // Api should be ready to use when AceBase constructor runs
        }
        else {
            // Use local database
            const { Storage } = require('./storage');
            const storage = new Storage(dbname, options.storage);
            storage.on("ready", () => this.emit("ready"));

            const { LocalApi } = require('./api-local');
            this.api = new LocalApi(db, storage);     
            storage.on("datachanged", (event) => {
                debug.warn(`datachanged event fired for path ${event.path}`);
                //debug.warn(event);
                //storage.subscriptions.trigger(db, event.type, event.path, event.previous);
                this.emit("datachanged", event);
            });
        }



        this.types = new TypeMappings();

        // this.schema = {
        //     global: {
        //         //include: [],
        //         exclude: []
        //     }
        // }
    }

    /**
     * Creates a reference to a node
     * @param {string} path 
     * @returns {DataReference} reference to the requested node
     */
    ref(path) {
        return new DataReference(this, path);
    }

    /**
     * Get a reference to the root database node
     * @returns {DataReference} reference to root node
     */
    get root() {
        return this.ref("");
    }

}

module.exports = { AceBase, AceBaseSettings };