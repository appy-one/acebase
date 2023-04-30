import { CustomStorageTransaction, ICustomStorageNode, ICustomStorageNodeMetaData } from '..';
import { LocalStorageLike } from './interface';
export declare class LocalStorageTransaction extends CustomStorageTransaction {
    context: {
        debug: boolean;
        dbname: string;
        localStorage: LocalStorageLike;
    };
    private _storageKeysPrefix;
    constructor(context: {
        debug: boolean;
        dbname: string;
        localStorage: LocalStorageLike;
    }, target: {
        path: string;
        write: boolean;
    });
    commit(): Promise<void>;
    rollback(err: any): Promise<void>;
    get(path: string): Promise<any>;
    set(path: string, val: any): Promise<void>;
    remove(path: string): Promise<void>;
    childrenOf(path: string, include: {
        metadata?: boolean;
        value?: boolean;
    }, checkCallback: (path: string) => boolean, addCallback: (path: string, node?: ICustomStorageNodeMetaData | ICustomStorageNode) => boolean): Promise<void>;
    descendantsOf(path: string, include: {
        metadata?: boolean;
        value?: boolean;
    }, checkCallback: (path: string) => boolean, addCallback: (path: string, node?: ICustomStorageNodeMetaData | ICustomStorageNode) => boolean): Promise<void>;
    /**
     * Helper function to get the path from a localStorage key
     */
    getPathFromStorageKey(key: string): string;
    /**
     * Helper function to get the localStorage key for a path
     */
    getStorageKeyForPath(path: string): string;
}
//# sourceMappingURL=transaction.d.ts.map