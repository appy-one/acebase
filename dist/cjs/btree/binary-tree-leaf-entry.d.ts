import { IBinaryBPlusTreeLeafEntryExtData } from './binary-tree-leaf-entry-extdata';
import { BinaryBPlusTreeLeafEntryValue } from './binary-tree-leaf-entry-value';
import { NodeEntryKeyType } from './entry-key-type';
export declare class BinaryBPlusTreeLeafEntry {
    key: NodeEntryKeyType;
    values: BinaryBPlusTreeLeafEntryValue[];
    extData?: IBinaryBPlusTreeLeafEntryExtData;
    private _totalValues;
    /**
     * @param key
     * @param values Array of binary values - NOTE if the tree has unique values, it must always wrap the single value in an Array: [value]
     */
    constructor(key: NodeEntryKeyType, values: BinaryBPlusTreeLeafEntryValue[]);
    /**
     * @deprecated use .values[0] instead
     */
    get value(): BinaryBPlusTreeLeafEntryValue;
    get totalValues(): number;
    set totalValues(nr: number);
    /**
     * TODO: refactor this (and the whole extData handling)
     */
    _values: BinaryBPlusTreeLeafEntryValue[];
    /** Loads values from leaf's extData block */
    loadValues(): Promise<BinaryBPlusTreeLeafEntryValue[]>;
}
//# sourceMappingURL=binary-tree-leaf-entry.d.ts.map