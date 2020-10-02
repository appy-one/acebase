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
        if (originalError) {
            // this.currentStack = this.stack;
            this.stack += '\n---------\n' + originalError.stack;
        }
    }
}

module.exports = { DetailedError };