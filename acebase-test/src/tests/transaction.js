const { AceBase } = require('acebase');
/**
 * 
 * @param {AceBase} db 
 */
const run = (db) => {

    db.ref("accounts").on("child_changed").subscribe(snap => {
        console.log(`Account ${snap.key} changed, balance = ${snap.val().balance}`);
    });

    // Test serial transaction (1 followed by another when done)
    db.ref("accounts/sadfasdf75")
    .set({
        balance: 50
    })
    .then(ref => {
        return ref.transaction(snap => {
            let account = snap.val();
            account.balance -= 15;
            return account;
        });
    })
    .then(ref => {
        return ref.child("balance").transaction(snap => {
            let balance = snap.val();
            balance -= 10;
            return balance;
        });
    })
    .then(ref => {
        return ref.parent.get();
    })
    .then(snap => {
        let balance = snap.val().balance;
        console.assert(balance === 25, "balance must be 25");
        console.log(`Account balance was succesfully decreased to ${balance}`);
    });

    // Now test parallel transactions (3 executed at the same time)
    db.ref("accounts/fgyjtry345")
    .set({
        balance: 500
    })
    .then(ref => {
        const withdraw = (snapshot, amount) => {
            let account = snapshot.val();
            let currentBalance = account.balance;
            account.balance -= amount;
            if (account.balance < 0) {
                console.warn(`Insufficient funds to withdraw ${amount}, balance = ${currentBalance}`);
                return; // cancels this transaction
            }
            else {
                console.log(`Withdrew ${amount} from account, old balance = ${currentBalance}, new balance = ${account.balance}`);
            }
            return account;
        };

        // First one:
        let t1 = ref.transaction(snap => {
            return withdraw(snap, 100);
        });

        // Second one:
        let t2 = ref.transaction(snap => {
            return withdraw(snap, 275);
        });
        
        // Third one:
        let t3 = ref.transaction(snap => {
            return withdraw(snap, 450);
        });

        Promise.all([t1, t2, t3]).then(refs => { //, t2, t3
            console.log(`All transactions processed`);
            return ref.get()
        })
        .then(snap => {
            console.log(`Final balance = ${snap.val().balance}`);
        });

    });

}

module.exports = run;