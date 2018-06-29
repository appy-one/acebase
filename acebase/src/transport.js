const { PathReference } = require('./path-reference');
const { DataReference } = require('./data-reference');
const { cloneObject } = require('./utils');
const ascii85 = require('ascii85');

module.exports = {
    deserialize(data) {
        if (data.map === null || typeof data.map === "undefined") {
            return data.val;
        }
        const deserializeValue = (type, val) => {
            if (type === "date") {
                // Date was serialized as a string (UTC)
                return new Date(val);
            }
            else if (type === "binary") {
                // ascii85 encoded binary data
                const buffer = ascii85.decode(val);
                const ab = new ArrayBuffer(buffer.length);
                const view = new Uint8Array(ab);
                for (var i = 0; i < buffer.length; ++i) {
                    view[i] = buffer[i];
                }
                return ab; //buffer.buffer.slice(buffer.byteOffset, buffer.byteLength);
            }
            else if (type === "reference") {
                return new PathReference(val);
            }
            return val;          
        };
        if (typeof data.map === "string") {
            // Single value
            return deserializeValue(data.map, data.val);
        }
        Object.keys(data.map).forEach(path => {
            const type = data.map[path];
            const keys = path.replace(/\[/g, "/[").split("/");
            keys.forEach((key, index) => {
                if (key.startsWith("[")) { 
                    keys[index] = parseInt(key.substr(1, key.length - 2)); 
                }
            });
            let parent = data;
            let key = "val";
            let val = data.val;
            keys.forEach(k => {
                key = k;
                parent = val;
                val = val[key]; // If an error occurs here, there's something wrong with the calling code...
            });
            parent[key] = deserializeValue(type, val);
        });

        return data.val;
    },

    serialize(obj) {
        // Recursively find dates and binary data
        if (obj === null || typeof obj !== "object" || obj instanceof Date || obj instanceof ArrayBuffer || obj instanceof PathReference || obj instanceof DataReference) {
            // Single value
            const ser = this.serialize({ value: obj });
            return {
                map: ser.map.value,
                val: ser.val.value
            };
        }
        obj = cloneObject(obj); // Make sure we don't alter the original object
        const process = (obj, mappings, prefix) => {
            Object.keys(obj).forEach(key => {
                const val = obj[key];
                const path = prefix.length === 0 ? key : `${prefix}/${key}`;
                if (val instanceof Date) {
                    // serialize date to UTC string
                    obj[key] = val.toISOString();
                    mappings[path] = "date";
                }
                else if (val instanceof ArrayBuffer) {
                    // Serialize binary data with ascii85
                    obj[key] = ascii85.encode(Buffer.from(val)).toString();
                    mappings[path] = "binary";
                }
                else if (val instanceof PathReference || val instanceof DataReference) {
                    obj[key] = val.path;
                    mappings[path] = "reference";
                }
                else if (typeof val === "object" && val !== null) {
                    process(val, mappings, path);
                }
            });
        };
        const mappings = {};
        process(obj, mappings, "");
        return {
            map: mappings,
            val: obj
        };
    }        
};