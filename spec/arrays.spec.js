/// <reference types="@types/jasmine" />
const { createTempDB } = require("./tempdb");

describe('arrays', () => {
    it('test array updates', async () => {
        const { db, removeDB } = await createTempDB();

        const ref = db.ref('array');
        const baseText = 'entry with a longer text so it gets saved in its own record';
    
        await ref.set({
            entries: [
                { name: `${baseText} 1` },
                { name: `${baseText} 2` },
                { name: `${baseText} 3` }
            ]
        });
    
        // Get value
        let snap = await ref.get();
        let val = snap.val();
        expect(val.entries).toBeInstanceOf(Array);
        expect(val.entries.length).toEqual(3);
        expect(val.entries[0].name).toMatch(/1$/);
        expect(val.entries[1].name).toMatch(/2$/);
        expect(val.entries[2].name).toMatch(/3$/);
    
        // Now overwrite it, swapping some entries
        await ref.update({
            entries: [
                { name: `${baseText} 3` },
                { name: `${baseText} 1` },
                { name: `${baseText} 2` },
            ]
        });
    
        // Get value again
        snap = await ref.get();
        val = snap.val();
        expect(val.entries).toBeInstanceOf(Array);
        expect(val.entries.length).toEqual(3);
        expect(val.entries[0].name).toMatch(/3$/);
        expect(val.entries[1].name).toMatch(/1$/);
        expect(val.entries[2].name).toMatch(/2$/);

        // Now overwrite entries by their index - WARNING*
        await ref.child('entries').update({
            0: { name: `${baseText} 1` },
            1: { name: `${baseText} 2` },
            2: { name: `${baseText} 3` },
            3: { name: `${baseText} 4` }
        });

        // Get value again
        snap = await ref.get();
        val = snap.val();
        expect(val.entries).toBeInstanceOf(Array);
        expect(val.entries.length).toEqual(4);
        expect(val.entries[0].name).toMatch(/1$/);
        expect(val.entries[1].name).toMatch(/2$/);
        expect(val.entries[2].name).toMatch(/3$/);
        expect(val.entries[3].name).toMatch(/4$/);

        // Now update individual entries by their index - WARNING*
        await ref.child('entries').child(0).update({ name: `${baseText} 4` });
        await ref.child('entries').child(1).update({ name: `${baseText} 3` });
        await ref.child('entries').child(2).update({ name: `${baseText} 2` });
        await ref.child('entries').child(3).update({ name: `${baseText} 1` });
        
        // Get value again
        snap = await ref.get();
        val = snap.val();
        expect(val.entries).toBeInstanceOf(Array);
        expect(val.entries.length).toEqual(4);
        expect(val.entries[0].name).toMatch(/4$/);
        expect(val.entries[1].name).toMatch(/3$/);
        expect(val.entries[2].name).toMatch(/2$/);
        expect(val.entries[3].name).toMatch(/1$/);

        // Try to add an entry at the end of the array - WARNING*
        let p = ref.child('entries').child(4).update({ name: `${baseText} 5` });
        await expectAsync(p).toBeResolved();

        // Get value again
        snap = await ref.get();
        val = snap.val();
        expect(val.entries).toBeInstanceOf(Array);
        expect(val.entries.length).toEqual(5);
        expect(val.entries[0].name).toMatch(/4$/);
        expect(val.entries[1].name).toMatch(/3$/);
        expect(val.entries[2].name).toMatch(/2$/);
        expect(val.entries[3].name).toMatch(/1$/);
        expect(val.entries[4].name).toMatch(/5$/);

        // Try to add an entry at an invalid index
        p = ref.child('entries').child(6).update({ name: `${baseText} 7` });
        await expectAsync(p).toBeRejected();

        // Try removing the last array entry - method 1
        p = ref.child('entries').child(4).remove();
        await expectAsync(p).toBeResolved();

        // Try to remove the last array entry - method 2
        p = ref.child('entries').update({ 3: null });
        await expectAsync(p).toBeResolved();

        // Try to remove an entry that is not the last - method 1
        p = ref.child('entries').child(0).remove();
        await expectAsync(p).toBeRejected();

        // Try to remove an entry that is not the last - method 2
        p = ref.child('entries').update({ 0: null });
        await expectAsync(p).toBeRejected();

        // Try to delete an nonexistent entry - should be no problem since the item isn't there so nothing happens
        p = ref.child('entries').child(6).remove();
        await expectAsync(p).toBeResolved();

        await removeDB();
    });
});