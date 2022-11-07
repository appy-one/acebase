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

import { DataReference, DataSnapshot, EventSubscription, PathReference, TypeMappings, ID, proxyAccess,
    DataSnapshotsArray, ObjectCollection, DataReferencesArray, EventStream, TypeMappingOptions,
    IReflectionNodeInfo, IReflectionChildrenInfo, IStreamLike, ILiveDataProxy, ILiveDataProxyValue,
    IObjectCollection, PartialArray } from 'acebase-core';
import { AceBaseLocalSettings } from './acebase-local';
import { BrowserAceBase } from './acebase-browser';
import { CustomStorageSettings, CustomStorageTransaction, CustomStorageHelpers } from './storage/custom';

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

// Expose classes to window.acebase:
(window as any).acebase = acebase;
// Expose BrowserAceBase class as window.AceBase:
(window as any).AceBase = BrowserAceBase;

// Expose classes for module imports:
export default acebase;

// acebase-core exports
export {
    DataSnapshot,
    DataReference,
    DataSnapshotsArray,
    DataReferencesArray,
    EventStream,
    EventSubscription,
    PathReference,
    TypeMappings,
    TypeMappingOptions,
    IReflectionNodeInfo,
    IReflectionChildrenInfo,
    IStreamLike,
    ILiveDataProxy,
    ILiveDataProxyValue,
    IObjectCollection,
    ObjectCollection,
    ID,
    proxyAccess,
    PartialArray,
};

// acebase exports
export {
    BrowserAceBase as AceBase,
};

export {
    AceBaseLocalSettings,
    LocalStorageSettings,
    IndexedDBStorageSettings,
} from './acebase-local';

export { AceBaseStorageSettings } from './storage/binary';
export { SQLiteStorageSettings } from './storage/sqlite';
export { MSSQLStorageSettings } from './storage/mssql';

export {
    CustomStorageTransaction,
    CustomStorageSettings,
    CustomStorageHelpers,
    ICustomStorageNode,
    ICustomStorageNodeMetaData,
} from './storage/custom';

export {
    StorageSettings,
    TransactionLogSettings,
    IPCClientSettings,
    SchemaValidationError,
} from './storage';
