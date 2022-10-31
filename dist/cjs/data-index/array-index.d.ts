import { BlacklistingSearchOperator } from '../btree';
import { DataIndex } from './data-index';
import { DataIndexOptions } from './options';
import type { Storage } from '../storage';
import { IndexableValueOrArray } from './shared';
import { IndexQueryResults } from './query-results';
/**
 * An array index allows all values in an array node to be indexed and searched
 */
export declare class ArrayIndex extends DataIndex {
    constructor(storage: Storage, path: string, key: string, options: DataIndexOptions);
    get type(): string;
    handleRecordUpdate(path: string, oldValue: unknown, newValue: unknown): Promise<void>;
    build(): Promise<this>;
    static get validOperators(): string[];
    get validOperators(): string[];
    query(op: BlacklistingSearchOperator): Promise<IndexQueryResults>;
    query(op: string, val: IndexableValueOrArray, options?: {
        filter?: IndexQueryResults;
    }): Promise<IndexQueryResults>;
}
//# sourceMappingURL=array-index.d.ts.map