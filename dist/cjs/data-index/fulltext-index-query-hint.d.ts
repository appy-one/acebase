import { IndexQueryHint } from './query-hint';
export declare class FullTextIndexQueryHint extends IndexQueryHint {
    static get types(): Readonly<{
        missingWord: "missing";
        genericWord: "generic";
        ignoredWord: "ignored";
    }>;
    constructor(type: 'missing' | 'generic' | 'ignored', value: unknown);
    get description(): string;
}
//# sourceMappingURL=fulltext-index-query-hint.d.ts.map