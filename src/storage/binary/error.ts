export class ErrorWithCode extends Error {
    constructor(public code: string, message: string, cause?: any) {
        super(message, { cause });
    }
}
