/*
    * This file is used to create a browser bundle, 
    (re)generate it with: npm run browserify

    * To use AceBase in the browser with localStorage as the storage engine:
    const settings = { logLevel: 'error', temp: false }; // optional
    const db = new AceBase('dbname', settings); // (uses BrowserAceBase class behind the scenes)

    * When using Typescript (Angular/Ionic), you will have to pass a LocalStorageSettings object:
    import { AceBase, LocalStorageSettings } from 'acebase';
    const settings = { logLevel: 'error', storage: new LocalStorageSettings({ session: false }) };
    const db = new AceBase('dbname', settings);

    * In Typescript, its also possible to use the BrowserAceBase class
    import { BrowserAceBase } from 'acebase';
    const settings = { logLevel: 'error', temp: false }; // optional
    const db = new BrowserAceBase('dbname', settings);
 */


const { DataReference, DataSnapshot, EventSubscription, PathReference, TypeMappings, TypeMappingOptions } = require('acebase-core');
const { AceBase, AceBaseLocalSettings, BrowserAceBase } = require('./acebase-local');
const { LocalStorageSettings } = require('./storage-localstorage');

const acebase = {
    BrowserAceBase,
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

// Expose classes to window.acebase:
window.acebase = acebase;
// Expose BrowserAceBase class as window.AceBase:
window.AceBase = BrowserAceBase;
// Expose classes for module imports:
module.exports = acebase;