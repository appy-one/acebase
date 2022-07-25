import { LeafEntryMetaData } from './leaf-entry-metadata';
import { LeafEntryRecordPointer } from './leaf-entry-recordpointer';

export class BPlusTreeLeafEntryValue {
    /**
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
