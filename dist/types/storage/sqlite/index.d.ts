import { Storage, StorageEnv, StorageSettings } from '..';
import { NodeInfo } from '../../node-info';
import { VALUE_TYPES } from '../../node-value-types';
import { NodeAddress } from '../../node-address';
export declare class SQLiteNodeAddress extends NodeAddress {
    constructor(containerPath: string);
}
export declare class SQLiteNodeInfo extends NodeInfo {
    address: SQLiteNodeAddress;
    revision: string;
    revision_nr: number;
    created: number;
    modified: number;
    constructor(info: Partial<SQLiteNodeInfo>);
}
export declare class SQLiteStorageSettings extends StorageSettings {
    constructor(options: Partial<SQLiteStorageSettings>);
}
export declare class SQLiteStorage extends Storage {
    private sqlite;
    private _db;
    private rootRecord;
    /**
     * @param name database name
     * @param settings
     */
    constructor(name: string, settings: Partial<SQLiteStorageSettings>, env: StorageEnv);
    _get(sql: string, params?: any): Promise<any[]>;
    _getOne(sql: string, params?: any): Promise<any>;
    _exec(sql: string, params?: any): Promise<SQLiteStorage>;
    /**
     * @param sql
     * @param params
     * @param callback function to call for every row until it returns false
     * @returns Resolves once all rows have been processed, or callback returned false
     */
    _each(sql: string, params: any, callback: (row: any) => boolean): Promise<{
        rows: number;
        canceled: boolean;
    }>;
    private _transactionConnection;
    _createTransaction(): {
        add(sql: string, params?: any): void;
        run: () => Promise<unknown>;
    };
    private init;
    private _getTypeFromStoredValue;
    _createJSON(obj: any): string;
    _deserializeJSON(type: typeof VALUE_TYPES[keyof typeof VALUE_TYPES], json: string): any;
    /**
     * Creates or updates a node in its own record. DOES NOT CHECK if path exists in parent node, or if parent paths exist! Calling code needs to do this
     */
    _writeNode(path: string, value: any, options?: {
        merge?: boolean;
        revision?: string;
        transaction?: ReturnType<SQLiteStorage['_createTransaction']>;
    }): Promise<void>;
    /**
     * Deletes (dedicated) node and all subnodes without checking for existence. Use with care - all removed nodes will lose their revision stats! DOES NOT REMOVE INLINE CHILD NODES!
     */
    _deleteNode(path: string, options?: {
        transaction: {
            add(sql: string, params?: any): void;
            run: () => Promise<unknown>;
        };
    }): Promise<SQLiteStorage>;
    /**
     * Enumerates all children of a given Node for reflection purposes
     */
    getChildren(path: string, options?: {
        keyFilter?: (string | number)[];
        tid?: string | number;
    }): {
        /**
         *
         * @param valueCallback callback function to run for each child. Return false to stop iterating
         * @returns returns a promise that resolves with a boolean indicating if all children have been enumerated, or was canceled by the valueCallback function
         */
        next(valueCallback: (child: SQLiteNodeInfo) => boolean | void | Promise<boolean | void>): Promise<boolean>;
    };
    getNode(path: string, options?: {
        include?: (string | number)[];
        exclude?: (string | number)[];
        child_objects?: boolean;
        tid?: string | number;
    }): Promise<{
        revision: string;
        value: any;
    }>;
    getNodeInfo(path: string, options?: {
        tid?: string | number;
    }): Promise<SQLiteNodeInfo>;
    setNode(path: string, value: any, options?: {
        assert_revision?: string;
        tid?: string | number;
        suppress_events?: boolean;
        context?: any;
    }): Promise<void>;
    updateNode(path: string, updates: any, options?: {
        tid?: string | number;
        suppress_events?: boolean;
        context?: any;
    }): Promise<void>;
}
//# sourceMappingURL=index.d.ts.map