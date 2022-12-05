/**
* Replacement for console.assert, throws an error if condition is not met.
* @param condition 'truthy' condition
* @param error
*/
export function assert(condition, error) {
    if (!condition) {
        throw new Error(`Assertion failed: ${error ?? 'check your code'}`);
    }
}
//# sourceMappingURL=assert.js.map