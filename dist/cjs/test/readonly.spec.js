"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tempdb_1 = require("./tempdb");
const __1 = require("..");
describe('readonly databases', () => {
    it('cannot be created', async () => {
        try {
            const { removeDB } = await (0, tempdb_1.createTempDB)({ config(options) { options.storage = { readOnly: true }; } });
            await removeDB();
            fail('readOnly database cannot be created');
        }
        catch (err) {
            // Expected
        }
    });
    it('cannot be written to', async () => {
        // eslint-disable-next-line prefer-const
        let { db, removeDB } = await (0, tempdb_1.createTempDB)();
        await db.ref('test').set({ text: 'This is a test' });
        await db.close();
        // Open it readonly
        db = new __1.AceBase(db.name, { logLevel: 'verbose', storage: { path: __dirname, readOnly: true } });
        try {
            // Try writing to it
            await db.ref('test').update({ test: 'Not allowed' });
            fail('readOnly database cannot be written to');
        }
        catch (err) {
            // Expected
        }
        await db.close();
        await removeDB();
    });
    it('can be read from', async () => {
        // eslint-disable-next-line prefer-const
        let { db, removeDB } = await (0, tempdb_1.createTempDB)();
        await db.ref('test').set({ text: 'This is a test' });
        await db.close();
        // Open it readonly
        db = new __1.AceBase(db.name, { logLevel: 'verbose', storage: { path: __dirname, readOnly: true } });
        // Try reading from it
        const snap = await db.ref('test').get();
        const val = snap.val();
        expect(val).not.toBeNull();
        expect(typeof val).toBe('object');
        expect(val.text).toBe('This is a test');
        await db.close();
        await removeDB();
    });
});
//# sourceMappingURL=readonly.spec.js.map