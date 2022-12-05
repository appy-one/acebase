const { AceBase } = require('acebase');

// Open or create database:
const db = new AceBase('mydb', { logLevel: 'error' });

// Set data at "runkit/test"
await db.ref('runkit/test').set({
    text: 'This is a test',
    created: new Date(),
});

// Update "text" child of "runkit/test", create "modified" child
await db.ref('runkit/test').update({
    text: 'Updated text with a parent node update',
    modified: new Date(),
});

// Overwrite "runkit/test/text"
await db.ref('runkit/test/text').set('Updated text by setting it');

// Get all data stored at "runkit/test"
const snapshot = await db.ref('runkit/test').get();
console.log('Value stored at "runkit/test":');
console.log(snapshot.val());

// Transactional update on "runkit/test/counter"
await db.ref('runkit/test/counter').transaction(snapshot => {
    const val = snapshot.exists() ? snapshot.val() : 0;
    return val + 1; // new value for "counter" property
});

// Remove "runkit"
await db.ref('runkit').remove();
