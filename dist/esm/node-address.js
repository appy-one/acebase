export class NodeAddress {
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
export class RemovedNodeAddress extends NodeAddress {
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
//# sourceMappingURL=node-address.js.map