import { Uint8ArrayBuilder } from '../../../binary.js';
import { VALUE_TYPES } from '../../../node-value-types.js';
import { SerializedKeyValue } from '../serialized-key-value.js';

/**
 * @param builder optional builder to append data to
 * @returns returns the used builder
 */
export function _writeBinaryValue(kvp: SerializedKeyValue, builder = new Uint8ArrayBuilder(null, 64)): Uint8ArrayBuilder {
    const startIndex = builder.length;
    // value_type:
    builder.push(kvp.type << 4);    // tttt0000

    // tiny_value?:
    let tinyValue = -1;
    if (kvp.type === VALUE_TYPES.BOOLEAN) { tinyValue = kvp.bool ? 1 : 0; }
    else if (kvp.type === VALUE_TYPES.NUMBER && kvp.ref >= 0 && kvp.ref <= 15 && Math.floor(kvp.ref) === kvp.ref) { tinyValue = kvp.ref; }
    else if (kvp.type === VALUE_TYPES.BIGINT && kvp.ref >= BigInt(0) && kvp.ref <= BigInt(15)) { tinyValue = Number(kvp.ref); }
    else if (kvp.type === VALUE_TYPES.STRING && kvp.binary && kvp.binary.length === 0) { tinyValue = 0; }
    else if (kvp.type === VALUE_TYPES.ARRAY && kvp.ref.length === 0) { tinyValue = 0; }
    else if (kvp.type === VALUE_TYPES.OBJECT && Object.keys(kvp.ref).length === 0) { tinyValue = 0; }
    else if (kvp.type === VALUE_TYPES.BINARY && kvp.ref.byteLength === 0) { tinyValue = 0; }
    if (tinyValue >= 0) {
        // Tiny value
        builder.data[startIndex] |= tinyValue;
        builder.push(64); // 01000000 --> tiny value
        // The end
    }
    else if (kvp.record) {
        // External record
        builder.push(192); // 11000000 --> record value

        // Set the 6 byte record address (page_nr,record_nr)
        builder.writeUint32(kvp.record.pageNr);
        builder.writeUint16(kvp.record.recordNr);
    }
    else {
        // Inline value
        let data = kvp.bytes || kvp.binary;
        const length = 'byteLength' in data ? data.byteLength : data.length;

        builder.push(
            128             // 10000000 --> inline value
            | (length - 1),  // inline_length (last 6 bits)
        );
        if (data instanceof ArrayBuffer) {
            data = new Uint8Array(data);
        }
        builder.append(data as Uint8Array);

        // End
    }
    return builder;
}
