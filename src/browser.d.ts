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
import { DataReference, DataSnapshot, EventSubscription, PathReference, TypeMappings, ID, proxyAccess } from 'acebase-core';
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
};
export default acebase;
export { BrowserAceBase as AceBase, AceBaseLocalSettings, DataReference, DataSnapshot, EventSubscription, PathReference, TypeMappings, CustomStorageSettings, CustomStorageTransaction, CustomStorageHelpers, ID, proxyAccess, };
