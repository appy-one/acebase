"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getValueType = exports.getNodeValueType = exports.getValueTypeName = exports.VALUE_TYPES = void 0;
const acebase_core_1 = require("acebase-core");
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
exports.VALUE_TYPES = nodeValueTypes;
function getValueTypeName(valueType) {
    switch (valueType) {
        case exports.VALUE_TYPES.ARRAY: return 'array';
        case exports.VALUE_TYPES.BINARY: return 'binary';
        case exports.VALUE_TYPES.BOOLEAN: return 'boolean';
        case exports.VALUE_TYPES.DATETIME: return 'date';
        case exports.VALUE_TYPES.NUMBER: return 'number';
        case exports.VALUE_TYPES.OBJECT: return 'object';
        case exports.VALUE_TYPES.REFERENCE: return 'reference';
        case exports.VALUE_TYPES.STRING: return 'string';
        case exports.VALUE_TYPES.BIGINT: return 'bigint';
        // case VALUE_TYPES.DOCUMENT: return 'document';
        default: 'unknown';
    }
}
exports.getValueTypeName = getValueTypeName;
function getNodeValueType(value) {
    if (value instanceof Array) {
        return exports.VALUE_TYPES.ARRAY;
    }
    else if (value instanceof acebase_core_1.PathReference) {
        return exports.VALUE_TYPES.REFERENCE;
    }
    else if (value instanceof ArrayBuffer) {
        return exports.VALUE_TYPES.BINARY;
    }
    // TODO else if (value instanceof DataDocument) { return VALUE_TYPES.DOCUMENT; }
    else if (typeof value === 'string') {
        return exports.VALUE_TYPES.STRING;
    }
    else if (typeof value === 'object') {
        return exports.VALUE_TYPES.OBJECT;
    }
    else if (typeof value === 'bigint') {
        return exports.VALUE_TYPES.BIGINT;
    }
    throw new Error(`Invalid value for standalone node: ${value}`);
}
exports.getNodeValueType = getNodeValueType;
function getValueType(value) {
    if (value instanceof Array) {
        return exports.VALUE_TYPES.ARRAY;
    }
    else if (value instanceof acebase_core_1.PathReference) {
        return exports.VALUE_TYPES.REFERENCE;
    }
    else if (value instanceof ArrayBuffer) {
        return exports.VALUE_TYPES.BINARY;
    }
    else if (value instanceof Date) {
        return exports.VALUE_TYPES.DATETIME;
    }
    // TODO else if (value instanceof DataDocument) { return VALUE_TYPES.DOCUMENT; }
    else if (typeof value === 'string') {
        return exports.VALUE_TYPES.STRING;
    }
    else if (typeof value === 'object') {
        return exports.VALUE_TYPES.OBJECT;
    }
    else if (typeof value === 'number') {
        return exports.VALUE_TYPES.NUMBER;
    }
    else if (typeof value === 'boolean') {
        return exports.VALUE_TYPES.BOOLEAN;
    }
    else if (typeof value === 'bigint') {
        return exports.VALUE_TYPES.BIGINT;
    }
    throw new Error(`Unknown value type: ${value}`);
}
exports.getValueType = getValueType;
//# sourceMappingURL=node-value-types.js.map