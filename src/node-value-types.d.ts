export declare const VALUE_TYPES: {
    OBJECT: number;
    ARRAY: number;
    NUMBER: number;
    BOOLEAN: number;
    STRING: number;
    BIGINT: number;
    DATETIME: number;
    BINARY: number;
    REFERENCE: number;
};
export declare function getValueTypeName(valueType: number): "object" | "string" | "number" | "array" | "boolean" | "date" | "binary" | "reference" | "bigint";
export declare function getNodeValueType(value: unknown): number;
export declare function getValueType(value: unknown): number;
