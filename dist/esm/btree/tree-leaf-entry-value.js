export class BPlusTreeLeafEntryValue {
    /**
     * @param recordPointer used to be called "value", renamed to prevent confusion
     * @param metadata
     */
    constructor(recordPointer, metadata) {
        this.recordPointer = recordPointer;
        this.metadata = metadata;
    }
    /** @deprecated use .recordPointer instead */
    get value() {
        return this.recordPointer;
    }
}
//# sourceMappingURL=tree-leaf-entry-value.js.map