"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AsyncTaskBatch = void 0;
class AsyncTaskBatch {
    /**
     * Creates a new batch: runs a maximum amount of async tasks simultaniously and waits until they are all resolved.
     * If all tasks succeed, returns the results in the same order tasks were added (like `Promise.all` would do), but
     * cancels any waiting tasks upon failure of one task. Note that the execution order of tasks added after the set
     * limit is unknown.
     * @param limit Max amount of async functions to execute simultaniously. Default is `1000`
     * @param options Additional options
     */
    constructor(limit = 1000, options) {
        this.limit = limit;
        this.options = options;
        this.added = 0;
        this.scheduled = [];
        this.running = 0;
        this.results = [];
        this.done = false;
    }
    async execute(task, index) {
        var _a, _b;
        try {
            this.running++;
            const result = await task();
            this.results[index] = result;
            this.running--;
            if (this.running === 0 && this.scheduled.length === 0) {
                // Finished
                this.done = true;
                (_a = this.doneCallback) === null || _a === void 0 ? void 0 : _a.call(this, this.results);
            }
            else if (this.scheduled.length > 0) {
                // Run next scheduled task
                const next = this.scheduled.shift();
                this.execute(next.task, next.index);
            }
        }
        catch (err) {
            this.done = true;
            (_b = this.errorCallback) === null || _b === void 0 ? void 0 : _b.call(this, err);
        }
    }
    add(task) {
        var _a;
        if (this.done) {
            throw new Error(`Cannot add to a batch that has already finished. Use wait option and start batch processing manually if you are adding tasks in an async loop`);
        }
        const index = this.added++;
        if (((_a = this.options) === null || _a === void 0 ? void 0 : _a.wait) !== true && this.running < this.limit) {
            this.execute(task, index);
        }
        else {
            this.scheduled.push({ task, index });
        }
    }
    /**
     * Manually starts batch processing, mus be done if the `wait` option was used
     */
    start() {
        while (this.running < this.limit) {
            const next = this.scheduled.shift();
            this.execute(next.task, next.index);
        }
    }
    async finish() {
        if (this.running === 0 && this.scheduled.length === 0) {
            return this.results;
        }
        await new Promise((resolve, reject) => {
            this.doneCallback = resolve;
            this.errorCallback = reject;
        });
        return this.results;
    }
}
exports.AsyncTaskBatch = AsyncTaskBatch;
//# sourceMappingURL=async-task-batch.js.map