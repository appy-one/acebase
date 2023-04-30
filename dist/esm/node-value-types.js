import { PathReference } from 'acebase-core';
const nodeValueTypes = {
    // Native types:
    OBJECT: 1,
    ARRAY: 2,
    NUMBER: 3,
    BOOLEAN: 4,
    STRING: 5,
    BIGINT: 7,
    // Custom types:
    DATETIME: 6,
    BINARY: 8,
    REFERENCE: 9, // Absolute or relative path to other node
    // Future:
    // DOCUMENT: 10,     // JSON/XML documents that are contained entirely within the stored node
};
export const VALUE_TYPES = nodeValueTypes;
export function getValueTypeName(valueType) {
    switch (valueType) {
        case VALUE_TYPES.ARRAY: return 'array';
        case VALUE_TYPES.BINARY: return 'binary';
        case VALUE_TYPES.BOOLEAN: return 'boolean';
        case VALUE_TYPES.DATETIME: return 'date';
        case VALUE_TYPES.NUMBER: return 'number';
        case VALUE_TYPES.OBJECT: return 'object';
        case VALUE_TYPES.REFERENCE: return 'reference';
        case VALUE_TYPES.STRING: return 'string';
        case VALUE_TYPES.BIGINT: return 'bigint';
        // case VALUE_TYPES.DOCUMENT: return 'document';
        default: 'unknown';
    }
}
export function getNodeValueType(value) {
    if (value instanceof Array) {
        return VALUE_TYPES.ARRAY;
    }
    else if (value instanceof PathReference) {
        return VALUE_TYPES.REFERENCE;
    }
    else if (value instanceof ArrayBuffer) {
        return VALUE_TYPES.BINARY;
    }
    // TODO else if (value instanceof DataDocument) { return VALUE_TYPES.DOCUMENT; }
    else if (typeof value === 'string') {
        return VALUE_TYPES.STRING;
    }
    else if (typeof value === 'object') {
        return VALUE_TYPES.OBJECT;
    }
    else if (typeof value === 'bigint') {
        return VALUE_TYPES.BIGINT;
    }
    throw new Error(`Invalid value for standalone node: ${value}`);
}
export function getValueType(value) {
    if (value instanceof Array) {
        return VALUE_TYPES.ARRAY;
    }
    else if (value instanceof PathReference) {
        return VALUE_TYPES.REFERENCE;
    }
    else if (value instanceof ArrayBuffer) {
        return VALUE_TYPES.BINARY;
    }
    else if (value instanceof Date) {
        return VALUE_TYPES.DATETIME;
    }
    // TODO else if (value instanceof DataDocument) { return VALUE_TYPES.DOCUMENT; }
    else if (typeof value === 'string') {
        return VALUE_TYPES.STRING;
    }
    else if (typeof value === 'object') {
        return VALUE_TYPES.OBJECT;
    }
    else if (typeof value === 'number') {
        return VALUE_TYPES.NUMBER;
    }
    else if (typeof value === 'boolean') {
        return VALUE_TYPES.BOOLEAN;
    }
    else if (typeof value === 'bigint') {
        return VALUE_TYPES.BIGINT;
    }
    throw new Error(`Unknown value type: ${value}`);
}
//# sourceMappingURL=node-value-types.js.map