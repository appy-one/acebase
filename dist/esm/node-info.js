import { getValueTypeName } from './node-value-types.js';
import { PathInfo } from 'acebase-core';
export class NodeInfo {
    constructor(info) {
        this.path = info.path;
        this.type = info.type;
        this.index = info.index;
        this.key = info.key;
        this.exists = info.exists;
        this.address = info.address;
        this.value = info.value;
        this.childCount = info.childCount;
        if (typeof this.path === 'string' && (typeof this.key === 'undefined' && typeof this.index === 'undefined')) {
            const pathInfo = PathInfo.get(this.path);
            if (typeof pathInfo.key === 'number') {
                this.index = pathInfo.key;
            }
            else {
                this.key = pathInfo.key;
            }
        }
        if (typeof this.exists === 'undefined') {
            this.exists = true;
        }
    }
    get valueType() {
        return this.type;
    }
    get valueTypeName() {
        return getValueTypeName(this.valueType);
    }
    toString() {
        if (!this.exists) {
            return `"${this.path}" doesn't exist`;
        }
        if (this.address) {
            return `"${this.path}" is ${this.valueTypeName} stored at ${this.address.toString()}`;
        }
        else {
            return `"${this.path}" is ${this.valueTypeName} with value ${this.value}`;
        }
    }
}
//# sourceMappingURL=node-info.js.map