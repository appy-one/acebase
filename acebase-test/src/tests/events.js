const { AceBase, DataReference, PathReference } = require('acebase');

/**
 * 
 * @param {AceBase} db
 * @param {string} path 
 * @param {string} type 
 * @param {number} nr
 * @returns {Promise<void>} returns a promise that resolves once the event has been fired on the reference nr of times
 */
function createEvent(db, path, type, nr) {
    let resolve, reject;
    const p = new Promise((rs, rj) => { resolve = rs; reject = rj; });
    //return new Promise((resolve, reject) => {
        let n = 0;
        const ref = db.ref(path);
        const subscription = ref.on(type).subscribe(snap => {
            n++;
            console.log(`${n}/${nr}: Event "${type}" fired on "/${ref.path}" with source path "/${snap.ref.path}" and data:`, snap.val())
            if (n === nr) { 
                subscription.stop(); // Stop subscription
                resolve(snap.val()); 
            }
        });
        if (nr === 0) {
            // Set a timeout for events that should not fire at all (nr === 0)
            // 1s timeout should be sufficient, unless you have breakpoints in your code (the timeout will fire before any potential event callback)
            setTimeout(() => {
                if (n === 0) { resolve(); }
                else {
                    reject(`This event should not have fired!`);
                }
            }, 1000);
        }
        else {
            setTimeout(() => {
                if (n < nr) {
                    console.warn(`Still waiting for event "${type}" on path "/${path}", only hit ${n}/${nr}`);
                }
            }, 1000);            
        }
    //});
    return p;
}

/**
 * 
 * @param {AceBase} db 
 */
const run = (db) => {

    // Initialize data
    return db.ref("events/welcome_august")
    .set({
        name: "Welcome August Party",
        location: "Amsterdam",
        start_date: new Date("2018/07/31 20:00"),
        end_date: new Date("2018/08/01 05:00"),
        venue: "Museumplein",
        tickets_total: 5000,
        tickets_sold: 3587,
        price: 25,
        price_currency: "EUR",
        line_up: {
            dj1: {
                name: "The first DJ",
                start_date: new Date("2018/07/31 20:00"),
                end_date: new Date("2018/07/31 21:00"),
                bio: new PathReference("events/djs/the_first_dj")
            },
            dj2: {
                name: "Second to None",
                start_date: new Date("2018/07/31 21:00"),
                start_date: new Date("2018/07/31 22:30"),
                bio: new PathReference("events/djs/second_to_none")
            },
            dj3: {
                name: "3 Strikes' Out",
                start_date: new Date("2018/07/31 22:30"),
                start_date: new Date("2018/08/01 00:00"),
                bio: new PathReference("events/djs/3_strikes_out")
            },
            dj4: {
                name: "The Night Shift",
                start_date: new Date("2018/07/31 00:00"),
                start_date: new Date("2018/08/01 03:00"),
                bio: new PathReference("events/djs/the_night_shift")                
            }
        }
    })
    .then(ref => {
        // Setup events
        const events = [
            createEvent(db, "", "child_changed", 1),
            createEvent(db, "events", "value", 1),
            createEvent(db, "events", "child_changed", 1),
            createEvent(db, "events/welcome_august", "value", 1),
            createEvent(db, "events/welcome_august", "child_changed", 1),
            createEvent(db, "events/welcome_august/name", "value", 1),
        ];

        // Fiddle with the data
        db.ref("events/welcome_august/name").update("Welcome August");

        // Wait for all events to have fired nr of times
        return Promise.all(events);
    })
    .then((results) => {
        // Try some more events
        const events = [
            createEvent(db, "", "child_changed", 1),
            createEvent(db, "events", "child_changed", 1),
            createEvent(db, "events/welcome_august", "child_changed", 1),
            createEvent(db, "events/welcome_august/line_up", "value", 1),
            createEvent(db, "events/welcome_august/line_up", "child_changed", 0),
            createEvent(db, "events/welcome_august/line_up", "child_added", 1),
            createEvent(db, "events/welcome_august/line_up", "child_removed", 0)
        ];

        // Fiddle with the data
        let dj5Ref = db.ref("events/welcome_august/line_up/dj5");
        dj5Ref.set({
            name: "Last BN Least",
            start_date: new Date("2018/07/31 03:00"),
            start_date: new Date("2018/08/01 05:00"),
            bio: new PathReference("events/djs/last_bn_least")
        })

        // Wait for all events to have fired nr of times
        return Promise.all(events).then(res => {
            return dj5Ref;
        });   
    })
    .then(djRef => {
        const events = [
            createEvent(db, "", "child_changed", 1),
            createEvent(db, "events", "child_changed", 1),
            createEvent(db, "events/welcome_august", "child_changed", 1),
            createEvent(db, "events/welcome_august/line_up", "value", 1),
            createEvent(db, "events/welcome_august/line_up", "child_changed", 0),
            createEvent(db, "events/welcome_august/line_up", "child_added", 0),
            createEvent(db, "events/welcome_august/line_up", "child_removed", 1)
        ];

        djRef.remove(); // Delete it again

        // Wait for all events to have fired nr of times
        return Promise.all(events).then(res => {
            return true;
        });
    });

};

module.exports = run;