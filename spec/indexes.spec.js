/// <reference types="@types/jasmine" />
const { createTempDB } = require("./tempdb");
const { AceBase, ID } = require("..");

// TODO: MANY MORE index options to spec

describe('string index', () => {
    /** @type {AceBase} */
    let db, removeDB;

    beforeAll(async () => {
        const tmp = await createTempDB();
        db = tmp.db;
        removeDB = tmp.removeDB;

        // Insert sample data from meteorites json
        const m = require('./dataset/meteorites.json');
        const meteorites = {};
        m.forEach(m => {
            const id = ID.generate();
            meteorites[id] = {
                name: m.name,
                mass: typeof m.mass !== 'undefined' ? parseFloat(m.mass) : null,
                class: m.recclass,
                location: m.geolocation && m.geolocation.coordinates ? {
                    lat: m.geolocation.coordinates[1],
                    long: m.geolocation.coordinates[0]
                } : null
            };
        });
        await db.ref('meteorites').set(meteorites);
    }, 30000);

    it('without included columns', async () => {
        // Build
        await db.indexes.create('meteorites', 'name');

        // Query with '=='
        let stats = [], hints = [];
        let snaps = await db.ref('meteorites').query()
            .filter('name', '==', 'Louisville')
            .on('stats', ev => stats.push(ev))
            .on('hints', ev => hints.push(ev))
            .get({ });

        expect(snaps.length).toEqual(1); 
        // Check triggered events 
        expect(hints.length).toEqual(0); // No hints because the query should have used the index
        expect(stats.length).toEqual(1); // 1 stats event for the used index
        expect(stats[0].type === 'index_query'); 
        expect(stats[0].source).toEqual('/meteorites/*/name'); 
        expect(stats[0].stats.result).toEqual(snaps.length);
        // Check query performance. NOTE: with all other tests running at the same time (in the same 1 thread), this could possibly fail!
        expect(stats[0].stats.duration).toBeLessThan(100); 

        // Query with 'like'
        stats = [], hints = [];
        snaps = await db.ref('meteorites').query()
            .filter('name', 'like', 'L*')
            .on('stats', ev => stats.push(ev))
            .on('hints', ev => hints.push(ev))
            .get();

        expect(snaps.length).toEqual(48);
        expect(stats.length).toEqual(1);
        expect(stats[0].stats.result).toEqual(snaps.length);

        // Query with '!like'
        stats = [], hints = [];
        snaps = await db.ref('meteorites').query()
            .filter('name', '!like', 'L*')
            .on('stats', ev => stats.push(ev))
            .on('hints', ev => hints.push(ev))
            .get();

        expect(snaps.length).toEqual(952);
        expect(stats.length).toEqual(1);
        expect(stats[0].stats.result).toEqual(snaps.length);
    }, 30000);

    afterAll(async () => {
        await removeDB();
    });
});