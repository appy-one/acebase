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
const { StorageOptions } = require('./storage');
const { LocalApi } = require('./api-local');

class AceBaseLocalSettings {
    /**
     * 
     * @param {{ logLevel: string, storage: StorageOptions }} options 
     */
    constructor(options) {
        if (!options) { options = {}; }
        this.logLevel = options.logLevel || 'log';
        this.storage = new StorageOptions(options.storage);
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
            storage: options.storage
        };
        this.api = new LocalApi(dbname, apiSettings, ready => {
            this.emit("ready");
        });
    }
}

module.exports = { AceBase, AceBaseLocalSettings };