import { NodeAddress } from '../../node-address';
export declare class BinaryNodeAddress extends NodeAddress {
    readonly pageNr: number;
    readonly recordNr: number;
    constructor(path: string, pageNr: number, recordNr: number);
    toString(): string;
    /**
     * Compares this address to another address
     */
    equals(address: BinaryNodeAddress): boolean;
}
//# sourceMappingURL=node-address.d.ts.map