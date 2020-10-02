// Polyfill for Promise.try, promisifies synchronous code,
// resolving with function's return value and catching synchronous errors with a promise rejection
if (!Promise.try) {
    Promise.try = function(fn) {
        return new Promise(resolve => {
            resolve(fn());
        });
    };
}