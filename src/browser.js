/**
   ________________________________________________________________________________
   
      ___          ______                
     / _ \         | ___ \               
    / /_\ \ ___ ___| |_/ / __ _ ___  ___ 
    |  _  |/ __/ _ \ ___ \/ _` / __|/ _ \
    | | | | (_|  __/ |_/ / (_| \__ \  __/
    \_| |_/\___\___\____/ \__,_|___/\___|
                        realtime database

   Copyright 2018 by Ewout Stortenbeker (me@appy.one)   
   Published under MIT license

   See docs at https://www.npmjs.com/package/acebase
   ________________________________________________________________________________

*/

const { DataReference, DataSnapshot, EventSubscription, PathReference, TypeMappings, ID, proxyAccess } = require('acebase-core');
const { AceBaseLocalSettings } = require('./acebase-local');
const { BrowserAceBase } = require('./acebase-browser');
const { CustomStorageSettings, CustomStorageTransaction, CustomStorageHelpers } = require('./storage-custom');

const acebase = {
    AceBase: BrowserAceBase, 
    AceBaseLocalSettings,
    DataReference, 
    DataSnapshot, 
    EventSubscription, 
    PathReference, 
    TypeMappings,
    CustomStorageSettings,
    CustomStorageTransaction,
    CustomStorageHelpers,
    ID,
    proxyAccess
};

// Expose classes to window.acebase:
window.acebase = acebase;
// Expose BrowserAceBase class as window.AceBase:
window.AceBase = BrowserAceBase;
// Expose classes for module imports:
module.exports = acebase;