/// <reference types="@types/jasmine" />
const { AceBase } = require("..");
const { createTempDB } = require("./tempdb");

describe('Event', () => {
    /** @type {AceBase} */
    let db, removeDB;
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
        let resolve, promise = new Promise(r => resolve = r);
        let childAddedCallback = (snap) => {
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
        subscription = collectionRef.on('child_added', 'truthy argument').subscribe(childAddedCallback);
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

    afterAll(async () => {
        await removeDB();
    });
});