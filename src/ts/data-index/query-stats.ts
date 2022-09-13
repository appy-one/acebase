
export class IndexQueryStats {
    public started = 0;
    public stopped = 0;
    public steps = [] as IndexQueryStats[];
    public result = null as any;

    /**
     * Used by GeoIndex: amount of queries executed to get results
     */
    public queries = 1;

    constructor(public type: string, public args: unknown, start = false) {
        if (start) {
            this.start();
        }
    }

    start() {
        this.started = Date.now();
    }

    stop(result: any = null) {
        this.stopped = Date.now();
        this.result = result;
    }

    get duration() { return this.stopped - this.started; }
}
