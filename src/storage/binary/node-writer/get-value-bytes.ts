import { SerializedKeyValue } from '../serialized-key-value.js';
import { _writeBinaryValue } from './write-binary-value.js';

export function _getValueBytes(kvp: SerializedKeyValue): Uint8Array {
    return _writeBinaryValue(kvp).data;
}
