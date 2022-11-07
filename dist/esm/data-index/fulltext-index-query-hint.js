import { IndexQueryHint } from './query-hint.js';
export class FullTextIndexQueryHint extends IndexQueryHint {
    static get types() {
        return Object.freeze({
            missingWord: 'missing',
            genericWord: 'generic',
            ignoredWord: 'ignored',
        });
    }
    constructor(type, value) {
        super(type, value);
    }
    get description() {
        switch (this.type) {
            case FullTextIndexQueryHint.types.missingWord: {
                return `Word "${this.value}" does not occur in the index, you might want to remove it from your query`;
            }
            case FullTextIndexQueryHint.types.genericWord: {
                return `Word "${this.value}" is very generic and occurs many times in the index. Removing the word from your query will speed up the results and minimally impact the size of the result set`;
            }
            case FullTextIndexQueryHint.types.ignoredWord: {
                return `Word "${this.value}" was ignored because it is either blacklisted, occurs in a stoplist, or did not match other criteria such as minimum (wildcard) word length`;
            }
            default: {
                return 'Uknown hint';
            }
        }
    }
}
//# sourceMappingURL=fulltext-index-query-hint.js.map