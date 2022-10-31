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
export { DataSnapshot, DataReference, DataSnapshotsArray, DataReferencesArray, EventStream, EventSubscription, PathReference, TypeMappings, ObjectCollection, ID, proxyAccess, PartialArray, } from 'acebase-core';
export { AceBase, AceBaseLocalSettings, LocalStorageSettings, IndexedDBStorageSettings, } from './acebase-local.js';
export { AceBaseStorageSettings } from './storage/binary/index.js';
export { SQLiteStorageSettings } from './storage/sqlite/index.js';
export { MSSQLStorageSettings } from './storage/mssql/index.js';
export { CustomStorageTransaction, CustomStorageSettings, CustomStorageHelpers, ICustomStorageNode, ICustomStorageNodeMetaData, } from './storage/custom/index.js';
export { StorageSettings, SchemaValidationError, } from './storage/index.js';
//# sourceMappingURL=index.js.map