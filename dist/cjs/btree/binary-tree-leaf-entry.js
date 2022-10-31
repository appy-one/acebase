"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BinaryBPlusTreeLeafEntry = void 0;
class BinaryBPlusTreeLeafEntry {
    /**
     * @param key
     * @param values Array of binary values - NOTE if the tree has unique values, it must always wrap the single value in an Array: [value]
     */
    constructor(key, values) {
        this.key = key;
        this.values = values;
        this.key = key;
        this.values = values;
    }
    /**
     * @deprecated use .values[0] instead
     */
    get value() {
        return this.values[0];
    }
    get totalValues() {
        if (typeof this._totalValues === 'number') {
            return this._totalValues;
        }
        if (this.extData) {
            return this.extData.totalValues;
        }
        return this.values.length;
    }
    set totalValues(nr) {
        this._totalValues = nr;
    }
    /** Loads values from leaf's extData block */
    async loadValues() {
        throw new Error('entry.loadValues must be overridden if leaf has extData');
    }
}
exports.BinaryBPlusTreeLeafEntry = BinaryBPlusTreeLeafEntry;
//# sourceMappingURL=binary-tree-leaf-entry.js.map