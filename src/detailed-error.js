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
        // if (originalError) {
        //     // this.currentStack = this.stack;
        //     this.stack += '\n---------\n' + originalError.stack;
        // }
    }

    get codes() {
        const arr = [this.code];
        let err = this;
        while(err = err.originalError) {
            arr.push(err.code);
        }
        return arr;
    }

    get stacks() {
        const arr = [this.stack];
        let err = this;
        while(err = err.originalError) {
            arr.push(err.stack);
        }
        return arr.join('\r\n-----------------\r\n');
    }
}

module.exports = { DetailedError };