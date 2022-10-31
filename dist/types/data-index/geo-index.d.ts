import type { Storage } from '../storage';
import { BlacklistingSearchOperator } from '../btree';
import { DataIndex } from './data-index';
import { DataIndexOptions } from './options';
import { IndexQueryResults } from './query-results';
import { IndexableValueOrArray } from './shared';
export declare class GeoIndex extends DataIndex {
    constructor(storage: Storage, path: string, key: string, options: DataIndexOptions);
    get type(): string;
    handleRecordUpdate(path: string, oldValue: unknown, newValue: unknown): Promise<void>;
    build(): Promise<this>;
    static get validOperators(): string[];
    get validOperators(): string[];
    test(obj: any, op: 'geo:nearby', val: {
        lat: number;
        long: number;
        radius: number;
    }): boolean;
    query(op: string | BlacklistingSearchOperator, val?: IndexableValueOrArray, options?: {
        filter?: IndexQueryResults;
    }): Promise<IndexQueryResults>;
    /**
     * @param op Only 'geo:nearby' is supported at the moment
     */
    nearby(val: {
        /**
         * nearby query center latitude
         */
        lat: number;
        /**
         * nearby query center longitude
         */
        long: number;
        /**
         * nearby query radius in meters
         */
        radius: number;
    }): Promise<IndexQueryResults>;
}
//# sourceMappingURL=geo-index.d.ts.map