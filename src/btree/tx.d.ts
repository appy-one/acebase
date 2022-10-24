import { DetailedError } from '../detailed-error';
export declare class TxDetailedError extends DetailedError {
    transactionErrors: Array<DetailedError | Error>;
    rollbackErrors: Array<DetailedError | Error>;
    constructor(code: string, msg: string, originalError?: Error);
}
export declare class TX {
    private _queue;
    private _rollbackSteps;
    constructor();
    run(action: () => any, rollback: () => any): any;
    /**
     * For parallel transactions
     */
    queue(step: {
        name?: string;
        action: (prevResult?: any) => any;
        rollback: () => any;
    }): void;
    execute(parallel?: boolean): Promise<any>;
}
//# sourceMappingURL=tx.d.ts.map