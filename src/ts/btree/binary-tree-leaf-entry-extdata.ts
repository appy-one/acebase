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
    _headerLoaded: boolean,
    _values: BinaryBPlusTreeLeafEntryValue[],
    _listLengthIndex: number;
    loadValues: (existingLock?: ThreadSafeLock) => Promise<BinaryBPlusTreeLeafEntryValue[]>;
    loadHeader: (keepLock: boolean | ThreadSafeLock) => Promise<void | ThreadSafeLock>;
    loadFromExtData: (allExtData: any) => void;
    addValue: (recordPointer: LeafEntryRecordPointer, metadata: LeafEntryMetaData) => Promise<void>;
    removeValue: (recordPointer: LeafEntryRecordPointer) => Promise<void>;
}

// I apparently started building a BinaryBPlusTreeLeafExtData class,
// which would be a good thing to try again soon!

// class BinaryBPlusTreeLeafExtData {
//     /**
//      *
//      * @param {object} [info]
//      * @param {number} [info.length=0]
//      * @param {number} [info.freeBytes=0]
//      * @param {boolean} [info.loaded]
//      * @param {()=>Promise<void>} [info.load]
//      */
//     constructor(info) {
//         this.length = typeof info.length === 'number' ? info.length : 0;
//         this.freeBytes = typeof info.freeBytes === 'number' ? info.freeBytes : 0;
//         this.loaded = typeof info.loaded === 'boolean' ? info.loaded : false;
//         if (typeof info.load === 'function') {
//             this.load = info.load;
//         }
//     }
//     /**
//      * MUST BE OVERRIDEN: Makes sure all extData blocks are read. Needed when eg rebuilding.
//      */
//     load() {
//         throw new Error('BinaryBPlusTreeLeaf.extData.load must be overriden');
//     }
// }
