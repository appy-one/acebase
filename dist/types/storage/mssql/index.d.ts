import { Storage, StorageEnv, StorageSettings } from '..';
import { NodeInfo } from '../../node-info';
import { NodeValueType, VALUE_TYPES } from '../../node-value-types';
import { NodeAddress } from '../../node-address';
export declare class MSSQLNodeAddress extends NodeAddress {
    constructor(containerPath: string);
}
export declare class MSSQLNodeInfo extends NodeInfo {
    address: MSSQLNodeAddress;
    revision: string;
    revision_nr: number;
    created: number;
    modified: number;
    constructor(info: Partial<MSSQLNodeInfo>);
}
export declare class MSSQLStorageSettings extends StorageSettings {
    /**
     * Driver to use, 'tedious' by default. If you want to use Microsoft's native V8
     * driver on Windows, make sure to add msnodesqlv8 to your project dependencies
     */
    driver: 'tedious' | 'native';
    /**
     * Once you set domain, driver will connect to SQL Server using domain login.
     */
    domain?: string;
    /**
     * Username for the target database
     */
    user?: string;
    /**
     * Password
     */
    password?: string;
    /**
     * Server name, default is `'localhost'`
     * @default 'localhost'
     */
    server: string;
    /**
     * The instance name to connect to. The SQL Server Browser service must be running on the database server,
     * and UDP port 1434 on the database server must be reachable.
     */
    instance?: string;
    /**
     * Server port, default is `1433`
     * @default 1433
     */
    port: number;
    /**
     * Name of the database. SQL Server uses the user's default database if not specified
     */
    database?: string;
    /**
     * A boolean determining whether or not the connection will be encrypted. (default: `true`)
     * @default true
     */
    encrypt: boolean;
    /**
     * Name of the app to identify connection in SQL server manager
     */
    appName: string;
    /**
     * default is `60000`ms (60s)
     */
    connectionTimeout: number;
    /**
     * default is `300000`ms (5m)
     */
    requestTimeout: number;
    /**
     * default is `10`
     */
    maxConnections: number;
    /**
     * default is `0`
     */
    minConnections: number;
    /**
     * default is `30000`ms (30s)
     */
    idleTimeout: number;
    /**
     * Whether to use Windows authentication.
     * @default false
     */
    trustedConnection: boolean;
    constructor(options: Partial<MSSQLStorageSettings>);
}
export declare class MSSQLStorage extends Storage {
    settings: MSSQLStorageSettings;
    private mssql;
    private _db;
    private rootRecord;
    /**
     * @param name database name
     * @param settings settings to connect to a SQL Server database
     */
    constructor(name: string, settings: Partial<MSSQLStorageSettings>, env: StorageEnv);
    init(): Promise<void>;
    private _executeRequest;
    private _get;
    private _getOne;
    private _exec;
    /**
     * @param sql
     * @param params
     * @param callback function to call for every row until it returns false
     * @returns Resolves once all rows have been processed, or callback returned false
     */
    private _each;
    private _createTransaction;
    _getTypeFromStoredValue(val: unknown): {
        type: NodeValueType;
        value: any;
    };
    _createJSON(obj: any): string;
    _deserializeJSON(type: typeof VALUE_TYPES[keyof typeof VALUE_TYPES], json: string): any;
    /**
     * Creates or updates a node in its own record. DOES NOT CHECK if path exists in parent node, or if parent paths exist! Calling code needs to do this
     */
    protected _writeNode(path: string, value: any, options?: {
        merge?: boolean;
        revision?: string;
        transaction?: ReturnType<MSSQLStorage['_createTransaction']>;
    }): Promise<void>;
    /**
     * Deletes (dedicated) node and all subnodes without checking for existence. Use with care - all removed nodes will lose their revision stats! DOES NOT REMOVE INLINE CHILD NODES!
     */
    _deleteNode(path: string, options?: {
        transaction: {
            add(sql: string, params?: any): void;
            run: () => Promise<any[]>;
        };
    }): Promise<any>;
    /**
     * Enumerates all children of a given Node for reflection purposes
     */
    getChildren(path: string, options?: {
        keyFilter?: (string | number)[];
        tid?: string | number;
    }): {
        /**
         * @param valueCallback callback function to run for each child. Return false to stop iterating
         * @returns returns a promise that resolves with a boolean indicating if all children have been enumerated, or was canceled by the valueCallback function
         */
        next(valueCallback: (child: MSSQLNodeInfo) => boolean | void | Promise<boolean | void>): Promise<boolean>;
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
    }): Promise<MSSQLNodeInfo>;
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