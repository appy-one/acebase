/// <reference types="@types/jasmine" />
const { createTempDB } = require("./tempdb");

describe('node locking', () => {
    it('should not cause deadlocks', async () => {

        // Currently, deadlocks do not happen because multiple concurrent writes have been disabled by NodeLock
        //
        // When concurrent writes are enabled, a deadlock sitation will arise in the following situation:
        // - multiple write locks are allowed if their paths do not intersect (are not "on the same trail")
        // - value events are bound to a path
        // - 2 concurrent writes are done on a deeper path than the bound events. 
        // -> Both writes need to read lock the event path to fetch "before" event data, but aren't allowed to until one of them releases their write lock. Causing a DEADLOCK
        //
        // To enable concurrent writes again, code will have to be refactored so that any higher event path is read locked before acquiring a write lock on the descendant node

        // Create temp db
        const { db, removeDB } = await createTempDB();

        // Add event listener on "some/path/to" node
        db.ref('some/path/to').on('value', snap => {
            console.log(`Got "value" event on path "${snap.ref.path}" with value ${snap.exists() ? JSON.stringify(snap.val()) : 'null'}`);
        });

        // Perform 2 concurrent updates to paths that do not clash,
        // but do share the common ancestor 'some/path/to'
        const p1 = db.ref('some/path/to/some/child').update({ text: 'Update 1' });
        const p2 = db.ref('some/path/to/another/child').update({ text: 'Update 2' });

        // Use a timeout of 5 seconds to make sure above updates could both have been performed.
        let timeoutFired = false;
        const timeout = new Promise(resolve => setTimeout(() => { timeoutFired = true; resolve(); }, 5000));

        await Promise.race([timeout, Promise.all([p1, p2])]);

        expect(timeoutFired).toBeFalse();
        if (!timeoutFired) {

            // Check if the target data is correct
            const snap = await db.ref('some/path/to').get();
            expect(snap.exists()).toBeTrue();

            const val = snap.val();
            expect(val).toEqual({ some: { child: { text: 'Update 1' } }, another: { child: { text: 'Update 2' } } });
        }

        // Remove temp db
        await removeDB();
    });

    it('should not cause deadlocks - part2', async () => {
        // Simulate high load
  
        const { db, removeDB } = await createTempDB({ logLevel: 'verbose' });
        const mem = {};
        const actions = [
            async () => { 
                const product = { name: 'My product', added: new Date() };
                await db.ref('products/abc').set(product); 
                if (!mem.products) { mem.products = {}; }
                mem.products.abc = product;
            },
            async () => { 
                const product = { name: 'Another product', added: new Date() }
                await db.ref('products/def').set(product); 
                if (!mem.products) { mem.products = {}; }
                mem.products.def = product;
            },
            async () => { 
                const description = 'Changed description' + Math.random();
                await db.ref('products/abc').update({ description }); 
                if (!mem.products) { mem.products = {}; }
                if (!mem.products.abc) { mem.products.abc = {}; }
                mem.products.abc.description = description;
            },
            async () => { 
                const changed = new Date();
                await db.ref('products/abc').update({ changed }); 
                if (!mem.products) { mem.products = {}; }
                if (!mem.products.abc) { mem.products.abc = {}; }
                mem.products.abc.changed = changed;                
            },
            async () => { 
                const product = { name: 'Product nr ' + Math.round(Math.random() * 100000), added: new Date() };
                const ref = await db.ref('products').push(product);
                if (!mem.products) { mem.products = {}; }
                mem.products[ref.key] = product;                
            },
            async () => { 
                const description = 'Changed description: ' + Math.random();
                await db.ref('products/def').update({ description });
                if (!mem.products) { mem.products = {}; }
                if (!mem.products.def) { mem.products.def = {}; }
                mem.products.def.description = description;                
            },
            async () => { 
                const changed = new Date();
                await db.ref('products/def').update({ changed });
                if (!mem.products) { mem.products = {}; }
                if (!mem.products.def) { mem.products.def = {}; }
                mem.products.def.changed = changed;
            },
            async () => {
                const users = ['ewout','john','pete','jack','kenny','jimi'];
                const lorem = "At vero eos et accusamus et iusto odio dignissimos ducimus qui blanditiis praesentium voluptatum deleniti atque corrupti quos dolores et quas molestias excepturi sint occaecati cupiditate non provident, similique sunt in culpa qui officia deserunt mollitia animi, id est laborum et dolorum fuga. Et harum quidem rerum facilis est et expedita distinctio. Nam libero tempore, cum soluta nobis est eligendi optio cumque nihil impedit quo minus id quod maxime placeat facere possimus, omnis voluptas assumenda est, omnis dolor repellendus. Temporibus autem quibusdam et aut officiis debitis aut rerum necessitatibus saepe eveniet ut et voluptates repudiandae sint et molestiae non recusandae. Itaque earum rerum hic tenetur a sapiente delectus, ut aut reiciendis voluptatibus maiores alias consequatur aut perferendis doloribus asperiores repellat.";
                const words = lorem.replace(/\./g, '').split(' ');
                const randomUser = () => {
                    return users[Math.floor(Math.random() * users.length)];
                }
                const randomText = (nrWords) => {
                    const arr = [];
                    for (let i = 0; i < nrWords; i++) {
                        let word = words[Math.floor(Math.random() * words.length)];
                        arr.push(word);
                    }
                    return arr.join(' ');
                }
                const post = {
                    posted: new Date(),
                    author: randomUser(),
                    title: randomText(5),
                    text: randomText(50)
                };
                const ref = await db.ref('posts').push(post);
                if (!mem.posts) { mem.posts = {}; }
                mem.posts[ref.key] = post;
            },
            async () => { 
                await db.ref('products').get();
            },
            // async () => { 
            //     await db.ref('').get(); 
            // },
            async () => { 
                const pulse = new Date();
                await db.root.update({ pulse });
                mem.pulse = pulse;
            },
            async () => {
                // Remove random product (but make sure the first 50 are not removed)
                const skip = 50 + Math.round(Math.random() * 50);
                const info = await db.ref('products').reflect('children', { limit: 1, skip });
                if (info.list.length === 0) { return; }
                const key = info.list[0].key;
                await db.ref('products').child(key).remove();
                delete mem.products[key];
            },
            async () => {
                const dbCount = await db.ref('products').count();
                const memCount = Object.keys(mem.products || {}).length;
                // if (dbCount !== memCount) {
                //     // debugger;
                //     console.error(`Expected a products count of ${memCount}, but got ${dbCount}`);
                // }
                expect(dbCount).toBe(memCount);
            },
            async () => {
                const dbCount = await db.ref('posts').count();
                const memCount = Object.keys(mem.posts || {}).length
                // if (dbCount !== memCount) {
                //     // debugger;
                //     console.error(`Expected a posts count of ${memCount}, but got ${dbCount}`);
                // }
                expect(dbCount).toBe(memCount);
            },
            async () => {
                // Transaction on 'stats'
                const now = new Date();
                await db.ref('stats').transaction(snap => {
                    const stats = snap.val() || { transactions: 0 };
                    stats.last_transaction = now;
                    stats.transactions++;
                    return stats;
                });
                if (!mem.stats) { mem.stats = { transactions: 0 }; }
                mem.stats.last_transaction = now;
                mem.stats.transactions++;
            }
        ];

        const testEquality = async () => {
            const snap = await db.root.get();
            expect(snap.val()).toEqual(mem);            
        };

        const replay = {
            enabled: false,
            actions: [],
            delays: []
        };
        const handleError = err => {
            console.error(err.message);
            console.log(`To replay, use following actions and delays`);
            console.log(replay);
            throw err;
        }
        const promises = [];
        for (let i = 0; i < 10000; i++) {
            if (i % 100 === 0) {
                await testEquality().catch(handleError);
            }
            const actionIndex = replay.enabled ? replay.actions[i] : Math.floor(Math.random() * actions.length);
            !replay.enabled && replay.actions.push(actionIndex);
            const nr = i;
            const p = actions[actionIndex]().catch(err => {
                console.error(`Error executing action nr ${nr} index ${actionIndex}:`, actions[actionIndex]);
                handleError(err);
            });
            promises.push(p);
            const ms = replay.enabled ? replay.delays[i] : Math.round(50 * Math.random());
            !replay.enabled && replay.delays.push(ms);
            if (ms > 10) {
                await new Promise(resolve => setTimeout(resolve, ms));
            }
        }

        await Promise.all(promises);

        await testEquality();

        await removeDB();
    }, 2147483647);
})