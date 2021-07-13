/// <reference types="@types/jasmine" />
const { createTempDB } = require("./tempdb");

describe('JSON data export', () => {
    let db, removeDB;

    beforeAll(async () => {
        ({ db, removeDB } = await createTempDB());
    });

    it('should be typesafe', async () => {
        const obj = {
            name: 'Ewout', 
            country: 'The Netherlands',
            points: 125,
            created: new Date()
        }
        await db.ref('object').set(obj);

        let json = '';
        await db.ref('object').export({ write: str => json += str }, { format: 'json', type_safe: true });
        expect(typeof json).toBe('string');

        let serialized;
        expect(() => { serialized = JSON.parse(json) }).not.toThrow();
        expect(typeof serialized).toBe('object');
        expect(serialized.name).toEqual(obj.name);
        expect(serialized.country).toEqual(obj.country);
        expect(serialized.points).toEqual(obj.points);
        expect(serialized.created).toEqual({ '.type': 'Date', '.val': obj.created.toISOString() });
    });

    it('should allow not to be typesafe', async () => {
        const obj = {
            name: 'Ewout', 
            country: 'The Netherlands',
            points: 125,
            created: new Date()
        }
        await db.ref('object2').set(obj);

        let json = '';
        await db.ref('object2').export({ write: str => json += str }, { format: 'json', type_safe: false });
        expect(typeof json).toBe('string');

        let serialized;
        expect(() => { serialized = JSON.parse(json) }).not.toThrow();
        expect(typeof serialized).toBe('object');
        expect(serialized.name).toEqual(obj.name);
        expect(serialized.country).toEqual(obj.country);
        expect(serialized.points).toEqual(obj.points);
        expect(serialized.created).toEqual(obj.created.toISOString());
    });

    afterAll(async () => {
        await removeDB();
    })
});