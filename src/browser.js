"use strict";
/**
   ________________________________________________________________________________

      ___          ______
     / _ \         | ___ \
    / /_\ \ ___ ___| |_/ / __ _ ___  ___
    |  _  |/ __/ _ \ ___ \/ _` / __|/ _ \
    | | | | (_|  __/ |_/ / (_| \__ \  __/
    \_| |_/\___\___\____/ \__,_|___/\___|
                        realtime database

   Copyright 2018-2022 by Ewout Stortenbeker (me@appy.one)
   Published under MIT license

   See docs at https://github.com/appy-one/acebase
   ________________________________________________________________________________

*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.proxyAccess = exports.ID = exports.CustomStorageHelpers = exports.CustomStorageTransaction = exports.CustomStorageSettings = exports.TypeMappings = exports.PathReference = exports.EventSubscription = exports.DataSnapshot = exports.DataReference = exports.AceBaseLocalSettings = exports.AceBase = void 0;
const acebase_core_1 = require("acebase-core");
Object.defineProperty(exports, "DataReference", { enumerable: true, get: function () { return acebase_core_1.DataReference; } });
Object.defineProperty(exports, "DataSnapshot", { enumerable: true, get: function () { return acebase_core_1.DataSnapshot; } });
Object.defineProperty(exports, "EventSubscription", { enumerable: true, get: function () { return acebase_core_1.EventSubscription; } });
Object.defineProperty(exports, "PathReference", { enumerable: true, get: function () { return acebase_core_1.PathReference; } });
Object.defineProperty(exports, "TypeMappings", { enumerable: true, get: function () { return acebase_core_1.TypeMappings; } });
Object.defineProperty(exports, "ID", { enumerable: true, get: function () { return acebase_core_1.ID; } });
Object.defineProperty(exports, "proxyAccess", { enumerable: true, get: function () { return acebase_core_1.proxyAccess; } });
const acebase_local_1 = require("./acebase-local");
Object.defineProperty(exports, "AceBaseLocalSettings", { enumerable: true, get: function () { return acebase_local_1.AceBaseLocalSettings; } });
const acebase_browser_1 = require("./acebase-browser");
Object.defineProperty(exports, "AceBase", { enumerable: true, get: function () { return acebase_browser_1.BrowserAceBase; } });
const custom_1 = require("./storage/custom");
Object.defineProperty(exports, "CustomStorageSettings", { enumerable: true, get: function () { return custom_1.CustomStorageSettings; } });
Object.defineProperty(exports, "CustomStorageTransaction", { enumerable: true, get: function () { return custom_1.CustomStorageTransaction; } });
Object.defineProperty(exports, "CustomStorageHelpers", { enumerable: true, get: function () { return custom_1.CustomStorageHelpers; } });
const acebase = {
    AceBase: acebase_browser_1.BrowserAceBase,
    AceBaseLocalSettings: acebase_local_1.AceBaseLocalSettings,
    DataReference: acebase_core_1.DataReference,
    DataSnapshot: acebase_core_1.DataSnapshot,
    EventSubscription: acebase_core_1.EventSubscription,
    PathReference: acebase_core_1.PathReference,
    TypeMappings: acebase_core_1.TypeMappings,
    CustomStorageSettings: custom_1.CustomStorageSettings,
    CustomStorageTransaction: custom_1.CustomStorageTransaction,
    CustomStorageHelpers: custom_1.CustomStorageHelpers,
    ID: acebase_core_1.ID,
    proxyAccess: acebase_core_1.proxyAccess,
};
// Expose classes to window.acebase:
window.acebase = acebase;
// Expose BrowserAceBase class as window.AceBase:
window.AceBase = acebase_browser_1.BrowserAceBase;
// Expose classes for module imports:
exports.default = acebase;
//# sourceMappingURL=browser.js.map