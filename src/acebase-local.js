/**
   ________________________________________________________________________________
   
      ___          ______                
     / _ \         | ___ \               
    / /_\ \ ___ ___| |_/ / __ _ ___  ___ 
    |  _  |/ __/ _ \ ___ \/ _` / __|/ _ \
    | | | | (_|  __/ |_/ / (_| \__ \  __/
    \_| |_/\___\___\____/ \__,_|___/\___|
                                     
   Copyright 2018 by Ewout Stortenbeker (me@appy.one)   
   Published under MIT license
   ________________________________________________________________________________
  
 */
const { AceBaseBase, AceBaseSettings } = require('acebase-core');
const { StorageSettings } = require('./storage');
const { LocalApi } = require('./api-local');

class AceBaseLocalSettings {
    /**
     * 
     * @param {{ logLevel: 'verbose'|'log'|'warn'|'error', storage: StorageSettings }} options 
     */
    constructor(options) {
        if (!options) { options = {}; }
        this.logLevel = options.logLevel || 'log';
        this.storage = options.storage; ////new StorageOptions(options.storage);
    }
}

class AceBase extends AceBaseBase {

    /**
     * 
     * @param {string} dbname | Name of the database to open or create
     * @param {AceBaseLocalSettings} options | 
     */
    constructor(dbname, options) {
        options = new AceBaseLocalSettings(options);
        super(dbname, options);
        const apiSettings = { 
            db: this,
            storage: options.storage,
            logLevel: options.logLevel
        };
        this.api = new LocalApi(dbname, apiSettings, ready => {
            this.emit("ready");
        });
    }
}

class BrowserAceBase extends AceBase {
    /**
     * Convenience class for using AceBase in the browser without supplying additional settings.
     * Uses the browser's localStorage or sessionStorage.
     * @param {string} name database name
     * @param {object} [settings] optional settings
     * @param {string} [settings.logLevel] what level to use for logging to the console
     * @param {boolean} [settings.temp] whether to use sessionStorage instead of localStorage
     */
    constructor(name, settings) {
        settings = settings || {};
        const { LocalStorageSettings } = require('./storage-localstorage');
        settings.storage = new LocalStorageSettings();
        if (settings.temp === true) {
            settings.storage.session = true;
            delete settings.temp;
        }
        super(name, settings);
    }
}

module.exports = { AceBase, AceBaseLocalSettings, BrowserAceBase };