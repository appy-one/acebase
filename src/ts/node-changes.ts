type KeyOrIndex = string | number;

const CHANGE_TYPE = Object.freeze({
    UPDATE: 'update',
    DELETE: 'delete',
    INSERT: 'insert',
});

export class NodeChange {
    static get CHANGE_TYPE() {
        return CHANGE_TYPE;
    }

    constructor(public keyOrIndex: string | number, public changeType: 'update' | 'insert' | 'delete', public oldValue: unknown, public newValue: unknown) {
    }
}

export class NodeChangeTracker {
    private _changes: NodeChange[] = [];
    private _oldValue: Record<string, unknown>;
    private _newValue: Record<string, unknown>;

    constructor(public path: string) {
    }

    addDelete(keyOrIndex: KeyOrIndex, oldValue: unknown) {
        const change = new NodeChange(keyOrIndex, NodeChange.CHANGE_TYPE.DELETE, oldValue, null);
        this._changes.push(change);
        return change;
    }
    addUpdate(keyOrIndex: KeyOrIndex, oldValue: unknown, newValue: unknown) {
        const change = new NodeChange(keyOrIndex, NodeChange.CHANGE_TYPE.UPDATE, oldValue, newValue);
        this._changes.push(change);
        return change;
    }
    addInsert(keyOrIndex: KeyOrIndex, newValue: unknown) {
        const change = new NodeChange(keyOrIndex, NodeChange.CHANGE_TYPE.INSERT, null, newValue);
        this._changes.push(change);
        return change;
    }
    add(keyOrIndex: KeyOrIndex, currentValue: unknown, newValue: unknown) {
        if (currentValue === null) {
            if (newValue === null) {
                throw new Error(`Wrong logic for node change on "${this.path}/${keyOrIndex}" - both old and new values are null`);
            }
            return this.addInsert(keyOrIndex, newValue);
        }
        else if (newValue === null) {
            return this.addDelete(keyOrIndex, currentValue);
        }
        else {
            return this.addUpdate(keyOrIndex, currentValue, newValue);
        }
    }

    get updates() {
        return this._changes.filter(change => change.changeType === NodeChange.CHANGE_TYPE.UPDATE);
    }
    get deletes() {
        return this._changes.filter(change => change.changeType === NodeChange.CHANGE_TYPE.DELETE);
    }
    get inserts() {
        return this._changes.filter(change => change.changeType === NodeChange.CHANGE_TYPE.INSERT);
    }
    get all() {
        return this._changes;
    }
    get totalChanges() {
        return this._changes.length;
    }
    get(keyOrIndex: KeyOrIndex) {
        return this._changes.find(change => change.keyOrIndex === keyOrIndex);
    }
    hasChanged(keyOrIndex: KeyOrIndex) {
        return !!this.get(keyOrIndex);
    }

    get newValue() {
        if (typeof this._newValue === 'object') { return this._newValue; }
        if (typeof this._oldValue === 'undefined') { throw new TypeError(`oldValue is not set`); }
        const newValue: Record<string, unknown> = {};
        Object.keys(this.oldValue).forEach(key => newValue[key] = this.oldValue[key]);
        this.deletes.forEach(change => delete newValue[change.keyOrIndex]);
        this.updates.forEach(change => newValue[change.keyOrIndex] = change.newValue);
        this.inserts.forEach(change => newValue[change.keyOrIndex] = change.newValue);
        return newValue;
    }
    set newValue(value) {
        this._newValue = value;
    }

    get oldValue() {
        if (typeof this._oldValue === 'object') { return this._oldValue; }
        if (typeof this._newValue === 'undefined') { throw new TypeError(`newValue is not set`); }
        const oldValue: Record<string, unknown> = {};
        Object.keys(this.newValue).forEach(key => oldValue[key] = this.newValue[key]);
        this.deletes.forEach(change => oldValue[change.keyOrIndex] = change.oldValue);
        this.updates.forEach(change => oldValue[change.keyOrIndex] = change.oldValue);
        this.inserts.forEach(change => delete oldValue[change.keyOrIndex]);
        return oldValue;
    }
    set oldValue(value) {
        this._oldValue = value;
    }

    get typeChanged() {
        return typeof this.oldValue !== typeof this.newValue
            || (this.oldValue instanceof Array && !(this.newValue instanceof Array))
            || (this.newValue instanceof Array && !(this.oldValue instanceof Array));
    }

    static create(path: string, oldValue: Record<string, unknown>, newValue: Record<string, unknown>) {
        const changes = new NodeChangeTracker(path);
        changes.oldValue = oldValue;
        changes.newValue = newValue;

        oldValue && typeof oldValue === 'object' && Object.keys(oldValue).forEach(key => {
            if (typeof newValue === 'object' && key in newValue && newValue !== null) {
                changes.add(key, oldValue[key], newValue[key]);
            }
            else {
                changes.add(key, oldValue[key], null);
            }
        });
        newValue && typeof newValue === 'object' && Object.keys(newValue).forEach(key => {
            if (typeof oldValue !== 'object' || !(key in oldValue) || oldValue[key] === null) {
                changes.add(key, null, newValue[key]);
            }
        });
        return changes;
    }
}
