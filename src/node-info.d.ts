import { NodeAddress } from './node-address';
export declare class NodeInfo {
    path?: string;
    type?: number;
    index?: number;
    key?: string;
    exists?: boolean;
    address?: NodeAddress;
    value?: any;
    childCount?: number;
    constructor(info: Partial<NodeInfo>);
    get valueType(): number;
    get valueTypeName(): "object" | "string" | "number" | "array" | "boolean" | "date" | "binary" | "reference";
    toString(): string;
}
