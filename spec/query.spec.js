/// <reference types="@types/jasmine" />
const { DataReference, DataSnapshotsArray, DataReferencesArray, DataReferenceQuery, ObjectCollection } = require("acebase-core");
const { AceBase, ID } = require("..");
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

describe('Query with take/skip', () => {
    // Based on https://github.com/appy-one/acebase/issues/75

    /** @type {AceBase} */
    let db;
    /** @type {{() => Promise<void>}} */
    let removeDB;

    beforeAll(async () => {
        ({ db, removeDB } = await createTempDB());

        const updates = {};
        for (let i = 0; i < 2000; i++) {
            updates[ID.generate()] = { letter: String.fromCharCode(97 + Math.floor(Math.random() * 26)) };
        }

        // create non-indexed collection
        await db.ref("sort").update(updates);
        
        // create indexed collection
        await db.indexes.create("sort_indexed", "letter");  // | Swap these to
        await db.ref("sort_indexed").update(updates);       // | improve performance

    }, 60e3);

    afterAll(async () => {
        await removeDB();
    });
    
    // Non-indexed:

    it('load first 100 sort letter by a-z (non-indexed)', async () => {
        await db.query("sort").sort("letter", true).take(100).get();
    }, 30e3);

    it('load second 100 sort letter by a-z (non-indexed)', async () => {
        await db.query("sort").sort("letter", true).skip(100).take(100).get();
    }, 30e3);

    it('load third 100 sort letter by a-z (non-indexed)', async () => {
        await db.query("sort").sort("letter", true).skip(200).take(100).get();
    }, 30e3);

    it('load first 100 sort letter by z-a (non-indexed)', async () => {
        await db.query("sort").sort("letter", false).take(100).get();
    }, 30e3);

    it('load second 100 sort letter by z-a (non-indexed)', async () => {
        await db.query("sort").sort("letter", false).skip(100).take(100).get();
    }, 30e3);

    it('load third 100 sort letter by z-a (non-indexed)', async () => {
        await db.query("sort").sort("letter", false).skip(200).take(100).get();
    }, 30e3);

    // Indexed:

    it('load first 100 sort letter by a-z (non-indexed)', async () => {
        await db.query("sort_indexed").sort("letter", true).take(100).get();
    }, 30e3);

    it('load second 100 sort letter by a-z (non-indexed)', async () => {
        await db.query("sort_indexed").sort("letter", true).skip(100).take(100).get();
    }, 30e3);

    it('load third 100 sort letter by a-z (non-indexed)', async () => {
        await db.query("sort_indexed").sort("letter", true).skip(200).take(100).get();
    }, 30e3);

    it('load first 100 sort letter by z-a (non-indexed)', async () => {
        await db.query("sort_indexed").sort("letter", false).take(100).get();
    }, 30e3);

    it('load second 100 sort letter by z-a (non-indexed)', async () => {
        await db.query("sort_indexed").sort("letter", false).skip(100).take(100).get();
    }, 30e3);

    it('load third 100 sort letter by z-a (non-indexed)', async () => {
        await db.query("sort_indexed").sort("letter", false).skip(200).take(100).get();
    }, 30e3);

});

describe('Wildcard query', () => {
    /** @type {AceBase} */
    let db;
    /** @type {{() => Promise<void>}} */
    let removeDB;

    beforeAll(async () => {
        ({ db, removeDB } = await createTempDB());
    });

    afterAll(async () => {
        await removeDB();
    });

    it('wildcards need an index', async () => {
        // Created for discussion 92: https://github.com/appy-one/acebase/discussions/92
        // Changed schema to be users/uid/messages/messageid
        // To test: npx jasmine ./spec/query.spec.js --filter="wildcards"
        
        // Insert data without index
        await db.ref("users/user1/messages").push({ text: "First message" });
        await db.ref("users/user2/messages").push({ text: "Second message" });
        await db.ref("users/user1/messages").push({ text: "Third message" });

        try {
            await db.query("users/$username/messages").count();
            fail('Should not be allowed');
        }
        catch(err) {
            // Expected, scattered data query requires an index
        }

        // Remove data
        await db.root.update({ users: null });

        // Create an index on {key} (key of each message) and try again
        await db.indexes.create('users/$username/messages', '{key}');
        await db.ref("users/user1/messages").push({ text: "First message" });
        await db.ref("users/user2/messages").push({ text: "Second message" });
        await db.ref("users/user1/messages").push({ text: "Third message" });

        try {
            // Query with filter matching all 
            const snaps = await db.query("users/$username/messages").filter('{key}', '!=', '').get();
            expect(snaps.length).toBe(3);

            let msgcount = await db.query("users/$username/messages").filter('{key}', '!=', '').count();
            expect(msgcount).toBe(3);
        }
        catch(err) {
            fail('Should be allowed');
        }

        try {
            // Query without filter, index should automatically be selected with filter matching all 
            const snaps = await db.query("users/$username/messages").get();
            expect(snaps.length).toBe(3);

            let msgcount = await db.query("users/$username/messages").count();
            expect(msgcount).toBe(3);
        }
        catch(err) {
            fail('Should be allowed');
        }
    }, 60e3); // increased timeout for debugging

})