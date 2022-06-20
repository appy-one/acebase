const { PathReference } = require('acebase-core');

const VALUE_TYPES = {
    // Native types:
    OBJECT: 1,
    ARRAY: 2,
    NUMBER: 3,
    BOOLEAN: 4,
    STRING: 5,
    // Custom types:
    DATETIME: 6,
    // DOCUMENT: 7,     // JSON/XML documents that are contained entirely within the stored node
    BINARY: 8,
    REFERENCE: 9        // Absolute or relative path to other node
};

function getValueTypeName(valueType) {
    switch (valueType) {
        case VALUE_TYPES.ARRAY: return 'array';
        case VALUE_TYPES.BINARY: return 'binary';
        case VALUE_TYPES.BOOLEAN: return 'boolean';
        case VALUE_TYPES.DATETIME: return 'date';
        case VALUE_TYPES.NUMBER: return 'number';
        case VALUE_TYPES.OBJECT: return 'object';
        case VALUE_TYPES.REFERENCE: return 'reference';
        case VALUE_TYPES.STRING: return 'string';
        // case VALUE_TYPES.DOCUMENT: return 'document';
        default: 'unknown';
    }
}

function getNodeValueType(value) {
    if (value instanceof Array) { return VALUE_TYPES.ARRAY; }
    else if (value instanceof PathReference) { return VALUE_TYPES.REFERENCE; }
    else if (value instanceof ArrayBuffer) { return VALUE_TYPES.BINARY; }
    // TODO else if (value instanceof DataDocument) { return VALUE_TYPES.DOCUMENT; }
    else if (typeof value === 'string') { return VALUE_TYPES.STRING; }
    else if (typeof value === 'object') { return VALUE_TYPES.OBJECT; }
    throw new Error(`Invalid value for standalone node: ${value}`);
}

function getValueType(value) {
    if (value instanceof Array) { return VALUE_TYPES.ARRAY; }
    else if (value instanceof PathReference) { return VALUE_TYPES.REFERENCE; }
    else if (value instanceof ArrayBuffer) { return VALUE_TYPES.BINARY; }
    else if (value instanceof Date) { return VALUE_TYPES.DATETIME; }
    // TODO else if (value instanceof DataDocument) { return VALUE_TYPES.DOCUMENT; }
    else if (typeof value === 'string') { return VALUE_TYPES.STRING; }
    else if (typeof value === 'object') { return VALUE_TYPES.OBJECT; }
    else if (typeof value === 'number') { return VALUE_TYPES.NUMBER; }
    else if (typeof value === 'boolean') { return VALUE_TYPES.BOOLEAN; }
    throw new Error(`Unknown value type: ${value}`);
}

module.exports = { VALUE_TYPES, getValueTypeName, getNodeValueType, getValueType };