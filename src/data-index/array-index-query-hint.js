"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArrayIndexQueryHint = void 0;
const query_hint_1 = require("./query-hint");
class ArrayIndexQueryHint extends query_hint_1.IndexQueryHint {
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
exports.ArrayIndexQueryHint = ArrayIndexQueryHint;
//# sourceMappingURL=array-index-query-hint.js.map