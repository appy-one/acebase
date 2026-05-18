import { PathInfo, PathReference, Utils } from 'acebase-core';
import { NodeValueType, VALUE_TYPES } from '../../../node-value-types.js';
import { AceBaseStorage } from '../binary-storage.js';
import { _write } from './write.js';
import { SerializedKeyValue } from '../serialized-key-value.js';
import { _serializeValue } from './serialize-value.js';
import { BINARY_TREE_FILL_FACTOR_50, BINARY_TREE_FILL_FACTOR_95 } from '../flags.js';
import { BinaryWriter, BPlusTreeBuilder } from '../../../btree/index.js';
import { _getValueBytes } from './get-value-bytes.js';
import { Uint8ArrayBuilder } from '../../../binary.js';
import { _writeBinaryValue } from './write-binary-value.js';
import { IAceBaseIPCLock } from '../../../ipc/ipc.js';
import { RecordInfo } from '../record-info.js';

const { encodeString, bigintToBytes } = Utils;

export async function _writeNode(storage: AceBaseStorage, path: string, value: any, lock: IAceBaseIPCLock, currentRecordInfo?: RecordInfo): Promise<RecordInfo> {
    if (lock.path !== path || !lock.forWriting) {
        throw new Error(`Cannot write to node "/${path}" because lock is on the wrong path or not for writing`);
    }

    const write = (valueType: NodeValueType, buffer: number[] | Uint8Array, keyTree = false) => {
        let readOffset = 0;
        const reader = (length: number) => {
            const slice = buffer.slice(readOffset, readOffset + length);
            readOffset += length;
            return slice;
        };
        return _write(storage, path, valueType, buffer.length, keyTree, reader, currentRecordInfo);
    };

    if (typeof value === 'string') {
        return write(VALUE_TYPES.STRING, encodeString(value));
    }
    else if (typeof value === 'bigint') {
        return write(VALUE_TYPES.BIGINT, bigintToBytes(value)); // better called "HugeInt" if it has to be stored in its own record!
    }
    else if (value instanceof PathReference) {
        return write(VALUE_TYPES.REFERENCE, encodeString(value.path));
    }
    else if (value instanceof ArrayBuffer) {
        return write(VALUE_TYPES.BINARY, new Uint8Array(value));
    }
    else if (typeof value !== 'object') {
        throw new TypeError('Unsupported type to store in stand-alone record');
    }

    // Store array or object
    const childPromises = [] as Promise<any>[];
    const serialized = [] as SerializedKeyValue[];
    const isArray = value instanceof Array;

    if (isArray) {
        // Store array
        const isExhaustive = Object.keys(value).every((key, i) => +key === i && value[i] !== null); // Test if there are no gaps in the array
        if (!isExhaustive) {
            throw new Error('Cannot store arrays with missing entries');
        }
        (value as any[]).forEach((val, index) => {
            if (typeof val === 'function') {
                throw new Error(`Array at index ${index} has invalid value. Cannot store functions`);
            }
            const childPath = `${path}[${index}]`;
            const s = _serializeValue(storage, childPath, index, val, lock.tid);
            const add = (s: SerializedKeyValue) => {
                serialized[index] = s; // Fixed: Array order getting messed up (with serialized.push after promises resolving)
            };
            if (s instanceof Promise) {
                childPromises.push(s.then(add));
            }
            else {
                add(s);
            }
        });
    }
    else {
        // Store object
        Object.keys(value).forEach(key => {
            if (/[\x00-\x08\x0b\x0c\x0e-\x1f/[\]\\]/.test(key)) {
                throw new Error(`Invalid key "${key}" for object to store at path "${path}". Keys cannot contain control characters or any of the following characters: \\ / [ ]`);
            }
            if (key.length > 128) { throw new Error(`Key "${key}" is too long to store for object at path "${path}". Max key length is 128`); }
            if (key.length === 0) { throw new Error(`Child key for path "${path}" is not allowed be empty`); }
            const childPath = PathInfo.getChildPath(path, key); // `${path}/${key}`;
            const val = value[key];
            if (typeof val === 'function' || val === null) {
                return; // Skip functions and null values
            }
            else if (typeof val === 'undefined') {
                if (storage.settings.removeVoidProperties === true) {
                    delete value[key]; // Kill the property in the passed object as well, to prevent differences in stored and working values
                    return;
                }
                else {
                    throw new Error(`Property "${key}" has invalid value. Cannot store undefined values. Set removeVoidProperties option to true to automatically remove undefined properties`);
                }
            }
            else {
                const s = _serializeValue(storage, childPath, key, val, lock.tid);
                const add = (s: SerializedKeyValue) => {
                    serialized.push(s);
                };
                if (s instanceof Promise) {
                    childPromises.push(s.then(add));
                }
                else {
                    add(s);
                }
            }
        });
    }

    await Promise.all(childPromises);

    // Append all serialized data into 1 binary array
    let result: { keyTree: boolean, data: Uint8Array };
    const minKeysForTreeCreation = 100;
    if (serialized.length > minKeysForTreeCreation) {
        // Create a B+tree
        const fillFactor =
            isArray || serialized.every(kvp => typeof kvp.key === 'string' && /^[0-9]+$/.test(kvp.key))
                ? BINARY_TREE_FILL_FACTOR_50 // TODO: Consider removing this, might be better performing now with 95% instead!
                : BINARY_TREE_FILL_FACTOR_95;

        const treeBuilder = new BPlusTreeBuilder(true, fillFactor);
        serialized.forEach(kvp => {
            const binaryValue = _getValueBytes(kvp);
            treeBuilder.add(isArray ? kvp.index : kvp.key, binaryValue);
        });

        const builder = new Uint8ArrayBuilder();
        await treeBuilder.create().toBinary(true, BinaryWriter.forUint8ArrayBuilder(builder));
        // // Test tree
        // await BinaryBPlusTree.test(bytes)
        result = { keyTree: true, data: builder.data };
    }
    else {
        const builder = new Uint8ArrayBuilder();
        serialized.forEach(kvp => {
            if (!isArray) {
                const keyIndex = storage.KIT.getOrAdd(kvp.key); // Gets KIT index for this key

                // key_info:
                if (keyIndex >= 0) {
                    // Cached key name
                    builder.writeByte(
                        128                          // key_indexed = 1
                        | ((keyIndex >> 8) & 127),   // key_nr (first 7 bits)
                    );
                    builder.writeByte(
                        keyIndex & 255,              // key_nr (last 8 bits)
                    );
                }
                else {
                    // Inline key name
                    const keyBytes = encodeString(kvp.key);
                    builder.writeByte(keyBytes.byteLength - 1); // key_length
                    builder.append(keyBytes); // key_name
                }
            }
            // const binaryValue = _getValueBytes(kvp);
            // builder.append(binaryValue);
            _writeBinaryValue(kvp, builder);
        });
        result = { keyTree: false, data: builder.data };
    }
    // Now write the record
    return write(isArray ? VALUE_TYPES.ARRAY : VALUE_TYPES.OBJECT, result.data, result.keyTree);
}
