import { AceBaseBase } from 'acebase-core';
import type { Api, Query, QueryOptions } from 'acebase-core';
import { Storage } from './storage';
/**
 * TODO: import once LocalApi has been ported to TypeScript
 */
type LocalApi = Api & {
    db: AceBaseBase;
    storage: Storage;
};
/**
 *
 * @param storage Target storage instance
 * @param path Path of the object collection to perform query on
 * @param query Query to execute
 * @param options Additional options
 * @returns Returns a promise that resolves with matching data or paths in `results`
 */
export declare function executeQuery(api: LocalApi, path: string, query: Query, options?: QueryOptions): Promise<{
    results: Array<{
        path: string;
        val: any;
    }> | string[];
    context: any;
    stop(): Promise<void>;
}>;
export {};
//# sourceMappingURL=query.d.ts.map