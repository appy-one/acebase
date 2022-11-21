export declare const VALUE_TYPES: Readonly<{
    OBJECT: 1;
    ARRAY: 2;
    NUMBER: 3;
    BOOLEAN: 4;
    STRING: 5;
    BIGINT: 7;
    DATETIME: 6;
    BINARY: 8;
    REFERENCE: 9;
}>;
export declare function getValueTypeName(valueType: number): "object" | "string" | "number" | "binary" | "date" | "bigint" | "boolean" | "array" | "reference";
export declare function getNodeValueType(value: unknown): 1 | 2 | 5 | 7 | 8 | 9;
export declare function getValueType(value: unknown): 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
//# sourceMappingURL=node-value-types.d.ts.map