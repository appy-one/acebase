const { createTempDB } = require('./tempdb');
const { AceBase } = require('..');
const { ObjectCollection } = require('acebase-core');

describe('database recovery', () => {
    /** @type {AceBase} */
    let db;
    /** @type {{(): Promise<void>}} */
    let removeDB;

    beforeAll(async () => {
        ({ db, removeDB } = await createTempDB());
    });

    afterAll(async () => {
        await removeDB();
    });

    it('test', async () => {

        expect(typeof db.recovery?.repairNode).toBe('function');

        // Create some records
        const movies = require('./dataset/movies.json');

        const ref = db.ref('movies');
        await ref.set(ObjectCollection.from(movies));

        // Pick a random child
        const children = await ref.reflect('children', { limit: 100 });
        const index = Math.floor(Math.random() * children.list.length);
        const testChild = children.list[index];

        // Try repairing the (non-broken) child
        const testRef = ref.child(testChild.key);
        const originalValueSnapshot = await testRef.get();
        try {
            await db.recovery.repairNode(testRef.path);
        }
        catch (err) {
            expect(err.message).toContain('not broken');
        }

        // Try repairing again, ignoring the fact it's not broken
        try {
            await db.recovery.repairNode(testRef.path, { ignoreIntact: true });
        }
        catch (err) {
            fail(err.message);
        }

        // Load value
        let snap = await testRef.get();
        let val = snap.val();
        expect(val).toBe('[[removed]]');

        // Overwrite with original value
        const originalValue = originalValueSnapshot.val();
        await testRef.set(originalValue);

        // "Repair" it again, without marking it as deleted (removing it entirely)
        try {
            await db.recovery.repairNode(testRef.path, { ignoreIntact: true, markAsRemoved: false });
        }
        catch (err) {
            fail(err.message);
        }

        // Load value again, must be null now
        snap = await testRef.get();
        expect(snap.exists()).toBeFalse();
        val = snap.val();
        expect(val).toBe(null);

    });

});
