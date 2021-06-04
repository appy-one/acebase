/// <reference types="@types/jasmine" />
const { createTempDB } = require('./tempdb');

describe('transactions', () => {

    it('can be canceled', async () => {
        const { db, removeDB } = await createTempDB();
        const ref = db.ref('accounts/my_account');

        // Try returning nothing to cancel transaction
        await ref.transaction(snap => {
            // Return nothing
        });
        let snap = await ref.get();
        expect(snap.exists()).toBeFalse();

        // Try with a promise that resolves without a value
        await ref.transaction(snap => {
            return Promise.resolve();
        });
        snap = await ref.get();
        expect(snap.exists()).toBeFalse();

        // Same as above using async
        await ref.transaction(async snap => {
            // Return nothing
        });
        snap = await ref.get();
        expect(snap.exists()).toBeFalse();        

        await removeDB();
    });

    it('can return promises', async () => {
        const { db, removeDB } = await createTempDB();
        const ref = db.ref('accounts/my_account');
        await ref.transaction(async snap => {
            await new Promise(resolve => setTimeout(resolve, 0));
            return { balance: 150 };
        });

        const snap = await ref.get();
        const account = snap.val();
        expect(account.balance).toEqual(150);

        await removeDB();
    });

    it('removes nodes when returning null', async () => {
        const { db, removeDB } = await createTempDB();
        const ref = db.ref('accounts/my_account');

        // Create node
        await ref.set({ balance: 500 });

        await ref.transaction(snap => {
            const account = snap.val();
            expect(account.balance).toEqual(500);
            return null;
        });
        let snap = await ref.get();
        expect(snap.exists()).toBeFalse();

        // Create node again
        await ref.set({ balance: 1000 });

        // With promise
        await ref.transaction(snap => {
            const account = snap.val();
            expect(account.balance).toEqual(1000);
            return Promise.resolve(null);
        });
        snap = await ref.get();
        expect(snap.exists()).toBeFalse();

        // Create node again
        await ref.set({ balance: 1500 });

        // With async
        await ref.transaction(async snap => {
            const account = snap.val();
            expect(account.balance).toEqual(1500);
            return null;
        });
        snap = await ref.get();
        expect(snap.exists()).toBeFalse();

        await removeDB();
    });

    it('can run in serial', async () => {
        
        // Create temp db
        const { db, removeDB } = await createTempDB();

        db.ref("accounts").on("child_changed").subscribe(snap => {
            console.log(`Account ${snap.key} changed, balance = ${snap.val().balance}`);
        });
    
        // Test serial transaction (1 followed by another when done)
        const ref = db.ref("accounts/my_account");
        
        // Initialize account value
        await ref.set({ balance: 50 });

        // Perform transaction on "account" node
        await ref.transaction(snap => {
            let account = snap.val();
            expect(account.balance).toEqual(50);
            account.balance -= 15;
            return account;
        });
        
        // Perform transaction on "account/balance" node
        const childRef = await ref.child("balance").transaction(snap => {
            let balance = snap.val();
            expect(balance).toEqual(35);
            balance -= 10;
            return balance;
        });
        
        // Assert the resolved ref points to the child node
        expect(childRef.path).toEqual(ref.child("balance").path);

        // Get "account" value through childRef.parent
        const snap = await childRef.parent.get();
        let balance = snap.val().balance;
        expect(balance).toEqual(25);

        // console.log(`Account balance was succesfully decreased to ${balance}`);

        // Remove temp db
        await removeDB();
    });

    it('can run in parallel', async () => {
        // Test 3 parallel transactions (executed at the same time)

        const { db, removeDB } = await createTempDB();

        const startBalance = 500;
        let expectedEndBalance = startBalance;
        const withdraw = (snapshot, amount) => {
            let account = snapshot.val();
            let currentBalance = account.balance;
            account.balance -= amount;
            if (account.balance < 0) {
                console.error(`Insufficient funds to withdraw ${amount} from ${ref.key}, balance = ${currentBalance}`);
                return; // cancels this transaction
            }
            else {
                expectedEndBalance -= amount;
                console.log(`Withdrew ${amount} from ${ref.key}, old balance = ${currentBalance}, new balance = ${account.balance}`);
            }
            return account;
        };

        const ref = db.ref("accounts/my_account");

        // Initialize account balance
        await ref.set({
            balance: startBalance
        });

        // First transaction:
        let t1 = ref.transaction(snap => {
            return withdraw(snap, 100);
        });

        // Second transaction:
        let t2 = ref.transaction(snap => {
            return withdraw(snap, 275);
        });
        
        // Third transaction:
        let t3 = ref.transaction(snap => {
            return withdraw(snap, 450);
        });

        // Wait until all transactions to be processed
        await Promise.all([t1, t2, t3]);

        // console.log(`All parallel transactions processed`);
        
        // Check final balance
        const snap = await ref.get();
        const balance = snap.val().balance;
        expect(balance).toEqual(expectedEndBalance);

        // console.log(`Final balance = ${snap.val().balance}`);

        await removeDB();
    });

    it('handles errors', async () => {
        const { db, removeDB } = await createTempDB();

        const ref = db.ref("accounts/my_account");
        await ref.set({
            balance: 50
        });

        // Test transaction throwing an error
        let promise = ref.transaction(snap => {
            throw new Error('Not enough money!');
        });
        await expectAsync(promise).toBeRejected();

        // Test transaction returning rejected promise
        promise = ref.child("balance").transaction(snap => {
            return Promise.reject(new Error(`Not enough money!`));
        });
        await expectAsync(promise).toBeRejected();

        // Test transaction with async error
        promise = ref.child("balance").transaction(async snap => {
            throw new Error(`Not enough money!`);
        });
        await expectAsync(promise).toBeRejected();
        
        // Nothing should have changed, check that
        const snap = await ref.get();
        let balance = snap.val().balance;
        expect(balance).toEqual(50); 
    
        await removeDB();
    });

    it('handles concurrency', async () => {
        // Similar to the parallel test
        // use 100 concurrent transactions to update a single value
        const { db, removeDB } = await createTempDB();

        const ref = await db.ref("value").set(0);
        const promises = [];
        for (let i = 0; i < 100; i++) {
            let p = ref.transaction(snap => {
                return snap.val() + 1;
            });
            promises.push(p);
        }
        await Promise.all(promises);

        const snap = await ref.get();
        expect(snap.val()).toEqual(100);

        await removeDB();
    })
})