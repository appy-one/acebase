/// <reference types="@types/jasmine" />
const { createTempDB } = require("./tempdb");

describe('ALPHA - Transaction logging', () => {
    let db, removeDB;

    beforeAll(async () => {
        ({ db, removeDB } = await createTempDB({ transactionLogging: true }));
    });

    it('getMutations should work', async () => {
        const book1Ref = await db.ref('library/books').push({ title: 'Book 1', author: 'Ewout', published: new Date() });
        await db.ref('library/books').push({ title: 'Book 2', author: 'Pete', published: new Date() });
        await db.ref('library/books').push({ title: 'Book 3', author: 'John', published: new Date() });
        await db.ref('library/books').push({ title: 'Book 4', author: 'Jack', published: new Date() });
        await db.ref('library/books').push({ title: 'Book 5', author: 'Kenny', published: new Date() });

        const video1Ref = await db.ref('library/videos').push({ title: 'Video 1', author: 'Ewout', published: new Date() });
        await db.ref('library/videos').push({ title: 'Video 2', author: 'Pete', published: new Date() });
        await db.ref('library/videos').push({ title: 'Video 3', author: 'John', published: new Date() });
        const video4Ref = await db.ref('library/videos').push({ title: 'Video 4', author: 'Jack', published: new Date() });
        await db.ref('library/videos').push({ title: 'Video 5', author: 'Kenny', published: new Date() });

        let mutations = await db.api.storage.getMutations({ path: 'library', compressed: false });
        // --> Creation of root record (library: null)
        // --> 5x adding books
        // --> 5x adding videos
        expect(mutations.length).toEqual(11);

        mutations = await db.api.storage.getMutations({ path: 'library/books', compressed: false });
        // --> Creation of root record (library: null)
        // --> 5x adding books
        expect(mutations.length).toEqual(6);

        mutations = await db.api.storage.getMutations({ path: 'library/videos', compressed: false });
        // --> Creation of root record (library: null)
        // --> 5x adding videos
        expect(mutations.length).toEqual(6);

        mutations = await db.api.storage.getMutations({ path: `library/books/${book1Ref.key}`, compressed: false });
        // --> Creation of root record (library: null)
        // --> 1x adding book 1
        expect(mutations.length).toEqual(2);

        // Try again using a cursor to skip the root record creation
        mutations = await db.api.storage.getMutations({ path: 'library/videos', cursor: video1Ref.key, compressed: false });
        // --> 5x adding videos
        expect(mutations.length).toEqual(5);

        // Try with wildcard path, using cursor
        mutations = await db.api.storage.getMutations({ path: 'library/videos/*/title', cursor: video1Ref.key, compressed: false });
        // --> 5x adding videos
        expect(mutations.length).toEqual(5);

        // Get compressed results
        mutations = await db.api.storage.getMutations({ path: 'library', compressed: true });
        // --> NOT: Creation of root record (library: null) --> compressed checks the previous value and sees it wasn't there in the first place, so there is no mutation
        // --> 1x adding 5 books
        // --> 1x adding 5 videos
        expect(mutations.length).toEqual(2);

        // Get compressed results with cursor (from video 1)
        mutations = await db.api.storage.getMutations({ path: 'library', compressed: true, cursor: video1Ref.key });
        // --> 1x adding 5 videos
        expect(mutations.length).toEqual(1);

        // Get compressed results with cursor (from video 4)
        mutations = await db.api.storage.getMutations({ path: 'library', compressed: true, cursor: video4Ref.key });
        // --> 1x adding 2 videos
        expect(mutations.length).toEqual(1);

        mutations = await db.api.storage.getMutations({ for: [{ path: 'library/books', events: ['child_added'] }] });
        // --> 1x adding 5 books
        console.log(mutations);
        expect(mutations.length).toEqual(1);

        mutations = await db.api.storage.getMutations({ for: [{ path: 'library/books', events: ['child_removed'] }] });
        // --> 0x removed
        expect(mutations.length).toEqual(0);

        // Delete some records
        await video1Ref.remove();
        await video4Ref.remove();
 
        // Get compressed results with cursor (from video 4 creation)
        mutations = await db.api.storage.getMutations({ path: 'library', compressed: true, cursor: video4Ref.key });
        console.log(mutations);
        expect(mutations.length).toEqual(1);
        expect(mutations[0].path).toEqual('library/videos');
        const prevValue = mutations[0].previous, newValue = mutations[0].value;
        expect(Object.keys(prevValue).filter(key => prevValue[key] !== null).length).toEqual(2); // video 1 and 4
        expect(Object.keys(prevValue).filter(key => prevValue[key] === null).length).toEqual(1); // video 5 wasn't there yet
        expect(Object.keys(newValue).filter(key => newValue[key] === null).length).toEqual(2); // video 1 and 4 now gone
        expect(Object.keys(newValue).filter(key => newValue[key] !== null).length).toEqual(1); // video 5 was created after cursor


    }, 600 * 1000); // minutes to allow debugging

    afterAll(async () => {
        await removeDB();
    })
});