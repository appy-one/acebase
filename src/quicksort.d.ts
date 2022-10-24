/**
 * Faster quicksort using a stack to eliminate recursion, sorting inplace to reduce memory usage, and using insertion sort for small partition sizes.
 *
 * Original author unknown.
 * I (Ewout Stortenbeker) isolated the fast quicksort code from benchmark (see below), ported to TypeScript and added custom sort function argument.
 *
 * Benchmark results at https://www.measurethat.net/Benchmarks/Show/3549/0/javascript-sorting-algorithms indicate this algorithm is at least 10x faster
 * than the native sort function (tested on Chrome v101, June 2022). My own tests (using sort function callbacks) indicate it's typically 1.5x faster than
 * the native sort algorithm. This difference is probably caused by the built-in sort being called with a callback function in the benchmark, all others
 * with basic < and > operators, which are obviously faster than callbacks.
 *
 * @param arr array to sort
 * @param compareFn optional compare function to use. Must return a negative value if a < b, 0 if a == b, positive number if a > b
 * @returns
 */
export default function fastQuickSort<T = any>(arr: T[], compareFn?: (a: T, b: T) => number): T[];
//# sourceMappingURL=quicksort.d.ts.map