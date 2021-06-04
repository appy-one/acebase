// Test the new NodeTransaction class being developed
/// <reference types="@types/jasmine" />
const { TransactionManager, NodeLockIntention, NodeLockInfo } = require('../src/node-transaction')

describe('NodeTransaction (beta)', () => {

    const manager = new TransactionManager();
    // const transaction = await manager.createTransaction();
    // const writeLock = await transaction.lock('users/ewout/address', NodeLockIntention.OverwriteNode());
    // const readLock = await transaction.lock('users/ewout/address', NodeLockIntention.ReadValue());
    // writeLock.release(); // <!-- implement

    // it('manager', () => {
    //     describe('transaction', () => {
    //     })
    // })

    it ('should not allow conflicts', () => {

        // Using the following tree for tests:
        //
        // root
        // |- users
        // |    |- ewout
        // |    |    |- address
        // |    |    |    |- street
        // |    |    |    |- nr
        // |    |    |    |- city
        // |    |    |    |- state
        // |    |    |    |- country
        // |    |    |    |- collection
        // |    |    |    |    |- prop1
        // |    |    |    |    |- prop2
        // |    |    |    |    |- prop3
        // |    |- john
        // |    |    |- address
       
        // Test read/read: should never conflict
        const readValue = (path, filter) => ({ path, intention: NodeLockIntention.ReadValue(filter) });
        const readRootValue = readValue('');
        const readUsersValue = readValue('users');
        expect(manager.testConflict(readRootValue, readRootValue)).toEqual([false, false]);
        expect(manager.testConflict(readRootValue, readUsersValue)).toEqual([false, false]);
        expect(manager.testConflict(readUsersValue, readValue('users/ewout'))).toEqual([false, false]);
        expect(manager.testConflict(readValue('', { include: ['users'] }), readUsersValue)).toEqual([false, false]);

        // ReadInfo lock on node ""
        // Deny overwriting nodes "" and "users"
        const readInfo = (path) => ({ path, intention: NodeLockIntention.ReadInfo() });
        const setValue = (path) => ({ path, intention: NodeLockIntention.OverwriteNode() });
        const readRootInfo = readInfo('');
        expect(manager.testConflict(readRootInfo, setValue(''))).toEqual([true, true]);
        expect(manager.testConflict(readRootInfo, setValue('users'))).toEqual([true, true]);
        // Allow overwriting nodes "users/*" ("users/ewout", "users/ewout/address" etc)
        expect(manager.testConflict(readRootInfo, setValue('users/ewout'))).toEqual([false, false]);
        expect(manager.testConflict(readRootInfo, setValue('users/ewout/address'))).toEqual([false, false]);
        expect(manager.testConflict(readRootInfo, setValue('users/john'))).toEqual([false, false]);

        // ReadInfo lock on node ""
        // Deny updating node ""
        const updateValue = (path, keys) => ({ path, intention: NodeLockIntention.UpdateNode(keys) });
        expect(manager.testConflict(readRootInfo, updateValue('', ['users']))).toEqual([true, true]);
        // Allow updating nodes "users/*" ("users/ewout", "users/ewout/address" etc)
        expect(manager.testConflict(readRootInfo, updateValue('users', ['ewout']))).toEqual([false, false]);
        expect(manager.testConflict(readRootInfo, updateValue('users/ewout', ['address']))).toEqual([false, false]);
        expect(manager.testConflict(readRootInfo, updateValue('users/john', ['address']))).toEqual([false, false]);

        // ReadValue lock on node ""
        // Deny Overwriting nodes "", "users", "users/ewout"
        expect(manager.testConflict(readRootValue, setValue(''))).toEqual([true, true]);
        expect(manager.testConflict(readRootValue, setValue('users'))).toEqual([true, true]);
        expect(manager.testConflict(readRootValue, setValue('users/ewout'))).toEqual([true, true]);
        expect(manager.testConflict(readRootValue, setValue('users/ewout/address'))).toEqual([true, true]);
        expect(manager.testConflict(readRootValue, setValue('users/john'))).toEqual([true, true]);

        // ReadValue lock on node "users/ewout"
        // Deny Overwriting nodes "", "users", "users/ewout"
        const readEwout = readValue('users/ewout');
        expect(manager.testConflict(readEwout, setValue(''))).toEqual([true, true]);
        expect(manager.testConflict(readEwout, setValue('users'))).toEqual([true, true]);
        expect(manager.testConflict(readEwout, setValue('users/ewout'))).toEqual([true, true]);
        expect(manager.testConflict(readEwout, setValue('users/ewout/address'))).toEqual([true, true]);
        // Allow Overwriting nodes "users/john", "chats"
        expect(manager.testConflict(readEwout, setValue('users/john'))).toEqual([false, false]);
        expect(manager.testConflict(readEwout, setValue('users/john/address'))).toEqual([false, false]);
        expect(manager.testConflict(readEwout, setValue('chats'))).toEqual([false, false]);
        expect(manager.testConflict(readEwout, setValue('chats/chat1'))).toEqual([false, false]);

        // ReadValue lock on node "users/ewout" with include filter
        // Deny Overwriting nodes "", "users", "users/ewout", "users/ewout/address", "users/ewout/posts"
        const readEwout2 = readValue('users/ewout', { include: ['address','posts'] });
        expect(manager.testConflict(readEwout2, setValue(''))).toEqual([true, true]);
        expect(manager.testConflict(readEwout2, setValue('users'))).toEqual([true, true]);
        expect(manager.testConflict(readEwout2, setValue('users/ewout'))).toEqual([true, true]);
        expect(manager.testConflict(readEwout2, setValue('users/ewout/address'))).toEqual([true, true]);
        expect(manager.testConflict(readEwout2, setValue('users/ewout/address/city'))).toEqual([true, true]);
        expect(manager.testConflict(readEwout2, setValue('users/ewout/posts'))).toEqual([true, true]);
        expect(manager.testConflict(readEwout2, setValue('users/ewout/posts/post1'))).toEqual([true, true]);
        // Allow other account properties to be overwritten
        expect(manager.testConflict(readEwout2, setValue('users/ewout/email'))).toEqual([false, false]);
        expect(manager.testConflict(readEwout2, setValue('users/ewout/notes'))).toEqual([false, false]);
        expect(manager.testConflict(readEwout2, setValue('users/ewout/notes/note1'))).toEqual([false, false]);
        // Still allow Overwriting nodes "users/john", "chats"
        expect(manager.testConflict(readEwout2, setValue('users/john'))).toEqual([false, false]);
        expect(manager.testConflict(readEwout2, setValue('users/john/address'))).toEqual([false, false]);
        expect(manager.testConflict(readEwout2, setValue('chats'))).toEqual([false, false]);
        expect(manager.testConflict(readEwout2, setValue('chats/chat1'))).toEqual([false, false]);

        // ReadValue lock on node "users/ewout" with include filter
        // Deny Overwriting nodes "", "users", "users/ewout", "users/ewout/address", "users/ewout/posts"
        const readEwout3 = readValue('users/ewout', { exclude: ['notes','email'] });
        expect(manager.testConflict(readEwout3, setValue(''))).toEqual([true, true]);
        expect(manager.testConflict(readEwout3, setValue('users'))).toEqual([true, true]);
        expect(manager.testConflict(readEwout3, setValue('users/ewout'))).toEqual([true, true]);
        expect(manager.testConflict(readEwout3, setValue('users/ewout/address'))).toEqual([true, true]);
        expect(manager.testConflict(readEwout3, setValue('users/ewout/address/city'))).toEqual([true, true]);
        expect(manager.testConflict(readEwout3, setValue('users/ewout/posts'))).toEqual([true, true]);
        expect(manager.testConflict(readEwout3, setValue('users/ewout/posts/post1'))).toEqual([true, true]);
        // Allow excluded account properties to be overwritten
        expect(manager.testConflict(readEwout3, setValue('users/ewout/email'))).toEqual([false, false]);
        expect(manager.testConflict(readEwout3, setValue('users/ewout/notes'))).toEqual([false, false]);
        expect(manager.testConflict(readEwout3, setValue('users/ewout/notes/note1'))).toEqual([false, false]);
        // Still allow Overwriting nodes "users/john", "chats"
        expect(manager.testConflict(readEwout3, setValue('users/john'))).toEqual([false, false]);
        expect(manager.testConflict(readEwout3, setValue('users/john/address'))).toEqual([false, false]);
        expect(manager.testConflict(readEwout3, setValue('chats'))).toEqual([false, false]);
        expect(manager.testConflict(readEwout3, setValue('chats/chat1'))).toEqual([false, false]);

        // ReadValue lock on node "users/ewout" with include filter
        // Deny Overwriting nodes "", "users", "users/ewout", "users/ewout/address", "users/ewout/posts"
        const readEwout4 = readValue('users/ewout', { child_objects: false });
        expect(manager.testConflict(readEwout4, setValue(''))).toEqual([true, true]);
        expect(manager.testConflict(readEwout4, setValue('users'))).toEqual([true, true]);
        expect(manager.testConflict(readEwout4, setValue('users/ewout'))).toEqual([true, true]);
        expect(manager.testConflict(readEwout4, setValue('users/ewout/address'))).toEqual([true, true]);
        expect(manager.testConflict(readEwout4, setValue('users/ewout/posts'))).toEqual([true, true]);
        // Allow child properties of object children of "users/ewout" to be overwritten
        expect(manager.testConflict(readEwout4, setValue('users/ewout/address/city'))).toEqual([false, false]);
        expect(manager.testConflict(readEwout4, setValue('users/ewout/posts/post1'))).toEqual([false, false]);
        // Still allow Overwriting nodes "users/john", "chats"
        expect(manager.testConflict(readEwout4, setValue('users/john'))).toEqual([false, false]);
        expect(manager.testConflict(readEwout4, setValue('users/john/address'))).toEqual([false, false]);
        expect(manager.testConflict(readEwout4, setValue('chats'))).toEqual([false, false]);
        expect(manager.testConflict(readEwout4, setValue('chats/chat1'))).toEqual([false, false]);

        // Reverse test previous
        expect(manager.testConflict(setValue(''), readEwout4)).toEqual([true, true]);
        expect(manager.testConflict(setValue('users'), readEwout4)).toEqual([true, true]);
        expect(manager.testConflict(setValue('users/ewout'), readEwout4)).toEqual([true, true]);
        expect(manager.testConflict(setValue('users/ewout/address'), readEwout4)).toEqual([true, true]);
        expect(manager.testConflict(setValue('users/ewout/posts'), readEwout4)).toEqual([true, true]);
    });
})