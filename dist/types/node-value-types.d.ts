declare const nodeValueTypes: {
    readonly OBJECT: 1;
    readonly ARRAY: 2;
    readonly NUMBER: 3;
    readonly BOOLEAN: 4;
    readonly STRING: 5;
    readonly BIGINT: 7;
    readonly DATETIME: 6;
    readonly BINARY: 8;
    readonly REFERENCE: 9;
};
export type NodeValueType = typeof nodeValueTypes[keyof typeof nodeValueTypes];
export declare const VALUE_TYPES: Record<"OBJECT" | "ARRAY" | "NUMBER" | "BOOLEAN" | "STRING" | "BIGINT" | "DATETIME" | "BINARY" | "REFERENCE", NodeValueType>;
export declare function getValueTypeName(valueType: number): "object" | "string" | "number" | "array" | "boolean" | "date" | "bigint" | "binary" | "reference";
export declare function getNodeValueType(value: unknown): NodeValueType;
export declare function getValueType(value: unknown): NodeValueType;
export {};
//# sourceMappingURL=node-value-types.d.ts.map