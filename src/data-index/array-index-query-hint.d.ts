import { IndexQueryHint } from './query-hint';
export declare class ArrayIndexQueryHint extends IndexQueryHint {
    static get types(): Readonly<{
        missingValue: "missing";
    }>;
    constructor(type: 'missing', value: unknown);
    get description(): string;
}
//# sourceMappingURL=array-index-query-hint.d.ts.map