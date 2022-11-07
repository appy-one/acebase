"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DetailedError = void 0;
/* eslint-disable @typescript-eslint/no-this-alias */
class DetailedError extends Error {
    /**
     *
     * @param code code identifying the error
     * @param message user/developer friendly error message
     * @param originalError optional original error thrown to enable stack debugging for caught-rethrown errors
     */
    constructor(code, message, originalError = null) {
        super(message);
        this.code = code;
        this.originalError = originalError;
    }
    get codes() {
        const arr = [];
        let err = this;
        while (err) {
            arr.push(err instanceof DetailedError ? err.code : 'thrown');
            err = err instanceof DetailedError ? err.originalError : null;
        }
        return arr;
    }
    get stacks() {
        const arr = [];
        let err = this;
        while (err) {
            arr.push(err.stack);
            err = err instanceof DetailedError ? err.originalError : null;
        }
        return arr.join('\r\n-----------------\r\n');
    }
    hasErrorCode(code) {
        let err = this;
        while (err.code !== code && err.originalError) {
            err = err.originalError;
        }
        return err.code === code;
        // TODO: Maybe just use this for simplicity:
        // return this.codes.includes(code);
    }
    static hasErrorCode(err, code) {
        if (!(err instanceof DetailedError)) {
            return false;
        }
        return err.hasErrorCode(code);
    }
}
exports.DetailedError = DetailedError;
//# sourceMappingURL=detailed-error.js.map