/// <reference types="@types/jasmine" />
const { DataReference, DataSnapshotsArray, DataReferencesArray, DataReferenceQuery, ObjectCollection } = require("acebase-core");
const { AceBase } = require("..");
const { createTempDB } = require("./tempdb");

describe('Query', () => {
    /** @type {AceBase} */
    let db;
    /** @type {{() => Promise<void>}} */
    let removeDB;

    /** @type {DataReference} */
    let moviesRef;

    /** @type {Array<{ query: DataReferenceQuery, expect: object[] }>} */
    let tests = [];

    beforeAll(async () => {
        ({ db, removeDB } = await createTempDB());
        moviesRef = db.ref('movies');

        const movies = require("./dataset/movies.json");
        await moviesRef.set(ObjectCollection.from(movies));

        tests.push({ 
            query: moviesRef.query().filter("year", "between", [1995, 2010]).filter("rating", ">=", 7).filter("genres", "!contains", ["sci-fi", "fantasy"]),
            expect: movies.filter(movie => movie.year >= 1995 && movie.year <= 2010 && movie.rating >= 7 && movie.genres.every(g => !["sci-fi", "fantasy"].includes(g)))
        }, { 
            query: moviesRef.query().filter("genres", "contains", ["action"]),
            expect: movies.filter(movie => movie.genres.includes("action"))
        });
    });
    
    it('snapshots', async () => {
        for (let test of tests) {
            const snaps = await test.query.get();
            expect(snaps instanceof DataSnapshotsArray).toBeTrue();
            expect(snaps.length).toBe(test.expect.length);

            // Check if all expected movies are in the result
            for (let movie of snaps.getValues()) {
                const expectedMovie = test.expect.find(m => m.id === movie.id);
                expect(typeof expectedMovie === 'object');
            }
        }
    });

    it('snapshots with include option', async () => {
        for (let test of tests) {
            const snaps = await test.query.get({ include: ['id','title'] });
            expect(snaps instanceof DataSnapshotsArray).toBeTrue();
            expect(snaps.length).toBe(test.expect.length);

            // Check if all expected movies are in the result
            for (let movie of snaps.getValues()) {
                const expectedMovie = test.expect.find(m => m.id === movie.id);
                expect(typeof expectedMovie === 'object');

                // Also check if the value only has id & title properties
                const properties = Object.keys(movie).sort();
                expect(properties.length).toBe(2);
                expect(properties[0]).toBe('id');
                expect(properties[1]).toBe('title');
            }
        }
    });

    it('snapshots with exclude option', async () => {
        for (let test of tests) {
            const snaps = await test.query.get({ exclude: ['description'] });
            expect(snaps instanceof DataSnapshotsArray).toBeTrue();
            expect(snaps.length).toBe(test.expect.length);

            // Check if all expected movies are in the result
            for (let movie of snaps.getValues()) {
                const expectedMovie = test.expect.find(m => m.id === movie.id);
                expect(typeof expectedMovie === 'object');

                // Also check if the value does not have a description property
                expect('description' in movie).toBeFalse();
            }
        }
    });

    it('references', async () => {
        for (let test of tests) {
            const refs = await test.query.find();
            expect(refs instanceof DataReferencesArray).toBeTrue();
            expect(refs.length).toBe(test.expect.length);
        }
    });

    it('count', async () => {
        for (let test of tests) {
            const count = await test.query.count();
            expect(count).toBe(test.expect.length);
        }
    });

    it('exists', async () => {
        for (let test of tests) {
            const exists = await test.query.exists();
            expect(exists).toBe(test.expect.length > 0);
        }
    });

    it('is live', async() => {
        // Code based on realtime query example in README.md
        const wait = async (ms) => new Promise(resolve => setTimeout(resolve, ms));

        const fiveStarBooks = {}; // local query result set
        const snaps = await db.query('books')
            .filter('rating', '==', 5)
            .on('add', match => {
                // add book to results
                fiveStarBooks[match.snapshot.key] = match.snapshot.val();
            })
            .on('change', match => {
                // update book details
                fiveStarBooks[match.snapshot.key] = match.snapshot.val();
            })
            .on('remove', match => {
                // remove book from results
                delete fiveStarBooks[match.ref.key];
            })
            .get();

        // Add current query results to our local result set
        snaps.forEach(snap => {
            fiveStarBooks[snap.key] = snap.val();
        });

        const countBooks = () => Object.keys(fiveStarBooks).length;

        // Collection is empty, so there should be 0 results
        expect(countBooks()).toBe(0);

        // Let's add a non-matching book
        await db.ref('books').push({ title: 'Some mediocre novel', rating: 3 });
        
        // Wait few ms to make sure results are (not) being updated
        await wait(10);

        // Collection should still be 0
        expect(countBooks()).toBe(0);

        // Add a matching book
        let matchRef1 = await db.ref('books').push({ title: 'A very good novel', rating: 5 });
        
        // Wait few ms to make sure results are being updated
        await wait(10);

        // Collection should now contain 1 book
        expect(countBooks()).toBe(1);

        // Change the rating so it doesn't match anymore
        await matchRef1.update({ rating: 4 });
        await wait(10); // Wait few ms
        expect(countBooks()).toBe(0);

        // Change rating back to 5
        await matchRef1.update({ rating: 5 });
        await wait(10); // Wait few ms
        expect(countBooks()).toBe(1);
    });

    afterAll(async () => {
        await removeDB();
    });
});