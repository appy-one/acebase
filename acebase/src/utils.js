const numberToBytes = (number) => {
    const bytes = new Uint8Array(8);
    const view = new DataView(bytes.buffer);
    view.setFloat64(0, number);
    return new Array(...bytes);
}

const bytesToNumber = (bytes) => {
    //if (bytes.length !== 8) { throw "passed value must contain 8 bytes"; }
    if (bytes.length < 8) {
        throw new TypeError("must be 8 bytes");
        // // Pad with zeroes
        // let padding = new Uint8Array(8 - bytes.length);
        // for(let i = 0; i < padding.length; i++) { padding[i] = 0; }
        // bytes = concatTypedArrays(bytes, padding);
    }
    const bin = new Uint8Array(bytes);
    const view = new DataView(bin.buffer);
    const nr = view.getFloat64(0);
    return nr;
}

const concatTypedArrays = (a, b) => {
    const c = new a.constructor(a.length + b.length);
    c.set(a);
    c.set(b, a.length);
    return c;
};

const cloneObject = (original, stack) => {
    const { DataSnapshot } = require('./data-snapshot'); // Don't move to top, because data-snapshot requires this script (utils)
    if (original instanceof DataSnapshot) {
        throw new TypeError(`Object to clone is a DataSnapshot (path "${original.ref.path}")`);
    }
    else if (typeof original !== "object" || original === null || original instanceof Date || original instanceof ArrayBuffer) {
        return original;
    }
    const cloneValue = (val) => {
        // if (["string","number","boolean","function","undefined"].indexOf(typeof val) >= 0) {
        //     return val;
        // }
        if (stack.indexOf(val) >= 0) {
            throw new ReferenceError(`object contains a circular reference`);
        }
        if (val === null || val instanceof Date || val instanceof ArrayBuffer) { // || val instanceof ID
            return val;
        }
        else if (val instanceof Array) {
            stack.push(val);
            val = val.map(item => cloneValue(item));
            stack.pop();
            return val;
        }
        else if (typeof val === "object") {
            stack.push(val);
            val = cloneObject(val, stack);
            stack.pop();
            return val;
        }
        else {
            return val; // Anything other can just be copied
        }
    }
    if (typeof stack === "undefined") { stack = [original]; }
    const clone = {};
    Object.keys(original).forEach(key => {
        let val = original[key];
        if (typeof val === "function") {
            return; // skip functions
        }
        clone[key] = cloneValue(val);
    });
    return clone;
}

const getPathKeys = (path) => {
    if (path.length === 0) { return []; }
    let keys = path.replace(/\[/g, "/[").split("/");
    keys.forEach((key, index) => {
        if (key.startsWith("[")) { 
            keys[index] = parseInt(key.substr(1, key.length - 2)); 
        }
    });
    return keys;
}

const getPathInfo = (path) => {
    if (path.length === 0) {
        return { parent: null, key: "" };
    }
    const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("["));
    const parentPath = i < 0 ? "" : path.substr(0, i);
    let key = i < 0 ? path : path.substr(i);
    if (key.startsWith("[")) { 
        key = parseInt(key.substr(1, key.length - 2)); 
    }
    else if (key.startsWith("/")) {
        key = key.substr(1); // Chop off leading slash
    }
    if (parentPath === path) {
        parentPath = null;
    }
    return {
        parent: parentPath,
        key
    };
};

module.exports = {
    numberToBytes,
    bytesToNumber,
    concatTypedArrays,
    cloneObject,
    getPathKeys,
    getPathInfo
};
