export type RetryOptions = {
    /**
     * Number of retries after first try failed
     * @default 10
     */
    retries: number;
    /**
     * Exponential factor to use
     * @default 2
     */
    factor: number;
    /**
     * minimum amount of milliseconds to wait before the first retry. Default is 1 second
     * @default 1000
     */
    minTimeout: number;
    /**
     * maximum amount of milliseconds to wait between retries. Default is 1 hour
     * @default 3_600_000
     */
    maxTimeout: number;
    /**
     * Optional callback function to determines whether to proceed retrying
     */
    check?: (err: any, attempt: number) => boolean | Promise<boolean>;
};

export async function retry<T = any>(operation: () => T, settings: Partial<RetryOptions>) {
    if (typeof operation !== 'function') { throw new Error(`no operation given`); }
    settings.retries = settings.retries ?? 10;
    settings.factor = settings.factor ?? 2;
    settings.minTimeout = settings.minTimeout ?? 1000;
    settings.maxTimeout = settings.maxTimeout ?? 3_600_000;
    const { retries, factor, minTimeout, maxTimeout, check } = settings;

    let lastError: any;
    let attempt = 0;
    while (attempt <= retries) {
        if (attempt > 0) {
            const timeout = Math.min(minTimeout * Math.pow(factor, attempt), maxTimeout);
            await new Promise<void>((resolve) => setTimeout(resolve, timeout));
        }
        try {
            const result = await operation();
            return result as T;
        }
        catch (err: any) {
            lastError = err;
            if (check) {
                const proceed = await check(err, attempt);
                if (!proceed) { break; }
            }
            attempt++;
        }
    }
    throw lastError;
}
