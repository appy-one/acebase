const { AceBase } = require('acebase');
/**
 * 
 * @param {AceBase} db 
 */
const run = (db) => {
    const users = ["pete", "anne", "john", "jane", "bill", "joe", "jack", "sue", "sophy"];
    const lorem = "At vero eos et accusamus et iusto odio dignissimos ducimus qui blanditiis praesentium voluptatum deleniti atque corrupti quos dolores et quas molestias excepturi sint occaecati cupiditate non provident, similique sunt in culpa qui officia deserunt mollitia animi, id est laborum et dolorum fuga. Et harum quidem rerum facilis est et expedita distinctio. Nam libero tempore, cum soluta nobis est eligendi optio cumque nihil impedit quo minus id quod maxime placeat facere possimus, omnis voluptas assumenda est, omnis dolor repellendus. Temporibus autem quibusdam et aut officiis debitis aut rerum necessitatibus saepe eveniet ut et voluptates repudiandae sint et molestiae non recusandae. Itaque earum rerum hic tenetur a sapiente delectus, ut aut reiciendis voluptatibus maiores alias consequatur aut perferendis doloribus asperiores repellat.";
    const words = lorem.replace(/\./g, "").split(" ");
    
    const randomUser = () => {
        return users[Math.floor(Math.random() * users.length)];
    }
    const randomText = (nrWords) => {
        const arr = [];
        for (let i = 0; i < nrWords; i++) {
            let word = words[Math.floor(Math.random() * words.length)];
            arr.push(word);
        }
        return arr.join(" ");
    }

    //return db.ref("posts").remove();

    let postKey;
    return db.indexes.create("posts", "posted")
    .then(() => {
        return db.ref("posts")
        .push({
            posted: new Date(),
            title: randomText(5),
            user: randomUser(),
            text: randomText(50),
            comments_nr: Math.floor(Math.random() * 50)
        });
    })
    .then(ref => {
        // ref points to the new post
        postKey = ref.key;
        return ref.parent
            .query()
            .where("posted", "<", new Date())
            .get();
    })
    .then(snapshots => {
        let posts = snapshots.map(snap => snap.val());
        let createdPost = snapshots.find(snap => snap.key === postKey);
        console.log(createdPost);
        console.assert(createdPost, "Newly created post must be in the query results");
    });
}

module.exports = run;
