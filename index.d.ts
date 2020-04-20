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
    logLevel?: 'verbose'|'log'|'warn'|'error';
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
    provider?: object;
}

/**
 * Allows data to be stored in a custom storage backend of your choice! Simply provide a couple of functions
 * to get, set and remove data and you're done.
 */
export class CustomStorageSettings extends StorageSettings {
    constructor(settings: CustomStorageSettings);
    /** Function that gets a value from your custom data store, must return null if path does not exist */
    get(path: string): Promise<string|null>;
    /** Function that sets a value in your custom data store */
    set(path: string, value: string): Promise<void>;
    /** Function that removes a value from your custom data store */
    remove(path: string): Promise<void>;
    /** function that returns all stored paths that are direct children of the given path. Must include "parent/path/key" AND "parent/path[0]". Use CustomStorageHelpers for logic */
    childrenOf(path: string): Promise<string[]>;
    /** function that returns all stored paths that are descendants of the given path. Must include "parent/path/key", "parent/path/key/subkey", "parent/path[0]", "parent/path[12]/key" etc. Use CustomStorageHelpers for logic */
    descendantsOf(path: string): Promise<string[]>;
    /** (optional, not used yet) Function that gets multiple values from your custom data store at once. Must return a Promise that resolves with Map<path,value> */
    getMultiple?(paths: string[]): Promise<Map<string, string|null>>;
    /** (optional) Function that removes multiple values from your custom data store at once */
    removeMultiple?(paths: string[]): Promise<void>;
}

export class CustomStorageHelpers {
    /**
     * Helper function that returns a SQL where clause for all children of given path
     * @param path Path to get children of
     * @param columnName Name of the Path column in your SQL db, default is 'path'
     * @returns Returns the SQL where clause
     */
    static ChildPathsSql(path:string, columnName:string = 'path'): string;
    /**
     * Helper function that returns a regular expression to test if paths are children of the given path
     * @param path Path to test children of
     * @returns Returns regular expression to test paths with
     */
    static ChildPathsRegex(path: string): RegExp;
    /**
     * Helper function that returns a SQL where clause for all descendants of given path
     * @param path Path to get descendants of
     * @param columnName Name of the Path column in your SQL db, default is 'path'
     * @returns Returns the SQL where clause
     */
    static DescendantPathsSql(path:string, columnName:string = 'path'): string;
    /**
     * Helper function that returns a regular expression to test if paths are descendants of the given path
     * @param path Path to test descendants of
     * @returns Returns regular expression to test paths with
     */
    static DescendantPathsRegex(path: string): RegExp;

    /**
     * PathInfo helper class. Can be used to extract keys from a given path, get parent paths, check if a path is a child or descendant of other path etc
     * @example
     * var pathInfo = CustomStorage.PathInfo.get('my/path/to/data');
     * pathInfo.key === 'data';
     * pathInfo.parentPath === 'my/path/to';
     * pathInfo.pathKeys; // ['my','path','to','data'];
     * pathInfo.isChildOf('my/path/to') === true;
     * pathInfo.isDescendantOf('my/path') === true;
     * pathInfo.isParentOf('my/path/to/data/child') === true;
     * pathInfo.isAncestorOf('my/path/to/data/child/grandchild') === true;
     * pathInfo.childPath('child') === 'my/path/to/data/child';
     * pathInfo.childPath(0) === 'my/path/to/data[0]';
     */
    static readonly PathInfo: typeof acebasecore.PathInfo
}

export class BrowserAceBase extends AceBase {
    /**
     * Convenience class for using AceBase in the browser without supplying additional settings.
     * Uses the browser's localStorage or sessionStorage.
     * @param {string} name database name
     * @param {object} [settings] optional settings
     * @param {string} [settings.logLevel] what level to use for logging to the console
     * @param {boolean} [settings.temp] whether to use sessionStorage instead of localStorage
     */
    constructor(name: string, settings?: { logLevel?: 'verbose'|'log'|'warn'|'error', temp?: boolean });
}

export import DataSnapshot = acebasecore.DataSnapshot;
export import DataReference = acebasecore.DataReference;
export import EventStream = acebasecore.EventStream;
export import EventSubscription = acebasecore.EventSubscription;
export import PathReference = acebasecore.PathReference;
export import TypeMappings = acebasecore.TypeMappings;
export import TypeMappingOptions = acebasecore.TypeMappingOptions;