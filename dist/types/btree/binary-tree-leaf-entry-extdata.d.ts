import { ThreadSafeLock } from '../thread-safe';
import { BinaryBPlusTreeLeafEntryValue } from './binary-tree-leaf-entry-value';
import { LeafEntryMetaData } from './leaf-entry-metadata';
import { LeafEntryRecordPointer } from './leaf-entry-recordpointer';
export interface IBinaryBPlusTreeLeafEntryExtData {
    length: number;
    freeBytes: number;
    values: any[];
    leafOffset: number;
    index: number;
    totalValues: number;
    loaded: boolean;
    _headerLength: number;
    _length: number;
    _freeBytes: number;
    _headerLoaded: boolean;
    _values: BinaryBPlusTreeLeafEntryValue[];
    _listLengthIndex: number;
    loadValues: (existingLock?: ThreadSafeLock) => Promise<BinaryBPlusTreeLeafEntryValue[]>;
    loadHeader: (keepLock: boolean | ThreadSafeLock) => Promise<void | ThreadSafeLock>;
    loadFromExtData: (allExtData: any) => void;
    addValue: (recordPointer: LeafEntryRecordPointer, metadata: LeafEntryMetaData) => Promise<void>;
    removeValue: (recordPointer: LeafEntryRecordPointer) => Promise<void>;
}
//# sourceMappingURL=binary-tree-leaf-entry-extdata.d.ts.map