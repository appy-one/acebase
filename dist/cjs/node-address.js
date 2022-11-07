"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RemovedNodeAddress = exports.NodeAddress = void 0;
class NodeAddress {
    constructor(path) {
        this.path = path;
    }
    toString() {
        return `"/${this.path}"`;
    }
    /**
     * Compares this address to another address
     */
    equals(address) {
        return this.path === address.path;
    }
}
exports.NodeAddress = NodeAddress;
class RemovedNodeAddress extends NodeAddress {
    constructor(path) {
        super(path);
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