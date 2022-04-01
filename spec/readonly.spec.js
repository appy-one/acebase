/// <reference types="@types/jasmine" />
const { createTempDB } = require('./tempdb');
const { AceBase } = require('..');

describe('readonly databases', () => {

    it('cannot be created', async () => {
        try {
            const { db, removeDB } = await createTempDB({ config(options) { options.storage = { readOnly: true } } });
            await removeDB();
            fail('readOnly database cannot be created');
        }
        catch(err) {
            // Expected
        }
    });

    it('cannot be written to', async () => {
        let { db, removeDB } = await createTempDB();
        await db.ref('test').set({ text: 'This is a test' });
        await db.close();

        // Open it readonly
        db = new AceBase(db.name, { logLevel: 'verbose', storage: { path: __dirname, readOnly: true } });

        try {
            // Try writing to it
            await db.ref('test').update({ test: 'Not allowed' });
            fail('readOnly database cannot be written to');
        }
        catch(err) {
            // Expected
        }

        await db.close();
        await removeDB();
    });

    it('can be read from', async () => {
        let { db, removeDB } = await createTempDB();
        await db.ref('test').set({ text: 'This is a test' });
        await db.close();

        // Open it readonly
        db = new AceBase(db.name, { logLevel: 'verbose', storage: { path: __dirname, readOnly: true } });

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