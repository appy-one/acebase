"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RemovedNodeAddress = exports.NodeAddress = void 0;
class NodeAddress {
    constructor(path, pageNr, recordNr) {
        this.path = path;
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
exports.NodeAddress = NodeAddress;
class RemovedNodeAddress extends NodeAddress {
    constructor(path) {
        super(path, null, null);
    }
    toString() {
        return `"/${this.path}" (removed)`;
    }
    /**
     * Compares this address to another address
     */
    equals(address) {
        return address instanceof RemovedNodeAddress && this.path === address.path;
    }
}
exports.RemovedNodeAddress = RemovedNodeAddress;
//# sourceMappingURL=node-address.js.map