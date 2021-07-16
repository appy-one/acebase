/// <reference types="@types/jasmine" />
const { createTempDB } = require("./tempdb");
const { proxyAccess, IObservableLike } = require('acebase-core');

describe('DataProxy', () => {
    it('OrderedCollectionProxy', async () => {
        const { db, removeDB } = await createTempDB();

        // Use AceBase's own basic Observable shim because rxjs is not installed
        db.setObservable('shim');

        const proxy = await db.ref('todo').proxy({});
        const todo = proxyAccess(proxy.value);

        // Create transaction so we can monitor when changes have been persisted
        let tx = await todo.startTransaction();

        // Add some items to collection without sorting property
        todo.push({ text: 'Build' });
        todo.push({ text: 'Test' });
        todo.push({ text: 'Fix' });
        todo.push({ text: 'Release' });

        // Create object collection proxy with defaults
        let collection = proxyAccess(todo).getOrderedCollection();
        let subscription = collection.getArrayObservable().subscribe(newArray => {
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
        expect(arr).toEqual([{ text: 'Build', order: 0 }, { text: 'Release', order: 10 }, { text: 'Update', order: 20 }])

        // Prepend item
        tx = await todo.startTransaction();
        collection.add({ text: 'Think' }, 0);
        await tx.commit();
        arr = collection.getArray();
        expect(arr).toEqual([{ text: 'Think', order: -10 }, { text: 'Build', order: 0 }, { text: 'Release', order: 10 }, { text: 'Update', order: 20 }])

        // Cleanup
        subscription.unsubscribe();
        removeDB();
    });
});