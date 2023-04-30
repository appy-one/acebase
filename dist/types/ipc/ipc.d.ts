import { SimpleEventEmitter } from 'acebase-core';
import { Storage } from '../storage';
export declare class AceBaseIPCPeerExitingError extends Error {
    constructor(message: string);
}
type InternalLockInfo = {
    tid: string;
    granted: boolean;
    request: ILockRequestData;
    lock?: IAceBaseIPCLock;
};
/**
 * Base class for Inter Process Communication, enables vertical scaling: using more CPU's on the same machine to share workload.
 * These processes will have to communicate with eachother because they are reading and writing to the same database file
 */
export declare abstract class AceBaseIPCPeer extends SimpleEventEmitter {
    protected storage: Storage;
    protected id: string;
    dbname: string;
    protected masterPeerId: string;
    protected ipcType: string;
    get isMaster(): boolean;
    protected ourSubscriptions: Array<{
        path: string;
        event: AceBaseEventType;
        callback: AceBaseSubscribeCallback;
    }>;
    protected remoteSubscriptions: Array<{
        for?: string;
        path: string;
        event: AceBaseEventType;
        callback: AceBaseSubscribeCallback;
    }>;
    protected peers: Array<{
        id: string;
        lastSeen: number;
    }>;
    private _nodeLocker;
    constructor(storage: Storage, id: string, dbname?: string);
    protected _exiting: boolean;
    /**
     * Requests the peer to shut down. Resolves once its locks are cleared and 'exit' event has been emitted.
     * Has to be overridden by the IPC implementation to perform custom shutdown tasks
     * @param code optional exit code (eg one provided by SIGINT event)
     */
    exit(code?: number): Promise<any>;
    protected sayGoodbye(forPeerId: string): void;
    protected addPeer(id: string, sendReply?: boolean): void;
    protected removePeer(id: string, ignoreUnknown?: boolean): void;
    protected addRemoteSubscription(peerId: string, details: ISubscriptionData): void;
    protected cancelRemoteSubscription(peerId: string, details: ISubscriptionData): void;
    protected handleMessage(message: IMessage): Promise<any>;
    protected _locks: InternalLockInfo[];
    /**
     * Acquires a lock. If this peer is a worker, it will request the lock from the master
     * @param details
     */
    lock(details: ILockRequestData): Promise<IAceBaseIPCLock>;
    private _requests;
    private request;
    protected abstract sendMessage(message: IMessage): any;
    /**
     * Sends a custom request to the IPC master
     * @param request
     * @returns
     */
    sendRequest(request: any): Promise<any>;
    replyRequest(requestMessage: IRequestMessage, result: any): void;
    /**
     * Sends a custom notification to all IPC peers
     * @param notification
     * @returns
     */
    sendNotification(notification: any): void;
    private _eventsEnabled;
    /**
     * If ipc event handling is currently enabled
     */
    get eventsEnabled(): boolean;
    /**
     * Enables or disables ipc event handling. When disabled, incoming event messages will be ignored.
     */
    set eventsEnabled(enabled: boolean);
}
export interface IAceBaseIPCLock {
    id: number;
    tid: string;
    path: string;
    forWriting: boolean;
    comment: string;
    expires: number;
    state: string;
    release(comment?: string): Promise<void>;
    moveToParent(): Promise<IAceBaseIPCLock>;
}
export type AceBaseSubscribeCallback = (error: Error, path: string, newValue: any, oldValue: any, eventContext: any) => void;
export interface IMessage {
    /**
     * Message type, determines how to handle data
     */
    type: string;
    /**
     * Who sends this message
     */
    from: string;
    /**
     * Who is this message for (not present for broadcast messages)
     */
    to?: string;
    /**
     * Optional payload
     */
    data?: any;
}
export interface IHelloMessage extends IMessage {
    type: 'hello';
    data: void;
}
export interface IByeMessage extends IMessage {
    type: 'bye';
    data: void;
}
export interface IPulseMessage extends IMessage {
    type: 'pulse';
    data: void;
}
export interface ICustomNotificationMessage extends IMessage {
    type: 'notification';
    data: any;
}
export type AceBaseEventType = string;
export interface ISubscriptionData {
    path: string;
    event: AceBaseEventType;
}
export interface ISubscribeMessage extends IMessage {
    type: 'subscribe';
    data: ISubscriptionData;
}
export interface IUnsubscribeMessage extends IMessage {
    type: 'unsubscribe';
    data: ISubscriptionData;
}
export interface IEventMessage extends IMessage {
    type: 'event';
    event: AceBaseEventType;
    /**
     * Path the subscription is on
     */
    path: string;
    data: {
        /**
         * The path the event fires on
         */
        path: string;
        val?: any;
        previous?: any;
        context: any;
    };
}
export interface IRequestMessage extends IMessage {
    id: string;
}
export interface ILockRequestData {
    path: string;
    write: boolean;
    tid: string;
    comment: string;
}
export interface ILockRequestMessage extends IRequestMessage {
    type: 'lock-request';
    data: ILockRequestData;
}
export interface IUnlockRequestData {
    id: number;
}
export interface IUnlockRequestMessage extends IRequestMessage {
    type: 'unlock-request';
    data: IUnlockRequestData;
}
export interface IResponseMessage extends IMessage {
    id: string;
    ok: boolean;
    reason?: string;
}
export interface ILockResponseData {
    id: number;
    path: string;
    write: boolean;
    tid: string;
    expires: number;
    comment: string;
}
export interface ILockResponseMessage extends IResponseMessage {
    type: 'lock-result';
    data: ILockResponseData;
}
export interface IUnlockResponseData {
    id: number;
}
export interface IUnlockResponseMessage extends IResponseMessage {
    type: 'unlock-result';
    data: IUnlockResponseData;
}
export interface IMoveLockRequestData {
    id: number;
    move_to: 'parent' | 'path';
}
export interface IMoveLockRequestMessage extends IRequestMessage {
    type: 'move-lock-request';
    data: IMoveLockRequestData;
}
export interface ICustomRequestMessage extends IRequestMessage {
    type: 'request';
    data: any;
}
export {};
//# sourceMappingURL=ipc.d.ts.map