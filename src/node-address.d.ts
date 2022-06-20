export declare class NodeAddress {
    readonly path: string;
    readonly pageNr: number;
    readonly recordNr: number;
    constructor(path: string, pageNr: number, recordNr: number);
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
    equals(address: NodeAddress): any;
}
