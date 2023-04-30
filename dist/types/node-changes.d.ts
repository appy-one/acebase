type KeyOrIndex = string | number;
export declare class NodeChange {
    keyOrIndex: string | number;
    changeType: 'update' | 'insert' | 'delete';
    oldValue: unknown;
    newValue: unknown;
    static get CHANGE_TYPE(): Readonly<{
        UPDATE: "update";
        DELETE: "delete";
        INSERT: "insert";
    }>;
    constructor(keyOrIndex: string | number, changeType: 'update' | 'insert' | 'delete', oldValue: unknown, newValue: unknown);
}
export declare class NodeChangeTracker {
    path: string;
    private _changes;
    private _oldValue;
    private _newValue;
    constructor(path: string);
    addDelete(keyOrIndex: KeyOrIndex, oldValue: unknown): NodeChange;
    addUpdate(keyOrIndex: KeyOrIndex, oldValue: unknown, newValue: unknown): NodeChange;
    addInsert(keyOrIndex: KeyOrIndex, newValue: unknown): NodeChange;
    add(keyOrIndex: KeyOrIndex, currentValue: unknown, newValue: unknown): NodeChange;
    get updates(): NodeChange[];
    get deletes(): NodeChange[];
    get inserts(): NodeChange[];
    get all(): NodeChange[];
    get totalChanges(): number;
    get(keyOrIndex: KeyOrIndex): NodeChange;
    hasChanged(keyOrIndex: KeyOrIndex): boolean;
    get newValue(): Record<string, unknown>;
    set newValue(value: Record<string, unknown>);
    get oldValue(): Record<string, unknown>;
    set oldValue(value: Record<string, unknown>);
    get typeChanged(): boolean;
    static create(path: string, oldValue: Record<string, unknown>, newValue: Record<string, unknown>): NodeChangeTracker;
}
export {};
//# sourceMappingURL=node-changes.d.ts.map