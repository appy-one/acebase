import { BPlusTreeLeafEntryValue } from '../btree/tree-leaf-entry-value';
import { IndexQueryHint } from './query-hint';
import { IndexQueryStats } from './query-stats';
import { IndexableValue, IndexableValueOrArray, IndexMetaData } from './shared';
export declare class IndexQueryResult {
    key: string | number;
    path: string;
    value: IndexableValue;
    metadata: IndexMetaData;
    values: BPlusTreeLeafEntryValue[];
    constructor(key: string | number, path: string, value: IndexableValue, metadata: IndexMetaData);
}
export declare class IndexQueryResults extends Array<IndexQueryResult> {
    static fromResults(results: IndexQueryResults | IndexQueryResult[], filterKey: string): IndexQueryResults;
    entryValues: BPlusTreeLeafEntryValue[];
    hints: IndexQueryHint[];
    stats: IndexQueryStats;
    filterKey: string;
    filterMetadata(key: string | number, op: string, compare: IndexableValueOrArray): IndexQueryResults;
    constructor(length: number);
    constructor(...results: IndexQueryResult[]);
}
//# sourceMappingURL=query-results.d.ts.map