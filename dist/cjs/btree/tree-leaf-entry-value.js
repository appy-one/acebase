"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BPlusTreeLeafEntryValue = void 0;
class BPlusTreeLeafEntryValue {
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
exports.BPlusTreeLeafEntryValue = BPlusTreeLeafEntryValue;
//# sourceMappingURL=tree-leaf-entry-value.js.map