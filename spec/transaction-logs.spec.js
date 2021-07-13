/// <reference types="@types/jasmine" />
const { createTempDB } = require("./tempdb");

describe('ALPHA - Transaction logging', () => {
    let db, removeDB;

    beforeAll(async () => {
        ({ db, removeDB } = await createTempDB({ transactionLogging: true }));
    });

    it('history should work', async () => {
        const book1Ref = await db.ref('library/books').push({ title: 'Book 1', author: 'Ewout', published: new Date() });
        await db.ref('library/books').push({ title: 'Book 2', author: 'Pete', published: new Date() });
        await db.ref('library/books').push({ title: 'Book 3', author: 'John', published: new Date() });
        await db.ref('library/books').push({ title: 'Book 4', author: 'Jack', published: new Date() });
        await db.ref('library/books').push({ title: 'Book 5', author: 'Kenny', published: new Date() });

        const video1Ref = await db.ref('library/videos').push({ title: 'Video 1', author: 'Ewout', published: new Date() });
        await db.ref('library/videos').push({ title: 'Video 2', author: 'Pete', published: new Date() });
        await db.ref('library/videos').push({ title: 'Video 3', author: 'John', published: new Date() });
        await db.ref('library/videos').push({ title: 'Video 4', author: 'Jack', published: new Date() });
        await db.ref('library/videos').push({ title: 'Video 5', author: 'Kenny', published: new Date() });

        let transactions = await db.api.storage.getHistory({ path: 'library' });
        // --> Creation of root record (library: null)
        // --> 5x adding books
        // --> 5x adding videos
        expect(transactions.length).toEqual(11);

        transactions = await db.api.storage.getHistory({ path: 'library/books' });
        // --> Creation of root record (library: null)
        // --> 5x adding books
        expect(transactions.length).toEqual(6);

        transactions = await db.api.storage.getHistory({ path: 'library/videos' });
        // --> Creation of root record (library: null)
        // --> 5x adding videos
        expect(transactions.length).toEqual(6);

        transactions = await db.api.storage.getHistory({ path: `library/books/${book1Ref.key}` });
        // --> Creation of root record (library: null)
        // --> 1x adding book 1
        expect(transactions.length).toEqual(2);

        // Try again using a cursor to skip the root record creation
        transactions = await db.api.storage.getHistory({ path: 'library/videos', cursor: video1Ref.key });
        // --> 5x adding videos
        expect(transactions.length).toEqual(5);

        // Try with wildcard path, using cursor
        transactions = await db.api.storage.getHistory({ path: 'library/videos/*/title', cursor: video1Ref.key });
        // --> 5x adding videos
        expect(transactions.length).toEqual(5);

        // Get compressed results
        transactions = await db.api.storage.getHistory({ path: 'library', compressed: true });
        // --> Creation of root record (library: null)
        // --> 1x adding 5 books
        // --> 1x adding 5 videos
        expect(transactions.length).toEqual(3);

        // Get compressed results with cursor
        transactions = await db.api.storage.getHistory({ path: 'library', compressed: true, cursor: video1Ref.key });
        // --> 1x adding 5 videos
        expect(transactions.length).toEqual(1);

    });

    afterAll(async () => {
        await removeDB();
    })
});