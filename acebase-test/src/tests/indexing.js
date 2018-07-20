
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

keys.forEach(key => {
    binaryIndex.find(key)
    .then(val => {
        console.log(val);
    });
});

binaryIndex.search("<", 50)
.then(results => {
    console.log(results);
});

binaryIndex.search(">=", 50)
.then(results => {
    console.log(results);
});

binaryIndex.search("==", 50)
.then(results => {
    console.log(results);
});

binaryIndex.search("!=", 50)
.then(results => {
    console.log(results);
});

binaryIndex.search("between", [15, 55])
.then(results => {
    console.log(results);
});

binaryIndex.search("!between", [15, 55])
.then(results => {
    console.log(results);
});

binaryIndex.search("in", [15, 55, 60, 80])
.then(results => {
    console.log(results);
});

binaryIndex.search("!in", [15, 55, 60, 80])
.then(results => {
    console.log(results);
});