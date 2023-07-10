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
import { DataReference, DataSnapshot, EventSubscription, PathReference, TypeMappings, ID, proxyAccess, DataSnapshotsArray, ObjectCollection, DataReferencesArray, EventStream, PartialArray } from 'acebase-core';
import { AceBaseLocalSettings } from './acebase-local.js';
import { BrowserAceBase } from './acebase-browser.js';
import { CustomStorageSettings, CustomStorageTransaction, CustomStorageHelpers } from './storage/custom/index.js';
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
    proxyAccess,
    DataSnapshotsArray,
};
if (typeof window !== 'undefined') {
    // Expose classes to window.acebase:
    window.acebase = acebase;
    // Expose BrowserAceBase class as window.AceBase:
    window.AceBase = BrowserAceBase;
}
// Expose classes for module imports:
export default acebase;
// acebase-core exports
export { DataSnapshot, DataReference, DataSnapshotsArray, DataReferencesArray, EventStream, EventSubscription, PathReference, TypeMappings, ObjectCollection, ID, proxyAccess, PartialArray, };
// acebase exports
export { BrowserAceBase as AceBase, };
export { AceBaseLocalSettings, LocalStorageSettings, IndexedDBStorageSettings, } from './acebase-local.js';
export { AceBaseStorageSettings } from './storage/binary/index.js';
export { SQLiteStorageSettings } from './storage/sqlite/index.js';
export { MSSQLStorageSettings } from './storage/mssql/index.js';
export { CustomStorageTransaction, CustomStorageSettings, CustomStorageHelpers, ICustomStorageNode, ICustomStorageNodeMetaData, } from './storage/custom/index.js';
export { StorageSettings, SchemaValidationError, } from './storage/index.js';
//# sourceMappingURL=browser.js.map