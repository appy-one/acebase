const { AceBase, ID } = require("..");
const { Utils } = require('acebase-core');
const { compareValues } = Utils;
const { pfs } = require('../src/promise-fs');
const { NodeLock } = require('../src/node-lock');

describe('node locking', () => {
    it('should not cause deadlocks', async () => {

        // Currently, deadlocks do not happen because multiple concurrent writes have been disabled by NodeLock
        //
        // When concurrent writes are enabled, a deadlock sitation will arise in the following situation:
        // - multiple write locks are allowed if their paths do not intersect (are not "on the same trail")
        // - value events are bound to a path
        // - 2 concurrent writes are done on a deeper path than the bound events. 
        // -> Both writes need to read lock the event path to fetch "before" event data, but aren't allowed to until one of them releases their write lock. Causing a DEADLOCK
        //
        // To enable concurrent writes again, code will have to be refactored so that any higher event path is read locked before acquiring a write lock on the descendant node

        const dbname = ID.generate();
        const db = new AceBase(dbname, { storage: { path: __dirname }});
        await db.ready();

        // Add event listener on "some/path/to" node
        db.ref('some/path/to').on('value', snap => {
            console.log(`Got "value" event on path "${snap.ref.path}" with value ${snap.exists() ? JSON.stringify(snap.val()) : 'null'}`);
        });

        // Perform 2 concurrent updates to paths that do not clash,
        // but do share the common ancestor 'some/path/to'
        const p1 = db.ref('some/path/to/some/child').update({ text: 'Update 1' });
        const p2 = db.ref('some/path/to/another/child').update({ text: 'Update 2' });

        // Use a timeout of 5 seconds to make sure above updates could both have been performed.
        let timeoutFired = false;
        const timeout = new Promise(resolve => setTimeout(() => { timeoutFired = true; resolve(); }, 5000));

        await Promise.race([timeout, Promise.all([p1, p2])]);

        expect(timeoutFired).toBeFalse();
        if (!timeoutFired) {

            // Check if the target data is correct
            const snap = await db.ref('some/path/to').get();
            expect(snap.exists()).toBeTrue();

            const val = snap.val();
            const compareResult = compareValues(val, { some: { child: { text: 'Update 1' } }, another: { child: { text: 'Update 2' } } });
            expect(compareResult).toEqual('identical');
 
        }

        // Close database
        await db.close(); // TODO: add type

        // Remove database
        const dbdir = `${__dirname}/${dbname}.acebase`;
        await pfs.rmdir(dbdir, { recursive: true });
    });
})