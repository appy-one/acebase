/// <reference types="@types/jasmine" />
const { createTempDB } = require("./tempdb");
const { AceBase, ID } = require("..");

// TODO: MANY MORE index options to spec

describe('index', () => {
    /** @type {AceBase} */
    let db, removeDB;

    beforeAll(async () => {
        ({ db, removeDB } = await createTempDB());
    });

    afterAll(async () => {
        await removeDB();
    });

    it('can be on the root', async () => {
        // Created for issue https://github.com/appy-one/acebase/issues/67
        const index = await db.indexes.create('', 'some_property');
        expect(index.fileName).not.toContain('[undefined]');
    });

});

describe('string index', () => {
    /** @type {AceBase} */
    let db, removeDB;

    beforeAll(async () => {
        ({ db, removeDB } = await createTempDB());

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
                } : null,
                meta: {
                    id: m.id,
                    date: m.year ? new Date(m.year) : null
                }
            };
        });
        await db.ref('meteorites').set(meteorites);
    }, 30000);

    it('key can contain slashes', async () => {
        // Created for issue https://github.com/appy-one/acebase/issues/67
        try {
            const index = await db.indexes.create('meteorites', 'meta/id', { include: ['meta/date'] });
        }
        catch (err) {
            fail('index key must be allowed to contain slashes');
        }

        // Try querying the subkey index:
        const results = await db.query('meteorites')
            .filter('meta/id', 'in', ['53829','463','4922']) // Sołtmany, Alessandria, Bahjoi
            .sort('meta/id')
            .get();

        expect(results.length).toBe(3);

        const meteorites = results.getValues();
        expect(meteorites[0].name).toBe('Alessandria');
        expect(meteorites[1].name).toBe('Bahjoi');
        expect(meteorites[2].name).toBe('Sołtmany');

        // Try adding a meteorite, index should update ok
        await db.ref('meteorites').push({
            name: 'BigRock',
            class: 'Unknown',
            meta: {
                id: 'bigrock',
                date: new Date()
            }
        });

        // Query me
        const snaps = await db.query('meteorites')
            .filter('meta/id', '==', 'bigrock')
            .get();
        expect(snaps.length).toBe(1);

    }, 60000);

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
            .filter('name', '!=', 'BigRock') // Might have been added by other test above
            .on('stats', ev => stats.push(ev))
            .on('hints', ev => hints.push(ev))
            .get();

        expect(snaps.length).toEqual(952);
        expect(stats.length).toEqual(1);
        expect([952, 953].includes(stats[0].stats.result)).toBeTrue();
    }, 60000);

    afterAll(async () => {
        await removeDB();
    });
});