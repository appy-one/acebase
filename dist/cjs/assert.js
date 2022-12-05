"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assert = void 0;
/**
* Replacement for console.assert, throws an error if condition is not met.
* @param condition 'truthy' condition
* @param error
*/
function assert(condition, error) {
    if (!condition) {
        throw new Error(`Assertion failed: ${error !== null && error !== void 0 ? error : 'check your code'}`);
    }
}
exports.assert = assert;
//# sourceMappingURL=assert.js.map