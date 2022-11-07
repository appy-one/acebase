export class NodeAddress {
    constructor(public readonly path: string) {}

    toString() {
        return `"/${this.path}"`;
    }

    /**
     * Compares this address to another address
     */
    equals(address: NodeAddress) {
        return this.path === address.path;
    }
}

export class RemovedNodeAddress extends NodeAddress {
    constructor(path: string) {
        super(path);
    }

    toString() {
        return `"/${this.path}" (removed)`;
    }

    /**
     * Compares this address to another address
     */
    equals(address: NodeAddress): boolean {
        return address instanceof RemovedNodeAddress && this.path === address.path;
    }
}
