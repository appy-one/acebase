export class BinaryBPlusTreeTransactionOperation {
    static add(key, recordPointer, metadata) {
        return new BinaryBPlusTreeTransactionOperation({ type: 'add', key, recordPointer, metadata });
    }
    static update(key, newValue, currentValue, metadata) {
        return new BinaryBPlusTreeTransactionOperation({ type: 'update', key, newValue, currentValue, metadata });
    }
    static remove(key, recordPointer) {
        return new BinaryBPlusTreeTransactionOperation({ type: 'remove', key, recordPointer });
    }
    constructor(operation) {
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
//# sourceMappingURL=binary-tree-transaction-operation.js.map