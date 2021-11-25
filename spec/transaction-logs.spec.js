/// <reference types="@types/jasmine" />
const { AceBase } = require("..");
const { createTempDB } = require("./tempdb");

describe('BETA - Transaction logging', () => {
    /** @type {AceBase} */
    let db, removeDB;

    beforeAll(async () => {
        ({ db, removeDB } = await createTempDB({ transactionLogging: true }));
    });

    it('storage.getMutations', async () => {
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

        let result = await db.api.storage.getMutations({ path: 'library' });
        // --> Creation of root record (library: null)
        // --> 5x adding books
        // --> 5x adding videos
        expect(typeof result.used_cursor).toEqual('undefined');
        expect(typeof result.new_cursor).toEqual('string');
        expect(result.mutations.length).toEqual(10);

        result = await db.api.storage.getMutations({ path: 'library/books' });
        // --> Creation of root record (library: null)
        // --> 5x adding books
        expect(result.mutations.length).toEqual(5);

        result = await db.api.storage.getMutations({ path: 'library/videos' });
        // --> Creation of root record (library: null)
        // --> 5x adding videos
        expect(result.mutations.length).toEqual(5);

        result = await db.api.storage.getMutations({ path: `library/books/${book1Ref.key}` });
        // --> Creation of root record (library: null)
        // --> 1x adding book 1
        expect(result.mutations.length).toEqual(1);

        // Try again using a cursor to skip the root record creation
        result = await db.api.storage.getMutations({ path: 'library/videos', cursor: video1Ref.key });
        // --> 5x adding videos
        expect(result.used_cursor).toEqual(video1Ref.key);
        expect(result.mutations.length).toEqual(5);

        // Try with wildcard path, using cursor
        result = await db.api.storage.getMutations({ path: 'library/videos/*/title', cursor: video1Ref.key });
        // --> 5x adding videos
        expect(result.mutations.length).toEqual(5);

        // Get compressed results
        result = await db.api.storage.getChanges({ path: 'library'});
        // --> NOT: Creation of root record (library: null) --> compressed checks the previous value and sees it wasn't there in the first place, so there is no mutation
        // --> 1x adding 5 books
        // --> 1x adding 5 videos
        expect(result.changes.length).toEqual(2);

        // Get compressed results with cursor (from video 1)
        result = await db.api.storage.getChanges({ path: 'library', cursor: video1Ref.key });
        // --> 1x adding 5 videos
        expect(result.changes.length).toEqual(1);

        // Get compressed results with cursor (from video 4)
        result = await db.api.storage.getChanges({ path: 'library', cursor: video4Ref.key });
        // --> 1x adding 2 videos
        expect(result.changes.length).toEqual(1);

        // Get relevant mutations for child_added event on books
        result = await db.api.storage.getMutations({ for: [{ path: 'library/books', events: ['child_added'] }] });
        // --> 5x adding 1 books
        console.log(result);
        expect(result.mutations.length).toEqual(5);

        // Get relevant changes for child_added event on books
        result = await db.api.storage.getChanges({ for: [{ path: 'library/books', events: ['child_added'] }] });
        // --> 1x adding 5 books
        console.log(result);
        expect(result.changes.length).toEqual(1);

        // Get relevant mutations for child_removed event on books
        result = await db.api.storage.getMutations({ for: [{ path: 'library/books', events: ['child_removed'] }] });
        // --> 0x removed
        expect(result.mutations.length).toEqual(0);

        // Delete some records
        await video1Ref.remove();
        await video4Ref.remove();
 
        // Get changes with cursor (from video 4 creation)
        result = await db.api.storage.getChanges({ path: 'library', cursor: video4Ref.key });
        console.log(result);
        expect(result.changes.length).toEqual(1);
        expect(result.changes[0].path).toEqual('library/videos');
        const prevValue = result.changes[0].previous, newValue = result.changes[0].value;
        expect(Object.keys(prevValue).filter(key => prevValue[key] !== null).length).toEqual(2); // video 1 and 4
        expect(Object.keys(prevValue).filter(key => prevValue[key] === null).length).toEqual(1); // video 5 wasn't there yet
        expect(Object.keys(newValue).filter(key => newValue[key] === null).length).toEqual(2); // video 1 and 4 now gone
        expect(Object.keys(newValue).filter(key => newValue[key] !== null).length).toEqual(1); // video 5 was created after cursor

    }, 600 * 1000); // minutes to allow debugging

    it('ref.getMutations', async () => {
        // Start without songs in library
        const fakeCursor = '00000000';
        {
            const result = await db.ref('library2/songs').getMutations(fakeCursor);
            expect(result.used_cursor).toBe(fakeCursor);
            expect(typeof result.new_cursor).toBe('string');
            expect(result.mutations.length).toBe(0);
        }

        // Add some songs
        await db.ref('library2/songs').push({ title: 'Slow Dancing In A Burning Room', artist: 'John Mayer' });
        await db.ref('library2/songs').push({ title: 'Blue On Black', artist: 'Kenny Wayne Shepherd' });

        // Get mutations without cursor
        {
            const result = await db.ref('library2/songs').getMutations(fakeCursor);
            expect(result.used_cursor).toBe(fakeCursor);
            expect(typeof result.new_cursor).toBe('string');
            // 1: Creation of 1st song (creation of "library" depending on execution order of other spec)
            // 2: Creation of 2nd song
            expect(result.mutations.length).toBe(2); 
        }

        // Get changes without cursor and remember returned cursor
        let cursor;
        {
            const result = await db.ref('library2/songs').getChanges(fakeCursor);
            expect(result.used_cursor).toBe(fakeCursor);
            expect(typeof result.new_cursor).toBe('string');
            expect(result.changes.length).toBe(1); // compressed to 1 'update' mutation on "library2/songs"

            // Remember this cursor
            cursor = result.new_cursor;            
        }
        
        // Add more songs
        await db.ref('library2/songs').push({ title: 'All Along The Watchtower', artist: 'Jimi Hendrix' });
        await db.ref('library2/songs').push({ title: 'While My Guitar Gently Weeps', artist: 'George Harrison' });

        // Get changes with previous cursor
        {
            const result = await db.ref('library2/songs').getChanges(cursor);
            expect(result.used_cursor).toBe(cursor);
            expect(typeof result.new_cursor).toBe('string');
            expect(result.changes.length).toBe(1); // compressed to 1 'update' mutation?
        }

    }, 60 * 1000 * 5);

    afterAll(async () => {
        await removeDB();
    })
});