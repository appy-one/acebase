import { BinaryBPlusTreeLeafEntryValue } from './binary-tree-leaf-entry-value';
import { NodeEntryKeyType } from './entry-key-type';
import { LeafEntryMetaData } from './leaf-entry-metadata';
import { LeafEntryRecordPointer } from './leaf-entry-recordpointer';

export class BinaryBPlusTreeTransactionOperation {
    static add(key: NodeEntryKeyType, recordPointer: LeafEntryRecordPointer, metadata?: LeafEntryMetaData) {
        return new BinaryBPlusTreeTransactionOperation({ type: 'add', key, recordPointer, metadata });
    }

    static update(key: NodeEntryKeyType, newValue: BinaryBPlusTreeLeafEntryValue, currentValue: BinaryBPlusTreeLeafEntryValue, metadata?: LeafEntryMetaData) {
        return new BinaryBPlusTreeTransactionOperation({ type: 'update', key, newValue, currentValue, metadata });
    }

    static remove(key: NodeEntryKeyType, recordPointer: LeafEntryRecordPointer) {
        return new BinaryBPlusTreeTransactionOperation({ type: 'remove', key, recordPointer });
    }

    type: 'add'|'remove'|'update';
    key: NodeEntryKeyType;
    recordPointer?: LeafEntryRecordPointer;
    metadata?: LeafEntryMetaData;
    newValue?: BinaryBPlusTreeLeafEntryValue;
    currentValue?: BinaryBPlusTreeLeafEntryValue;

    constructor(operation: BinaryBPlusTreeTransactionOperation) {
        // operation.key = _normalizeKey(operation.key); // if (_isIntString(operation.key)) { operation.key = parseInt(operation.key); }
        this.type = operation.type;
        this.key = operation.key;
        if (operation.type === 'add' || operation.type === 'remove') {
            this.recordPointer = operation.recordPointer;
        }
        if (operation.type === 'add') {
            this.metadata = operation.metadata;
        }
        if (operation.type === 'update') {
            this.newValue = operation.newValue;
            this.currentValue = operation.currentValue;
        }
    }
}
