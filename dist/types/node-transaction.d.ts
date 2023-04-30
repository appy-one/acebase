import { PathInfo } from 'acebase-core';
import { IPCPeer } from './ipc';
type NodeKey = string | number;
export declare abstract class NodeLockIntention {
    /**
     * The intention to read a single node for reflection purposes (eg enumerating its children).
     * While lock is granted, this prevents others to write to this node
     */
    static ReadInfo(): ReadInfoIntention;
    /**
     * The intention to read the value of a node and its children, optionally filtered to include or exclude specific child keys/paths
     * While lock is granted, this prevents others to write to this node and its (optionally filtered) child paths
     * @param filter
     */
    static ReadValue(filter?: {
        include?: NodeKey[];
        exclude?: NodeKey[];
        child_objects?: boolean;
    }): ReadValueIntention;
    /**
     * The intention to update specific child values of a node.
     * While lock is granted, this prevents others to read or write to this node and specified child keys
     * @param keys The child keys that will be updated
     */
    static UpdateNode(keys: NodeKey[]): UpdateNodeIntention;
    /**
     * The intention to overwrite a node's value.
     * While lock is granted, this prevents others to read or write to this node and its descendants
     */
    static OverwriteNode(): OverwriteNodeIntention;
}
declare class ReadInfoIntention extends NodeLockIntention {
}
declare class ReadValueIntention extends NodeLockIntention {
    filter?: {
        include?: NodeKey[];
        exclude?: NodeKey[];
        child_objects?: boolean;
    };
    constructor(filter?: {
        include?: NodeKey[];
        exclude?: NodeKey[];
        child_objects?: boolean;
    });
}
declare class UpdateNodeIntention extends NodeLockIntention {
    keys: NodeKey[];
    constructor(keys: NodeKey[]);
}
declare class OverwriteNodeIntention extends NodeLockIntention {
}
interface INodeLockRequest {
    tid: TransactionID;
    path: string;
    pathInfo?: PathInfo;
    intention: NodeLockIntention;
}
type TransactionID = number;
type LockID = number;
declare enum NodeLockState {
    pending = 0,
    locked = 1,
    released = 2,
    expired = 3
}
export declare class NodeLockInfo {
    /** Generated lock ID */
    readonly id: LockID;
    /** Transaction this lock is part of */
    readonly tid: TransactionID;
    /** path of the lock */
    readonly path: string;
    /** pathInfo */
    readonly pathInfo: PathInfo;
    /** the intention the lock was requested with */
    readonly intention: NodeLockIntention;
    /** current state of the lock. Cycle: pending -> locked -> released or expired */
    state: NodeLockState;
    /** lock request timestamp */
    requested: number;
    /** timestamp the lock was granted */
    granted?: number;
    /** lock expiry timestamp */
    expires: number;
    /** lock release timestamp */
    released?: number;
    constructor(id: LockID, tid: TransactionID, path: string, intention: NodeLockIntention);
}
interface ITransactionManager {
    /**
     * Creates a transaction that handles lock requests
     */
    createTransaction(): Promise<Transaction>;
    /**
     * If a transaction is unable to determine if access can be granted by itself based upon the locks it currently holds, it will
     * have to forward the request to the TransactionManager that is able to check other transactions.
     * @param request request details
     */
    requestLock(request: INodeLockRequest): Promise<NodeLockInfo>;
    releaseLock(id: LockID): Promise<void>;
}
export declare class TransactionManager implements ITransactionManager {
    private lastTid;
    private lastLid;
    private queue;
    private locks;
    private blacklisted;
    createTransaction(): Promise<Transaction>;
    requestLock(request: INodeLockRequest): Promise<NodeLockInfo>;
    releaseLock(id: LockID): Promise<void>;
    private processQueue;
    private allowLock;
    testConflict(lock: {
        path: string;
        intention: NodeLockIntention;
    }, request: {
        path: string;
        intention: NodeLockIntention;
    }): boolean[];
    private conflicts;
}
export declare class IPCTransactionManager extends TransactionManager {
    private ipc;
    constructor(ipc: IPCPeer);
    private init;
    createTransaction(): Promise<Transaction>;
    requestLock(request: INodeLockRequest): Promise<NodeLockInfo>;
    releaseLock(id: LockID): Promise<void>;
}
export declare class NodeLock extends NodeLockInfo {
    private transaction;
    constructor(transaction: Transaction, lockInfo: NodeLockInfo);
    release(): Promise<void>;
}
export declare class Transaction {
    manager: ITransactionManager;
    readonly id: TransactionID;
    readonly locks: NodeLockInfo[];
    constructor(manager: ITransactionManager, id: TransactionID);
    lock(path: string, intention: NodeLockIntention): Promise<NodeLock>;
}
export {};
//# sourceMappingURL=node-transaction.d.ts.map