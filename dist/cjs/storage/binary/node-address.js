"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BinaryNodeAddress = void 0;
const node_address_1 = require("../../node-address");
class BinaryNodeAddress extends node_address_1.NodeAddress {
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
exports.BinaryNodeAddress = BinaryNodeAddress;
//# sourceMappingURL=node-address.js.map