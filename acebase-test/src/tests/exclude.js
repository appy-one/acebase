const { AceBase } = require('acebase');
/**
 * 
 * @param {AceBase} db 
 */
const run = (db) => {

    return db.ref("chats/somechatid").set({
        members: ["ewout", "annet"],
        title: "Spouse chat",
        messages: {
            msg1: {
                sent: new Date("2018-06-19T13:02:09Z"),
                user: "ewout",
                text: "What time will you be home?",
                receipts: {
                    annet: {
                        received: new Date("2018-06-19T13:02:10Z"),
                        read: new Date("2018-06-19T13:03:54Z")
                    }
                } 
            },
            msg2: {
                sent: new Date("2018-06-19T13:05:09Z"),
                user: "annet",
                text: "Half an hour!",
                receipts: {
                    ewout: {
                        received: new Date("2018-06-19T13:05:09Z"),
                        read: new Date("2018-06-19T13:05:54Z")
                    }
                }
            },
            msg3: {
                sent: new Date("2018-06-19T13:06:01Z"),
                user: "ewout",
                text: "Awesome! 😘",
                receipts: {} 
            }
        }
    })
    .then(ref => {
        // Chat was saved, now get it again but exclude the messages
        return ref.get({ exclude: ["messages"] });
    })
    .then(snapshot => {
        const chat = snapshot.val();
        console.log(chat);
        console.assert(typeof chat.messages === "undefined", "retrieved chat should not include messages!");

        // Now get all chats without messages and members
        return db.ref("chats").get({ exclude: ["*/members", "*/messages"] });
    })
    .then(snapshot => {
        const chats = snapshot.val();
        console.log(chats);
        Object.keys(chats).forEach(id => {
            const chat = chats[id];
            console.assert(!chat.members && !chat.messages, "retrieved chat should NOT include members and messages!");
        });
        return db.root;
    })
    .then(rootRef => {
        // Now get the root node and combine include & exclude to only load chats, but without their messages
        return rootRef.get({ include: ["chats"], exclude: ["chats/*/messages"] });
    })
    .then(snapshot => {
        const root = snapshot.val();
        console.log(root);
        Object.keys(root).forEach(key => {
            console.assert(key === "chats", "retrieved root object should ONLY have .chats");
        });
        const chats = root.chats;
        Object.keys(chats).forEach(id => {
            const chat = chats[id];
            console.assert(!chat.messages, "retrieved chats should NOT include messages!");
        });        
    })
    ;
};

module.exports = run;