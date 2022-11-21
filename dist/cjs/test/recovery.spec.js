"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tempdb_1 = require("./tempdb");
const acebase_core_1 = require("acebase-core");
describe('database recovery', () => {
    let db;
    let removeDB;
    beforeAll(async () => {
        ({ db, removeDB } = await (0, tempdb_1.createTempDB)());
    });
    afterAll(async () => {
        await removeDB();
    });
    it('test', async () => {
        var _a;
        expect(typeof ((_a = db.recovery) === null || _a === void 0 ? void 0 : _a.repairNode)).toBe('function');
        // Create some records
        const movies = await Promise.resolve().then(() => require('./dataset/movies.json'));
        const ref = db.ref('movies');
        await ref.set(acebase_core_1.ObjectCollection.from(movies));
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
//# sourceMappingURL=recovery.spec.js.map