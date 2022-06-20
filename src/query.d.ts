import { AceBaseBase } from "acebase-core";
import type { Api } from "acebase-core/src/api";
import { Storage } from './storage';
/**
 * TODO: import once LocalApi has been ported to TypeScript
 */
declare type LocalApi = Api & {
    db: AceBaseBase;
    storage: Storage;
};
export interface QueryFilter {
    key: string;
    op: string;
    compare: any;
}
export interface QueryOrder {
    key: string;
    ascending: boolean;
}
export interface Query {
    filters: QueryFilter[];
    /**
     * number of results to skip, useful for paging
     */
    skip: number;
    /**
     * max number of results to return
     */
    take: number;
    /**
     * sort order
     */
    order: QueryOrder[];
}
export interface QueryOptions {
    /**
     * whether to return matching data, or paths to matching nodes only
     * @default false
     */
    snapshots?: boolean;
    /**
     * when using snapshots, keys or relative paths to include in result data
     */
    include?: string[];
    /**
     * when using snapshots, keys or relative paths to exclude from result data
     */
    exclude?: string[];
    /**
     * when using snapshots, whether to include child objects in result data
     * @default true
     */
    child_objects?: boolean;
    /**
     * callback function for events
     */
    eventHandler?: (event: {
        name: string;
        [key: string]: any;
    }) => boolean | void;
    /**
     * NEW (BETA) monitor changes
     */
    monitor?: {
        /**
         * monitor new matches (either because they were added, or changed and now match the query)
         */
        add?: boolean;
        /**
         * monitor changed children that still match this query
         */
        change?: boolean;
        /**
         * monitor children that don't match this query anymore
         */
        remove?: boolean;
    };
}
/**
 *
 * @param storage Target storage instance
 * @param path Path of the object collection to perform query on
 * @param query Query to execute
 * @param options Additional options
 * @returns Returns a promise that resolves with matching data or paths in `results`
 */
export declare function query(api: LocalApi, path: string, query: Query, options?: QueryOptions): Promise<{
    results: object[] | string[];
    context: any;
    stop(): Promise<void>;
}>;
export {};
