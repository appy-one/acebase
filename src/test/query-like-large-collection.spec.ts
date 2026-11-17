import { createTempDB } from './tempdb';

describe('like query on large collection', () => {
    // Collections with more than 100 children are stored as a B+tree.
    // These tests verify 'like' queries with a leading wildcard still return correct results.

    const TOTAL_USERS = 250;
    const isExampleUser = (i: number) => i % 3 !== 0; // 2 out of 3 users have an @example.com address

    const createUsers = () => {
        const users = {} as Record<string, { name: string; email: string }>;
        for (let i = 0; i < TOTAL_USERS; i++) {
            const domain = isExampleUser(i) ? 'example.com' : 'other.org';
            users[`user${i}`] = { name: `User ${i}`, email: `user${i}@${domain}` };
        }
        return users;
    };
    const expectedKeys = () => Array.from({ length: TOTAL_USERS }, (_, i) => i)
        .filter(isExampleUser)
        .map(i => `user${i}`)
        .sort();

    it('without index', async () => {
        const { db, removeDB } = await createTempDB();
        try {
            await db.ref('users').set(createUsers());

            const snaps = await db.query('users')
                .filter('email', 'like', '*@example.com')
                .get();

            const keys = snaps.map(snap => snap.key).sort();
            expect(keys).toEqual(expectedKeys());
            snaps.forEach(snap => expect(snap.val().email).toMatch(/@example\.com$/));
        }
        finally {
            await removeDB();
        }
    }, 60_000);

    it('with index', async () => {
        const { db, removeDB } = await createTempDB();
        try {
            await db.ref('users').set(createUsers());
            await db.indexes.create('users', 'email');

            const snaps = await db.query('users')
                .filter('email', 'like', '*@example.com')
                .get();

            const keys = snaps.map(snap => snap.key).sort();
            expect(keys).toEqual(expectedKeys());
            snaps.forEach(snap => expect(snap.val().email).toMatch(/@example\.com$/));
        }
        finally {
            await removeDB();
        }
    }, 60_000);
});
