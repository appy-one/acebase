const { AceBase, ID } = require('../src/index');

const db = new AceBase('custom-test');
db.ready(async () => {

    // Temp custom test for #112, using non-random data for easier (reproducible) debugging

    const exists = await db.ref('collection').exists();
    let updates = {};
    if (!exists) {
        for (let i = 0; i < 2000; i++) {
            updates[ID.generate()] = { letter: String.fromCharCode(97 + Math.floor(Math.random() * 26)) };
        }

        // create non-indexed collection
        await db.ref('collection').update(updates);
    }
    else {
        const snap = await db.ref('collection').get();
        updates = snap.val();
    }

    // create indexed collection
    const indexes = await db.indexes.get();
    await Promise.all(indexes.map(index => db.indexes.delete(index.fileName)));
    await db.ref('sort_indexed').remove();
    await db.indexes.create('sort_indexed', 'letter');
    await db.ref('sort_indexed').update(updates);
});
