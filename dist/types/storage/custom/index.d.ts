import { Utils } from 'acebase-core';
import { NodeInfo } from '../../node-info';
import { NodeLock } from '../../node-lock';
import { NodeValueType } from '../../node-value-types';
import { Storage, StorageEnv, StorageSettings } from '../index';
import { NodeAddress } from '../../node-address';
export { CustomStorageHelpers } from './helpers';
/** Interface for metadata being stored for nodes */
export declare class ICustomStorageNodeMetaData {
    /** cuid (time sortable revision id). Nodes stored in the same operation share this id */
    revision: string;
    /** Number of revisions, starting with 1. Resets to 1 after deletion and recreation */
    revision_nr: number;
    /** Creation date/time in ms since epoch UTC */
    created: number;
    /** Last modification date/time in ms since epoch UTC */
    modified: number;
    /** Type of the node's value. 1=object, 2=array, 3=number, 4=boolean, 5=string, 6=date, 7=reserved, 8=binary, 9=reference */
    type: NodeValueType;
}
/** Interface for metadata combined with a stored value */
export declare class ICustomStorageNode extends ICustomStorageNodeMetaData {
    /** only Object, Array, large string and binary values. */
    value: any;
    constructor();
}
/** Enables get/set/remove operations to be wrapped in transactions to improve performance and reliability. */
export declare abstract class CustomStorageTransaction {
    production: boolean;
    target: {
        readonly originalPath: string;
        path: string;
        readonly write: boolean;
    };
    /** Transaction ID */
    id: string;
    _lock: NodeLock;
    /**
     * @param target Which path the transaction is taking place on, and whether it is a read or read/write lock. If your storage backend does not support transactions, is synchronous, or if you are able to lock resources based on path: use storage.nodeLocker to ensure threadsafe transactions
     */
    constructor(target: {
        path: string;
        write: boolean;
    });
    abstract get(path: string): Promise<ICustomStorageNode>;
    abstract set(path: string, node: ICustomStorageNode): void | Promise<void>;
    abstract remove(path: string): void | Promise<void>;
    /**
     *
     * @param path Parent path to load children of
     * @param include What data to include
     * @param checkCallback callback method to precheck if child needs to be added, perform before loading metadata/value if possible
     * @param addCallback callback method that adds the child node. Returns whether or not to keep calling with more children
     * @returns Returns a promise that resolves when there are no more children to be streamed
     */
    abstract childrenOf(path: string, include: {
        /** Whether metadata needs to be loaded */
        metadata: boolean;
        /** Whether value needs to be loaded */
        value: boolean;
    }, checkCallback: (childPath: string) => boolean, addCallback?: (childPath: string, node?: ICustomStorageNodeMetaData | ICustomStorageNode) => boolean): Promise<any>;
    /**
     *
     * @param path Parent path to load descendants of
     * @param include What data to include
     * @param checkCallback callback method to precheck if descendant needs to be added, perform before loading metadata/value if possible. NOTE: if include.metadata === true, you should load and pass the metadata to the checkCallback if doing so has no or small performance impact
     * @param addCallback callback method that adds the descendant node. Returns whether or not to keep calling with more children
     * @returns Returns a promise that resolves when there are no more descendants to be streamed
     */
    abstract descendantsOf(path: string, include: {
        /** Whether metadata needs to be loaded */
        metadata: boolean;
        /** Whether value needs to be loaded */
        value: boolean;
    }, checkCallback: (descPath: string, metadata?: ICustomStorageNodeMetaData) => boolean, addCallback?: (descPath: string, node?: ICustomStorageNodeMetaData | ICustomStorageNode) => boolean): Promise<any>;
    /**
     * Returns the number of children stored in their own records. This implementation uses `childrenOf` to count, override if storage supports a quicker way.
     * Eg: For SQL databases, you can implement this with a single query like `SELECT count(*) FROM nodes WHERE ${CustomStorageHelpers.ChildPathsSql(path)}`
     * @param path
     * @returns Returns a promise that resolves with the number of children
     */
    getChildCount(path: string): Promise<number>;
    /**
     * NOT USED YET
     * Default implementation of getMultiple that executes .get for each given path. Override for custom logic
     * @param paths
     * @returns Returns promise with a Map of paths to nodes
     */
    getMultiple(paths: string[]): Promise<Map<string, ICustomStorageNode>>;
    /**
     * NOT USED YET
     * Default implementation of setMultiple that executes .set for each given path. Override for custom logic
     * @param nodes
     */
    setMultiple(nodes: Array<{
        path: string;
        node: ICustomStorageNode;
    }>): Promise<void>;
    /**
     * Default implementation of removeMultiple that executes .remove for each given path. Override for custom logic
     * @param paths
     */
    removeMultiple(paths: string[]): Promise<void>;
    /**
     * @param reason
     */
    abstract rollback(reason: Error): Promise<any>;
    /**
     * @returns {Promise<any>}
     */
    commit(): Promise<void>;
    /**
     * Moves the transaction path to the parent node. If node locking is used, it will request a new lock
     * Used internally, must not be overridden unless custom locking mechanism is required
     * @param targetPath
     */
    moveToParentPath(targetPath: string): Promise<string>;
}
/**
 * Allows data to be stored in a custom storage backend of your choice! Simply provide a couple of functions
 * to get, set and remove data and you're done.
 */
