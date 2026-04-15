import { AceBase, DataSnapshot } from '..';
import { createTempDB } from './tempdb';

describe('Corrupted records', () => {
    let db: AceBase, removeDB: () => Promise<void>;
    beforeAll(async () => {
        const tmp = await createTempDB();
        db = tmp.db;
        removeDB = tmp.removeDB;
    });

    afterAll(async () => {
        await removeDB();
    });

    it('must be handled correctly', async() => {
        const ref = db.ref('simulate/corrupt/record/here');
        await ref.set({
            description: 'this data is this record appears to be corrupted and cannot be read',
        });

        // Try reading the corrupt record directly, should fail
        let p = ref.get();
        await expectAsync(p).toBeRejected();

        // Try reading the parent record, should fail
        p = ref.parent.get();
        // await expectAsync(p).toBeResolved();
        // let snap = await p;
        // let val = snap.val();
        // console.log(val);
        await expectAsync(p).toBeRejected();

        // Try reading a child record, will fail if we don't have it in cache - so this is not a good test now
        // p = ref.child('description').get();
        // await expectAsync(p).toBeRejected();

        // Try reading a sibling record that doesn't exist, should be fine
        p = ref.parent.child('elsewhere').get();
        await expectAsync(p).toBeResolved();
        let snap = await p;
        expect(snap.exists()).toBeFalse();

        // Try reflecting on corrupted node, should fail
        let rp = ref.reflect('children', {});
        await expectAsync(rp).toBeRejected();
        // reflectionInfo = await rp;

        // Try reflecting parent node's children, should be ok
        rp = ref.parent.reflect('children', {});
        await expectAsync(rp).toBeResolved();
        let reflectionInfo = await rp;
        const corruptedChild = reflectionInfo.list.find((child) => child.key === 'here');
        expect(typeof corruptedChild).toEqual('object');

    });
});
