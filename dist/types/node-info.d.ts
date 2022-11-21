import { NodeAddress } from './node-address';
export declare class NodeInfo {
    path?: string;
    type?: number;
    index?: number;
    key?: string;
    exists?: boolean;
    /** TODO: Move this to BinaryNodeInfo */
    address?: NodeAddress;
    value?: any;
    childCount?: number;
    constructor(info: Partial<NodeInfo>);
    get valueType(): number;
    get valueTypeName(): "object" | "string" | "number" | "binary" | "date" | "bigint" | "boolean" | "array" | "reference";
    toString(): string;
}
//# sourceMappingURL=node-info.d.ts.map