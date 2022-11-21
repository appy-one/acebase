"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const quicksort_1 = require("./quicksort");
const perf_hooks_1 = require("perf_hooks");
describe('quicksort', () => {
    const sortAscending = (a, b) => a - b;
    const sortDescending = (a, b) => b - a;
    it('sorts in place', () => {
        const input = [5, 2, 7, 1, 0, -5, 3, 2];
        const output = (0, quicksort_1.default)(input);
        expect(output).toBe(input);
    });
    it('sorts ok', () => {
        // sort ascending
        const input = [5, 2, 7, 1, 0, -5, 3, 2];
        const sorted = input.slice().sort(sortAscending);
        (0, quicksort_1.default)(input);
        expect(input).toEqual(sorted);
    });
    it('sorts ok (descending)', () => {
        // sort descending
        const input = [5, 2, 7, 1, 0, -5, 3, 2];
        const sorted = input.slice().sort(sortDescending);
        (0, quicksort_1.default)(input, sortDescending);
        expect(input).toEqual(sorted);
    });
    it('sorts ok (random)', () => {
        // run 1000 times
        const runs = 1000;
        for (let r = 0; r < runs; r++) {
            const arr = [];
            for (let i = 0; i < 10000; i++) {
                arr[i] = Math.round(Math.random() * 1000000);
            }
            const sorted = arr.slice().sort(sortAscending);
            (0, quicksort_1.default)(arr);
            expect(arr).toEqual(sorted);
        }
    });
    it('is faster than native', () => {
        const run = () => {
            // prepare
            const arr = [];
            for (let i = 0; i < 1000; i++) {
                arr[i] = Math.round(Math.random() * 1000000);
            }
            const copy = arr.slice();
            // run native
            const native = { start: perf_hooks_1.performance.now(), end: -1 };
            arr.sort(sortAscending);
            native.end = perf_hooks_1.performance.now();
            // run fast quicksort
            const quick = { start: perf_hooks_1.performance.now(), end: -1 };
            (0, quicksort_1.default)(copy, sortAscending);
            quick.end = perf_hooks_1.performance.now();
            return {
                native: native.end - native.start,
                quick: quick.end - quick.start,
            };
        };
        // Run many times
        const runs = 10000;
        const totals = { native: 0, quick: 0 };
        for (let i = 0; i < runs; i++) {
            const results = run();
            totals.native += results.native;
            totals.quick += results.quick;
        }
        const perc = Math.round((totals.quick / totals.native) * 100);
        const multiplier = Math.round(10000 / perc) / 100;
        const percFaster = (100 * multiplier) - 100;
        console.log(`Fast quicksort (${Math.round(totals.quick)}ms) vs native (${Math.round(totals.native)}ms) performance: fast quicksort is ${percFaster}% faster (${multiplier}x as fast)`);
        expect(totals.quick).toBeLessThan(totals.native);
    });
    it('does not loop infinitely #118', async () => {
        // Created for issue #118 (fastQuickSort() infinite loop when arr.length = 1)
        // Execution hung before fixing this is v1.21.6
        (0, quicksort_1.default)([0]);
    });
});
//# sourceMappingURL=quicksort.spec.js.map