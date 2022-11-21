export declare class AsyncTaskBatch {
    limit: number;
    options?: {
        /**
         * Whether to wait with processing until `start` is called. Set this to true if you are adding tasks
         * in an async loop and batch processing might be finished already before new tasks are added.
         * @default false
         */
        wait?: boolean;
    };
    private added;
    private scheduled;
    private running;
    private results;
    private doneCallback;
    private errorCallback;
    private done;
    /**
     * Creates a new batch: runs a maximum amount of async tasks simultaniously and waits until they are all resolved.
     * If all tasks succeed, returns the results in the same order tasks were added (like `Promise.all` would do), but
     * cancels any waiting tasks upon failure of one task. Note that the execution order of tasks added after the set
     * limit is unknown.
     * @param limit Max amount of async functions to execute simultaniously. Default is `1000`
     * @param options Additional options
     */
    constructor(limit?: number, options?: {
        /**
         * Whether to wait with processing until `start` is called. Set this to true if you are adding tasks
         * in an async loop and batch processing might be finished already before new tasks are added.
         * @default false
         */
        wait?: boolean;
    });
    private execute;
    add(task: () => Promise<any>): void;
    /**
     * Manually starts batch processing, mus be done if the `wait` option was used
     */
    start(): void;
    finish(): Promise<any[]>;
}
//# sourceMappingURL=async-task-batch.d.ts.map