<p align="center">
    <img src="https://github.com/appy-one/acebase/blob/master/logo.png?raw=true" alt="AceBase realtime database">
</p>

# AceBase realtime database

A fast, low memory, transactional, index & query enabled NoSQL database engine and server for node.js and browser with realtime data change notifications. Supports storing of JSON objects, arrays, numbers, strings, booleans, dates and binary (ArrayBuffer) data.

Inspired by (and largely compatible with) the Firebase realtime database, with additional functionality and less data sharding/duplication. Capable of storing up to 2^48 (281 trillion) object nodes in a binary database file that can theoretically grow to a max filesize of 8 petabytes.

AceBase is easy to set up and runs anywhere: in the cloud, NAS, local server, your PC/Mac, Raspberry Pi, the [browser](#running-acebase-in-the-browser), wherever you want.

🔥 Check out the new [live data proxy](#realtime-synchronization-with-a-live-data-proxy) feature that allows your app to use and update live database values using in-memory objects and **no additional db coding**!

## Table of contents

* [Getting started](#getting-started)
    * [Prerequisites](#prerequisites)
    * [Installing](#installing)
    * [Example usage](#example-usage)
    * [Creating a database](#creating-a-database)
* Loading and storing data
    * [Loading data](#loading-data)
    * [Storing data](#storing-data)
    * [Updating data](#updating-data)
    * [Transactional updating](#transactional-updating)
    * [Removing data](#removing-data)
    * [Generating unique keys](#generating-unique-keys)
    * [Using arrays](#using-arrays)
    * [Counting children](#counting-children)
    * [Limit nested data loading](#limit-nested-data-loading)
    * [Iterating (streaming) children](#iterating-streaming-children)
* Realtime monitoring
    * [Monitoring realtime data changes](#monitoring-realtime-data-changes)
    * [Using variables and wildcards in subscription paths](#using-variables-and-wildcards-in-subscription-paths)
    * [Notify only events](#notify-only-events)
    * [Wait for events to activate](#wait-for-events-to-activate)
    * [Get triggering context of events](#get-triggering-context-of-events)
    * [Change tracking using "mutated" and "mutations" events](#change-tracking-using-mutated-and-mutations-events)
    * [Observe realtime value changes](#observe-realtime-value-changes)
    * [Realtime synchronization with a live data proxy](#realtime-synchronization-with-a-live-data-proxy)
    * [Using proxy methods in Typescript](#using-proxy-methods-in-typescript)
* Queries
    * [Querying data](#querying-data)
    * [Limiting query result data](#limiting-query-result-data)
    * [Removing data with a query](#removing-data-with-a-query)
    * [Counting query results](#counting-query-results)
    * [Checking query result existence](#checking-query-result-existence)
    * [Streaming query results](#streaming-query-results)
    * [Realtime queries](#realtime-queries)
* Indexes
    * [Indexing data](#indexing-data)
    * [Indexing scattered data with wildcards](#indexing-scattered-data-with-wildcards)
    * [Include additional data in indexes](#include-additional-data-in-indexes)
    * [Other indexing options](#other-indexing-options)
    * [Special indexes](#special-indexes)
    * [Array indexes](#array-indexes)
    * [Fulltext indexes](#fulltext-indexes)
    * [Geo indexes](#geo-indexes)
* Schemas (NEW v1.3.0)
    * [Validating data with schemas](#schemas)
    * [Adding schemas to enforce data rules](#adding-schemas-to-enforce-data-rules)
    * [Schema Examples](#schema-examples)
* Class mappings (ORM)
    * [Mapping data to custom classes](#mapping-data-to-custom-classes)
* Data storage options
    * [AceBase data storage engine](#storage)
    * [Using SQLite or MSSQL storage](#using-a-sqllite-or-mssql-backend)
    * [AceBase in the browser](#running-acebase-in-the-browser)
    * [Using CustomStorage](#using-a-customstorage-backend)
* Reflect API
    * [Introduction](#reflect-api)
    * [Get information about a node](#get-information-about-a-node)
    * [Get children of a node](#get-children-of-a-node)
* Importing and Exporting data
    * [Export API usage](#export-api)
    * [Import API usage](#import-api)
* Transaction Logging
    * [Info](#transaction-logging)
* Multi-process support
    * [Info](#multi-process-support)
* [Upgrade notices](#upgrade-notices)
* [Known issues](#known-issues)
* [Authors](#authors)
* [Contributing](#contributing)
* [Sponsoring](#sponsoring)
## Getting Started

AceBase is split up into multiple packages:
* **acebase**: local AceBase database engine ([github](https://github.com/appy-one/acebase), [npm](https://www.npmjs.com/package/acebase))
* **acebase-server**: AceBase server endpoint to enable remote connections. Includes built-in user authentication and authorization, supports using external OAuth providers such as Facebook and Google ([github](https://github.com/appy-one/acebase-server), [npm](https://www.npmjs.com/package/acebase-server)).
* **acebase-client**: client to connect to an external AceBase server ([github](https://github.com/appy-one/acebase-client), [npm](https://www.npmjs.com/package/acebase-client))
* **acebase-core**: shared functionality, dependency of above packages ([github](https://github.com/appy-one/acebase-core), [npm](https://www.npmjs.com/package/acebase-core))

AceBase uses [semver](https://semver.org/) versioning to prevent breaking changes to impact older code.
Please report any errors / unexpected behaviour you encounter by creating an issue on Github.


### Prerequisites

AceBase is designed to run in a [Node.js](https://nodejs.org/) environment, as it (by default) requires the 'fs' filesystem to store its data and indexes. However, since v0.9.0 **it is now also possible to use AceBase databases in the browser**! To run AceBase in the browser, simply include 1 script file and you're good to go! See [AceBase in the browser](#running-acebase-in-the-browser) for more info and code samples!

### Installing

All AceBase repositories are available through npm. You only have to install one of them, depending on your needs:

### Create a local database
If you want to use a **local AceBase database** in your project, install the [acebase](https://github.com/appy-one/acebase) package.

```sh
npm install acebase
```
Then, create (open) your database:
```js
const { AceBase } = require('acebase');
const db = new AceBase('my_db'); // nodejs
// OR: const db = AceBase.WithIndexedDB('my_db'); // browser
db.ready(() => {
    // Do stuff
});
```

### Try AceBase in your browser

If you want to try out AceBase running in Node.js, simply open it in [RunKit](https://npm.runkit.com/acebase) and follow along with the examples. If you want to try out the browser version of AceBase, open [google.com](google.com) in a new tab (GitHub doesn't allow cross-site scripts to be loaded) and run the code snippet below to use it in your browser console immediately.

*To try AceBase in RunKit:*
```js
const { AceBase } = require('acebase');
const db = new AceBase('mydb');

await db.ref('test').set({ text: 'This is my first AceBase test in RunKit' });

const snap = await db.ref('test/text').get();
console.log(`value of "test/text": ` + snap.val());
```

*To try AceBase in the browser console:*
```js
await fetch('https://cdn.jsdelivr.net/npm/acebase@latest/dist/browser.min.js')
    .then(response => response.text())
    .then(text => eval(text));
if (!AceBase) { throw 'AceBase not loaded!'; }

var db = AceBase.WithIndexedDB('mydb');
await db.ref('test').set({ text: 'This is my first AceBase test in the browser' });

const snap = await db.ref('test/text').get();
console.log(`value of "test/text": ` + snap.val());
```

### Setup a database server
If you want to setup an **AceBase server**, install [acebase-server](https://github.com/appy-one/acebase-server).

```sh
npm install acebase-server
```
Then, start your server (`server.js`):
```js
const { AceBaseServer } = require('acebase-server');
const server = new AceBaseServer('my_server_db', { /* server config */ });
server.ready(() => {
    // Server running
});
```

### Connect to a remote database
If you want to connect to a remote (or local) AceBase server, install [acebase-client](https://github.com/appy-one/acebase-client).

```sh
npm install acebase-client
```
Then, connect to your AceBase server:
```js
const { AceBaseClient } = require('acebase-client');
const db = new AceBaseClient({ /* connection config */ });
db.ready(() => {
    // Connected!
});
```

## Example usage

The API is similar to that of the Firebase realtime database, with additions.

### Creating a database

Creating a new database is as simple as opening it. If the database file doesn't exists, it will be created automatically.

```javascript
const { AceBase } = require('acebase');
const options = { logLevel: 'log', storage: { path: '.' } }; // optional settings
const db = new AceBase('mydb', options);  // Creates or opens a database with name "mydb"

db.ready(() => {
    // database is ready to use!
})
```

NOTE: The `logLevel` option specifies how much info should be written to the console logs. Possible values are: `'verbose'`, `'log'` (default), `'warn'` and `'error'` (only errors are logged)

### Loading data

Run ```.get``` on a reference to get the currently stored value. This is short for the Firebase syntax of ```.once("value")```

```javascript
db.ref('game/config')
.get(snapshot => {
    if (snapshot.exists()) {
        config = snapshot.val();
    }
    else {
        config = new MyGameConfig(); // use defaults
    }
});
```

Note: When loading data, the currently stored value will be wrapped and returned in a ```DataSnapshot``` object. Use ```snapshot.exists()``` to determine if the node exists, ```snapshot.val()``` to get the value. 

### Storing data

Setting the value of a node, overwriting if it exists:

```javascript
db.ref('game/config')
.set({
    name: 'Name of the game',
    max_players: 10
})
.then(ref => {
    // stored at /game/config
})
```

Note: When storing data, it doesn't matter whether the target path, and/or parent paths exist already. If you store data in _'chats/somechatid/messages/msgid/receipts'_, it will create any nonexistent node in that path.

### Updating data

Updating the value of a node merges the stored value with the new object. If the target node doesn't exist, it will be created with the passed value.

```javascript
db.ref('game/config').update({
    description: 'The coolest game in the history of mankind'
})
.then(ref => {
    // config was updated, now get the value
    return ref.get(); // shorthand for firebase syntax ref.once("value")
})
.then(snapshot => {
    const config = snapshot.val();
    // config now has properties "name", "max_players" and "description"
});
```

### Transactional updating

If you want to update data based upon its current value, and you want to make sure the data is not changed in between your ```get``` and ```update```, use ```transaction```. A transaction gets the current value, runs your callback with a snapshot. The value you return from the callback will be used to overwrite the node with. Returning ```null``` will remove the entire node, returning ```undefined``` will cancel the transaction.

```javascript
db.ref('accounts/some_account')
.transaction(snapshot => {
    // some_account is locked until its new value is returned by this callback
    var account = snapshot.val();
    if (!snapshot.exists()) {
        // Create it
        account = {
            balance: 0
        };
    }
    account.balance *= 1.02;    // Add 2% interest
    return account; // accounts/some_account will be set to the return value
});
```

Note: ```transaction``` loads the value of a node including ALL child objects. If the node you want to run a transaction on has a large value (eg many nested child objects), you might want to run the transaction on a subnode instead. If that is not possible, consider structuring your data differently.

```javascript
// Run transaction on balance only, reduces amount of data being loaded, transferred, and overwritten
db.ref('accounts/some_account/balance')
.transaction(snapshot => {
    var balance = snapshot.val();
    if (balance === null) { // snapshot.exists() === false
        balance = 0;
    }
    return balance * 1.02;    // Add 2% interest
});
```

### Removing data

You can remove data with the ```remove``` method

```javascript
db.ref('animals/dog')
.remove()
.then(() => { /* removed successfully */ )};
```

Removing data can also be done by setting or updating its value to ```null```. Any property that has a null value will be removed from the parent object node.

```javascript
// Remove by setting it to null
db.ref('animals/dog')
.set(null)
.then(ref => { /* dog property removed */ )};

// Or, update its parent with a null value for 'dog' property
db.ref('animals')
.update({ dog: null })
.then(ref => { /* dog property removed */ )};
```

### Generating unique keys

For all generic data you add, you need to create keys that are unique and won't clash with keys generated by other clients. To do this, you can have unique keys generated with ```push```. Under the hood, ```push``` uses [cuid](https://www.npmjs.com/package/cuid) to generated keys that are guaranteed to be unique and time-sortable.

```javascript
db.ref('users')
.push({
    name: 'Ewout',
    country: 'The Netherlands'
})
.then(userRef => {
    // user is saved, userRef points to something 
    // like 'users/jld2cjxh0000qzrmn831i7rn'
};
```

The above example generates the unique key and stores the object immediately. You can also choose to have the key generated, but store the value later. 

```javascript
const postRef = db.ref('posts').push();
console.log(`About to add a new post with key "${postRef.key}"..`);
// ... do stuff ...
postRef.set({
    title: 'My first post'
})
.then(ref => {
    console.log(`Saved post "${postRef.key}"`);
};
```

**NOTE**: This approach is recommended if you want to add multitple new objects at once, because a single update performs way faster:

```javascript
const newMessages = {};
// We got messages from somewhere else (eg imported from file or other db)
messages.forEach(message => {
    const ref = db.ref('messages').push();
    newMessages[ref.key] = message;
})
console.log(`About to add multiple messages in 1 update operation`);
db.ref('messages').update(newMessages)
.then(ref => {
    console.log(`Added all messages at once`);
};
```

### Using arrays

AceBase supports storage of arrays, but there are some caveats when working with them. For instance, you cannot remove or insert items that are not at the end of the array. AceBase arrays work like a stack, you can add and remove from the top, not within. It is possible however to edit individual entries, or to overwrite the entire array. The safest way to edit arrays is with a ```transaction```, which requires all data to be loaded and stored again. In many cases, it is wiser to use object collections instead.

You can safely use arrays when:
* The number of items are small and finite, meaning you could estimate the typical average number of items in it.
* There is no need to retrieve/edit individual items using their stored path. If you reorder the items in an array, their paths change (eg from ```"playlist/songs[4]"``` to ```"playlist/songs[1]"```)
* The entries stored are small and do not have a lot of nested data (small strings or simple objects, eg: ```chat/members``` with user IDs array ```['ewout','john','pete']```)
* The collection does not need to be edited frequently.

Use object collections instead when:
* The collection keeps growing (eg: user generated content)
* The path of items are important and preferably not change, eg ```"playlist/songs[4]"``` might point to a different entry if the array is edited. When using an object collection, ```playlist/songs/jld2cjxh0000qzrmn831i7rn``` will always refer to that same item.
* The entries stored are large (eg large strings / blobs / objects with lots of nested data)
* You have to edit the collection frequently.

Having said that, here's how to safely work with arrays:
```javascript
// Store an array with 2 songs:
await db.ref('playlist/songs').set([
    { id: 13535, title: 'Daughters', artist: 'John Mayer' }, 
    { id: 22345,  title: 'Crazy', artist: 'Gnarls Barkley' }
]);

// Editing an array safely:
await db.ref('playlist/songs').transaction(snap => {
    const songs = snap.val();
    // songs is instanceof Array
    // Add a song:
    songs.push({ id: 7855, title: 'Formidable', artist: 'Stromae' });
    // Edit the second song:
    songs[1].title += ' (Live)';
    // Remove the first song:
    songs.splice(0, 1);
    // Store the edited array:
    return songs;
});
```

If you do not change the order of the entries in an array, it's safe to use them in referenced paths:

```js
// Update a single array entry:
await db.ref('playlist/songs[4]/title').set('Blue on Black');

// Or:
await db.ref('playlist/songs[4]').update({ title: 'Blue on Black') };

// Or:
await db.ref('playlist/songs').update({
    4: { title: 'Blue on Black', artist: 'Kenny Wayne Shepherd' }
})

// Get value of single array entry:
let snap = await db.ref('playlist/songs[2]').get();

// Get selected entries with an include filter (like you'd use with object collections)
let snap = await db.ref('playlist/songs').get({ include: [0, 5, 8] });
let songs = snap.val();
// NOTE: songs is instanceof PartialArray, which is an object with properties '0', '5', '8'
```

NOTE: you CANNOT use ```ref.push()``` to add entries to an array! `push` can only be used on object collections because it generates unique child IDs such as `"jpx0k53u0002ecr7s354c51l"` (which obviously is not a valid array index)

To summarize: ONLY use arrays if using an object collection seems like overkill, and be very cautious! Adding and removing items can only be done to/from the END of an array, unless you rewrite the entire array. That means you will have to know how many entries your array has up-front to be able to add new entries, which is not really desirable in most situations. If you feel the urge to use an array because the order of the entries are important for you or your app: consider using an object collection instead, and add an 'order' property to the entries to perform a sort on.

## Counting children

To quickly find out how many children a specific node has, use the ```count``` method on a ```DataReference```:

```javascript
const messageCount = await db.ref('chat/messages').count();
```

### Limit nested data loading  

If your database structure is using nesting (eg storing posts in ```'users/someuser/posts'``` instead of in ```'posts'```), you might want to limit the amount of data you are retrieving in most cases. Eg: if you want to get the details of a user, but don't want to load all nested data, you can explicitly limit the nested data retrieval by passing ```exclude```, ```include```, and/or ```child_objects``` options to ```.get```:

```javascript
// Exclude specific nested data:
db.ref('users/someuser')
.get({ exclude: ['posts', 'comments'] })
.then(snap => {
    // snapshot contains all properties of 'someuser' except 
    // 'users/someuser/posts' and 'users/someuser/comments'
});

// Include specific nested data:
db.ref('users/someuser/posts')
.get({ include: ['*/title', '*/posted'] })
.then(snap => {
    // snapshot contains all posts of 'someuser', but each post 
    // only contains 'title' and 'posted' properties
});

// Combine include & exclude:
db.ref('users/someuser')
.get({ exclude: ['comments'], include: ['posts/*/title'] })
.then(snap => {
    // snapshot contains all user data without the 'comments' collection, 
    // and each object in the 'posts' collection only contains a 'title' property.
});
```

**NOTE**: This enables you to do what Firebase can't: store your data in logical places, and only get the data you are interested in, fast! On top of that, you're even able to index your nested data and query it, even faster. See [Indexing data](#indexing-data) for more info.

### Iterating (streaming) children
(NEW since v1.4.0)

To iterate through all children of an object collection without loading all data into memory at once, you can use `forEach` which streams each child and executes a callback function with a snapshot of its data. If the callback function returns `false`, iteration will stop. If the callback returns a `Promise`, iteration will wait for it to resolve before loading the next child.

The children to iterate are determined at the start of the function. Because `forEach` does not read/write lock the collection, it is possible for the data to be changed while iterating. Children that are added while iterating will be ignored, removed children will be skipped.

It is also possible to selectively load data for each child, using the same options object available for `ref.get(options)`

Examples:
```js
// Stream all books one at a time (loads all data for each book):
await db.ref('books').forEach(bookSnapshot => {
   const book = bookSnapshot.val();
   console.log(`Got book "${book.title}": "${book.description}"`);
});

// Now do the same but only load 'title' and 'description' of each book:
await db.ref('books').forEach(
   { include: ['title', 'description'] }, 
   bookSnapshot => {
      const book = bookSnapshot.val();
      console.log(`Got book "${book.title}": "${book.description}"`);
   }
);
```

Also see [Streaming query results](#streaming-query-results)

## Monitoring realtime data changes

You can subscribe to data events to get realtime notifications as the monitored node is being changed. When connected to a remote AceBase server, the events will be pushed to clients through a websocket connection. Supported events are:  
- ```'value'```: triggered when a node's value changes (including changes to any child value)
- ```'child_added'```: triggered when a child node is added, callback contains a snapshot of the added child node
- ```'child_changed'```: triggered when a child node's value changed, callback contains a snapshot of the changed child node
- ```'child_removed'```: triggered when a child node is removed, callback contains a snapshot of the removed child node
- ```'mutated'```: (NEW v0.9.51) triggered when any nested property of a node changes, callback contains a snapshot and reference of the exact mutation.
- ```'mutations'```: (NEW v0.9.60) like ```'mutated'```, but fires with an array of all mutations caused by a single database update.
- ```'notify_*'```: notification only version of above events without data, see "Notify only events" below 

```javascript
// Using event callback
db.ref('users')
.on('child_added', userSnapshot => {
    // fires for all current children, 
    // and for each new user from then on
});
```

```javascript
// To be able to unsubscribe later:
function userAdded(userSnapshot) { /* ... */ }
db.ref('users').on('child_added', userAdded);
// Unsubscribe later with .off:
db.ref('users').off('child_added', userAdded);
```

AceBase uses the same ```.on``` and ```.off``` method signatures as Firebase, but also offers another way to subscribe to the events using the returned ```EventStream``` you can ```subscribe``` to. Having a subscription helps to easier unsubscribe from the events later. Additionally, ```subscribe``` callbacks only fire for future events by default, as opposed to the ```.on``` callback, which also fires for current values of events ```'value'``` and ```'child_added'```:

```javascript
// Using .subscribe
const addSubscription = db.ref('users')
.on('child_added')
.subscribe(newUserSnapshot => {
    // .subscribe only fires for new children from now on
});

const removeSubscription = db.ref('users')
.on('child_removed')
.subscribe(removedChildSnapshot => {
    // removedChildSnapshot contains the removed data
    // NOTE: snapshot.exists() will return false, 
    // and snapshot.val() contains the removed child value
});

const changesSubscription = db.ref('users')
.on('child_changed')
.subscribe(updatedUserSnapshot => {
    // Got new value for an updated user object
});

// Stopping all subscriptions later:
addSubscription.stop();
removeSubscription.stop();
changesSubscription.stop();
```

If you want to use ```.subscribe``` while also getting callbacks on existing data, pass ```true``` as the callback argument:
```javascript
db.ref('users/some_user')
.on('value', true) // passing true triggers .subscribe callback for current value as well
.subscribe(userSnapshot => {
    // Got current value (1st call), or new value (2nd+ call) for some_user
});
```

The ```EventStream``` returned by ```.on``` can also be used to ```subscribe``` more than once:

```javascript
const newPostStream = db.ref('posts').on('child_added');
const subscription1 = newPostStream.subscribe(childSnapshot => { /* do something */ });
const subscription2 = newPostStream.subscribe(childSnapshot => { /* do something else */ });
// To stop 1's subscription:
subscription1.stop(); 
// or, to stop all active subscriptions:
newPostStream.stop();
```

### Using variables and wildcards in subscription paths

It is also possible to subscribe to events using wildcards and variables in the path:
```javascript
// Using wildcards:
db.ref('users/*/posts')
.on('child_added')
.subscribe(snap => {
    // This will fire for every post added by any user,
    // so for our example .push this will be the result:
    // snap.ref.vars === { 0: "ewout" }
    const vars = snap.ref.vars;
    console.log(`New post added by user "${vars[0]}"`)
});
db.ref('users/ewout/posts').push({ title: 'new post' });

// Using named variables:
db.ref('users/$userid/posts/$postid/title')
.on('value')
.subscribe(snap => {
    // This will fire for every new or changed post title,
    // so for our example .push below this will be the result:
    // snap.ref.vars === { 0: "ewout", 1: "jpx0k53u0002ecr7s354c51l", userid: "ewout", postid: (...), $userid: (...), $postid: (...) }
    // The user id will be in vars[0], vars.userid and vars.$userid
    const title = snap.val();
    const vars = snap.ref.vars; // contains the variable values in path
    console.log(`The title of post ${vars.postid} by user ${vars.userid} was set to: "${title}"`);
});
db.ref('users/ewout/posts').push({ title: 'new post' });

// Or a combination:
db.ref('users/*/posts/$postid/title')
.on('value')
.subscribe(snap => {
    // snap.ref.vars === { 0: 'ewout', 1: "jpx0k53u0002ecr7s354c51l", postid: "jpx0k53u0002ecr7s354c51l", $postid: (...) }
});
db.ref('users/ewout/posts').push({ title: 'new post' });
```

### Notify only events

In additional to the events mentioned above, you can also subscribe to their ```notify_``` counterparts which do the same, but with a reference to the changed data instead of a snapshot. This is quite useful if you want to monitor changes, but are not interested in the actual values. Doing this also saves serverside resources, and results in less data being transferred from the server. Eg: ```notify_child_changed``` will run your callback with a reference to the changed node:

```javascript
ref.on('notify_child_changed', childRef => {
    console.log(`child "${childRef.key}" changed`);
})
```

### Wait for events to activate

In some situations, it is useful to wait for event handlers to be active before modifying data. For instance, if you want an event to fire for changes you are about to make, you have to make sure the subscription is active before performing the updates.
```javascript
var subscription = db.ref('users')
.on('child_added')
.subscribe(snap => { /*...*/ });

// Use activated promise
subscription.activated()
.then(() => {
    // We now know for sure the subscription is active,
    // adding a new user will trigger the .subscribe callback
    db.ref('users').push({ name: 'Ewout' });
})
.catch(err => {
    // Access to path denied by server?
    console.error(`Subscription canceled: ${err.message}`);
});
```

If you want to handle changes in the subscription state after it was activated (eg because server-side access rights have changed), provide a callback function to the ```activated``` call:
```javascript
subscription.activated((activated, cancelReason) => {
    if (!activated) {
        // Access to path denied by server?
        console.error(`Subscription canceled: ${cancelReason}`);
    }
});
```

### Get triggering context of events 
(NEW v0.9.51)

In some cases it is benificial to know what (and/or who) triggered a data event to fire, so you can choose what you want to do with data updates. It is now possible to pass context information with all `update`, `set`, `remove` , and `transaction` operations, which will be passed along to any event triggered on affected paths (on any connected client!)

Imagine the following situation: you have a document editor that allows multiple people to edit at the same time. When loading a document you update its `last_accessed` property:

```javascript
// Load document & subscribe to changes
db.ref('users/ewout/documents/some_id').on('value', snap => {
    // Document loaded, or changed. Display its contents
    const document = snap.val();
    displayDocument(document);
});

// Set last_accessed to current time
db.ref('users/ewout/documents/some_id').update({ last_accessed: new Date() })
```

This will trigger the `value` event TWICE, and cause the document to render TWICE. Additionally, if any other user opens the same document, it will be triggered again even though a redraw is not needed!

To prevent this, you can pass contextual info with the update:

```javascript
// Load document & subscribe to changes (context aware!)
db.ref('users/ewout/documents/some_id')
    .on('value', snap => {
        // Document loaded, or changed.
        const context = snap.context();
        if (context.redraw === false) {
            // No need to redraw!
            return;
        }
        // Display its contents
        const document = snap.val();
        displayDocument(document);
    });

// Set last_accessed to current time, with context
db.ref('users/ewout/documents/some_id')
    .context({ redraw: false }) // prevent redraws!
    .update({ last_accessed: new Date() })
```

### Change tracking using "mutated" and "mutations" events
(NEW v0.9.51)

These events are mainly used by AceBase behind the scenes to automatically update in-memory values with remote mutations. See [Observe realtime value changes](#observe-realtime-value-changes) and [Realtime synchronization with a live data proxy](#realtime-synchronization-with-a-live-data-proxy). It is possible to use these events yourself, but they require some additional plumbing, and you're probably better off using the methods mentioned above.

Having said that, here's how to use them: 

If we you want to monitor a specific node's value, but don't want to get its entire new value every time a small mutation is made to it, subscribe to the "mutated" event. This event is only fired with the target data actually being changed. This allows you to keep a cached copy of your data in memory (or cache db), and replicate all changes being made to it:

```javascript
const chatRef = db.ref('chats/chat_id');
// Get current value
const chat = (await chatRef.get()).val();

// Subscribe to mutated event
chatRef.on('mutated', snap => {
    const mutatedPath = snap.ref.path; // 'chats/chat_id/messages/message_id'
    const propertyTrail = 
        // ['messages', 'message_id']
        mutatedPath.slice(chatRef.path.length + 1).split('/');

    // Navigate to the in-memory chat property target:
    let targetObject = propertyTrail.slice(0,-1).reduce((target, prop) => target[prop], chat);
    // targetObject === chat.messages
    const targetProperty = propertyTrail.slice(-1)[0]; // The last item in array
    // targetProperty === 'message_id'

    // Update the value of our in-memory chat:
    const newValue = snap.val(); // { sender: 'Ewout', text: '...' }
    if (newValue === null) {
        // Remove it
        delete targetObject[targetProperty]; // delete chat.messages.message_id
    }
    else {
        // Set or update it
        targetObject[targetProperty] = newValue; // chat.messages.message_id = newValue
    }
});

// Add a new message to trigger above event handler
chatRef.child('messages').push({
    sender: 'Ewout'
    text: 'Sending you a message'
})
```

NOTE: if you are connected to a remote AceBase server and the connection was lost, it is important that you always get the latest value upon reconnecting because you might have missed mutation events.

The ```'mutations'``` event does the same as ```'mutated'```, but will be fired on the subscription path with an array of all mutations caused by a single database update. The best way to handle these mutations is by iterating them using ```snapshot.forEach```:

```javascript
chatRef.on('mutations', snap => {
    snap.forEach(mutationSnap => {
        handleMutation(mutationSnap);
    });
})
```

### Observe realtime value changes 
(NEW v0.9.51)

You can now observe the realtime value of a path, and (for example) bind it to your UI. ```ref.observe()``` returns a RxJS Observable that can be used to observe updates to this node and its children. It does not return snapshots, so you can bind the observable straight to your UI. The value being observed is updated internally using the "mutations" database event. All database mutations are automatically applied to the in-memory value, and trigger the observable to emit the new value.

```html
<!-- In your Angular view template: -->
<ng-container *ngIf="liveChat | async as chat">
   <h3>{{ chat.title }}</h3>
   <p>Chat was started by {{ chat.startedBy }}</p>
   <div class="messages">
    <Message *ngFor="let item of chat.messages | keyvalue" [message]="item.value"></Message>
   </div>
</ng-container>
```

_Note that to use Angular's ```*ngFor``` on an object collection, you have to use the ```keyvalue``` pipe._

```javascript
// In your Angular component:
ngOnInit() {
   this.liveChat = this.db.ref('chats/chat_id').observe();
}
```

Or, if you want to monitor updates yourself, handle the subscribe and unsubscribe:
```javascript
ngOnInit() {
   this.observer = this.db.ref('chats/chat_id').observe().subscribe(chat => {
      this.chat = chat;
   });
}
ngOnDestroy() {
   // DON'T forget to unsubscribe!
   this.observer.unsubscribe();
}
```

NOTE: objects returned in the observable are only updated downstream - any changes made locally won't be updated in the database. If that is what you would want to do... keep reading! (Spoiler alert - use ```proxy()```!)

### Realtime synchronization with a live data proxy 
(NEW v0.9.51)

You can now create a live data proxy for a given path. The data of the referenced path will be loaded, and kept in-sync with live data by listening for remote 'mutated' events, and immediately syncing back all changes you make to its value. This allows you to forget about data storage, and code as if you are only handling in-memory objects. Synchronization was never this easy!

Check out the following example:

```javascript
const proxy = await db.ref('chats/chat1').proxy();
const chat = proxy.value; // contains realtime chat value

// Make changes in memory, AND database (yes!)
chat.title = 'Changing the title in the database too!';
chat.members = ['Ewout'];
chat.members.push('John', 'Jack', 'Pete'); // Append to array
chat.messages.push({ // Push child to a collection (generates an ID for it!)
    from: 'Ewout', 
    message: 'I am changing the database without programming against it!' 
});
chat.messages.push({
    from: 'Pete', 
    message: 'Impressive dude' 
});
if (chat.members.includes('John') && !chat.title.startsWith('Hallo')) {
    chat.title = 'Hallo, is John May er?'; // Dutch joke
}
// Now that all synchronous updates above have taken place,
// AceBase will update the database automatically
```

All changes made above will be persisted to the database, and any changes made remotely will be automatically become available in the proxy object. The above code will result in the execution of 2 updates to the database, equivalent to below statements. **How awesome is that?!**

```javascript
// This is what is executed behind the scenes by above example:
db.ref('chats/chat1').update({
    title: 'Hallo, is John May er?', // Dutch joke
    members: ['Ewout','John','Jack','Pete']
});
db.ref('chats/chat1/messages').update({
    kh1x3ygb000120r7ipw6biln: {
        from: 'Ewout',
        message: 'I am changing the database without programming against it!'
    },
    kh1x3ygb000220r757ybpyec: {
        from: 'Pete',
        message: 'Impressive dude'
    }
});
```

To get a notification each time a mutation is made to the value, use ```proxy.onMutation(handler)```. To get notifications about any errors that might occur, use ```proxy.onError(handler)```:

```javascript
proxy.onError(err => {
    console.error(`Proxy error: ${err.message}`, err.details);
});
proxy.onMutation((mutationSnapshot, isRemoteChange) => {
    console.log(`Value of path "${mutationSnapshot.ref.path}" was mutated by ${isRemoteChange ? 'somebody else' : 'us' }`);
})
```

If you no longer need the proxy object, use ```proxy.destroy()``` to stop realtime updating. Don't forget this!

A number of additional methods are available to all proxied object values to make it possible to monitor specific properties being changed, get the actual target values, add children etc. See code below for more details:

```javascript
const proxy = await db.ref('chats/chat1').proxy();
if (!proxy.hasValue) {
    // If the proxied path currently does not have a value, create it now.
    proxy.value = {};
}
const chat = proxy.value;
```

**```forEach```**: iterate object collection
```javascript
chat.messages.forEach((message, key, index) => {
    // Fired for all messages in collection, or until returning false
});
```

**```for...of```**: iterate array or object collection's values, keys or entries (v1.2.0+)
```js
for (let message of chat.messages) {
    // Iterates with default .values iterator, same as:
    // for (let message of chat.messages.values())
}
for (let keys of chat.messages.keys()) {
    // All keys in the messages object collection
}
for (let [key, message] of chat.messages.entries()) {
    // Same as above
}
```

**```push```**: Add item to object collection with generated key
```javascript
const key = chat.messages.push({ text: 'New message' });
```

**```remove```**: delete a node
```javascript
chat.messages[key].remove();
chat.messages.someotherkey.remove();

// Note, you can also do this:
delete chat.messages.somemessage;
// Or this:
chat.messages.somemessage = null;
```

**```toArray```**: access an object collection like an array:
```javascript
const array = chat.messages.toArray();
```

**```toArray``` (with sort)**: like above, sorting the results:
```javascript
const sortedArray = chat.messages.toArray((a, b) => a.sent < b.sent ? -1 : 1);
```

**```valueOf```** (or **```getTarget```**): gets the underlying value (unproxied, be careful!)
```js
const message = chat.messages.message1.valueOf();
message.text = 'This does NOT update the database'; // Because it is not the proxied value
chat.messages.message1.text = 'This does'; // Just so you know
```

**```onChanged```**: registers a callback for the value that is called every time the underlying value changes:
```javascript
chat.messages.message1.onChanged((message, previous, isRemote, context) => {
    if (message.read) {
        // Show blue ticks
    }
    if (message.title !== previous.title && isRemote) {
        // Somebody changed the title 
        // (remote: not through this proxy instance)
    }
});
```

**```getRef```**: returns a DataReference instance to current target if you'd want or need to do stuff outside of the proxy's scope:
```javascript
const messageRef = chat.messages.message1.getRef();
// Eg: add an "old fashioned" event handler
messageRef.on('child_changed', snap => { /* .. */ });
// Or, if you need to know when an update is done
await messageRef.update({ read: new Date() });
```

**```getObservable```**: returns a RxJS Observable that is updated each time the underlying value changes:
```javascript
const observable = chat.messages.message1.getObservable();
const subscription = observable.subscribe(message => {
    if (message.read) {
        // Show blue ticks
    }
});
// Later:
subscription.unsubscribe();
```

**```startTransaction```**: (NEW v0.9.62) Enables you to make changes to the proxied value, but not writing them to the database until you want them to. This makes it possble to bind a proxy to an input form, and wait to save the changes until the user click 'Save', or rollback when canceling. Meanwhile, the value will still be updated with any remote changes.

```javascript
const proxy = await db.ref('contacts/ewout').proxy();
const contact = proxy.value; // NOTE: === null if node doesn't exist
const tx = await contact.startTransaction();

// Make some changes:
contact.name = 'Ewout Stortenbeker'; // Was 'Ewout'
contact.email = 'ewout@appy.one'; // Was 'me@appy.one'

async function save() {
    await tx.commit();
    console.log('Contact details updated');
}

function rollback() {
    tx.rollback();
    // contact.name === 'Ewout'
    // contact.email === 'me@appy.one'
    console.log('All changes made were rolled back');
}
```
Once ```tx.commit()``` is called, all pending updates will be processed and saved to the database. When ```tx.rollback()``` is called, all changes made to the proxied object will be reverted and no further action is taken.

### Using proxy methods in Typescript

In TypeScript some additional typecasting is needed to access proxy methods shown above. You can use the ```proxyAccess``` function to get help with that. This function typecasts and also checks if your passed value is indeed a proxy.
```typescript
type ChatMessage = { from: string, text: string, sent: Date, received: Date, read: Date };
type MessageCollection = IObjectCollection<ChatMessage>;

// Easy & safe typecasting:
proxyAccess<MessageCollection>(chat.messages)
    .getObservable()
    .subscribe(messages => {
        // No need to define type of messages, TS knows it is a MessageCollection
    });

// Instead of:
(chat.messages as any as ILiveDataProxyValue<MessageCollection>)
    .getObservable()
    .subscribe(messages => {
        // messages: MessageCollection
    });

// Or, with unsafe typecasting (discouraged!)
(chat.messages as any)
    .getObservable()
    .subscribe((messages: MessageCollection) => {
        // messages: MessageCollection, but only because we've prevented typescript
        // from checking if the taken route to get here was ok.
        // If getObservable or subscribe method signatures change in the 
        // future, code will break without typescript knowing it!
    });
```

With Angular, ```getObservable``` comes in handy for UI binding and updating:

```typescript
@Component({
  selector: 'chat-messages',
  template: `<ng-container *ngIf="liveChat | async as chat">
    <h1>{{ chat.title }}</h1>
    <Message *ngFor="let item of chat.messages | keyvalue" [message]="item.value" />
    </ng-container>`
})
export class ChatComponent {
    liveChat: Observable<{ 
        title: string, 
        messages: IObjectCollection<{ from: string, text: string }> 
    }>;

    constructor(private dataProvider: MyDataProvider) {}

    async ngOnInit() {
        const proxy = await this.dataProvider.db.ref('chats/chat1').proxy();
        this.liveChat = proxyAccess(proxy.value).getObservable();
    }
}
```

For completeness of above example, ```MyDataProvider``` would look something like this:
```typescript
import { AceBase } from 'acebase';
@Injectable({
    providedIn: 'root'
})
export class MyDataProvider {
    db: AceBase;
    constructor() {
        this.db = new AceBase('chats');
    }
}
```

I'll leave up to your imagination what the ```MessageComponent``` would look like.

## Querying data

When running a query, all child nodes of the referenced path will be matched against your set criteria and returned in any requested `sort` order. Pagination of results is also supported, so you can `skip` and `take` any number of results. Queries do not require data to be indexed, although this is recommended if your data becomes larger.

To filter results, multiple `filter(key, operator, compare)` statements can be added. The filtered results must match all conditions set (logical AND). Supported query operators are:
- `'<'`: value must be smaller than `compare`
- `'<='`: value must be smaller or equal to `compare`
- `'=='`: value must be equal to `compare`
- `'!='`: value must not be equal to `compare`
- `'>'`: value must be greater than `compare`
- `'>='`: value must be greater or equal to `compare`
- `'exists'`: `key` must exist
- `'!exists'`: `key` must not exist
- `'between'`: value must be between the 2 values in `compare` array (`compare[0]` <= value <= `compare[1]`). If `compare[0] > compare[1]`, their values will be swapped
- `'!between'`: value must not be between the 2 values in `compare` array (value < `compare[0]` or value > `compare[1]`). If `compare[0] > compare[1]`, their values will be swapped
- `'like'`: value must be a string and must match the given pattern `compare`. Patterns are case-insensitive and can contain wildcards _*_ for 0 or more characters, and _?_ for 1 character. (pattern `"Th?"` matches `"The"`, not `"That"`; pattern `"Th*"` matches `"the"` and `"That"`)
- `'!like'`: value must be a string and must not match the given pattern `compare`
- `'matches'`: value must be a string and must match the regular expression `compare`
- `'!matches'`: value must be a string and must not match the regular expression `compare`
- `'in'`: value must be equal to one of the values in `compare` array
- `'!in'`: value must not be equal to any value in `compare` array
- `'has'`: value must be an object, and it must have property `compare`.
- `'!has'`: value must be an object, and it must not have property `compare`
- `'contains'`: value must be an array and it must contain a value equal to `compare`, or contain all of the values in `compare` array
- `'!contains'`: value must be an array and it must not contain a value equal to `compare`, or not contain any of the values in `compare` array

NOTE: A query does not require any `filter` criteria, you can also use a `query` to paginate your data using `skip`, `take` and `sort`. If you don't specify any of these, AceBase will use `.take(100)` as default. If you do not specify a `sort`, the order of the returned values can vary between executions.

```javascript
db.query('songs')
.filter('year', 'between', [1975, 2000])
.filter('title', 'matches', /love/i)  // Songs with love in the title
.take(50)                   // limit to 50 results
.skip(100)                  // skip first 100 results
.sort('rating', false)      // highest rating first
.sort('title')              // order by title ascending
.get(snapshots => {
    // ...
});
```

To quickly convert a snapshots array to the values it encapsulates, you can call `snapshots.getValues()`. This is a convenience method and comes in handy if you are not interested in the results' paths or keys. You can also do it yourself with `var values = snapshots.map(snap => snap.val())`:
```javascript
db.query('songs')
.filter('year', '>=', 2018)
.get(snapshots => {
    const songs = snapshots.getValues();
});
```

Instead of using the callback of `.get`, you can also use the returned `Promise` which is very useful in promise chains:
```javascript
// ... in some promise chain
.then(fromYear => {
    return db.query('songs')
    .filter('year', '>=', fromYear)
    .get();
})
.then(snapshots => {
    // Got snapshots from returned promise
})
```

This also enables using ES6 `async` / `await`:
```javascript
const snapshots = await db.query('songs')
    .filter('year', '>=', fromYear)
    .get();
```

### Limiting query result data

By default, queries will return snapshots of the matched nodes, but you can also get references only by passing the option `{ snapshots: false }` or use the new `.find()` method.

```javascript
// ...
const references = await db.query('songs')
    .filter('genre', 'contains', 'rock')
    .get({ snapshots: false });

// now we have references only, so we can decide what data to load

```
Using the new `find()` method does the same (v1.10.0+):

```javascript
const references = await db.query('songs')
    .filter('genre', 'contains', 'blues')
    .find();
```

If you do want your query results to include some (but not all) data, you can use the `include` and `exclude` options to filter the fields in the query results returned by `get`:

```javascript
const snapshots = await db.query('songs')
    .filter('title', 'like', 'Love*')
    .get({ include: ['title', 'artist'] });
```

The snapshots in the example above will only contain each matching song's _title_ and _artist_ fields. See [Limit nested data loading](#limit-nested-data-loading) for more info about `include` and `exclude` filters.

### Removing data with a query

To remove all nodes that match a query, simply call ```remove``` instead of ```get```:
```javascript
db.query('songs')
    .filter('year', '<', 1950)
    .remove(() => {
        // Old junk gone
    }); 

// Or, with await
await db.query('songs')
    .filter('year', '<', 1950)
    .remove();
```

### Counting query results
(NEW since v1.10.0)

To get a quick count of query results, you can use `.count()`:

```javascript
const count = await db.query('songs')
    .filter('artist', '==', 'John Mayer')
    .count();
```

You can use this in combination with `skip` and `limit` to check if there are results beyond a currently loaded dataset:

```javascript
const nextPageSongsCount = await db.query('songs')
    .filter('artist', '==', 'John Mayer')
    .skip(100)
    .take(10)
    .count(); // 10: full page, <10: last page.
```

NOTE: This method currently performs a count on results returned by `.find()` behind the scenes, this will be optimized in a future version.

### Checking query result existence
(NEW since v1.10.0)

To quickly determine if a query has any matches, you can use `.exists()`:

```javascript
const exists = await db.query('users')
    .filter('email', '==', 'me@appy.one')
    .exists();
```

Just like `count()`, you can also combine this with `skip` and `limit`.

NOTE: This method currently performs a check on the result returned by `.count()` behind the scenes, this will be optimized in a future version.

### Streaming query results
(NEW since v1.4.0)

To iterate through the results of a query without loading all data into memory at once, you can use `forEach` which streams each child and executes a callback function with a snapshot of its data. If the callback function returns `false`, iteration will stop. If the callback returns a `Promise`, iteration will wait for it to resolve before loading the next child.

The query will be executed at the start of the function, retrieving references to all matching children (not their values). After this, `forEach` will load their values one at a time. It is possible for the underlying data to be changed while iterating. Matching children that were removed while iterating will be skipped. Children that had any of the filtered properties changed after initial results were populated might not match the query anymore, this is not checked.

It is also possible to selectively load data for each child, using the same options object available for `query.get(options)`.

Example:
```js
// Query books, streaming the results one at a time:
await db.query('books')
 .filter('category', '==', 'cooking')
 .forEach(bookSnapshot => {
    const book = bookSnapshot.val();
    console.log(`Found cooking book "${book.title}": "${book.description}"`);
 });

// Now only load book properties 'title' and 'description'
await db.query('books')
 .filter('category', '==', 'cooking')
 .forEach(
   { include: ['title', 'description'] },
   bookSnapshot => {
      const book = bookSnapshot.val();
      console.log(`Found cooking book "${book.title}": "${book.description}"`);
   }
);
```

Also see [Iterating (streaming) children](#iterating-streaming-children)

### Realtime queries 
(NEW 0.9.9, alpha)

AceBase now supports realtime (live) queries and is able to send notifications when there are changes to the initial query results

```javascript
let fiveStarBooks = {}; // maps keys to book values
function gotMatches(snaps) {
    snaps.forEach(snap => {
        fiveStarBooks[snap.key] = snap.val();
    });
}
function matchAdded(match) {
    // add book to results
    fiveStarBooks[match.snapshot.key] = match.snapshot.val();
}
function matchChanged(match) {
    // update book details
    fiveStarBooks[match.snapshot.key] = match.snapshot.val();
}
function matchRemoved(match) {
    // remove book from results
    delete fiveStarBooks[match.ref.key];
}

db.query('books')
    .filter('rating', '==', 5)
    .on('add', matchAdded)
    .on('change', matchChanged)
    .on('remove', matchRemoved)
    .get(gotMatches)
```

NOTE: Usage of ```take``` and ```skip``` are currently not taken into consideration, events might fire for results that are not in the requested range.

## Indexing data

Indexing data will dramatically improve the speed of queries on your data, especially as it increases in size. Any indexes you create will be updated automatically when underlying data is changed, added or removed. Indexes are used to speed up filters and sorts, and to limit the amount of results. NOTE: If you are connected to an external AceBase server (using ```AceBaseClient```), indexes can only be created if you are signed in as the *admin* user.

```javascript
Promise.all([
    // creates indexes if they don't exist
    db.indexes.create('songs', 'year'),
    db.indexes.create('songs', 'genre')
])
.then(() => {
    return db.query('songs')
    .filter('year', '==', 2010) // uses the index on year
    .filter('genre', 'in', ['jazz','rock','blues']) // uses the index on genre
    .get();
})
.then(snapshots => {
    console.log(`Got ${snapshots.length} songs`);
});
```

### Indexing scattered data with wildcards

Because nesting data is recommended in AceBase (as opposed to Firebase that discourages this), you are able to index and query data that is scattered accross your database in a structered manner. For example, you might want to store ```posts``` for each ```user``` in their own user node, and index (and query) all posts by any user:

```javascript
db.indexes.create('users/*/posts', 'date') // Index date of any post by any user
.then(() => {
    let now = new Date();
    let today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return db.query('users/*/posts') // query with the same wildcard
    .filter('date', '>=', today)
    .get();
})
.then(postSnapshots => {
    // Got all today's posts, of all users
});
```

**NOTE**: Wildcard queries always require an index - they will not execute if there is no corresponding index.

<a name="include-additional-data-in-indexes"></a>
### Include additional data in indexes

If your query uses filters on multiple keys you could create separate indexes on each key, but you can also include that data into a single index. This will speed up queries even more in most cases:

```javascript
db.indexes.create('songs', 'year', { include: ['genre'] })
.then(() => {
    return db.query('songs')
    .filter('year', '==', 2010) // uses the index on year
    .filter('genre', 'in', ['jazz','rock','blues']) // filters indexed results of year filter: FAST!
    .get();
})
.then(snapshots => {
    // ...
});
```

If you are filtering data on one key, and are sorting on another key, it is highly recommended to include the ```sort``` key in your index on the ```filter``` key, because this will greatly increase sorting performance:

```javascript
db.indexes.create('songs', 'title', { include: ['year', 'genre'] })
.then(() => {
    return db.query('songs')
    .filter('title', 'like', 'Love *') // queries the index
    .sort('genre')  // sorts indexed results: FAST!
    .sort('title')  // sorts indexed results: FAST!
    .get();
})
.then(snapshots => {
    // ...
});
```

### Other indexing options

In addition to the `include` option described above, you can specify the following options:

 * `caseSensitive`: boolean that specifies whether texts should be indexed using case sensitivity. Setting this to `true` will cause words with mixed casings (eg `"word"`, `"Word"` and `"WORD"`) to be indexed separately. Default is `false`.
 * `textLocale`: string that specifies the default locale of the indexed texts. Should be a 2-character language code such as `"en"` for English and `"nl"` for Dutch, or an LCID string for country specific locales such as `"en-us"` for American English, `"en-gb"` for British English etc.
 * `textLocaleKey`: string that specifies a key in the source data that contains the locale to use instead of the default specified in `textLocale`

### Special indexes

Normal indexes are able to index ```string```, ```number```, ```Date```, ```boolean``` and ```undefined``` (non-existent) values. To index other data, you have to create a special index. Currently supported special indexes are: **Array**, **FullText** and **Geo** indexes.

### Array indexes

Use Array indexes to dramatically improve the speed of ```"contains"``` filters on array values.
Consider the following data structure:

```javascript
chats: {
    chat1: {
        members: ['ewout','john','pete','jack'],
        // ...
    }
}
```

By adding an index to the ```members``` key, this will speed up queries to get all chats a specific user is in.

```javascript
db.indexes.create('chats', 'members', { type: 'array' });
.then(() => {
    return db.query('chats')
    .filter('members', 'contains', 'ewout'); // also possible without index, but now way faster
    .get()
})
.then(snapshots => {
    // Got all chats with ewout
})
```

By supplying an array to the filter, you can get all chats that have all of the supplied users:
```javascript
db.query('chats')
.filter('members', 'contains', ['ewout', 'jack']);
.get(snapshots => {
    // Got all chats with ewout AND jack
})
```
Using ```!contains``` you can check which chats do not involve 1 or more users:
```javascript
db.query('chats')
.filter('members', '!contains', ['ewout', 'jack']);
.get(snapshots => {
    // Got all chats without ewout and/or jack
})
```

### Fulltext indexes

A fulltext index will index all individual words and their relative positions in string nodes. A normal index on text nodes is only capable of searching for exact matches quickly, or proximate like/regexp matches by scanning through the index. A fulltext index makes it possible to quickly find text nodes that contain multiple words, a selection of words or parts of them, in any order in the text.

```javascript
db.indexes.create('chats/*/messages', 'text', { type: 'fulltext' });
.then(() => {
    return db.query('chats/*/messages')
    .filter('text', 'fulltext:contains', `confidential OR secret OR "don't tell"`); // not possible without fulltext index
    .get()
})
.then(snapshots => {
    // Got all confidential messages
})
```

Fulltext indexes support *whitelisting*, *blacklisting*, manual word *stemming* and *filtering*, and using different *locales*. All indexed words are stored *"unidecoded"*: all unicode characters are translated into ascii characters so they become searchable in both ways. Eg: Japanese "AceBaseはクールです" is indexed as "acebase wa kurudesu" and will be found with queries on both "クール", "kūru" and "kuru".

You can define these additional settings using the the `config` property in the options parameter passed to the `indexes.create` method:

#### `transform`
Callback function that transforms (and/or filters) words being indexed *and* queried.

```js
db.indexes.create('chats/*/messages', 'text', { 
    type: 'fulltext', 
    config: { 
        transform: function(locale, word) {
            // Correct misspelled words:
            if (word === 'mispeled') { return 'misspelled'; } 

            // Do not index a specific word:
            if (word === 'secret') { return null; }

            // Word stemming:
            if (['fishing','fished','fisher'].includes(word)) { return 'fish'; }

            // Consider multiple locales to allow multilingual query results:
            if (locale === 'nl') {
                // Word being indexed or queried is Dutch, index and query in English
                // Also see localeKey setting for more info
                return dutchToEnglish(word);
            }

            // Or, keep the word as it is:
            return word;
        } 
    } 
});
```

#### `blacklist`
Also known as a *stoplist*. Array of words to automatically be ignored for indexing and querying. 

```javascript
db.indexes.create('chats/*/messages', 'text', { 
    type: 'fulltext', 
    config: { 
        blacklist: ['a','the','on','at'] // these words won't be indexed and ignored in queries
    }
}
```

#### `whitelist`
Words to be included if they did not match `minLength` and/or `blacklist` criteria:

```javascript
db.indexes.create('chats/*/messages', 'text', { 
    type: 'fulltext', 
    config: { 
        minLength: 3,
        whitelist: ['ok'] // allow "ok" although it's only 2 characters
    }
}
```

#### `minLength` and `maxLength`
Only use words with a minimum and/or maximum length:
```javascript
db.indexes.create('chats/*/messages', 'text', { 
    type: 'fulltext', 
    config: { 
        minLength: 3,   // Ignore small words
        maxLength: 20   // Ignore large words
    }
}
```
#### `localeKey`
Specify a key in the data that contains the locale of the indexed texts. This allows multiple languages to be indexed using their own rules.

Imagine the following the dataset:
```json
{
    "love": {
        "item1": {
            "text": "I love AceBase",
            "locale": "en"
        },
        "item2": {
            "text": "Amo AceBase",
            "locale": "es"
        },
        "item3": {
            "text": "J'aime AceBase",
            "locale": "fr"
        },
        "item4": {
            "text": "Ich liebe AceBase",
            "locale": "de"
        },
        "item5": {
            "text": "Ik hou van AceBase",
            "locale": "nl"
        },
        "item6": {
            "text": "Jag älskar AceBase",
            "locale": "sv"
        }
    }
}
```

You can have the texts in `text` indexed using the locale specified in `locale`. The locale found is used in a given `transform` function. If the source data does not have the specified locale key, the default `textLocale` option specified in the options will be used.

```javascript
db.indexes.create('chats/*/messages', 'text', { 
    type: 'fulltext', 
    textLocale: 'en' // default locale to use
    config: { 
        localeKey: 'locale' // Use the locale found in the locale property
    }
}
```

#### `useStoplist`
Boolean value that specifies whether a default stoplist for the used locale should be used to automatically blacklist words. Currently only available for locale `"en"`, which contains very frequently used words like "a", "i", "me", "it", "the", "they", "them" etc.

### Geo indexes

A geo index is able to index latitude/longitude value combinations so you can create very fast location-based queries. 

Consider the following dataset:
```javascript
landmarks: {
    landmark1: {
        name: 'I Amsterdam Sign',
        note: 'This is where it used to be before some crazy mayor decided it had to go',
        location: {
            lat: 52.359157,
            long: 4.884155
        }
    },
    landmark2: {
        name: 'Van Gogh Museum',
        location: {
            lat: 52.358407, 
            long: 4.881152
        }
    },
    landmark3: {
        name: 'Rijksmuseum',
        location: {
            lat: 52.359818, 
            long: 4.884924
        }
    },
    // ...
}
```

To query all landmarks in a range of a given location, create a _geo_ index on nodes containing ```lat``` and ```long``` keys. Then use the ```geo:nearby``` filter:

```javascript
db.indexes.create('landmarks', 'location', { type: 'geo' });
.then(() => {
    return db.query('landmarks')
    .filter('location', 'geo:nearby', { lat: 52.359157, long: 4.884155, radius: 100 });
    .get()
})
.then(snapshots => {
    // Got all landmarks on Museumplein in Amsterdam (in a radius of 100 meters)
})
```

Indexed locations are stored using 10 character geohashes, which have a precision of about half a square meter.

## Schemas
(NEW since v1.3.0)

In many cases it is desirable to define what data is allowed to be stored in your database, to prevent unexpected errors in your application. It can also prevent a programming error from damaging your database structure or data. By defining schemas to your database, you can prevent data that does not adhere to the schema from being written. All updates and inserts will check the passed data with your defined schemas before writing, and raise an error if validation fails. Any existing data will not be checked.

Note: Schema checking was already available in [acebase-server](https://github.com/appy-one/acebase-server), but its implementation was limited. For this reason, it was moved closer to the storage code and improved. Additional benefit: schema checks are now available for any AceBase instance (Hello, standalone browser/node.js databases!).

### Adding schemas to enforce data rules

To define a schema, use `db.schema.set(path, schema)`. This will add a schema definition to the specified path to enforce for updates and inserts. Schema definitions use typescript formatting. For optional properties, append a question mark to the property name, eg: "birthdate?". You can specify one wildcard child property ("*" or "$varname") to check unspecified properties with.

The following types are supported: 
* Types returned by `typeof`: `string`, `number`, `boolean`, `object`\*, and `undefined`\*\*
* Classnames: `Date`, `Object`*, (_v1.8.0+_:) `String`, `Number`, `Boolean`
* Interface definitions: `{ "prop1": "string", "prop2": "Date" }`
* Arrays: `string[]`, `number[]`, ``Date[]``, `{ "prop": "string" }[]` etc
* Arrays (generic): `Array<Date>`, `Array<string | number>`, `Array<{ "prop1": "string" }>` etc
* Binary: `Binary`, `binary`
* Any type: `any` or `*`
* Combinations: `string | number | Date[]`
* Specific values: `1 | 2 | 3`, `"car" | "boat" | "airplane"`, `true` etc
* Regular expressions (_v1.8.0+_): `/^[A-Z]{2}$/` (NL, EN, DE, US, etc), `/^[a-z.\-_]+@(?:[a-z\-_]+\.){1,}[a-z]{2,}$/i` (email addresses), etc
* Optional values: property names suffixed with `?`

\* Types `object` and `Object` are treated the same way: they allow a given value to be *any* object, *except* `Array`, `Date` and binary values. This means that if you are using custom class mappings, you will be able to store a `Pet` object, but not an `Array`.

\*\* When using type `undefined`, the property will not be allowed to be inserted or updated. This can be useful if your data structure changed and want to prevent updates to use the old structure. For example, if your contacts previously had an "age" property that you are replacing with "birthday". Setting the type of "age" to `undefined` will prevent the property to be set or overwritten. Note that an existing "age" property will not be removed, unless its value is set to `null` by the update.

### Schema Examples

```js
// Set schema for users:
await db.schema.set('users/$uid', {
    name: 'string',
    email: 'string',
    "birthdate?": 'Date' // optional birthdate
    "address?": { // optional address
        street: 'string',
        nr: 'number | string',
        "building?": 'string',
        city: 'number',
        postal_code: 'string',
        country: /^[A-Z]{2}$/  // 2 uppercase character strings
    },
    "posts?": 'object', // Optional posts
});

// Set schema for user posts, using string definitions:
await db.schema.set(
    'users/$uid/posts/$postid', 
    '{ title: string, text: string, posted: Date, edited?: Date, tags: string[] }'
);

// Set schema for user AND posts in 1 schema definition:
await db.schema.set('users/$uid', {
    name: 'string', 
    // ...
    "posts?": {
        // use wildcard "*", or "$postid" for each child:
        "*": { 
            title: 'string',
            text: 'string',
            posted: 'Date',
            "edited?": 'Date',
            tags: 'string[]',
        }
    }
});

// Get schema defined for a specific path:
const schemaInfo = await db.schema.get('users/$uid');

// Get all defined schemas
const schemas = await db.schema.all();
```

## Mapping data to custom classes

Mapping data to your own classes allows you to store and load objects to/from the database without them losing their class type. Once you have mapped a database path to a class, you won't ever have to worry about serialization or deserialization of the objects => Store a ```User```, get a ```User```. Store a ```Chat``` that has a collection of ```Messages```, get a ```Chat``` with ```Messages``` back from the database. Any class specific methods can be executed directly on the objects you get back from the db, because they will be an ```instanceof``` your class.

By default, AceBase runs your class constructor with a snapshot of the data to instantiate new objects, and uses all properties of your class to serialize them for storage. 

```javascript
// User class implementation
class User {
    constructor(obj) {
        if (obj && obj instanceof DataSnapshot) {
            let obj = snapshot.val();
            this.name = obj.name;
        }
    }
}

// Bind to all children of users node
db.types.bind("users", User);
```

You can now do the following:
```javascript
// Create a user
let user = new User();
user.name = 'Ewout';

// Store the user in the database (will be serialized automatically)
const userRef = await db.ref('users').push(user);

// Load user from the db again (will be instantiated with the User constructor)
const userSnapshot = await userRef.get();
let savedUser = userSnapshot.val();
// savedUser is an instance of class User
```


If you are unable (or don't want to) to change your class constructor, add a static method named ```create``` to deserialize stored objects:

```javascript
class Pet {
    // Constructor that takes multiple arguments
    constructor(animal, name) {
        this.animal = animal;
        this.name = name;
    }
    // Static method that instantiates a Pet object
    static create(snap) {
        let obj = snap.val();
        return new Pet(obj.animal, obj.name);
    }
}
// Bind to all pets of any user
db.types.bind("users/*/pets", Pet); 
```

If you want to change how your objects are serialized for storage, add a method named ```serialize``` to your class. You should do this if your class contains properties that should not be serialized (eg ```get``` properties).

```javascript
class Pet {
    // ...
    serialize() {
        // manually serialize
        return {
            animal: this.animal,
            name: this.name
        }
    }
}
// Bind
db.types.bind("users/*/pets", Pet); 
```

If you want to use other methods for instantiation and/or serialization than the defaults explained above, you can manually specify them in the ```bind``` call:
```javascript
class Pet {
    // ...
    toDatabase(ref) {
        return {
            animal: this.animal,
            name: this.name
        }
    }
    static fromDatabase(snap) {
        let obj = snap.val();
        return new Pet(obj.animal, obj.name);
    }
}
// Bind using Pet.fromDatabase as object creator and Pet.prototype.toDatabase as serializer
db.types.bind("users/*/pets", Pet, { creator: Pet.fromDatabase, serializer: Pet.prototype.toDatabase }); 
```

If you want to store native or 3rd party classes, or don't want to extend the classes with (de)serialization methods:
```javascript
// Storing native RegExp objects
db.types.bind(
    "regular_expressions", 
    RegExp, { 
        creator: (snap) => {
            let obj = snap.val();
            return new RegExp(obj.pattern, obj.flags);
        }, 
        serializer: (ref, regex) => {
            // NOTE the regex param, it's provided because we can't use `this` to reference the object
            return { pattern: regex.source, flags: regex.flags };
        } 
    }
);
```

## Storage

By default, AceBase uses its own binary database format in Node.js environments, and IndexedDB (or LocalStorage) in the browser to store its data. However, it is also possible to use AceBase's realtime capabilities, and have the actual data stored in other databases. Currently, AceBase has built-in adapters for MSSQL, SQLite in Node.js environments; and IndexedDB, LocalStorage, SessionStorage for the browser. It also possible to create your own custom storage adapters, so wherever you'd want to store your data - it's in your hands!

### Using SQLite or MSSQL storage 
(NEW v0.8.0)

From v0.8.0+ it is now possible to have AceBase store all data in a SQLite or SQL Server database backend! They're not as fast as the default AceBase binary database (which is about 5x faster), but if you want more control over your data, storing it in a widely used DBMS might come in handy. I developed it to be able to make ports to the browser and/or Android/iOS HTML5 apps easier, so ```AceBaseClient```s will be able to store and query data locally also.

To use a different backend database, simply pass a typed ```StorageSettings``` object to the ```AceBase``` constructor. You can use ```SQLiteStorageSettings``` for a SQLite backend, ```MSSQLStorageSettings``` for SQL Server etc. 

Dependencies: SQLite requires the ```sqlite3``` package to be installed from npm (```npm i sqlite3```), MSSQL requires the ```mssql``` package. mssql uses the tedious driver by default, but if you're on Windows you can also use Microsoft's native sql server driver by adding the ```msnodesqlv8``` package as well, and specifying ```driver: 'native'``` in the ```MSSQLStorageSettings```

```javascript
// Using SQLite backend:
const db = new AceBase('mydb', new SQLiteStorageSettings({ path: '.' }));

// Or, SQL Server:
const db = new AceBase('mydb', new MSSQLStorageSettings({ server: 'localhost', port: 1433, database: 'MyDB', username: 'user', password: 'secret', (...) }));
```

## Running AceBase in the browser

AceBase is now able to run stand-alone in the browser. It uses IndexedDB or LocalStorage to store the data, or SessionStorage if you want a temporary database.

NOTE: If you want to connect to a remote AceBase [acebase-server](https://www.npmjs.com/package/acebase-server) from the browser instead of running one locally, use [acebase-client](https://www.npmjs.com/package/acebase-client) instead.

You can also use a local database in the browser to sync with an AceBase server. To do this, create your database in the browser and pass it as `cache` db in `AceBaseClient`'s settings.

If you are using TypeScript (eg with Angular/Ionic), or webpack, add `acebase` to your project (`npm i acebase`), and use:
```typescript
import { AceBase } from 'acebase';
```

Or, include AceBase script in your html page:
```html
<script type="text/javascript" src="https://cdn.jsdelivr.net/npm/acebase@latest/dist/browser.min.js"></script>
```

Then, create your database and start using it!
```js
// Create an AceBase db using IndexedDB
const db = AceBase.WithIndexedDB('mydb');

await db.ready();
console.log('Database ready to use');

const ref = await db.ref('browser').set({
    test: 'AceBase runs in the browser!'
});
console.log(`"${ref.path}" was saved!`);

const snapshot = await ref.get();
console.log(`Got "${snapshot.ref.path}" value:`, snapshot.val());
```

Or, if you prefer using `Promises` instead of `async` / `await`:
```js
db.ready(() => {
    console.log('Database ready to use');
    return db.ref('browser').set({
        test: 'AceBase runs in the browser!'
    })
    .then(ref => {
        console.log(`"${ref.path}" was saved!`);
        return ref.get();
    })
    .then(snap => {
        console.log(`Got "${snap.ref.path}" value:`, snap.val());
    });
});
```

If you want AceBase to use localStorage instead, use `AceBase.WithLocalStorage`:
```js
// Create an AceBase db using LocalStorage
const db = AceBase.WithLocalStorage('mydb', { temp: false }); // temp:true to use sessionStorage instead
```

### Cross-tab synchronization
(NEW in v1.5.0)

When you're using AceBase with an IndexedDB or LocalStorage backend, you might notice that if you change data in one open tab, those changes do not raise change events in other open tabs monitoring that same data. This is because `IndexedDB` or `LocalStorage` databases do not raise change events themselves, and AceBase won't be able to either if the data was not changed through AceBase itself. To overcome this issue, AceBase will have to notify local changes to other AceBase instances in different browser tabs. 

AceBase is now able to communicate with other tabs using the `BroadcastChannel` implemented in most browsers\*, and is able to notify others of changes made to the underlaying database. This functionality is disabled by default, set `multipleTabs: true` in the options parameter to enable it:

```js
const db = AceBase.WithIndexedDB('mydb', { multipleTabs: true });
```

Once you've enabled this setting, the AceBase instances running in multiple tabs will exchange what events they are listening for, and notify eachother with any changes made to the monitored data.

\* Safari (both desktop and iOS versions) do not currently support `BroadcastChannel`, a polyfill will be used. [Browser support](https://caniuse.com/broadcastchannel) is currently at 77% (April 2021)

NOTE: This applies to local databases only. If you are using an `AceBaseClient`, connected to an `AceBaseServer`, changing something in one browser tab will already notify other tabs, because the events are raised by the AceBase server and sent back to the clients automatically. If you use a local `AceBase` instance as offline cache for an `AceBaseClient` and have `multipleTabs` enabled, cross-tab synchronization will only be used while offline.

## Using a CustomStorage backend

In additional to the already available binary, SQL Server, SQLite, IndexedDB and LocalStorage backends, it's also possible to roll your own custom storage backend, such as MongoDB, MySQL, WebSQL etc. To do this, all you have to do is write a couple of methods to get, set, remove and query data within a transactional context. The only prerequisite is that your used database provider is able to execute queries, or provides some other way to iterate through record entries without having to load them all into memory at once. (Firebase won't do because it can't do that)

The example below shows how to implement a ```CustomStorage``` class that uses the browser's `LocalStorage`, but you can use anything you'd want. It's easy to change the code below to use any other database provider like MongoDB, PostgreSQL, MySQL etc.

NOTE: The code below is similar to the implementation of `AceBase.WithLocalStorage`

```javascript
const { AceBase, CustomStorageSettings, CustomStorageTransaction, CustomStorageHelpers } = require('acebase');

const dbname = 'test';

// Setup our CustomStorageSettings
const storageSettings = new CustomStorageSettings({
    name: 'LocalStorage',
    locking: true, // Let AceBase handle resource locking to prevent multiple simultanious updates to the same data
    
    ready() {
        // LocalStorage is always ready
        return Promise.resolve();
    },

    getTransaction(target) {
        // Create an instance of our transaction class
        const context = {
            debug: true,
            dbname
        }
        const transaction = new LocalStorageTransaction(context, target);
        return Promise.resolve(transaction);
    }
});

// Setup CustomStorageTransaction for browser's LocalStorage
class LocalStorageTransaction extends CustomStorageTransaction {

    /**
     * @param {{debug: boolean, dbname: string}} context
     * @param {{path: string, write: boolean}} target
     */
    constructor(context, target) {
        super(target);
        this.context = context;
        this._storageKeysPrefix = `${this.context.dbname}.acebase::`;
    }

    commit() {
        // To implement REAL commit and rollback capabilities, we'd have to add pending mutations to a batch,
        // and store upon commit, or toss upon rollback. This is what AceBase.WithIndexedDB does, is also way faster.
        return Promise.resolve(); // All changes have already been committed
    }
    
    rollback(err) {
        // Not able to rollback changes, was already comitted.
        return Promise.resolve();
    }

    get(path) {
        // Gets value from localStorage, wrapped in Promise
        return new Promise(resolve => {
            const json = localStorage.getItem(this.getStorageKeyForPath(path));
            const val = JSON.parse(json);
            resolve(val);
        });
    }

    set(path, val) {
        // Sets value in localStorage, wrapped in Promise
        return new Promise(resolve => {
            const json = JSON.stringify(val);
            localStorage.setItem(this.getStorageKeyForPath(path), json);
            resolve();
        });
    }

    remove(path) {
        // Removes a value from localStorage, wrapped in Promise
        return new Promise(resolve => {
            localStorage.removeItem(this.getStorageKeyForPath(path));
            resolve();
        });
    }

    childrenOf(path, include, checkCallback, addCallback) {
        // Streams all child paths
        // Cannot query localStorage, so loop through all stored keys to find children
        return new Promise(resolve => {
            const pathInfo = CustomStorageHelpers.PathInfo.get(path);
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (!key.startsWith(this._storageKeysPrefix)) { continue; }                
                let otherPath = this.getPathFromStorageKey(key);
                if (pathInfo.isParentOf(otherPath) && checkCallback(otherPath)) {
                    let node;
                    if (include.metadata || include.value) {
                        const json = localStorage.getItem(key);
                        node = JSON.parse(json);
                    }
                    const keepGoing = addCallback(otherPath, node);
                    if (!keepGoing) { break; }
                }
            }
            resolve();
        });
    }

    descendantsOf(path, include, checkCallback, addCallback) {
        // Streams all descendant paths
        // Cannot query localStorage, so loop through all stored keys to find descendants
        return new Promise(resolve => {
            const pathInfo = CustomStorageHelpers.PathInfo.get(path);
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (!key.startsWith(this._storageKeysPrefix)) { continue; }
                let otherPath = this.getPathFromStorageKey(key);
                if (pathInfo.isAncestorOf(otherPath) && checkCallback(otherPath)) {
                    let node;
                    if (include.metadata || include.value) {
                        const json = localStorage.getItem(key);
                        node = JSON.parse(json);
                    }
                    const keepGoing = addCallback(otherPath, node);
                    if (!keepGoing) { break; }
                }
            }
            resolve();
        });
    }

    /**
     * Helper function to get the path from a localStorage key
     * @param {string} key 
     */
    getPathFromStorageKey(key) {
        return key.slice(this._storageKeysPrefix.length);
    }

    /**
     * Helper function to get the localStorage key for a path
     * @param {string} path 
     */
    getStorageKeyForPath(path) {
        return `${this._storageKeysPrefix}${path}`;
    }
}

// Now, create the database
const db = new AceBase(dbname, { logLevel: settings.logLevel, storage: storageSettings });
db.ready(ready => {
    // That's it!
})
```

## Reflect API

AceBase has a built-in reflection API that enables browsing the database content without retrieving any (nested) data. This API is available for local databases, and remote databases when signed in as the ```admin``` user or on paths the authenticated user has access to.

The reflect API is also used internally: AceBase server's webmanager uses it to allow database exploration, and the ```DataReference``` class uses it to deliver results for ```count()``` and initial ```notify_child_added``` event callbacks.

### Get information about a node

To get information about a node and its children, use an ```info``` query:

```javascript
// Get info about the root node and a maximum of 200 children:
db.root.reflect('info', { child_limit: 200, child_skip: 0 })
.then(info => { /* ... */ });
```

The above example will return an info object with the following structure:
```json
{ 
    "key": "",
    "exists": true, 
    "type": "object",
    "children": { 
        "more": false, 
        "list": [
            { "key": "appName", "type": "string", "value": "My social app" },
            { "key": "appVersion", "type": "number", "value": 1 },
            { "key": "posts", "type": "object" }
        ] 
    } 
}
```

To get the number of children of a node (instead of enumerating them), pass ```{ child_count: true }``` with the ```info``` reflect request:

```javascript
const info = await db.ref('chats/somechat/messages')
    .reflect('info', { child_count: true });
```

This will return an info object with the following structure:
```json
{ 
    "key": "messages",
    "exists": true, 
    "type": "object",
    "children": { 
        "count": 879
    }
}
```

### Get children of a node

To get information about the children of a node, use the ```children``` reflection query:
```javascript
const children = await db.ref('chats/somechat/messages')
    .reflect('children', { limit: 10, skip: 0 });
```

The returned children object in above example will have to following structure:
```json
{
    "more": true,
    "list": {
        "message1": { "type": "object" },
        "message2": { "type": "object" },
        // ...
        "message10": { "type": "object" }
    }
}
```

## Export API 
(NEW v0.9.1)

To export data from any node to json, you can use the export API. Simply pass an object that has a ```write``` method to ```yourRef.export```, and the entire node's value (including nested data) will be streamed in ```json``` format. If your ```write``` function returns a ```Promise```, streaming will be paused until the promise resolves (local databases only). You can use this to back off writing if the target stream's buffer is full (eg while waiting for a file stream to "drain"). This API is available for local databases, and remote databases 
~~when signed in as the ```admin``` user~~ (from server v0.9.29+) on paths the authenticated user has access to.

```javascript
let json = '';
const write = str => {
    json += str;
};
db.ref('posts').export(write)
.then(() => {
    console.log('All posts have been exported:');
    console.log(json);
})
```

To export to a file in Node.js, you could use a filestream:
```js
const stream = fs.createWriteStream('export.json', { flags: 'w+' });
const write = chunk => {
    const ok = stream.write(chunk);
    if (!ok) {
        return new Promise(resolve => stream.once('drain', resolve));
    }
};
await db.root.export(write); // Export all data
stream.close(); 
```

### Type safety
Any data that can not be expressed in JSON format natively (such as Dates and binary data) are exported type-safe using an object describing the content. This is the default behaviour since v1.13.0 

For example: a Date will be exported like `"date":{".type":"Date",".val":"2021-12-31T11:55:14.380Z"}`, and binary data like `"binary":{".type":"Buffer",".val":"<~@VK^gEd8d<@<>o~>"}`.

If you do not want to use this type-safe formatting, you can disable it by setting the `type_safe` option: `ref.export(write, { type_safe: false })`;

## Import API 
(NEW v1.13.0)

If you need to import large amounts of data it is recommended to use the new import API, which efficiently streams a JSON input source into the database without acquiring long-blocking write locks. This leaves your database responsive for other processes and eliminates the need to load your entire source into memory.

Example:
```js
const fd = fs.openSync('data.json', 'r');
const read = length => {
    return new Promise((resolve, reject) => {
        const buffer = new Uint8Array(length);
        fs.read(fd, buffer, 0, length, null, err => {
            if (err) { reject(err); }
            else { resolve(buffer); }
        });
    });
};
await db.ref(path).import(read);
fs.closeSync(fd);
```

NOTE: If you have transaction logging enabled, the import will cause many smaller updates to be logged, instead of just one.

## Transaction Logging
(NEW v1.8.0, BETA, AceBase binary databases only)

AceBase now supports transaction logging to facilitate sophisticated synchronization options and custom data recovery. Using cursors that indicate certain points in time, this allows for fast and easy synchronization of data between an AceBase server and multiple clients, or other server instances. This functionality is currently in BETA stage and will be tested extensively in the coming weeks. 

To enable transaction logging on your database, add the `transactions` setting to the AceBase constructor:
```js
const db = new AceBase('mydb', { transactions: { log: true, maxAge: 30, noWait: false } });
```

More documentation will follow soon, see `transaction-logs.spec.js` unit tests for more info for now.

## Multi-process support

AceBase supports running in multiple processes by using interprocess communication (IPC). If your app runs in a standard Node.js cluster, AceBase is able to communicate with each process through Node.js's built-in `cluster` functionality. If your app runs in the browser, AceBase will use `BroadcastChannel` (or shim for Safari) to communicate with other browser tabs. 

If you are using pm2 to run your app in a cluster, or run your app in a cloud-based cluster (eg Kubernetes, Docker Swarm), AceBase instances will need some other way to communicate with eachother. This is now possible using an AceBase IPC Server, which allows fast communication using websockets. See [AceBase IPC Server](https://github.com/appy-one/acebase-ipc-server) for more info!

## Upgrade notices

* v0.9.68 - To get the used updating context in data event handlers, read from `snap.context()` instead of `snap.ref.context()`. This is to prevent further updates on `snap.ref` to use the same context. If you need to reuse the event context for new updates, you will have to manually set it: `snap.ref.context(snap.context()).update(...)`

* v0.7.0 - Changed DataReference.vars object for subscription events, it now contains all values for path wildcards and variables with their index, and (for named variables:) ```name``` and ($-)prefixed ```$name```. The ```wildcards``` array has been removed. See *Using variables and wildcards in subscription paths* in the documentation above.

* v0.6.0 - Changed ```db.types.bind``` method signature. Serialization and creator functions can now also access the ```DataReference``` for the object being serialized/instantiated, this enables the use of path variables.

* v0.4.0 - introduced fulltext, geo and array indexes. This required making changes to the index file format, you will have to delete all index files and create them again using ```db.indexes.create```.

## Known issues

* No currently known issues. Please submit any issues you might find in the respective GitHub repository! For this repository go to [AceBase issues](https://github.com/appy-one/acebase/issues)

## Authors

* **Ewout Stortenbeker** - *Initial work* - <me@appy.one>
* **You?** Please contribute!

## Contributing

If you would like to contribute to help move the project forward, you are welcome to do so!
What can you help me with?

* Bugfixes - if you find bugs please create a new issue on github. If you know how to fix one, feel free to submit a pull request or drop me an email
* Enhancements - if you've got code to make AceBase even faster or better, you're welcome to contribute!
* Ports - If you would like to port ```AceBaseClient``` to other languages (Java, Swift, C#, etc) that would be awesome!
* Ideas - I love new ideas, share them!
* Money - I am an independant developer and many (MANY) months were put into developing this. I also have a family to feed so if you like AceBase, send me a donation or become a sponsor ♥

## Sponsoring

If you use AceBase, let me know! Also, please consider supporting its development by sponsoring the project, buying me a coffee or sending a donation.

* [Sponsor](https://github.com/sponsors/appy-one)
* [Buy me a coffee](https://www.buymeacoffee.com/appyone)
* [Donate with PayPal](https://paypal.me/theappyone)
* BTC address: 3EgetGDnG9vvfJzjLYdKwWvZpHwePKNJYc

You rock! 🎸
Thanks, Ewout
