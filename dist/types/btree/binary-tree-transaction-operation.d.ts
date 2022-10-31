import { BinaryBPlusTreeLeafEntryValue } from './binary-tree-leaf-entry-value';
import { NodeEntryKeyType } from './entry-key-type';
import { LeafEntryMetaData } from './leaf-entry-metadata';
import { LeafEntryRecordPointer } from './leaf-entry-recordpointer';
export declare class BinaryBPlusTreeTransactionOperation {
    static add(key: NodeEntryKeyType, recordPointer: LeafEntryRecordPointer, metadata?: LeafEntryMetaData): BinaryBPlusTreeTransactionOperation;
    static update(key: NodeEntryKeyType, newValue: BinaryBPlusTreeLeafEntryValue, currentValue: BinaryBPlusTreeLeafEntryValue, metadata?: LeafEntryMetaData): BinaryBPlusTreeTransactionOperation;
    static remove(key: NodeEntryKeyType, recordPointer: LeafEntryRecordPointer): BinaryBPlusTreeTransactionOperation;
    type: 'add' | 'remove' | 'update';
    key: NodeEntryKeyType;
    recordPointer?: LeafEntryRecordPointer;
    metadata?: LeafEntryMetaData;
    newValue?: BinaryBPlusTreeLeafEntryValue;
    currentValue?: BinaryBPlusTreeLeafEntryValue;
    constructor(operation: BinaryBPlusTreeTransactionOperation);
}
//# sourceMappingURL=binary-tree-transaction-operation.d.ts.map