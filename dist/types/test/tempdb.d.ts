import { AceBase } from '..';
export declare function createTempDB(enable?: {
    transactionLogging?: boolean;
    logLevel?: 'verbose' | 'log' | 'warn' | 'error';
    config?: (options: any) => void;
}): Promise<{
    db: AceBase;
    removeDB: () => Promise<void>;
}>;
//# sourceMappingURL=tempdb.d.ts.map