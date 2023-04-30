export class IndexQueryResult {
    constructor(key, path, value, metadata) {
        this.key = key;
        this.path = path;
        this.value = value;
        this.metadata = metadata;
    }
}
export class IndexQueryResults extends Array {
    static fromResults(results, filterKey) {
        const arr = new IndexQueryResults(results.length);
        results.forEach((result, i) => arr[i] = result);
        arr.filterKey = filterKey;
        return arr;
    }
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
    filterMetadata(key, op, compare) {
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
            if (op === '<') {
                return value < compare;
            }
            if (op === '<=') {
                return value <= compare;
            }
            if (op === '>') {
                return value > compare;
            }
            if (op === '>=') {
                return value >= compare;
            }
            if (op === '==') {
                return value == compare;
            }
            if (op === '!=') {
                return value != compare;
            }
            if (op === 'like' || op === '!like') {
                if (typeof compare !== 'string') {
                    return op === '!like';
                }
                const pattern = '^' + compare.replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
                const re = new RegExp(pattern, 'i');
                const isLike = re.test(value);
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
                const isMatch = re.test(value);
                return op === 'matches' ? isMatch : !isMatch;
            }
        });
        return IndexQueryResults.fromResults(filtered, this.filterKey);
    }
    constructor(...args) {
        super(...args);
        this.hints = [];
        this.stats = null;
    }
}
//# sourceMappingURL=query-results.js.map