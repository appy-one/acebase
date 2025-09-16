import { IBinaryBPlusTreeLeafEntryExtData } from './binary-tree-leaf-entry-extdata';
import { BinaryBPlusTreeLeafEntryValue } from './binary-tree-leaf-entry-value';
import { NodeEntryKeyType } from './entry-key-type';

export class BinaryBPlusTreeLeafEntry {

    extData?: IBinaryBPlusTreeLeafEntryExtData;

    private _totalValues: number;

    /**
     * @param key
     * @param values Array of binary values - NOTE if the tree has unique values, it must always wrap the single value in an Array: [value]
     */
    constructor(public key: NodeEntryKeyType, public values: BinaryBPlusTreeLeafEntryValue[]) {
    }

    /**
     * @deprecated use .values[0] instead
     */
    get value() {
        return this.values[0];
    }

    get totalValues() {
        if (typeof this._totalValues === 'number') { return this._totalValues; }
        if (this.extData) { return this.extData.totalValues; }
        return this.values.length;
    }

    set totalValues(nr) {
        this._totalValues = nr;
    }

    /**
     * TODO: refactor this (and the whole extData handling)
     */
    public _values: BinaryBPlusTreeLeafEntryValue[];

    /** Loads values from leaf's extData block */
    async loadValues(): Promise<BinaryBPlusTreeLeafEntryValue[]> { // added async during TS port
        throw new Error('entry.loadValues must be overridden if leaf has extData');
    }

}
