import { BPlusTreeLeafEntryValue } from '../btree/tree-leaf-entry-value';
import { IndexQueryHint } from './query-hint';
import { IndexQueryStats } from './query-stats';
import { IndexableValue, IndexableValueOrArray, IndexMetaData } from './shared';

export class IndexQueryResult {
    public values: BPlusTreeLeafEntryValue[];
    constructor(public key: string | number, public path: string, public value: IndexableValue, public metadata: IndexMetaData) { }
}

export class IndexQueryResults extends Array<IndexQueryResult> {

    static fromResults(results: IndexQueryResults | IndexQueryResult[], filterKey: string) {
        const arr = new IndexQueryResults(results.length);
        results.forEach((result, i) => arr[i] = result);
        arr.filterKey = filterKey;
        return arr;
    }

    public entryValues: BPlusTreeLeafEntryValue[];
    public hints = [] as IndexQueryHint[];
    public stats = null as IndexQueryStats;

    public filterKey: string;

    // /** @param {BinaryBPlusTreeLeafEntry[]} entries */
    // set treeEntries(entries) {
    //     this._treeEntries = entries;
    // }

    // /** @type {BinaryBPlusTreeLeafEntry[]} */
    // get treeEntries() {
    //     return this._treeEntries;
    // }

    // filter(callback: (result: IndexQueryResult, index: number, arr: IndexQueryResults) => boolean) {
    //     return super.filter(callback);
    // }

    filterMetadata(key: string, op: string, compare: IndexableValueOrArray) {
        if (typeof compare === 'undefined') {
            compare = null; // compare with null so <, <=, > etc will get the right results
        }
        if (op === 'exists' || op === '!exists') {
            op = op === 'exists' ? '!=' : '==';
            compare = null;
        }
        const filtered = this.filter(result => {
            let value = key === this.filterKey ? result.value : result.metadata ? result.metadata[key] : null;
            if (typeof value === 'undefined') {
                value = null; // compare with null
            }
            if (op === '<') { return value < compare; }
            if (op === '<=') { return value <= compare; }
            if (op === '>') { return value > compare; }
            if (op === '>=') { return value >= compare; }
            if (op === '==') { return value == compare; }
            if (op === '!=') { return value != compare; }
            if (op === 'like' || op === '!like') {
                if (typeof compare !== 'string') {
                    return op === '!like';
                }
                const pattern = '^' + compare.replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
                const re = new RegExp(pattern, 'i');
                const isLike = re.test(value as string);
                return op === 'like' ? isLike : !isLike;
            }
            if (op === 'in' || op === '!in') {
                const isIn = compare instanceof Array && compare.includes(value);
                return op === 'in' ? isIn : !isIn;
            }
            if (op == 'between' || op === '!between') {
                if (!(compare instanceof Array)) {
                    return op === '!between';
                }
                let bottom = compare[0], top = compare[1];
                if (top < bottom) {
                    const swap = top;
                    top = bottom;
                    bottom = swap;
                }
                const isBetween = value >= bottom && value <= top;
                return op === 'between' ? isBetween : !isBetween;
            }
            if (op === 'matches' || op === '!matches') {
                if (!(compare instanceof RegExp)) {
                    return op === '!matches';
                }
                const re = compare;
                const isMatch = re.test(value as string);
                return op === 'matches' ? isMatch : !isMatch;
            }
        });
        return IndexQueryResults.fromResults(filtered, this.filterKey);
    }

    constructor(length: number);
    constructor(...results: IndexQueryResult[]);
    constructor(...args: any[]) {
        super(...args);
    }

}
