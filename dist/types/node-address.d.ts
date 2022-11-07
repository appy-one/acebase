export declare class NodeAddress {
    readonly path: string;
    constructor(path: string);
    toString(): string;
    /**
     * Compares this address to another address
     */
    equals(address: NodeAddress): boolean;
}
export declare class RemovedNodeAddress extends NodeAddress {
    constructor(path: string);
    toString(): string;
    /**
     * Compares this address to another address
     */
    equals(address: NodeAddress): boolean;
}
//# sourceMappingURL=node-address.d.ts.map