const { getValueTypeName } = require('./node-value-types');
const { PathInfo } = require('acebase-core');

class NodeInfo {
    /** {path?: string, type?: number, key?: string, index?: number, exists?: boolean, address?: NodeAddress, value?: any }
     * @param {object} info 
     * @param {string} [info.path]
     * @param {number} [info.type]
     * @param {string} [info.key]
     * @param {number} [info.index]
     * @param {boolean} [info.exists]
     * @param {NodeAddress} [info.address]
     * @param {any} [info.value]
     * @param {number} [info.childCount]
     */
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
            let pathInfo = PathInfo.get(this.path);
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
            return `"${this.path}" is ${this.valueTypeName} stored at ${this.address.pageNr},${this.address.recordNr}`;
        }
        else {
            return `"${this.path}" is ${this.valueTypeName} with value ${this.value}`;
        }
    }
}

module.exports = { NodeInfo };