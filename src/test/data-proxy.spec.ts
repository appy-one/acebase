import { createTempDB } from './tempdb';
import { proxyAccess, ObjectCollection, ILiveDataProxyValue } from 'acebase-core';
import * as Util from 'util';
const util: typeof Util = (Util as any).default ?? Util;

describe('DataProxy', () => {

    it('Proxy1', async() => {
        const { db, removeDB } = await createTempDB();

        // Use AceBase's own basic Observable shim because rxjs is not installed
        db.setObservable('shim');

        const delay = () => new Promise(resolve => setTimeout(resolve, 1000));

        const ref = db.ref('observable_chats/chat3');

        const proxy1 = await ref.proxy({
            defaultValue: {
                title: {
                    text: 'General chat',
                    updated_by: 'Ewout',
                    updated: new Date(),
                },
                created: new Date(),
                participants: [] as string[],
                messages: {} as Record<string, { from: string; text: string; read?: Date }> | undefined,
                removeMe: true as boolean | undefined,
            },
        });
        type ProxiedChat = ILiveDataProxyValue<typeof proxy1.value> & typeof proxy1.value;

        const proxy1Mutations = [] as any[];
        proxy1.on('mutation', (event) => {
            const { snapshot: snap, isRemote: remote } = event;
            // console.log(`[proxy1] chat was updated ${remote ? 'outside proxy' : 'by us'} at ${snap.ref.path}: `, { current: snap.val(), previous: snap.previous() });
            proxy1Mutations.push({ remote, path: snap.ref.path, val: snap.val(), prev: snap.previous(), context: snap.context() });
            // console.log(JSON.stringify(chat));
        });

        const proxy2 = await ref.proxy<typeof proxy1.value>();
        (proxy2.value as ProxiedChat).getObservable().subscribe((chat: any) => {
            console.log(`[proxy2] Got new observer value`, chat);
        });
        const proxy2Mutations = [] as any[];
        proxy2.on('mutation', (event) => {
            const { snapshot: snap, isRemote: remote } = event;
            // console.log(`[proxy2] chat was updated ${remote ? 'remotely' : 'by us'} at ${snap.ref.path}: `, { current: snap.val(), previous: snap.previous() });
            proxy2Mutations.push({ remote, path: snap.ref.path, val: snap.val(), prev: snap.previous(), context: snap.context() });
        });
        (proxy2.value as ProxiedChat).onChanged((value, previous, isRemote, context) => {
            console.log(`[proxy2] chat changed ${isRemote ? 'remotely' : 'by us'}`);
        });

        const chat = proxy1.value as ProxiedChat;
        type ProxiedParticipants = typeof proxy1.value.participants & ILiveDataProxyValue<typeof proxy1.value.participants>;
        type ProxiedMessages = typeof proxy1.value.messages & ILiveDataProxyValue<typeof proxy1.value.messages>;
        chat.messages = {};
        chat.title.text = 'Cool app chat';

        const tx = await chat.startTransaction();
        chat.title.text = 'Annoying chat';
        chat.title.updated_by = 'Pessimist';

        expect(chat.title.text).toBe('Annoying chat');
        expect(chat.title.updated_by).toBe('Pessimist');

        // Rollback!
        tx.rollback();

        // Values should have been rolled back:
        expect(chat.title.text).toBe('Cool app chat');
        expect(chat.title.updated_by).toBe('Ewout');

        chat.onChanged((value, previous, isRemote, context) => {
            console.log(`[proxy1] chat changed ${isRemote ? 'outside proxy' : 'by us'}`);
        });
        (chat.participants as ProxiedParticipants).onChanged((value, previous, isRemote, context) => {
            console.log(`[proxy1] participants changed`);
        });
        (chat.messages as ProxiedMessages).onChanged((value, previous, isRemote, context) => {
            console.log(`[proxy1] messages changed`);
        });

        chat.title = {
            text: 'Support chat',
            updated_by: 'Ewout',
            updated: new Date(),
        };

        await delay();

        chat.participants = ['Ewout', 'World'];
        // const participants = chat.participants;
        chat.participants[0] = 'Me';
        chat.participants[1] = 'You';
        chat.participants.push('Blue');
        chat.participants.splice(2, 0, 'True');

        // chat.messages = {};
        (chat.messages as ProxiedMessages).push({ from: 'Ewout', text: 'Hello world' });
        (chat.messages as ProxiedMessages).push({ from: 'World', text: 'Hello Ewout, how are you?' });
        (chat.messages as ProxiedMessages).push({ from: 'Ewout', text: 'Great! 🔥' });
        // chat.participants.push('Annet');

        delete chat.removeMe;

        await delay();
        expect(chat.participants[0]).toBe('Me');
        expect(chat.participants[1]).toBe('You');
        expect(chat.participants[2]).toBe('True');
        expect(chat.participants[3]).toBe('Blue');

        // Check array size
        expect((chat.messages as ProxiedMessages).toArray().length).toBe(3);

        // All messages must be a proxied values
        (chat.messages as ProxiedMessages).forEach(message => {
            expect(util.types.isProxy(message)).toBeTrue(); // Test with util.types
            expect((message as any)[Symbol('isProxy')]).toBeTrue(); // Test with isProxy Symbol
        });

        for (const p of chat.participants) {
            console.log(p);
        }
        for (const m of (chat.messages as ProxiedMessages) as unknown as Iterable<ProxiedMessages[string]>) {
            console.log(m.valueOf());
            m.read = new Date();
        }

        await delay();

        console.log((chat.messages as ProxiedMessages).getTarget());
        console.log((chat.messages as ProxiedMessages).getTarget(false));
        console.log(chat.messages.valueOf());
        console.log(chat.messages.toString());

        delete chat.messages;
        await delay();

        // expect(count).toBe(6);
        // Check receivedMutations
        console.log(proxy1Mutations);
        console.log(proxy2Mutations);

        await proxy1.destroy();
        await proxy2.destroy();

        removeDB();
    }, 60000);

    it('Proxy2', async() => {
        const { db, removeDB } = await createTempDB();

        const delay = () => new Promise(resolve => setTimeout(resolve, 1000));

        const ref = db.ref('proxy2');
        const proxy = await ref.proxy({
            defaultValue: {
                books: {} as ObjectCollection<{ title: string; description: string }>,
            },
        });
        type ProxiedBooks = typeof proxy.value.books & ILiveDataProxyValue<typeof proxy.value.books>;

        const mutations = [] as any[];
        proxy.on('mutation', (event) => {
            const { snapshot: snap, isRemote: remote } = event;
            mutations.push({ snap, remote, val: snap.val(), context: snap.context() });
            // console.log(`Mutation on "/${snap.ref.path}" with context: `, snap.context(), snap.val());
        });
        const obj = proxy.value;

        const book1 = { title: 'New book 1!', description: 'This is my first book' },
            book2 = { title: 'New book 2', description: 'This is my second book' },
            book3 = { title: 'New book 3', description: 'This is my third book' };

        // Add book through the proxy, considered a local mutation
        await (obj.books as ProxiedBooks).push(book1);

        // Add another book through a reference, considered a remote mutation
        await ref.child('books').push(book2);

        // Add another book through a reference achieved through proxy, also considered a remote mutation
        await (obj.books as ProxiedBooks).getRef().push(book3);

        await delay();

        expect(mutations.length).toEqual(3);
        expect(mutations[0].remote).toBeFalse();
        expect(mutations[0].val).toEqual(book1);
        expect(mutations[1].remote).toBeTrue();
        expect(mutations[1].val).toEqual(book2);
        expect(mutations[2].remote).toBeTrue();
        expect(mutations[2].val).toEqual(book3);

        removeDB();
    });

    it('Proxy3', async() => {
        // TODO: finish
        const { db, removeDB } = await createTempDB();

        // Use AceBase's own basic Observable shim because rxjs is not installed
        db.setObservable('shim');

        const movies = ObjectCollection.from(await import('./dataset/movies.json'));
        const proxy = await db.ref('movies').proxy({ defaultValue: movies });

        // Compare proxied value with original
        expect(proxy.value.valueOf()).toEqual(movies);

        // Make a change to a movie through the proxy
        const movieIDs = Object.keys(proxy.value);
        const aMovie = proxy.value[movieIDs[0]];

        removeDB();
    });

    it('OrderedCollectionProxy', async () => {
        const { db, removeDB } = await createTempDB();

        // Use AceBase's own basic Observable shim because rxjs is not installed
        db.setObservable('shim');

        type TodoItem = { text: string; order?: number };
        const proxy = await db.ref('todo').proxy({ defaultValue: {} as ObjectCollection<TodoItem> });
        const todo = proxyAccess(proxy.value);

        // Create transaction so we can monitor when changes have been persisted
        let tx = await todo.startTransaction();

        // Add some items to collection without sorting property
        todo.push({ text: 'Build' });
        todo.push({ text: 'Test' });
        todo.push({ text: 'Fix' });
        todo.push({ text: 'Release' });

        // Create object collection proxy with defaults
        const collection = todo.getOrderedCollection();
        const subscription = collection.getArrayObservable().subscribe(newArray => {
            console.log(`Got new array:`, newArray.map(item => `${item.order}: ${item.text}`));
        });

        // Make sure the default sorting property "order" has been added to each item
        let arr = collection.getArray();
        expect(arr.length).toBe(4);
        for (let i = 0; i < arr.length; i++) {
            const item = arr[i];
            expect(() => proxyAccess(item)).not.toThrow();
            expect(item.order).not.toBeUndefined();
            expect(item.order).toBe(i * 10);
        }

        await tx.commit();

        // Now create another one using collection.add
        tx = await todo.startTransaction();
        collection.add({ text: 'Update' });
        await tx.commit();
        arr = collection.getArray();
        expect(arr.length).toBe(5);
        expect(arr[4].text).toBe('Update');
        expect(arr[4].order).toBe(40);

        // Now swap items 'Release' & 'Update'
        tx = await todo.startTransaction();
        collection.move(4, 3);
        await tx.commit();
        arr = collection.getArray();
        expect(arr.length).toBe(5);
        expect(arr[3].text).toBe('Update');
        expect(arr[3].order).toBe(30);
        expect(arr[4].text).toBe('Release');
        expect(arr[4].order).toBe(40);

        // Now move 'Test' to the end
        tx = await todo.startTransaction();
        collection.move(1, 4);
        await tx.commit();
        arr = collection.getArray();
        expect(arr).toEqual([{ text: 'Build', order: 0 }, { text: 'Fix', order: 20 }, { text: 'Update', order: 30 }, { text: 'Release', order: 40 }, { text: 'Test', order: 50 } ]);

        // Now move 'Test' in between 'Fix' & 'Update'
        tx = await todo.startTransaction();
        collection.move(4, 2);
        await tx.commit();
        arr = collection.getArray();
        expect(arr).toEqual([{ text: 'Build', order: 0 }, { text: 'Fix', order: 20 }, { text: 'Test', order: 25 }, { text: 'Update', order: 30 }, { text: 'Release', order: 40 } ]);

        // Now move 'Fix' in between 'Test' & 'Update' (swaps 'Fix' and 'Test')
        tx = await todo.startTransaction();
        collection.move(1, 2);
        await tx.commit();
        arr = collection.getArray();
        expect(arr).toEqual([{ text: 'Build', order: 0 }, { text: 'Test', order: 20 }, { text: 'Fix', order: 25 }, { text: 'Update', order: 30 }, { text: 'Release', order: 40 } ]);

        // Move 'Release' in between 'Test' & 'Fix'
        tx = await todo.startTransaction();
        collection.move(4, 2);
        await tx.commit();
        arr = collection.getArray();
        expect(arr).toEqual([{ text: 'Build', order: 0 }, { text: 'Test', order: 20 }, { text: 'Release', order: 23 }, { text: 'Fix', order: 25 }, { text: 'Update', order: 30 } ]);

        // Insert 'Debug' between 'Release' and 'Fix'
        tx = await todo.startTransaction();
        collection.add({ text: 'Debug' }, 3);
        await tx.commit();
        arr = collection.getArray();
        expect(arr).toEqual([{ text: 'Build', order: 0 }, { text: 'Test', order: 20 }, { text: 'Release', order: 23 }, { text: 'Debug', order: 24 }, { text: 'Fix', order: 25 }, { text: 'Update', order: 30 } ]);

        // Insert 'Got Issue' between 'Release' and 'Debug'
        // This will trigger all orders to be regenerated - there is room for improvement here: order 23 could be set to 22, so the new item can get 23 instead.
        tx = await todo.startTransaction();
        collection.add({ text: 'Receive Issue' }, 3);
        await tx.commit();
        arr = collection.getArray();
        expect(arr).toEqual([{ text: 'Build', order: 0 }, { text: 'Test', order: 10 }, { text: 'Release', order: 20 }, { text: 'Receive Issue', order: 30 }, { text: 'Debug', order: 40 }, { text: 'Fix', order: 50 }, { text: 'Update', order: 60 } ]);

        // Remove items 1 at a time
        while (arr.length > 0) {
            tx = await todo.startTransaction();
            collection.delete(0);
            await tx.commit();
            const newArr = collection.getArray();
            expect(newArr.length).toBe(arr.length - 1);
            expect(newArr).toEqual(arr.slice(1));
            arr = newArr;
        }

        // Create multiple items
        tx = await todo.startTransaction();
        collection.add({ text: 'Build' });
        collection.add({ text: 'Release' });
        collection.add({ text: 'Update' });
        await tx.commit();
        arr = collection.getArray();
        expect(arr).toEqual([{ text: 'Build', order: 0 }, { text: 'Release', order: 10 }, { text: 'Update', order: 20 }]);

        // Prepend item
        tx = await todo.startTransaction();
        collection.add({ text: 'Think' }, 0);
        await tx.commit();
        arr = collection.getArray();
        expect(arr).toEqual([{ text: 'Think', order: -10 }, { text: 'Build', order: 0 }, { text: 'Release', order: 10 }, { text: 'Update', order: 20 }]);

        // Cleanup
        subscription.unsubscribe();
        removeDB();
    });

    it('proxy with cursor', async() => {
        const { db, removeDB } = await createTempDB({ transactionLogging: true });

        const delay = () => new Promise(resolve => setTimeout(resolve, 1000));

        const ref = db.ref('proxy');
        const proxy = await ref.proxy({
            defaultValue: {
                books: {} as ObjectCollection<{ title: string; description: string }>,
            },
        });

        const cursors = [] as string[];
        proxy.on('cursor', (cursor) => {
            console.log(`Got cursor ${cursor}`);
            cursors.push(cursor);
        });
        const obj = proxy.value;

        type ProxiedBooks = typeof proxy.value.books & ILiveDataProxyValue<typeof proxy.value.books>;
        const book1 = { title: 'New book 1!', description: 'This is my first book' },
            book2 = { title: 'New book 2', description: 'This is my second book' },
            book3 = { title: 'New book 3', description: 'This is my third book' };

        // Add book through the proxy, considered a local mutation
        await (obj.books as ProxiedBooks).push(book1);

        // Add another book through a reference, considered a remote mutation
        await ref.child('books').push(book2);

        // Add another book through a reference achieved through proxy, also considered a remote mutation
        await (obj.books as ProxiedBooks).getRef().push(book3);

        await delay();

        expect(cursors.length).toEqual(3);

        removeDB();
    });
});
