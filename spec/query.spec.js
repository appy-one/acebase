/// <reference types="@types/jasmine" />
const { DataReference, DataSnapshotsArray, DataReferencesArray, DataReferenceQuery, ObjectCollection } = require("acebase-core");
const { createTempDB } = require("./tempdb");

describe('Query', () => {
    let db, removeDB;

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

    afterAll(async () => {
        await removeDB();
    });
});