export declare class CustomStorageSettings extends StorageSettings {
    /**
     * Name of the custom storage adapter
     */
    name?: string;
    /**
     * Whether default node locking should be used.
     * Set to false if your storage backend disallows multiple simultanious write transactions.
     * Set to true if your storage backend does not support transactions (eg LocalStorage) or allows
     * multiple simultanious write transactions (eg AceBase binary).
     * @default true
     */
    locking: boolean;
    /**
     * Function that returns a Promise that resolves once your data store backend is ready for use
     */
    ready: () => Promise<any>;
    /**
     * Function that starts a transaction for read/write operations on a specific path and/or child paths
     */
    getTransaction: (target: {
        path: string;
        write: boolean;
    }) => Promise<CustomStorageTransaction>;
    constructor(settings: Partial<CustomStorageSettings>);
}
export declare class CustomStorageNodeAddress {
    path: string;
    constructor(containerPath: string);
}
export declare class CustomStorageNodeInfo extends NodeInfo {
    address: NodeAddress;
    revision: string;
    revision_nr: number;
    created: Date;
    modified: Date;
    constructor(info: Omit<CustomStorageNodeInfo, 'valueType' | 'valueTypeName'>);
}
export declare class CustomStorage extends Storage {
    private _customImplementation;
    constructor(dbname: string, settings: CustomStorageSettings, env: StorageEnv);
    private _init;
    private throwImplementationError;
    private _storeNode;
    private _processReadNodeValue;
    private _readNode;
    private _getTypeFromStoredValue;
    /**
     * Creates or updates a node in its own record. DOES NOT CHECK if path exists in parent node, or if parent paths exist! Calling code needs to do this
     */
    protected _writeNode(path: string, value: any, options: {
        transaction: CustomStorageTransaction;
        /** @default false */
        merge?: boolean;
        revision?: string;
        currentValue?: any;
        diff?: Utils.TCompareResult;
    }): Promise<void>;
    /**
     * Deletes (dedicated) node and all subnodes without checking for existence. Use with care - all removed nodes will lose their revision stats! DOES NOT REMOVE INLINE CHILD NODES!
     */
    private _deleteNode;
    /**
     * Enumerates all children of a given Node for reflection purposes
     */
    getChildren(path: string, options?: {
        transaction?: CustomStorageTransaction;
        keyFilter?: string[] | number[];
    }): {
        /**
         *
         * @param valueCallback callback function to run for each child. Return false to stop iterating
         * @returns returns a promise that resolves with a boolean indicating if all children have been enumerated, or was canceled by the valueCallback function
         */
        next(valueCallback: (child: NodeInfo) => boolean | void | Promise<boolean | void>): Promise<boolean>;
    };
    getNode(path: string, options?: {
        include?: string[];
        exclude?: string[];
        /** @default true */
        child_objects?: boolean;
        transaction?: CustomStorageTransaction;
    }): Promise<ICustomStorageNode>;
    getNodeInfo(path: string, options?: {
        transaction?: CustomStorageTransaction;
        /** @default false */
        include_child_count?: boolean;
    }): Promise<CustomStorageNodeInfo>;
    setNode(path: string, value: any, options?: {
        assert_revision?: string;
        transaction?: CustomStorageTransaction;
        /** @default false */
        suppress_events?: boolean;
        context?: any;
    }): Promise<void>;
    updateNode(path: string, updates: any, options?: {
        transaction?: CustomStorageTransaction;
        /** @default false */
        suppress_events?: boolean;
        context?: any;
    }): Promise<void>;
}
//# sourceMappingURL=index.d.ts.map