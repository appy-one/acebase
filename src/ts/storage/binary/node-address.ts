import { NodeAddress } from '../../node-address';

export class BinaryNodeAddress extends NodeAddress {
    constructor(
        path: string,
        public readonly pageNr: number,
        public readonly recordNr: number,
    ) {
        super(path);
    }

    toString() {
        return `"/${this.path}" @${this.pageNr},${this.recordNr}`;
    }

    /**
     * Compares this address to another address
     */
    equals(address: BinaryNodeAddress) {
        return this.path === address.path && this.pageNr === address.pageNr && this.recordNr === address.recordNr;
    }

}
