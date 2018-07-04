
const { BTree, BinaryBTree, AsyncBinaryBTree, BPlusTree, BinaryBPlusTree } = require('acebase/src/data-index');
let keys = [10, 20, 40, 50, 60, 70, 80, 30, 35, 5, 15];

let index = new BPlusTree(3, true);
keys.forEach(key => {
    index.add(key, `value ${key}`);
});

keys.forEach(key => {
    const val = index.find(key);
    console.log(val);
});

let all = index.all();
console.log(all);

let matches = index.search("between", [35, 55]);
console.log(matches);

matches = index.search(">=", 50);
console.log(matches);

matches = index.search("!=", 50);
console.log(matches);

matches = index.search("==", 50);
console.log(matches);

matches = index.search("<", 50);
console.log(matches);

let binary = index.toBinary();
//console.log(binary);

let binaryIndex = new BinaryBPlusTree(binary);
binaryIndex.find(keys[0])
.then(val => {
    console.log(val);
});

keys.forEach(key => {
    binaryIndex.find(key)
    .then(val => {
        console.log(val);
    });
});