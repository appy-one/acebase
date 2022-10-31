export class IndexQueryStats {
    constructor(type, args, start = false) {
        this.type = type;
        this.args = args;
        this.started = 0;
        this.stopped = 0;
        this.steps = [];
        this.result = null;
        /**
         * Used by GeoIndex: amount of queries executed to get results
         */
        this.queries = 1;
        if (start) {
            this.start();
        }
    }
    start() {
        this.started = Date.now();
    }
    stop(result = null) {
        this.stopped = Date.now();
        this.result = result;
    }
    get duration() { return this.stopped - this.started; }
}
//# sourceMappingURL=query-stats.js.map