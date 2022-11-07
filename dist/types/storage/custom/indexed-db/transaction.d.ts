import { SimpleCache } from 'acebase-core';
import { CustomStorageTransaction, ICustomStorageNode, ICustomStorageNodeMetaData } from '..';
import { IPCPeer } from '../../../ipc';
export interface IndexedDBTransactionContext {
    debug: boolean;
    db: IDBDatabase;
    cache: SimpleCache<string, ICustomStorageNode>;
    ipc: IPCPeer;
}
export declare class IndexedDBStorageTransaction extends CustomStorageTransaction {
    context: IndexedDBTransactionContext;
    production: boolean;
    private _pending;
    /**
     * Creates a transaction object for IndexedDB usage. Because IndexedDB automatically commits
     * transactions when they have not been touched for a number of microtasks (eg promises
     * resolving whithout querying data), we will enqueue set and remove operations until commit
     * or rollback. We'll create separate IndexedDB transactions for get operations, caching their
     * values to speed up successive requests for the same data.
     */
    constructor(context: IndexedDBTransactionContext, target: {
        path: string;
        write: boolean;
    });
    _createTransaction(write?: boolean): IDBTransaction;
    _splitMetadata(node: ICustomStorageNode): {
        metadata: ICustomStorageNodeMetaData;
        value: any;
    };
    commit(): Promise<void>;
    rollback(err: any): Promise<void>;
    get(path: string): Promise<ICustomStorageNode>;
    set(path: string, node: ICustomStorageNode): void;
    remove(path: string): void;
    removeMultiple(paths: string[]): Promise<void>;
    childrenOf(path: string, include: {
        metadata: boolean;
        value: boolean;
    }, checkCallback: (childPath: string) => boolean, addCallback?: (childPath: string, node?: ICustomStorageNodeMetaData | ICustomStorageNode) => boolean): Promise<void>;
    descendantsOf(path: string, include: {
        metadata: boolean;
        value: boolean;
    }, checkCallback: (descPath: string, metadata?: ICustomStorageNodeMetaData) => boolean, addCallback?: (descPath: string, node?: ICustomStorageNodeMetaData | ICustomStorageNode) => boolean): Promise<void>;
    _getChildrenOf(path: string, include: {
        metadata: boolean;
        value: boolean;
        descendants: boolean;
    }, checkCallback: (path: string, metadata?: ICustomStorageNodeMetaData) => boolean, addCallback?: (path: string, node?: ICustomStorageNodeMetaData | ICustomStorageNode) => boolean): Promise<void>;
}
//# sourceMappingURL=transaction.d.ts.map