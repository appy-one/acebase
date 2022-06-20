export class DetailedError extends Error {

    readonly code: string;
    
    readonly originalError: DetailedError|Error;

    /**
     * 
     * @param code code identifying the error
     * @param message user/developer friendly error message
     * @param originalError optional original error thrown to enable stack debugging for caught-rethrown errors
     */
    constructor(code: string, message: string, originalError: DetailedError | Error = null) {
        super(message);
        this.code = code;
        this.originalError = originalError;
    }

    get codes() {
        const arr = [];
        let err: Error = this;
        while(err) {
            arr.push(err instanceof DetailedError ? err.code : 'thrown');
            err = err instanceof DetailedError ? err.originalError : null;
        }
        return arr;
    }

    get stacks() {
        const arr = [];
        let err: Error = this;
        while(err) {
            arr.push(err.stack);
            err = err instanceof DetailedError ? err.originalError : null;
        }
        return arr.join('\r\n-----------------\r\n');
    }

    hasErrorCode(code) {
        let err: DetailedError = this;
        while (err.code !== code && err.originalError) {
            err = err.originalError as DetailedError;
        }
        return err.code === code;
        // TODO: Maybe just use this for simplicity:
        // return this.codes.includes(code);
    }

    static hasErrorCode(err, code) {
        if (!(err instanceof DetailedError)) { return false; }
        return err.hasErrorCode(code);
    }
}
