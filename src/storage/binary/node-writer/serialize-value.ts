import { VALUE_TYPES } from '../../../node-value-types.js';
import { InternalNodeReference } from '../internal-node-reference.js';
import { SerializedKeyValue } from '../serialized-key-value.js';
import { AceBaseStorage } from '../binary-storage.js';
import { _lockAndWriteNode } from './lock-and-write-node.js';
import { PathReference, Utils } from 'acebase-core';

const { numberToBytes, bigintToBytes, encodeString } = Utils;

export function _serializeValue (
    storage: AceBaseStorage,
    path: string,
    keyOrIndex: string | number,
    val: any,
    parentTid: string | number,
): SerializedKeyValue|Promise<SerializedKeyValue> {
    const missingTidMessage = 'Need to create a new record, but the parentTid is not given';
    const create = (details: SerializedKeyValue) => {
        if (typeof keyOrIndex === 'number') {
            details.index = keyOrIndex;
        }
        else {
            details.key = keyOrIndex;
        }
        details.ref = val;
        return new SerializedKeyValue(details);
    };

    if (val instanceof Date) {
        // Store as 64-bit (8 byte) signed integer.
        // NOTE: 53 bits seem to the max for the Date constructor in Chrome browser,
        // although higher dates can be constructed using specific year,month,day etc
        // NOTE: Javascript Numbers seem to have a max "safe" value of (2^53)-1 (Number.MAX_SAFE_INTEGER),
        // this is because the other 12 bits are used for sign (1 bit) and exponent.
        // See https://stackoverflow.com/questions/9939760/how-do-i-convert-an-integer-to-binary-in-javascript
        const ms = val.getTime();
        const bytes = numberToBytes(ms);
        return create({ type: VALUE_TYPES.DATETIME, bytes });
    }
    else if (val instanceof Array) {
        // Create separate record for the array
        if (val.length === 0) {
            return create({ type: VALUE_TYPES.ARRAY, bytes: [] });
        }
        console.assert(parentTid, missingTidMessage);
        return _lockAndWriteNode(storage, path, val, parentTid)
            .then(recordInfo => {
                return create({ type: VALUE_TYPES.ARRAY, record: recordInfo.address });
            });
    }
    else if (val instanceof InternalNodeReference) {
        // Used internally, happens to existing external record data that is not being changed.
        return create({ type: val.type, record: val.address });
    }
    else if (val instanceof ArrayBuffer) {
        if (val.byteLength > storage.settings.maxInlineValueSize) {
            console.assert(parentTid, missingTidMessage);
            return _lockAndWriteNode(storage, path, val, parentTid)
                .then(recordInfo => {
                    return create({ type: VALUE_TYPES.BINARY, record: recordInfo.address });
                });
        }
        else {
            return create({ type: VALUE_TYPES.BINARY, bytes: val });
        }
    }
    else if (val instanceof PathReference) {
        const encoded = encodeString(val.path); // textEncoder.encode(val.path);
        if (encoded.length > storage.settings.maxInlineValueSize) {
            // Create seperate record for this string value
            console.assert(parentTid, missingTidMessage);
            return _lockAndWriteNode(storage, path, val, parentTid)
                .then(recordInfo => {
                    return create({ type: VALUE_TYPES.REFERENCE, record: recordInfo.address });
                });
        }
        else {
            // Small enough to store inline
            return create({ type: VALUE_TYPES.REFERENCE, binary: encoded });
        }
    }
    else if (typeof val === 'object') {
        if (Object.keys(val).length === 0) {
            // Empty object (has no properties), can be stored inline
            return create({ type: VALUE_TYPES.OBJECT, bytes: [] });
        }
        // Create seperate record for this object
        console.assert(parentTid, missingTidMessage);
        return _lockAndWriteNode(storage, path, val, parentTid)
            .then(recordInfo => {
                return create({ type: VALUE_TYPES.OBJECT, record: recordInfo.address });
            });
    }
    else if (typeof val === 'number') {
        const bytes = numberToBytes(val);
        return create({ type: VALUE_TYPES.NUMBER, bytes });
    }
    else if (typeof val === 'bigint') {
        const bytes = bigintToBytes(val);
        return create({ type: VALUE_TYPES.BIGINT, bytes });
    }
    else if (typeof val === 'boolean') {
        return create({ type: VALUE_TYPES.BOOLEAN, bool: val });
    }
    else {
        // This is a string or something we don't know how to serialize
        if (typeof val !== 'string') {
            // Not a string, convert to one
            val = val.toString();
        }
        // Idea for later: Use string interning to store identical string values only once,
        // using ref count to decide when to remove
        const encoded = encodeString(val); // textEncoder.encode(val);
        if (encoded.length > storage.settings.maxInlineValueSize) {
            // Create seperate record for this string value
            console.assert(parentTid, missingTidMessage);
            return _lockAndWriteNode(storage, path, val, parentTid)
                .then(recordInfo => {
                    return create({ type: VALUE_TYPES.STRING, record: recordInfo.address });
                });
        }
        else {
            // Small enough to store inline
            return create({ type: VALUE_TYPES.STRING, binary: encoded });
        }
    }
}
