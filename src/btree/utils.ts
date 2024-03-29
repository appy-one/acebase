import { NodeEntryKeyType } from './entry-key-type';
import { LeafEntryMetaData } from './leaf-entry-metadata';
import { LeafEntryRecordPointer } from './leaf-entry-recordpointer';

export function _checkNewEntryArgs(key: NodeEntryKeyType, recordPointer: LeafEntryRecordPointer, metadataKeys: string[], metadata: LeafEntryMetaData) {
    const storageTypesText = 'supported types are string, number, boolean, Date and undefined';
    const isStorableType = (val: NodeEntryKeyType) => {
        return ['number','string','boolean','bigint','undefined'].includes(typeof val) || val instanceof Date;
    };
    if (!isStorableType(key)) {
        return new TypeError(`key contains a value that cannot be stored. ${storageTypesText}`);
    }
    if (!(recordPointer instanceof Array || recordPointer instanceof Uint8Array)) {
        return new TypeError('recordPointer must be a byte array or Uint8Array');
    }
    if (recordPointer.length > 255) {
        return new Error('Unable to store recordPointers larger than 255 bytes'); // binary restriction
    }
    // Check if all metadata keys are present and have valid data
    try {
        metadataKeys && metadataKeys.forEach(key => {
            if (!(key in metadata)) {
                throw new TypeError(`metadata must include key "${key}"`);
            }
            if (!isStorableType(typeof metadata[key])) {
                throw new TypeError(`metadata "${key}" contains a value that cannot be stored. ${storageTypesText}`);
            }
        });
    }
    catch(err) {
        return err;
    }
}

export const _appendToArray = (targetArray: unknown[], arr2: unknown[]) => {
    const n = 255;
    let start = 0;
    while (start < arr2.length) {
        targetArray.push(...arr2.slice(start, start + n));
        start += n;
    }
};
