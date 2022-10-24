export declare class DetailedError extends Error {
    readonly code: string;
    readonly originalError: DetailedError | Error;
    /**
     *
     * @param code code identifying the error
     * @param message user/developer friendly error message
     * @param originalError optional original error thrown to enable stack debugging for caught-rethrown errors
     */
    constructor(code: string, message: string, originalError?: DetailedError | Error);
    get codes(): string[];
    get stacks(): string;
    hasErrorCode(code: string): boolean;
    static hasErrorCode(err: Error, code: string): boolean;
}
//# sourceMappingURL=detailed-error.d.ts.map