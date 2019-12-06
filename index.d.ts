/// <reference types="acebase-core" />

// import { EventEmitter } from 'events';
import * as acebasecore from 'acebase-core';

export class AceBase extends acebasecore.AceBaseBase {
    /**
     * 
     * @param {string} dbname | Name of the database to open or create
     * @param {AceBaseLocalSettings} options | 
     */
    constructor(dbname: string, options?: AceBaseLocalSettings);

    /**
     * Waits for the database to be ready before running your callback. Do this before performing any other actions on your database
     * @param {()=>void} [callback] (optional) callback function that is called when ready. You can also use the returned promise
     * @returns {Promise<void>} returns a promise that resolves when ready
     */
    ready(callback?: () => void): Promise<void>;
}

export interface AceBaseLocalSettings {
    logLevel?: string;
    storage?: StorageSettings;
}

export abstract class StorageSettings {
    maxInlineValueSize?: number;
    removeVoidProperties?: boolean;
    path?: string;    
}

export class AceBaseStorageSettings extends StorageSettings {
    constructor(settings: AceBaseStorageSettings);
    recordSize?: number;
    pageSize?: number;
}

export class SQLiteStorageSettings extends StorageSettings {
    constructor(settings: SQLiteStorageSettings);
}

export class MSSQLStorageSettings extends StorageSettings {
    constructor(settings: MSSQLStorageSettings);
    driver?: 'tedious'|'native';
    domain?: string;
    user?: string;
    password?: string;
    server?: string;
    port?: number;
    database?: string;
    encrypt?: boolean;
    appName?: string;
    connectionTimeout?: number;
    requestTimeout?: number;
    maxConnections?: number;
    minConnections?: number;
    idleTimeout?: number;
}

export class LocalStorageSettings extends StorageSettings {
    constructor(settings: LocalStorageSettings);
    session?: boolean;
    provider?: object
}

export import DataSnapshot = acebasecore.DataSnapshot;
export import DataReference = acebasecore.DataReference;
export import EventStream = acebasecore.EventStream;
export import EventSubscription = acebasecore.EventSubscription;
export import PathReference = acebasecore.PathReference;
export import TypeMappings = acebasecore.TypeMappings;
export import TypeMappingOptions = acebasecore.TypeMappingOptions;