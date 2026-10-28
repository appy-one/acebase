import { AceBase } from '..';
import { rmdir } from 'fs/promises';

describe('issue #278', () => {
    // Bug: createStreamFromBinaryTree in node-reader constructs child paths as
    // `${parentPath}/${key}` which produces `/key` (leading slash) when parentPath === ''.
    // This wrong path is stored in nodeCache, leaving the correct-path announcement stuck.
    // Any subsequent getNodeInfo call for that key finds the stuck Promise and hangs forever.
    //
    // The bug only manifests after a cache miss for an EXISTING root-level collection once
    // the root has switched to B+tree mode (>100 children). Closing and reopening the DB
    // clears the cache so the B+tree code path is exercised from the start.

    it('reads and writes to top-level collections after root exceeds 100 children (B+tree)', async () => {
        const dbname = 'test-issue-278-' + Date.now();
        const dbpath = __dirname;

        // Phase 1: populate — create 110 top-level collections to force B+tree on root
        let db = new AceBase(dbname, { storage: { path: dbpath, ipc: 'socket' }, logLevel: 'warn' });
        await db.ready();
        for (let i = 0; i < 110; i++) {
            await db.ref(`collection_${i}`).set({ value: i });
        }

        // Close and reopen: this flushes the in-memory node cache so the next access to
        // any collection must go through the B+tree lookup rather than the cache.
        await db.close();
        db = new AceBase(dbname, { storage: { path: dbpath, ipc: 'socket' }, logLevel: 'warn' });
        await db.ready();

        try {
            const TIMEOUT_MS = 5_000;
            let timedOut = false;
            const makeTimeout = () => new Promise<void>(r => setTimeout(() => { timedOut = true; r(); }, TIMEOUT_MS));

            // Write to an existing post-B+tree collection with an empty cache.
            // Without the fix: getNodeInfo('collection_5') announces 'collection_5',
            //   then B+tree lookup returns childInfo.path='/collection_5' (wrong),
            //   updateCache('/collection_5') doesn't resolve the announcement → stuck.
            // With the fix: announcement is resolved correctly → write succeeds, cache clean.
            timedOut = false;
            const write = db.ref('collection_5').update({ value: 999 });
            await Promise.race([makeTimeout(), write]);
            expect(timedOut).withContext('update to collection_5 timed out — stuck NodeCache announcement?').toBeFalse();

            if (!timedOut) {
                // Without the fix: getNodeInfo('collection_5') finds the stuck Promise from
                //   the write above and awaits it forever → hangs.
                // With the fix: cache was updated correctly → returns immediately.
                timedOut = false;
                const get = db.ref('collection_5').get();
                await Promise.race([makeTimeout(), get]);
                expect(timedOut).withContext('get of collection_5 timed out — stuck NodeCache announcement?').toBeFalse();

                if (!timedOut) {
                    const snap = await get;
                    expect(snap.val()).toEqual({ value: 999 });
                }
            }

            // Also verify that a full root read returns correctly-keyed children (no leading slash).
            timedOut = false;
            const rootGet = db.ref('').get();
            await Promise.race([makeTimeout(), rootGet]);
            expect(timedOut).withContext('db.ref("").get() timed out').toBeFalse();

            if (!timedOut) {
                const rootVal = (await rootGet).val() as Record<string, any>;
                expect(rootVal).not.toBeNull();
                expect(rootVal['collection_0']).toEqual({ value: 0 });
                expect(rootVal['collection_5']).toEqual({ value: 999 });
                expect(rootVal['/collection_0']).toBeUndefined();
            }
        }
        finally {
            await db.close();
            await rmdir(`${dbpath}/${dbname}.acebase`, { recursive: true }).catch(e => void e);
        }
    }, 120_000);
});
