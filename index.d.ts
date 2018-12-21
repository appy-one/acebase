/// <reference types="node" />
/// <reference types="acebase-core" />

// import { EventEmitter } from 'events';
import * as acebasecore from 'acebase-core';

declare namespace acebase {
    // extends EventEmitter
    class AceBase extends acebasecore.AceBaseBase {
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

    interface AceBaseLocalSettings {
        logLevel?: string;
        storage?: StorageOptions;
    }

    interface StorageOptions {
        recordSize?: number;
        pageSize?: number;
        maxInlineValueSize?: number;
        removeVoidProperties?: boolean;
        path?:string;
    }

}

export = acebase;
export import DataSnapshot = acebasecore.DataSnapshot;
export import DataReference = acebasecore.DataReference;
export import EventStream = acebasecore.EventStream;
export import EventSubscription = acebasecore.EventSubscription;
export import PathReference = acebasecore.PathReference;
export import TypeMappings = acebasecore.TypeMappings;
export import TypeMappingOptions = acebasecore.TypeMappingOptions;