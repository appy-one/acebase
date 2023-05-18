import { NodeValueType } from './node-value-types';
import { NodeAddress } from './node-address';
export declare class NodeInfo {
    path?: string;
    type?: NodeValueType;
    index?: number;
    key?: string;
    exists?: boolean;
    /** TODO: Move this to BinaryNodeInfo */
    address?: NodeAddress;
    value?: any;
    childCount?: number;
    constructor(info: Partial<NodeInfo>);
    get valueType(): NodeValueType;
    get valueTypeName(): "object" | "string" | "number" | "array" | "boolean" | "date" | "bigint" | "binary" | "reference";
    toString(): string;
}
//# sourceMappingURL=node-info.d.ts.map