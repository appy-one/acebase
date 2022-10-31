"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BinaryBPlusTreeLeafEntryValue = void 0;
class BinaryBPlusTreeLeafEntryValue {
    /**
     *
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
exports.BinaryBPlusTreeLeafEntryValue = BinaryBPlusTreeLeafEntryValue;
//# sourceMappingURL=binary-tree-leaf-entry-value.js.map