import { NodeAddress } from '../../node-address.js';
export class BinaryNodeAddress extends NodeAddress {
    constructor(path, pageNr, recordNr) {
        super(path);
        this.pageNr = pageNr;
        this.recordNr = recordNr;
    }
    toString() {
        return `"/${this.path}" @${this.pageNr},${this.recordNr}`;
    }
    /**
     * Compares this address to another address
     */
    equals(address) {
        return this.path === address.path && this.pageNr === address.pageNr && this.recordNr === address.recordNr;
    }
}
//# sourceMappingURL=node-address.js.map