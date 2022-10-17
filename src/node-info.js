"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NodeInfo = void 0;
const node_value_types_1 = require("./node-value-types");
const acebase_core_1 = require("acebase-core");
class NodeInfo {
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
            const pathInfo = acebase_core_1.PathInfo.get(this.path);
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
        return (0, node_value_types_1.getValueTypeName)(this.valueType);
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
exports.NodeInfo = NodeInfo;
//# sourceMappingURL=node-info.js.map