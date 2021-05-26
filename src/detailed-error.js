class DetailedError extends Error {
    /**
     * 
     * @param {string} code code identifying the error
     * @param {string} message user/developer friendly error message
     * @param {AceBaseError|Error} [originalError] optional original error thrown to enable stack debugging for caught-rethrown errors
     */
    constructor(code, message, originalError = null) {
        super(message);
        this.code = code;
        this.originalError = originalError;
    }

    get codes() {
        const arr = [];
        let err = this;
        while(err) {
            arr.push(err.code);
            err = err.originalError;
        }
        return arr;
    }

    get stacks() {
        const arr = [];
        let err = this;
        while(err) {
            arr.push(err.stack);
            err = err.originalError;
        }
        return arr.join('\r\n-----------------\r\n');
    }
}

module.exports = { DetailedError };