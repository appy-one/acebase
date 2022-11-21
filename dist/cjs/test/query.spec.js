"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const acebase_core_1 = require("acebase-core");
const __1 = require("..");
const dataset_1 = require("./dataset");
const tempdb_1 = require("./tempdb");
describe('Query', () => {
    let db, removeDB;
    let moviesRef;
    const tests = [];
    beforeAll(async () => {
        ({ db, removeDB } = await (0, tempdb_1.createTempDB)());
        moviesRef = db.ref('movies');
        const movies = await (0, dataset_1.readDataSet)('movies');
        await moviesRef.set(acebase_core_1.ObjectCollection.from(movies));
        tests.push({
            query: moviesRef.query().filter('year', 'between', [1995, 2010]).filter('rating', '>=', 7).filter('genres', '!contains', ['sci-fi', 'fantasy']),
            expect: movies.filter(movie => movie.year >= 1995 && movie.year <= 2010 && movie.rating >= 7 && movie.genres.every(g => !['sci-fi', 'fantasy'].includes(g))),
        }, {
            query: moviesRef.query().filter('genres', 'contains', ['action']),
            expect: movies.filter(movie => movie.genres.includes('action')),
        }, {
            query: moviesRef.query().filter('year', 'in', [1994, 1995]),
            expect: movies.filter(movie => [1994, 1995].includes(movie.year)),
        });
    });
    it('snapshots', async () => {
        for (const test of tests) {
            const snaps = await test.query.get();
            expect(snaps instanceof acebase_core_1.DataSnapshotsArray).toBeTrue();
            expect(snaps.length).toBe(test.expect.length);
            // Check if all expected movies are in the result
            for (const movie of snaps.getValues()) {
                const expectedMovie = test.expect.find(m => m.id === movie.id);
                expect(typeof expectedMovie === 'object');
            }
        }
    });
    it('snapshots with include option', async () => {
        for (const test of tests) {
            const snaps = await test.query.get({ include: ['id', 'title'] });
            expect(snaps instanceof acebase_core_1.DataSnapshotsArray).toBeTrue();
            expect(snaps.length).toBe(test.expect.length);
            // Check if all expected movies are in the result
            for (const movie of snaps.getValues()) {
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
        for (const test of tests) {
            const snaps = await test.query.get({ exclude: ['description'] });
            expect(snaps instanceof acebase_core_1.DataSnapshotsArray).toBeTrue();
            expect(snaps.length).toBe(test.expect.length);
            // Check if all expected movies are in the result
            for (const movie of snaps.getValues()) {
                const expectedMovie = test.expect.find(m => m.id === movie.id);
                expect(typeof expectedMovie === 'object');
                // Also check if the value does not have a description property
                expect('description' in movie).toBeFalse();
            }
        }
    });
    it('references', async () => {
        for (const test of tests) {
            const refs = await test.query.find();
            expect(refs instanceof acebase_core_1.DataReferencesArray).toBeTrue();
            expect(refs.length).toBe(test.expect.length);
        }
    });
    it('count', async () => {
        for (const test of tests) {
            const count = await test.query.count();
            expect(count).toBe(test.expect.length);
        }
    });
    it('exists', async () => {
        for (const test of tests) {
            const exists = await test.query.exists();
            expect(exists).toBe(test.expect.length > 0);
        }
    });
    it('is live', async () => {
        // Code based on realtime query example in README.md
        const wait = async (ms) => new Promise(resolve => setTimeout(resolve, ms));
        const fiveStarBooks = {}; // local query result set
        const query = db.query('books')
            .filter('rating', '==', 5)
            .on('add', (match) => {
            // add book to results
            const snapshot = match.snapshot;
            fiveStarBooks[snapshot.key] = snapshot.val();
        })
            .on('change', match => {
            // update book details
            const snapshot = match.snapshot;
            fiveStarBooks[snapshot.key] = snapshot.val();
        })
            .on('remove', match => {
            // remove book from results
            const ref = match.ref;
            delete fiveStarBooks[ref.key];
        });
        const snaps = await query.get();
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
        const matchRef1 = await db.ref('books').push({ title: 'A very good novel', rating: 5 });
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
        // Stop query
        await query.stop();
        // Change the rating so it doesn't match anymore
        await matchRef1.update({ rating: 4 });
        await wait(10); // Wait few ms
        expect(countBooks()).toBe(1); // Should not have received a callback because of previous .stop()
    });
    afterAll(async () => {
        await removeDB();
    });
});
describe('Query with take/skip', () => {
    // Based on https://github.com/appy-one/acebase/issues/75
    let db;
    let removeDB;
    beforeAll(async () => {
        ({ db, removeDB } = await (0, tempdb_1.createTempDB)());
        const updates = {};
        for (let i = 0; i < 2000; i++) {
            updates[__1.ID.generate()] = { letter: String.fromCharCode(97 + Math.floor(Math.random() * 26)) };
        }
        // create non-indexed collection
        await db.ref('collection').update(updates);
        // create indexed collection
        await db.indexes.create('indexed_collection', 'letter'); // | Swap these to
        await db.ref('indexed_collection').update(updates); // | improve performance
    }, 60e3);
    afterAll(async () => {
        await removeDB();
    });
    // Non-indexed:
    it('load first 100 sort letter by a-z (non-indexed)', async () => {
        const results = await db.query('collection').sort('letter', true).take(100).get();
        expect(results.length).toBe(100);
    }, 30e3);
    it('load second 100 sort letter by a-z (non-indexed)', async () => {
        const results = await db.query('collection').sort('letter', true).skip(100).take(100).get();
        expect(results.length).toBe(100);
    }, 30e3);
    it('load third 100 sort letter by a-z (non-indexed)', async () => {
        const results = await db.query('collection').sort('letter', true).skip(200).take(100).get();
        expect(results.length).toBe(100);
    }, 30e3);
    it('load first 100 sort letter by z-a (non-indexed)', async () => {
        const results = await db.query('collection').sort('letter', false).take(100).get();
        expect(results.length).toBe(100);
    }, 30e3);
    it('load second 100 sort letter by z-a (non-indexed)', async () => {
        const results = await db.query('collection').sort('letter', false).skip(100).take(100).get();
        expect(results.length).toBe(100);
    }, 30e3);
    it('load third 100 sort letter by z-a (non-indexed)', async () => {
        const results = await db.query('collection').sort('letter', false).skip(200).take(100).get();
        expect(results.length).toBe(100);
    }, 30e3);
    // Indexed:
    it('load first 100 sort letter by a-z (indexed)', async () => {
        const results = await db.query('indexed_collection').sort('letter', true).take(100).get();
        expect(results.length).toBe(100);
    }, 30e3);
    it('load second 100 sort letter by a-z (indexed)', async () => {
        const results = await db.query('indexed_collection').sort('letter', true).skip(100).take(100).get();
        expect(results.length).toBe(100);
    }, 30e3);
    it('load third 100 sort letter by a-z (indexed)', async () => {
        const results = await db.query('indexed_collection').sort('letter', true).skip(200).take(100).get();
        expect(results.length).toBe(100);
    }, 30e3);
    it('load first 100 sort letter by z-a (indexed)', async () => {
        const results = await db.query('indexed_collection').sort('letter', false).take(100).get();
        expect(results.length).toBe(100);
    }, 30e3);
    it('load second 100 sort letter by z-a (indexed)', async () => {
        const results = await db.query('indexed_collection').sort('letter', false).skip(100).take(100).get();
        expect(results.length).toBe(100);
    }, 30e3);
    it('load third 100 sort letter by z-a (indexed)', async () => {
        const results = await db.query('indexed_collection').sort('letter', false).skip(200).take(100).get();
        expect(results.length).toBe(100);
    }, 30e3);
    it('without sort', async () => {
        // skip/take without sort, created for #119
        const results = await db.query('collection').skip(200).take(100).get();
        expect(results.length).toBe(100);
    });
});
describe('Query with take/skip multiple sorts', () => {
    // Based on the test created for issue #120 (see below)
    // This test performs an index take/skip with a sort on multiple fields (included in the index),
    // which is a new feature added in v1.24.0
    let db;
    let removeDB;
    let movies;
    beforeAll(async () => {
        ({ db, removeDB } = await (0, tempdb_1.createTempDB)());
        movies = await (0, dataset_1.readDataSet)('movies');
        const collection = acebase_core_1.ObjectCollection.from(movies);
        // Create unindexed collection
        await db.ref('movies').set(collection);
        // Create indexed collection
        await db.ref('indexed_movies').set(collection);
        await db.indexes.create('indexed_movies', 'year', { include: ['title'] });
    }, 60e3);
    afterAll(async () => {
        await removeDB();
    });
    it('skip unindexed', async () => {
        const skip = 10, take = 5;
        const query = db.query('movies')
            .sort('year', false)
            .sort('title')
            .take(take)
            .skip(skip);
        const results = await query.get(); //({ include: ['id', 'title', 'year'] })
        const check = movies.sort((a, b) => b.year === a.year ? a.title < b.title ? -1 : 1 : b.year - a.year).slice(skip, skip + take);
        expect(results.getValues()).toEqual(check);
    });
    it('skip indexed', async () => {
        const skip = 10, take = 5;
        const query = db.query('indexed_movies')
            .sort('year', false)
            .sort('title')
            .take(take)
            .skip(skip);
        const results = await query.get(); //({ include: ['id', 'title', 'year'] })
        const check = movies.sort((a, b) => b.year === a.year ? a.title < b.title ? -1 : 1 : b.year - a.year).slice(skip, skip + take);
        expect(results.getValues()).toEqual(check);
    }, 30e6);
});
describe('Query with take/skip #120', () => {
    // Based on https://github.com/appy-one/acebase/issues/120
    // This test occasionally failed because the indexed field 'year' was not unique:
    // performing a take/skip on either indexed or non-indexed data did not always return
    // the same results, simply because there was no second sort to guarantee a consistent
    // sort order. This test now uses the 'votes' field, which is unique in the currently
    // used (movies) dataset
    let db;
    let removeDB;
    let movies;
    beforeAll(async () => {
        ({ db, removeDB } = await (0, tempdb_1.createTempDB)());
        movies = await (0, dataset_1.readDataSet)('movies');
        const collection = acebase_core_1.ObjectCollection.from(movies);
        // Create unindexed collection
        await db.ref('movies').set(collection);
        // Create indexed collection
        await db.ref('indexed_movies').set(collection);
        await db.indexes.create('indexed_movies', 'votes');
    }, 60e3);
    afterAll(async () => {
        await removeDB();
    });
    it('skip unindexed', async () => {
        const skip = 10, take = 5;
        const query = db.query('movies').sort('votes', false).take(take).skip(skip);
        const results = await query.get(); //({ include: ['id', 'title', 'year'] })
        const check = movies.sort((a, b) => b.votes - a.votes).slice(skip, skip + take);
        expect(results.getValues()).toEqual(check);
    });
    it('skip indexed', async () => {
        const skip = 10, take = 5;
        const query = db.query('indexed_movies').sort('votes', false).take(take).skip(skip);
        const results = await query.get(); //({ include: ['id', 'title', 'year'] })
        const check = movies.sort((a, b) => b.votes - a.votes).slice(skip, skip + take);
        expect(results.getValues()).toEqual(check);
    });
});
describe('Query with take/sort/indexes #124', () => {
    let db;
    let removeDB;
    let movies;
    afterAll(async () => {
        await removeDB();
    });
    beforeAll(async () => {
        ({ db, removeDB } = await (0, tempdb_1.createTempDB)());
        movies = await (0, dataset_1.readDataSet)('movies');
        const collection = acebase_core_1.ObjectCollection.from(movies);
        // Create collection
        await db.ref('movies').set(collection);
        // Create indexes
        await db.indexes.create('movies', 'year');
        await db.indexes.create('movies', 'title');
    });
    it('test', async () => {
        // Query movies: filter by title, order by year (desc), take 10
        const snaps = await db.query('movies')
            .filter('title', 'like', 'the*')
            .sort('year', false)
            .take(20)
            .get();
        const results = snaps.getValues();
        const check = movies.filter(m => m.title.match(/^the/i)).sort((a, b) => b.year - a.year).slice(0, 20);
        expect(results).toEqual(check);
    }, 60 * 60 * 1000);
});
describe('Wildcard query', () => {
    let db;
    let removeDB;
    beforeAll(async () => {
        ({ db, removeDB } = await (0, tempdb_1.createTempDB)());
    });
    afterAll(async () => {
        await removeDB();
    });
    it('wildcards need an index', async () => {
        // Created for discussion 92: https://github.com/appy-one/acebase/discussions/92
        // Changed schema to be users/uid/messages/messageid
        // To test: npx jasmine ./spec/query.spec.js --filter='wildcards'
        // Insert data without index
        await db.ref('users/user1/messages').push({ text: 'First message' });
        await db.ref('users/user2/messages').push({ text: 'Second message' });
        await db.ref('users/user1/messages').push({ text: 'Third message' });
        try {
            await db.query('users/$username/messages').count();
            fail('Should not be allowed');
        }
        catch (err) {
            // Expected, scattered data query requires an index
        }
        // Remove data
        await db.root.update({ users: null });
        // Create an index on {key} (key of each message) and try again
        await db.indexes.create('users/$username/messages', '{key}');
        await db.ref('users/user1/messages').push({ text: 'First message' });
        await db.ref('users/user2/messages').push({ text: 'Second message' });
        await db.ref('users/user1/messages').push({ text: 'Third message' });
        try {
            // Query with filter matching all
            const snaps = await db.query('users/$username/messages').filter('{key}', '!=', '').get();
            expect(snaps.length).toBe(3);
            const msgcount = await db.query('users/$username/messages').filter('{key}', '!=', '').count();
            expect(msgcount).toBe(3);
        }
        catch (err) {
            fail('Should be allowed');
        }
        try {
            // Query without filter, index should automatically be selected with filter matching all
            const snaps = await db.query('users/$username/messages').get();
            expect(snaps.length).toBe(3);
            const msgcount = await db.query('users/$username/messages').count();
            expect(msgcount).toBe(3);
        }
        catch (err) {
            fail('Should be allowed');
        }
    }, 60e3); // increased timeout for debugging
});
describe('Wildcard query with delete', () => {
    let db;
    let removeDB;
    let movies;
    beforeAll(async () => {
        ({ db, removeDB } = await (0, tempdb_1.createTempDB)());
        movies = await (0, dataset_1.readDataSet)('movies');
        const collection = acebase_core_1.ObjectCollection.from(movies);
        await db.ref('movies/collection1').set(collection);
        await db.ref('movies/collection2').set(collection);
        await db.ref('movies/collection3').set(collection);
        await db.indexes.create('movies/*', 'votes');
    });
    afterAll(async () => {
        await removeDB();
    });
    it('works', async () => {
        const votes = 1500000;
        const query = db.query('movies/*').filter('votes', '>', votes);
        // confirm count delivers the correct amount
        let count = await query.count();
        let check = movies.filter(m => m.votes > votes).length * 3; // 3 collections
        expect(count).toBe(check);
        // exists should return true
        let exists = await query.exists();
        expect(exists).toBeTrue();
        // delete those
        await query.remove();
        // check if count is now 0
        count = await query.count();
        expect(count).toBe(0);
        // exists should now return false
        exists = await query.exists();
        expect(exists).toBeFalse();
        // All other movies should be still there
        count = await db.query('movies/*').count();
        check = movies.filter(m => m.votes <= votes).length * 3; // 3 collections
        expect(count).toBe(check);
    });
});
describe('Query with array/contains #135', () => {
    let db;
    let removeDB;
    afterAll(async () => {
        await removeDB();
    });
    beforeAll(async () => {
        ({ db, removeDB } = await (0, tempdb_1.createTempDB)());
    });
    it('test', async () => {
        await db.ref('food').push({
            name: 'apple',
            tags: ['fruit', 'sweet'],
        });
        await db.ref('food').push({
            name: 'orange',
            tags: ['fruit', 'sweet', 'sour'],
        });
        await db.ref('food').push({
            name: 'tomato',
            tags: ['vegetable', 'sour'],
        });
        await db.ref('food').push({
            name: 'milk',
            tags: ['drink', 'sweet'],
        });
        await db.ref('food').push({
            name: 'water',
            tags: ['drink'],
        });
        await db.ref('food').push({
            name: 'salt',
            tags: [],
        });
        const test = async () => {
            let snaps = await db.query('food').filter('tags', 'contains', ['fruit', 'sweet']).get();
            let values = snaps.getValues().map(v => v.name).sort();
            expect(values).toEqual(['apple', 'orange']);
            snaps = await db.query('food').filter('tags', 'contains', ['sweet']).get();
            values = snaps.getValues().map(v => v.name).sort();
            expect(values).toEqual(['apple', 'milk', 'orange']);
            snaps = await db.query('food').filter('tags', 'contains', []).get();
            values = snaps.getValues().map(v => v.name).sort();
            expect(values).toEqual(['apple', 'milk', 'orange', 'salt', 'tomato', 'water']);
            // Now test !contains
            snaps = await db.query('food').filter('tags', '!contains', ['fruit', 'sweet']).get();
            values = snaps.getValues().map(v => v.name).sort();
            expect(values).toEqual(['salt', 'tomato', 'water']);
            snaps = await db.query('food').filter('tags', '!contains', ['sweet']).get();
            values = snaps.getValues().map(v => v.name).sort();
            expect(values).toEqual(['salt', 'tomato', 'water']);
            snaps = await db.query('food').filter('tags', '!contains', []).get();
            values = snaps.getValues().map(v => v.name).sort();
            expect(values).toEqual(['apple', 'milk', 'orange', 'salt', 'tomato', 'water']);
        };
        // Run tests without index
        await test();
        // Now add an array index, run same tests
        await db.indexes.create('food', 'tags', { type: 'array' });
        // Run tests with index
        await test();
    }, 60 * 60 * 1000);
});
describe('Query on indexed BigInts #141', () => {
    // Created for https://github.com/appy-one/acebase/issues/141
    let db;
    let removeDB;
    let moviesRef;
    beforeAll(async () => {
        ({ db, removeDB } = await (0, tempdb_1.createTempDB)());
        moviesRef = db.ref('movies');
        const movies = (await (0, dataset_1.readDataSet)('movies')).map(movie => {
            return {
                title: movie.title,
                rating: movie.rating,
                year: movie.year,
                votes: BigInt(movie.votes),
            };
        });
        await moviesRef.set(acebase_core_1.ObjectCollection.from(movies));
        await db.indexes.create('movies', 'votes');
    });
    afterAll(async () => {
        await removeDB();
    });
    it('filter on BigInt', async () => {
        const query = moviesRef.query().filter('votes', '>', BigInt(1500000));
        let snaps = await query.get();
        expect(snaps.length).toEqual(5);
        // Try again, now with cached results
        snaps = await query.get();
        expect(snaps.length).toEqual(5);
    }, 60e3);
    it('filter on number', async () => {
        const query = moviesRef.query().filter('year', '>', BigInt(1995));
        let snaps = await query.get();
        expect(snaps.length).toEqual(8);
        // Try again, now with cached results
        snaps = await query.get();
        expect(snaps.length).toEqual(8);
    }, 60e3);
});
describe('Query on indexed BigInts #152', () => {
    // Created for https://github.com/appy-one/acebase/issues/152, with adjustments of https://github.com/appy-one/acebase/pull/159/files
    let db;
    let removeDB;
    let moviesRef;
    beforeAll(async () => {
        ({ db, removeDB } = await (0, tempdb_1.createTempDB)());
        moviesRef = db.ref('movies');
        const movies = (await (0, dataset_1.readDataSet)('movies')).map(movie => {
            return {
                title: movie.title,
                rating: movie.rating,
                year: movie.year,
                votes: BigInt(movie.votes),
            };
        });
        await db.indexes.create('movies', 'title');
        await db.indexes.create('movies', 'rating');
        await db.indexes.create('movies', 'votes');
        for (const movie of movies) {
            await moviesRef.push(movie);
        }
    });
    afterAll(async () => {
        await removeDB();
    });
    it('filter on BigInt', async () => {
        const query = moviesRef.query().filter('votes', '>', BigInt(1500000));
        let snaps = await query.get();
        expect(snaps.length).toEqual(5);
        // Try again, now with cached results
        snaps = await query.get();
        expect(snaps.length).toEqual(5);
    }, 60e3);
});
//# sourceMappingURL=query.spec.js.map