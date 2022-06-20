export class NodeAddress {
    constructor(
        public readonly path: string, 
        public readonly pageNr: number, 
        public readonly recordNr: number) {
    }

    toString() {
        return `"/${this.path}" @${this.pageNr},${this.recordNr}`;
    }

    /**
     * Compares this address to another address
     */
    equals(address: NodeAddress) {
        return this.path === address.path && this.pageNr === address.pageNr && this.recordNr === address.recordNr;
    }
}

export class RemovedNodeAddress extends NodeAddress {
    constructor(path: string) {
        super(path, null, null);
    }

    toString() {
        return `"/${this.path}" (removed)`;
    }

    /**
     * Compares this address to another address
     */
    equals(address: NodeAddress) {
        return address instanceof RemovedNodeAddress && this.path === address.path;
    }
}
