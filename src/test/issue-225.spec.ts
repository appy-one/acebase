import { AceBase } from '..';
import { createTempDB } from './tempdb';

describe('issue #225', () => {
    let db: AceBase;
    let removeDB: () => Promise<void>;

    beforeAll(async () => {
        ({ db, removeDB } = await createTempDB({ logLevel: 'warn' }));
    });

    afterAll(async () => {
        await removeDB();
    });

    it('realtime query and indexed deletes', async () => {
        // Create indexes
        await db.indexes.create('items', 'location');
        await db.indexes.create('items', 'category');
        await db.indexes.create('items', 'status');

        const eventStats = { add: 0, change: 0, remove: 0 };

        // Setup realtime query
        const realtimeQuery = db.query('items')
            .filter('category', '==', 'main')
            .filter('status', '==', 1)
            .on('add', event => {
                eventStats.add++;
                const item = event.snapshot.val();
                console.log(`Added item ${event.ref.key}:`, item);
            })
            .on('change', event => {
                eventStats.change++;
                const item = event.snapshot.val();
                console.log(`Changed item ${event.ref.key}:`, item);
            })
            .on('remove', event => {
                eventStats.remove++;
                console.log(`Removed item ${event.ref.key}`);
            });

        // Get initial (no) results
        const results = await realtimeQuery.get();

        // Add a bunch of items, should trigger "add" events on realtime query
        const TEST_SIZE = 1000;
        const itemIds = [] as string[];
        const locations = ['Amsterdam', 'Cape Town', 'Sydney', 'Miami', 'Toronto', 'Berlin', 'Paris'];
        for (let i = 0; i < TEST_SIZE; i++) {
            const ref = await db.ref('items').push({
                location: locations[Math.floor(Math.random() * locations.length)],
                category: 'main',
                status: 1,
            });
            itemIds.push(ref.key);
        }

        // Update every other item to status 2, should trigger 500 "remove" events on realtime query
        for (let i = 0; i < itemIds.length; i += 2) {
            await db.ref('items').child(itemIds[i]).update({
                status: 2,
            });
        }

        // Update every 3rd item to location 'Amsterdam', should trigger "change" events on realtime query
        for (let i = 0; i < itemIds.length; i += 3) {
            await db.ref('items').child(itemIds[i]).update({
                location: 'Amsterdam',
            });
        }

        // Update every 3rd item to status 3, should trigger some more "remove" events on realtime query
        for (let i = 0; i < itemIds.length; i += 3) {
            await db.ref('items').child(itemIds[i]).update({
                status: 3,
            });
        }

        // Remove items with status 1, should trigger all remaining "remove" events on realtime query (0 results left)
        await db.query('items').filter('status', '==', 1).remove();

        // Wait for all remove events to fire
        console.log('Waiting for all remove events to fire');
        await new Promise<void>(resolve => {
            let eventsFired = eventStats.remove;
            const check = () => {
                if (eventsFired === eventStats.remove) {
                    // All fired
                    return resolve();
                }
                eventsFired = eventStats.remove;
                setTimeout(check, 100); // Schedule next check
            };
            setTimeout(check, 1000); // Schedule first check
        });

        // Stop live query
        await realtimeQuery.stop();

        console.log(`${eventStats.add} added, ${eventStats.change} changed, ${eventStats.remove} removed`);
    }, 600_000);
});
