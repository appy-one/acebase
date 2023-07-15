import { MutationsDataSnapshot } from 'acebase-core';
import { AceBase, DataSnapshot } from '..';
import { createTempDB } from './tempdb';

describe('Event', () => {
    let db: AceBase, removeDB: () => Promise<void>;
    beforeAll(async () => {
        const tmp = await createTempDB();
        db = tmp.db;
        removeDB = tmp.removeDB;
    });

    it('child_added', async () => {
        const items = {
            item1: { text: 'Item 1' },
            item2: { text: 'Item 2' },
            item3: { text: 'Item 3' },
            item4: { text: 'Item 4' },
            item5: { text: 'Item 5' },
            item6: { text: 'Item 6' },
            item7: { text: 'Item 7' },
            item8: { text: 'Item 8' },
            item9: { text: 'Item 9' },
            item10: { text: 'Item 10' },
        };
        const collectionRef = db.ref('collection');
        await collectionRef.set(items);

        // Part 1: test callbacks for existing items

        // Test with callback
        let expectKeys = Object.keys(items);
        let resolve: () => any, promise = new Promise<void>(r => resolve = r);
        let childAddedCallback = (snap: DataSnapshot) => {
            expect(expectKeys.includes(snap.key)).toBeTrue();
            expectKeys.splice(expectKeys.indexOf(snap.key), 1);
            if (expectKeys.length === 0) { resolve(); }
        };
        collectionRef.on('child_added', childAddedCallback);
        await promise;
        collectionRef.off('child_added', childAddedCallback);

        // Test with subscribe
        expectKeys = Object.keys(items), promise = new Promise(r => resolve = r);
        let subscription = collectionRef.on('child_added', true).subscribe(childAddedCallback);
        await promise;
        subscription.stop();

        // Test with newOnly option
        expectKeys = Object.keys(items), promise = new Promise(r => resolve = r);
        subscription = collectionRef.on('child_added', { newOnly: false }).subscribe(childAddedCallback);
        await promise;
        subscription.stop();

        // Part 2: test callbacks for new items only

        childAddedCallback = (snap) => {
            expect(snap.key).toBe(`item11`);
            resolve();
        };

        // Subscribe without 'truthy' callback arg
        promise = new Promise(r => resolve = r);
        subscription = collectionRef.on('child_added').subscribe(childAddedCallback);
        collectionRef.child('item11').set({ text: 'Item 11' });
        await promise;
        subscription.stop();
        await collectionRef.child('item11').remove();

        // Subscribe with false callback arg
        promise = new Promise(r => resolve = r);
        subscription = collectionRef.on('child_added', false).subscribe(childAddedCallback);
        collectionRef.child('item11').set({ text: 'Item 11' });
        await promise;
        subscription.stop();
        await collectionRef.child('item11').remove();

        // Subscribe with newOnly option
        promise = new Promise(r => resolve = r);
        subscription = collectionRef.on('child_added', { newOnly: true }).subscribe(childAddedCallback);
        collectionRef.child('item11').set({ text: 'Item 11' });
        await promise;
        subscription.stop();
        await collectionRef.child('item11').remove();

        // Part 3: test callbacks for existing AND new items

        childAddedCallback = (snap) => {
            expect(expectKeys.includes(snap.key)).toBeTrue();
            expectKeys.splice(expectKeys.indexOf(snap.key), 1);
            if (expectKeys.length === 0) { resolve(); }
        };

        // Test with callback
        expectKeys = Object.keys(items).concat('item11'), promise = new Promise(r => resolve = r);
        collectionRef.on('child_added', childAddedCallback);
        collectionRef.child('item11').set({ text: 'Item 11' });
        await promise;
        collectionRef.off('child_added', childAddedCallback);
        await collectionRef.child('item11').remove();

        // Test subscription with true as fireForCurrentValue argument
        expectKeys = Object.keys(items).concat('item11'), promise = new Promise(r => resolve = r);
        subscription = collectionRef.on('child_added', true).subscribe(childAddedCallback);
        collectionRef.child('item11').set({ text: 'Item 11' });
        await promise;
        subscription.stop();
        await collectionRef.child('item11').remove();

        // Test subscription with 'truthy' fireForCurrentValue argument
        expectKeys = Object.keys(items).concat('item11'), promise = new Promise(r => resolve = r);
        subscription = collectionRef.on('child_added', 'truthy argument' as unknown as boolean).subscribe(childAddedCallback);
        collectionRef.child('item11').set({ text: 'Item 11' });
        await promise;
        subscription.stop();
        await collectionRef.child('item11').remove();

        // Test subscription with newOnly option
        expectKeys = Object.keys(items).concat('item11'), promise = new Promise(r => resolve = r);
        subscription = collectionRef.on('child_added', { newOnly: false }).subscribe(childAddedCallback);
        collectionRef.child('item11').set({ text: 'Item 11' });
        await promise;
        subscription.stop();
        await collectionRef.child('item11').remove();
    }, 10e3);

    it('"value" does not affect "mutated" event paths', async() => {
        // Created for https://github.com/appy-one/acebase/issues/105
        // A "value" event on a higher path than a "mutated" event caused
        // the path used for the "mutated" event to become invalid.

        const wait = () => new Promise((resolve) => setTimeout(resolve, 0));

        let path = '';
        db.ref('recipes').on('mutated', (mutated) => {
            path = mutated.ref.path;
            const prev = mutated.previous();
            const val = mutated.val();
            console.log(`Got mutation on path "${path}":`, { prev, val });
        });

        const ref = await db.ref('recipes').push({ name: 'cake' });
        await wait();

        expect(path).toBe('recipes');

        await ref.update({ name: 'Cake' });
        await wait();

        expect(path).toBe(`recipes/${ref.key}/name`);

        // Test previously only passed when commented out:
        db.ref('recipes').on('value', () => { console.log('value event'); });

        await ref.update({ name: 'Bread' });
        await wait();

        expect(path).toBe(`recipes/${ref.key}/name`);
    });

    it('"mutations" event path contains no wildcard characters', async () => {

        await new Promise<void>(async (resolve, reject) => {
            let eventsFired = 0;
            db.ref('users/*/books').on('mutations', (mutations: MutationsDataSnapshot) => {
                console.log(`mutations event fired on ${mutations.ref.path}`);
                eventsFired++;
                const val = mutations.val(false);
                try {
                    switch (eventsFired) {
                        case 1: {
                            expect(val.length).toBe(1);
                            expect(val[0].target).toEqual([]);
                            mutations.forEach(snap => {
                                expect(snap.ref.path).toEqual('users/user1/books');
                                return true;                        
                            });
                            break;
                        }
                        case 2: {
                            expect(val.length).toBe(1);
                            expect(val[0].target).toEqual(['book1', 'title']);
                            mutations.forEach(snap => {
                                expect(snap.ref.path).toEqual('users/user1/books/book1/title');
                                return true;                        
                            });
                            // Last event: resolve spec
                            resolve();
                            break;
                        }    
                    }
                }
                catch (err) {
                    reject(err);
                }
            });
            await db.ref('users/user1/books/book1/title').set('AceBase for dummies');
            await db.ref('users/user1/books/book1/title').set('AceBase for PROs');
        });
    }, 240e3)

    afterAll(async () => {
        await removeDB();
    });
});
