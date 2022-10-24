import { LeafEntryMetaData } from './leaf-entry-metadata';
import { LeafEntryRecordPointer } from './leaf-entry-recordpointer';
export declare class BinaryBPlusTreeLeafEntryValue {
    recordPointer: LeafEntryRecordPointer;
    metadata?: LeafEntryMetaData;
    /**
     *
     * @param recordPointer used to be called "value", renamed to prevent confusion
     * @param metadata
     */
    constructor(recordPointer: LeafEntryRecordPointer, metadata?: LeafEntryMetaData);
    /** @deprecated use .recordPointer instead */
    get value(): LeafEntryRecordPointer;
}
//# sourceMappingURL=binary-tree-leaf-entry-value.d.ts.map