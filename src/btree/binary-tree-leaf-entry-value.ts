import { LeafEntryMetaData } from './leaf-entry-metadata.js';
import { LeafEntryRecordPointer } from './leaf-entry-recordpointer.js';

export class BinaryBPlusTreeLeafEntryValue {
    /**
     *
     * @param recordPointer used to be called "value", renamed to prevent confusion
     * @param metadata
     */
    constructor(public recordPointer: LeafEntryRecordPointer, public metadata?: LeafEntryMetaData) {
    }

    /** @deprecated use .recordPointer instead */
    get value() {
        return this.recordPointer;
    }
}
