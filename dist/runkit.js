const { AceBase } = require('acebase');
const db = new AceBase('mydb');

await db.ref('test').set({ text: 'This is my first AceBase test in RunKit' });

const snap = await db.ref('test/text').get();
console.log(`value of "test/text": ` + snap.val());
