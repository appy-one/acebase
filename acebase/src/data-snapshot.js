const { DataReference } = require('./data-reference');
const { getPathKeys } = require('./utils');

const getChild = (snapshot, path) => {
    if (!snapshot.exists()) { return null; }
    let child = snapshot.val();
    //path.split("/").every...
    getPathKeys(path).every(key => {
        child = child[key];
        return typeof child !== "undefined";
    });
    return child || null;
};

const getChildren = (snapshot) => {
    if (!snapshot.exists()) { return []; }
    let value = snapshot.val();
    if (value instanceof Array) {
        return new Array(value.length).map((v,i) => i);
    }
    if (typeof value === "object") {
        return Object.keys(value);
    }
    return [];
};

class DataSnapshot {

    /**
     * 
     * @param {DataReference} ref 
     * @param {any} value 
     */
    constructor(ref, value) {
        this.ref = ref;
        this.val = () => { return value; };
        this.exists = () => { return value !== null && typeof value !== "undefined"; }
    }
    
    child(path) {
        // Create new snapshot for child data
        let child = getChild(this, path);
        return new DataSnapshot(this.ref.child(path), child);
    }

    hasChild(path) {
        return getChild(this, path) !== null;
    }

    hasChildren() {
        return getChildren(this).length > 0;
    }

    numChildren() {
        return getChildren(this).length;          
    }

    forEach(action) {
        const value = this.val();
        return getChildren(this).every((key, i) => {
            const snap = new DataSnapshot(this.ref.child(key), value[key]); 
            return action(snap);
        });
    }

    get key() { return this.ref.key; }
}

module.exports = { DataSnapshot };