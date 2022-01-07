/// <reference types="@types/jasmine" />
const { createTempDB } = require("./tempdb");

describe('Include/exclude filters', () => {
    let db, removeDB;
    beforeAll(async () => {
        const tmp = await createTempDB();
        db = tmp.db;
        removeDB = tmp.removeDB;
    });

    afterAll(async () => {
        await removeDB();
    });

    it('test', async () => {
        const testData = require('./dataset/users.json');
        await db.ref('users').set(testData);

        let snap = await db.ref('users/someuser').get({ exclude: ['posts', 'instruments'] })
        let user = snap.val();
        expect(user.name).toBe('Some random user');
        expect(user.country).toBe('Deserted Island');
        expect(user.instruments).toBeUndefined();
        expect(user.posts).toBeUndefined();

        snap = await db.ref('users/someuser/posts').get({ include: ['*/title', '*/posted'] });
        let posts = snap.val();
        expect(typeof posts.post1).toBe('object');
        expect(typeof posts.post1.title).toBe('string');
        expect(posts.post1.text).toBeUndefined();
        expect(typeof posts.post1.posted).toBe('string');

        snap = await db.ref('users/ewout').get({ exclude: ['posts'], include: ['instruments/*/type'] });
        user = snap.val();
        expect(user.name).toBe('Ewout Stortenbeker');
        expect(user.country).toBe('The Netherlands');
        expect(user.posts).toBeUndefined();
        expect(typeof user.instruments).toBe('object');
        expect(user.instruments.instrument1).toEqual({ type: 'guitar' });
        expect(user.instruments.instrument2).toEqual({ type: 'drums' });
        expect(user.instruments.instrument3).toEqual({ type: 'piano' });

        snap = await db.ref('users/ewout').get({ exclude: ['posts'], include: ['instruments', 'instruments/*/type'] });
        user = snap.val();
        expect(user.name).toBeUndefined();
        expect(user.country).toBeUndefined();
        expect(user.posts).toBeUndefined();
        expect(typeof user.instruments).toBe('object');
        expect(user.instruments.instrument1).toEqual({ type: 'guitar' });
        expect(user.instruments.instrument2).toEqual({ type: 'drums' });
        expect(user.instruments.instrument3).toEqual({ type: 'piano' });        
    });
});