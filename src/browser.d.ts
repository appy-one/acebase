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
import { DataReference, DataSnapshot, EventSubscription, PathReference, TypeMappings, ID, proxyAccess, DataSnapshotsArray, ObjectCollection, DataReferencesArray, EventStream, TypeMappingOptions, IReflectionNodeInfo, IReflectionChildrenInfo, IStreamLike, ILiveDataProxy, ILiveDataProxyValue, IObjectCollection, PartialArray } from 'acebase-core';
import { AceBaseLocalSettings } from './acebase-local';
import { BrowserAceBase } from './acebase-browser';
import { CustomStorageSettings, CustomStorageTransaction, CustomStorageHelpers } from './storage/custom';
declare const acebase: {
    AceBase: typeof BrowserAceBase;
    AceBaseLocalSettings: typeof AceBaseLocalSettings;
    DataReference: typeof DataReference;
    DataSnapshot: typeof DataSnapshot;
    EventSubscription: typeof EventSubscription;
    PathReference: typeof PathReference;
    TypeMappings: typeof TypeMappings;
    CustomStorageSettings: typeof CustomStorageSettings;
    CustomStorageTransaction: typeof CustomStorageTransaction;
    CustomStorageHelpers: typeof CustomStorageHelpers;
    ID: typeof ID;
    proxyAccess: typeof proxyAccess;
    DataSnapshotsArray: typeof DataSnapshotsArray;
};
export default acebase;
export { DataSnapshot, DataReference, DataSnapshotsArray, DataReferencesArray, EventStream, EventSubscription, PathReference, TypeMappings, TypeMappingOptions, IReflectionNodeInfo, IReflectionChildrenInfo, IStreamLike, ILiveDataProxy, ILiveDataProxyValue, IObjectCollection, ObjectCollection, ID, proxyAccess, PartialArray, };
export { BrowserAceBase as AceBase, };
export { AceBaseLocalSettings, LocalStorageSettings, IndexedDBStorageSettings, } from './acebase-local';
export { AceBaseStorageSettings } from './storage/binary';
export { SQLiteStorageSettings } from './storage/sqlite';
export { MSSQLStorageSettings } from './storage/mssql';
export { CustomStorageTransaction, CustomStorageSettings, CustomStorageHelpers, ICustomStorageNode, ICustomStorageNodeMetaData, } from './storage/custom';
export { StorageSettings, TransactionLogSettings, IPCClientSettings, SchemaValidationError, } from './storage';
//# sourceMappingURL=browser.d.ts.map