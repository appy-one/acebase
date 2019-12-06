// To use AceBase in the browser with localStorage as the storage engine,
// npm run browserify, which will execute: 
//      browserify src/browser.js -o dist/browser.js -u src/btree.js -i ./src/data-index.js -u src/geohash.js -u src/node-cache.js -u src/promise-fs.js -u src/promise-timeout.js -i ./src/storage-acebase.js -i ./src/storage-mssql.js -i ./src/storage-sqlite.js --ignore buffer
//      terser dist/browser.js -o dist/browser.min.js

const { DataReference, DataSnapshot, EventSubscription, PathReference, TypeMappings, TypeMappingOptions } = require('acebase-core');
const { AceBase, AceBaseLocalSettings } = require('./acebase-local');
const { LocalStorageSettings } = require('./storage-localstorage');
const acebase = {
    AceBase, 
    AceBaseLocalSettings,
    DataReference, 
    DataSnapshot, 
    EventSubscription, 
    PathReference, 
    TypeMappings, 
    TypeMappingOptions,
    LocalStorageSettings
};

class BrowserAceBase extends acebase.AceBase {
    constructor(name, settings) {
        settings = settings || {};
        settings.storage = new acebase.LocalStorageSettings();
        if (settings.temp === true) {
            settings.storage.session = true;
            delete settings.temp;
        }
        super(name, settings);
    }
}

window.AceBase = BrowserAceBase;
window.acebase = acebase;