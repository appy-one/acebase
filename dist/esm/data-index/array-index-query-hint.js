import { IndexQueryHint } from './query-hint.js';
export class ArrayIndexQueryHint extends IndexQueryHint {
    static get types() {
        return Object.freeze({
            missingValue: 'missing',
        });
    }
    constructor(type, value) {
        super(type, value);
    }
    get description() {
        const val = typeof this.value === 'string' ? `"${this.value}"` : this.value;
        switch (this.type) {
            case ArrayIndexQueryHint.types.missingValue: {
                return `Value ${val} does not occur in the index, you might want to remove it from your query`;
            }
            default: {
                return 'Uknown hint';
            }
        }
    }
}
//# sourceMappingURL=array-index-query-hint.js.map