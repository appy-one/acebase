export declare class IndexQueryStats {
    type: string;
    args: unknown;
    started: number;
    stopped: number;
    steps: IndexQueryStats[];
    result: any;
    /**
     * Used by GeoIndex: amount of queries executed to get results
     */
    queries: number;
    constructor(type: string, args: unknown, start?: boolean);
    start(): void;
    stop(result?: any): void;
    get duration(): number;
}
//# sourceMappingURL=query-stats.d.ts.map