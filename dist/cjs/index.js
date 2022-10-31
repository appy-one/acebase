"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SchemaValidationError = exports.StorageSettings = exports.ICustomStorageNodeMetaData = exports.ICustomStorageNode = exports.CustomStorageHelpers = exports.CustomStorageSettings = exports.CustomStorageTransaction = exports.MSSQLStorageSettings = exports.SQLiteStorageSettings = exports.AceBaseStorageSettings = exports.IndexedDBStorageSettings = exports.LocalStorageSettings = exports.AceBaseLocalSettings = exports.AceBase = exports.PartialArray = exports.proxyAccess = exports.ID = exports.ObjectCollection = exports.TypeMappings = exports.PathReference = exports.EventSubscription = exports.EventStream = exports.DataReferencesArray = exports.DataSnapshotsArray = exports.DataReference = exports.DataSnapshot = void 0;
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
var acebase_core_1 = require("acebase-core");
Object.defineProperty(exports, "DataSnapshot", { enumerable: true, get: function () { return acebase_core_1.DataSnapshot; } });
Object.defineProperty(exports, "DataReference", { enumerable: true, get: function () { return acebase_core_1.DataReference; } });
Object.defineProperty(exports, "DataSnapshotsArray", { enumerable: true, get: function () { return acebase_core_1.DataSnapshotsArray; } });
Object.defineProperty(exports, "DataReferencesArray", { enumerable: true, get: function () { return acebase_core_1.DataReferencesArray; } });
Object.defineProperty(exports, "EventStream", { enumerable: true, get: function () { return acebase_core_1.EventStream; } });
Object.defineProperty(exports, "EventSubscription", { enumerable: true, get: function () { return acebase_core_1.EventSubscription; } });
Object.defineProperty(exports, "PathReference", { enumerable: true, get: function () { return acebase_core_1.PathReference; } });
Object.defineProperty(exports, "TypeMappings", { enumerable: true, get: function () { return acebase_core_1.TypeMappings; } });
Object.defineProperty(exports, "ObjectCollection", { enumerable: true, get: function () { return acebase_core_1.ObjectCollection; } });
Object.defineProperty(exports, "ID", { enumerable: true, get: function () { return acebase_core_1.ID; } });
Object.defineProperty(exports, "proxyAccess", { enumerable: true, get: function () { return acebase_core_1.proxyAccess; } });
Object.defineProperty(exports, "PartialArray", { enumerable: true, get: function () { return acebase_core_1.PartialArray; } });
var acebase_local_1 = require("./acebase-local");
Object.defineProperty(exports, "AceBase", { enumerable: true, get: function () { return acebase_local_1.AceBase; } });
Object.defineProperty(exports, "AceBaseLocalSettings", { enumerable: true, get: function () { return acebase_local_1.AceBaseLocalSettings; } });
Object.defineProperty(exports, "LocalStorageSettings", { enumerable: true, get: function () { return acebase_local_1.LocalStorageSettings; } });
Object.defineProperty(exports, "IndexedDBStorageSettings", { enumerable: true, get: function () { return acebase_local_1.IndexedDBStorageSettings; } });
var binary_1 = require("./storage/binary");
Object.defineProperty(exports, "AceBaseStorageSettings", { enumerable: true, get: function () { return binary_1.AceBaseStorageSettings; } });
var sqlite_1 = require("./storage/sqlite");
Object.defineProperty(exports, "SQLiteStorageSettings", { enumerable: true, get: function () { return sqlite_1.SQLiteStorageSettings; } });
var mssql_1 = require("./storage/mssql");
Object.defineProperty(exports, "MSSQLStorageSettings", { enumerable: true, get: function () { return mssql_1.MSSQLStorageSettings; } });
var custom_1 = require("./storage/custom");
Object.defineProperty(exports, "CustomStorageTransaction", { enumerable: true, get: function () { return custom_1.CustomStorageTransaction; } });
Object.defineProperty(exports, "CustomStorageSettings", { enumerable: true, get: function () { return custom_1.CustomStorageSettings; } });
Object.defineProperty(exports, "CustomStorageHelpers", { enumerable: true, get: function () { return custom_1.CustomStorageHelpers; } });
Object.defineProperty(exports, "ICustomStorageNode", { enumerable: true, get: function () { return custom_1.ICustomStorageNode; } });
Object.defineProperty(exports, "ICustomStorageNodeMetaData", { enumerable: true, get: function () { return custom_1.ICustomStorageNodeMetaData; } });
var storage_1 = require("./storage");
Object.defineProperty(exports, "StorageSettings", { enumerable: true, get: function () { return storage_1.StorageSettings; } });
Object.defineProperty(exports, "SchemaValidationError", { enumerable: true, get: function () { return storage_1.SchemaValidationError; } });
//# sourceMappingURL=index.js.map