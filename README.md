# AceBase realtime database engine

A fast, low memory, transactional, index & query enabled NoSQL database engine and server for node.js and browser with realtime data change notifications. Supports storing of JSON objects, arrays, numbers, strings, booleans, dates and binary (ArrayBuffer) data.

Inspired by (and largely compatible with) the Firebase realtime database, with additional functionality and less data sharding/duplication. Capable of storing up to 2^48 (281 trillion) object nodes in a binary database file that can theoretically grow to a max filesize of 8 petabytes.

AceBase is easy to set up and runs anywhere: in the cloud, NAS, local server, your PC/Mac, Raspberry Pi, the **browser**, wherever you want.

🔥👇🏽Check out the new [live data proxy](#live-data-proxy) feature!
```javascript
const { AceBase } = require('acebase');
const db = new AceBase('chats');

db.ready(async () => {
    // Create a live data proxy for a chat
    const chatProxy = await db.ref('chats/chat1').proxy({});
    const liveChat = chatProxy.value;

    // Simply setting liveChat's properties will update the database:
    liveChat.title = 'Live Data Proxies Rock! 🚀';
    liveChat.messages.push({ 
        from: 'Ewout', 
        text: 'Updating a database was never this easy' 
    });
    
    // That easy!
}
```
The above example uses a live data proxy on a local database. If you use this on a remote database through an ```AceBaseClient```, it will synchronize with all other connected clients and update their ```liveChat``` object behind the scenes!

## Table of contents

* [Getting started](#getting-started)
* [Prerequisites](#prerequisites)
* [Installing](#installing)
* Loading and storing data
    * [Introduction](#usage)
    * [Creating a database](#create-database)
    * [Loading data](#loading-data)
    * [Storing data](#storing-data)
    * [Updating data](#updating-data)
    * [Transactional updating](#transactions)
    * [Removing data](#removing-data)
    * [Generating unique keys](#unique-keys)
    * [Using arrays](#using-arrays)
    * [Limit nested data loading](#limit-nested-data-loading)
    * [Counting children](#count-children)
* Realtime monitoring
    * [Monitoring realtime data changes](#monitor-realtime-changes)
    * [Using variables and wildcards in subscription paths](#wildcard-paths)
    * [Notify only events](#notify-only-events)
    * [Wait for events to activate](#wait-for-event-activation)
    * [Get triggering context of events](#event-context)
    * [Change tracking using "mutated" events](#mutated-events)
    * [Observe realtime value changes](#observe-realtime-value)
    * [🔥 Realtime synchronization with a live data proxy](#live-data-proxy)
* Queries
    * [Querying data](#querying-data)
    * [Removing data with a query](#query-removing-data)
    * [Realtime queries](#realtime-queries)
* Indexes
    * [Indexing data](#indexing-data)
    * [Indexing scattered data with wildcards](#indexing-scattered-data)
    * [Include additional data in indexes](#index-additional-data)
    * [Special indexes](#special-indexes)
    * [Array indexes](#array-indexes)
    * [Fulltext indexes](#fulltext-indexes)
    * [Geo indexes](#geo-indexes)
* Class mappings (ORM)
    * [Mapping data to custom classes](#class-mappings)
* Data storage options
    * [AceBase data storage engine](#storage)
    * [Using SQLite or MSSQL storage](#sqllite-mssql-storage)
    * [AceBase in the browser](#browser)
    * [Using CustomStorage backend](#custom-storage)
* Reflect API
    * [Introduction](#reflect-api)
    * [Get information about a node](#reflect-info)
    * [Get children of a node](#reflect-children)
* Export API
    * [Usage](#export-api)
* [Upgrade notices](#upgrade-notices)
* [Known issues](#known-issues)
* [Authors](#authors)
* [Contributing](#contributing)
* [Buy me a coffee](#buy-me-coffee)

<a name="getting-started"></a>
## Getting Started

AceBase is split up into multiple packages:
* **acebase**: local AceBase database engine ([github](https://github.com/appy-one/acebase), [npm](https://www.npmjs.com/package/acebase))
* **acebase-server**: AceBase server endpoint to enable remote connections. Includes built-in user authentication and authorization, supports using external OAuth providers such as Facebook and Google ([github](https://github.com/appy-one/acebase-server), [npm](https://www.npmjs.com/package/acebase-server)).
* **acebase-client**: client to connect to an external AceBase server ([github](https://github.com/appy-one/acebase-client), [npm](https://www.npmjs.com/package/acebase-client))
* **acebase-core**: shared functionality, dependency of above packages ([github](https://github.com/appy-one/acebase-core), [npm](https://www.npmjs.com/package/acebase-core))

**IMPORTANT**: AceBase is in beta stage. If you run into errors, make sure you have the latest version of each package you are using. The database files created by older releases might be incompatible with newer versions, so you might have to start from scratch after updating. **Do not use in production yet**!

<a name="prerequisites"></a>
### Prerequisites

AceBase is designed to run in a [Node.js](https://nodejs.org/) environment, as it (by default) requires the 'fs' filesystem to store its data and indexes. However, since v0.9.0 **it is now also possible to use AceBase databases in the browser**! To run AceBase in the browser, simply include 1 script file and you're good to go! See [AceBase in the browser](#browser) for more info and code samples!

### Installing

All AceBase repositories are available through npm. You only have to install one of them, depending on your needs:

If you want to use a **local AceBase database** in your project, install the [acebase](https://github.com/appy-one/acebase) package.

```
npm i acebase
```

If you want to setup an **AceBase server**, install [acebase-server](https://github.com/appy-one/acebase-server).

```
npm i acebase-server
```

If you want to connect to a remote (or local) AceBase server, install [acebase-client](https://github.com/appy-one/acebase-client).

```
npm i acebase-client
```

<a name="usage"></a>
## Example usage

The API is similar to that of the Firebase realtime database, with additions.

<a name="create-database"></a>
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

<a name="loading-data"></a>
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

<a name="storing-data"></a>
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

<a name="updating-data"></a>
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

<a name="transactions"></a>
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

<a name="removing-data"></a>
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

<a name="unique-keys"></a>
### Generating unique keys

For all generic data you add, you need to create keys that are unique and won't clash with keys generated by other clients. To do this, you can have unique keys generated with ```push```. Under the hood, ```push``` uses [cuid](https://www.npmjs.com/package/cuid) to generated keys that a guaranteed to be unique.

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

<a name="using-arrays"></a>
### Using arrays

AceBase supports storage of arrays, but there are some caveats when working with them. For instance, you cannot remove or insert items that are not at the end of the array. AceBase arrays work like a stack, you can add and remove from the top, not within. It is possible however to edit individual entries, or to overwrite the entire array. The safest way to edit arrays is with a ```transaction```, which requires all data to be loaded and stored again. In many cases, it is wiser to use object collections instead.

You can use arrays when:
* The number of items are small and finite, meaning you could estimate the typical average number of items in it.
* There is no need to retrieve/edit individual items using their stored path. If you reorder the items in an array, their paths change (eg from ```"playlist/songs[4]"``` to ```"playlist/songs[1]"```)
* The entries stored are small and do not have a lot of nested data (small strings or simple objects, eg: ```chat/members``` with user id's array ```['ewout','john','pete']```)
* The collection does not need to be edited frequently.

Use object collections instead when:
* The collection keeps growing (eg: user generated content)
* The path of items are important and preferably not change, eg ```"playlist/songs[4]"``` might point to a different entry if the array is edited. When using an object collection, ```playlist/songs/jld2cjxh0000qzrmn831i7rn``` will always refer to that same item.
* The entries stored are large (eg large strings / blobs / objects with lots of nested data)
* You have to edit the collection frequently.

Having said that, here's how to safely work with arrays:
```javascript
// Store an array with 2 songs:
db.ref('playlist/songs').set([
    { id: 13535, title: 'Daughters', artist: 'John Mayer' }, 
    { id: 22345,  title: 'Crazy', artist: 'Gnarls Barkley' }
]);

// Editing an array safely:
db.ref('playlist/songs').transaction(snap => {
    const songs = snap.val();
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

To summarize: the most important thing to note when working with arrays: ALWAYS use a ``transaction`` to edit arrays, AVOID accessing individual items by their index. Eg: DON'T use ```arrayRef.update({ 0: 'this is dangerous' })```, ```arrayRef.child(1).set('also dangerous')``` or ```db.ref('some/array[12]/title').update('What am I doing?!')```. If you need to update items individually, use object collections instead!

Also NOTE: you CANNOT use ```ref.push()``` to add entries to an array! It can only be used with with object collections.

<a name="counting-children"></a>
## Counting children

To quickly find out how many children a specific node has, use the ```count``` method on a ```DataReference```:

```javascript
const messageCount = await db.ref('chat/messages').count();
```

<a name="limit-nested-data-loading"></a>
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
})
```

**NOTE**: This enables you to do what Firebase can't: store your data in logical places, and only get the data you are interested in, fast! On top of that, you're even able to index your nested data and query it, even faster. See [Indexing data](#indexing-data) for more info about that..

<a name="monitor-realtime-changes"></a>
## Monitoring realtime data changes

You can subscribe to data events to get realtime notifications as the monitored node is being changed. When connected to a remote AceBase server, the events will be pushed to clients through a websocket connection. Supported events are:  
- ```'value'```: triggered when a node's value changes (including changes to any child value)
- ```'child_added'```: triggered when a child node is added, callback contains a snapshot of the added child node
- ```'child_changed'```: triggered when a child node's value changed, callback contains a snapshot of the changed child node
- ```'child_removed'```: triggered when a child node is removed, callback contains a snapshot of the removed child node
- ```'mutated'```: (NEW v0.9.51) triggered when any nested property of a node changes, callback contains a snapshot and reference of the exact mutation.
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
// Unsubscibe later with .off:
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

<a name="wildcard-paths"></a>
### Using variables and wildcards in subscription paths (NEW! v0.5.0+)

It is now possible to subscribe to events using wildcards and variables in the path:
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

<a name="notify-only-events"></a>
### Notify only events

In additional to the events mentioned above, you can also subscribe to their ```notify_``` counterparts which do the same, but with a reference to the changed data instead of a snapshot. This is quite useful if you want to monitor changes, but are not interested in the actual values. Doing this also saves serverside resources, and results in less data being transferred from the server. Eg: ```notify_child_changed``` will run your callback with a reference to the changed node.

<a name="wait-for-event-activation"></a>
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

<a name="event-context"></a>
### Get triggering context of events (NEW v0.9.51)

In some cases it is benificial to know what (and/or who) triggered a data event to fire, so you can choose what you want to do with data updates. It is now possible to pass context information with all ```update```, ```set```, and ```remove``` operations, which will be passed along to any event triggered on affected paths (on any connected client!)

Imagine the following situation: you have a document editor that allows multiple people to edit at the same time. When loading a document you update its ```last_accessed``` property:

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

This will trigger the ``value`` event TWICE, and cause the document to render TWICE. Additionally, if any other user opens the same document, it will be triggered again even though a redraw is not needed!

To prevent this, pass context info with the update:

```javascript
// Load document & subscribe to changes (context aware!)
db.ref('users/ewout/documents/some_id').on('value', snap => {
    // Document loaded, or changed.
    const context = snap.ref.context();
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
.context({ redraw: false })
.update({ last_accessed: new Date() })
```

<a name="mutated-events"></a>
### Change tracking using "mutated" events (NEW v0.9.51)

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

<a name="observe-realtime-value"></a>
### Observe realtime value changes (NEW v0.9.51)

EXPERIMENTAL - You can now observe the realtime value of a path, and (for example) bind it to your UI. ```ref.observe()``` returns a RxJS Observable that can be used to observe updates to this node and its children. It does not return snapshots, so you can bind the observable straight to your UI. The value being observed is updated internally using the new "mutated" event. All mutations are applied to the original value, and kept in-memory.

```html
<!-- In your Angular view template: -->
<ng-container *ngIf="liveChat | async as chat">
   <h3>{{ chat.title }}</h3>
   <p>Chat was started by {{ chat.startedBy }}</p>
   <div class="messages">
    <Message *ngFor="let msg of chat.messages | keyvalue" [message]="chat.messages[msg.key]"></Message>
   </div>
</ng-container>
```

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

<a name="live-data-proxy"></a>
### 🔥 Realtime synchronization with a live data proxy (NEW v0.9.51)

EXPERIMENTAL - You can now create a live data proxy for a given path. The data of the referenced path will be loaded, and kept in-sync with live data by listening for remote 'mutated' events, and immediately syncing back all changes you make to its value. This allows you to forget about data storage, and code as if you are only handling in-memory objects. Synchronization was never this easy!

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

To get a notification each time the value a mutation is made to the value, use ```proxy.onMutation(handler)```. To get notifications about any errors that might occur, use ```proxy.onError(handler)```:

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

```forEach```: iterate object collection
```javascript
chat.messages.forEach((message, key, index) => {
    // Fired for all messages in collection, or until returning false
});
```

```push```: Add item to object collection with generated key
```javascript
const key = chat.messages.push({ text: 'New message' });
```

```remove```: delete a message
```javascript
chat.messages[key].remove();
chat.messages.someotherkey.remove();
delete chat.messages.somemessage; // You can also do this
chat.messages.somemessage = null; // And this
```

```toArray```: access an object collection like an array:
```javascript
const array = chat.messages.toArray();
```

```toArray``` (with sort): like above, sorting the results:
```javascript
const sortedArray = chat.messages.toArray((a, b) => a.sent < b.sent ? -1 : 1);
```

```getTarget```: gets underlying value (unproxied, be careful!)
```javascript
const readOnlyMessage = chat.messages.message1.getTarget();
readOnlyMessage.text = 'This does NOT update the database!'; // Because it is not the proxied value
chat.messages.message1.text = 'This updates the database'; // Just so you know
```

```onChanged```: registers a callback for the value that is called every time the underlying value changes:
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

```getRef```: returns a DataReference instance to current target if you'd want or need to do stuff outside of the proxy's scope:
```javascript
const messageRef = chat.messages.message1.getRef();
// Eg: add an "old fashioned" event handler
messageRef.on('child_changed', snap => { /* .. */ });
```

```getObservable```: returns a RxJS Observable that is updated each time the underlying value changes:
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

NOTE: In TypeScript there is some additional typecasting needed to access proxy methods shown above. You can use the ```proxyAccess``` function to get help with that. This function typecasts and also checks if your passed value is indeed a Proxy.
```typescript
type IChatMessages = IObjectCollection<IChatMessage>;

// Easy & safe typecasting:
proxyAccess<IChatMessages>(chat.messages)
    .getObservable()
    .subscribe(messages => {
        // messages: IChatMessages
    });

// Instead of:
(chat.messages as any as ILiveDataProxyValue<IChatMessages>)
    .getObservable()
    .subscribe(messages => {
        // messages: IChatMessages
    });

// With unsafe typecasting:
(chat.messages as any)
    .getObservable()
    .subscribe((messages: IChatMessages) => {
        // messages: IChatMessages, but only because we've prevented typescript
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
    <Message *ngFor="let item of chat.messages | keyvalue" [message]="item.value">
    </Message>
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

<a name="querying-data"></a>
## Querying data

When running a query, all child nodes of the referenced path will be matched against your set criteria and returned in any requested ```sort``` order. Pagination of results is also supported, so you can ```skip``` and ```take``` any number of results. Queries do not require data to be indexed, although this is recommended if your data becomes larger.

To filter results, multiple ```filter(key, operator, compare)``` statements can be added. The filtered results must match all conditions set (logical AND). Supported query operators are:
- ```'<'```: value must be smaller than ```compare```
- ```'<='```: value must be smaller or equal to ```compare```
- ```'=='```: value must be equal to ```compare```
- ```'!='```: value must not be equal to ```compare```
- ```'>'```: value must be greater than ```compare```
- ```'>='```: value must be greater or equal to ```compare```
- ```'exists'```: key must exist
- ```'!exists'```: key must not exist
- ```'between'```: value must be between the 2 values in ```compare``` array (```compare[0]``` <= value <= ```compare[1]```). If ```compare[0] > compare[1]```, their values will be swapped
- ```'!between'```: value must not be between the 2 values in ```compare``` array (value < ```compare[0]``` or value > ```compare[1]```). If ```compare[0] > compare[1]```, their values will be swapped
- ```'like'```: value must be a string and must match the given pattern ```compare```. Patterns are case-insensitive and can contain wildcards _*_ for 0 or more characters, and ? for 1 character. (pattern ```"Th?"``` matches ```"The"```, not ```"That"```; pattern ```"Th*"``` matches ```"the"``` and ```"That"```)
- ```'!like'```: value must be a string and must not match the given pattern ```compare```
- ```'matches'```: value must be a string and must match the regular expression ```compare```
- ```'!matches'```: value must be a string and must not match the regular expression ```compare```
- ```'in'```: value must be equal to one of the values in ```compare``` array
- ```'!in'```: value must not be equal to any value in ```compare``` array
- ```'has'```: value must be an object, and it must have property ```compare```.
- ```'!has'```: value must be an object, and it must not have property ```compare```
- ```'contains'```: value must be an array and it must contain a value equal to ```compare```, or contain all of the values in ```compare``` array
- ```'!contains'```: value must be an array and it must not contain a value equal to ```compare```, or not contain any of the values in ```compare``` array

NOTE: A query does not require any ```filter``` criteria, you can also use a ```query``` to paginate your data using ```skip```, ```take``` and ```sort```. If you don't specify any of these, AceBase will use ```.take(100)``` as default. If you do not specify a ```sort```, the order of the returned values can vary between executions.

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

To quickly convert a snapshots array to the values it encapsulates, you can call ```snapshots.getValues()```. This is a convenience method and comes in handy if you are not interested in the results' paths or keys. You can also do it yourself with ```var values = snapshots.map(snap => snap.val())```:
```javascript
db.query('songs')
.filter('year', '>=', 2018)
.get(snapshots => {
    const songs = snapshots.getValues();
});
```

By default, queries will return snapshots of the matched nodes, but you can also get references only by passing the option ```{ snapshots: false }```
```javascript
// ...
.get({ snapshots: false }, references => {
    // now we have references only, so we can decide what data to load
});
```

Instead of using the callback of ```.get```, you can also use the returned ```Promise``` which is very useful in promise chains:
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
This also enables using ES6 syntax:
```javascript
const snapshots = await db.query('songs')
    .filter('year', '>=', fromYear)
    .get();
```

<a name="query-removing-data"></a>
### Removing data with a query

To remove all nodes that match a query, simply call ```remove``` instead of ```get```:
```javascript
db.query('songs')
.filter('year', '<', 1950)
.remove(() => {
    // Old junk gone
}); 
```

<a name="realtime-queries"></a>
### Realtime queries (NEW 0.9.9, alpha)

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

<a name="indexing-data"></a>
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

<a name="indexing-scattered-data"></a>
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

<a name="index-additional-data"></a>
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

<a name="special-indexes"></a>
### Special indexes

Normal indexes are able to index ```string```, ```number```, ```Date```, ```boolean``` and ```undefined``` (non-existent) values. To index other data, you have to create a special index. Currently supported special indexes are: **Array**, **FullText** and **Geo** indexes.

<a name="array-indexes"></a>
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

<a name="fulltext-indexes"></a>
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

<a name="geo-indexes"></a>
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

<a name="class-mappings"></a>
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

// Store the user in the database
db.ref('users')
.push(user)
.then(userRef => {
    // The object returned by user.serialize() was stored in the database
    return userRef.get();
})
.then(userSnapshot => {
    let user = userSnapshot.val();
    // user is an instance of class User!
})
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
            name: this.name
        }
    }
}
// Bind
db.types.bind("users/*/pets", Pet); 
```

If you want to use other methods for instantiation and/or serialization than the defaults, you can manually specify them in the ```bind``` call:
```javascript
class Pet {
    // ...
    toDatabase(ref) {
        return {
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

If you want to store native or 3rd party classes and don't want to extend them with (de)serialization functions:
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
            // NOTE the regex param, we need it because we can't use `this` as reference to the object
            return { pattern: regex.source, flags: regex.flags };
        } 
    }
);
```

<a name="storage"></a>
## Storage

By default, AceBase uses its own binary database format in Node.js environments, and IndexedDB (or LocalStorage) in the browser to store its data. However, it is also possible to use AceBase's realtime capabilities, and have the actual data stored in other databases. Currently, AceBase has built-in adapters for MSSQL, SQLite in Node.js environments; and IndexedDB, LocalStorage, SessionStorage for the browser. It also possible to create your own custom storage adapters, so wherever you'd want to store your data - it's in your hands!

<a name="sqllite-mssql-storage"></a>
### Using a SQLite or MSSQL backend (NEW v0.8.0)

From v0.8.0+ it is now possible to have AceBase store all data in a SQLite or SQL Server database backend! They're not as fast as the default AceBase binary database (which is about 5x faster), but if you want more control over your data, storing it in a widely used DBMS might come in handy. I developed it to be able to make ports to the browser and/or Android/iOS HTML5 apps easier, so ```AceBaseClient```s will be able to store and query data locally also.

To use a different backend database, simply pass a typed ```StorageSettings``` object to the ```AceBase``` constructor. You can use ```SQLiteStorageSettings``` for a SQLite backend, ```MSSQLStorageSettings``` for SQL Server etc. 

Dependencies: SQLite requires the ```sqlite3``` package to be installed from npm (```npm i sqlite3```), MSSQL requires the ```mssql``` package. mssql uses the tedious driver by default, but if you're on Windows you can also use Microsoft's native sql server driver by adding the ```msnodesqlv8``` package as well, and specifying ```driver: 'native'``` in the ```MSSQLStorageSettings```

```javascript
// Using SQLite backend:
const db = new AceBase('mydb', new SQLiteStorageSettings({ path: '.' }));

// Or, SQL Server:
const db = new AceBase('mydb', new MSSQLStorageSettings({ server: 'localhost', port: 1433, database: 'MyDB', username: 'user', password: 'secret', (...) }));
```

<a name="browser"></a>
## Running AceBase in the browser (NEW v0.9.0)

From v0.9.0+, AceBase is now able to run stand-alone in the browser! It uses IndexedDB (NEW v0.9.25) or localStorage to store the data, or sessionStorage if you want a temporary database.

NOTE: If you want to connect to a remote AceBase [acebase-server](https://www.npmjs.com/package/acebase-server) from the browser instead of running one locally, use [acebase-client](https://www.npmjs.com/package/acebase-client) instead.

You can also use a local database in the browser to sync with an AceBase server. To do this, create your database in the browser and pass it as ```cache``` db in ```AceBaseClient```'s storage settings.

```html
<script type="text/javascript" src="https://cdn.jsdelivr.net/npm/acebase@latest/dist/browser.min.js"></script>
<script type="text/javascript">
    // Create an AceBase db using IndexedDB
    const db = AceBase.WithIndexedDB('mydb');
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
            console.log(`Got "${snap.ref.path}" value:`);
            console.log(snap.val());
        });
    });

    // Or, Create an AceBase db using localStorage:
    const db2 = AceBase.WithLocalStorage('mydb', { temp: false }); // temp:true to use sessionStorage instead
</script>
```

If you are using TypeScript (eg with Angular/Ionic), use:
```typescript
import { AceBase } from 'acebase';
const db = AceBase.WithIndexedDB('dbname'); 
```

<a name="sqllite-mssql-storage"></a>
## Using a CustomStorage backend (NEW v0.9.22)

It is now possible to store data in your own custom storage backend. To do this, you only have to provide a couple of methods to get, set and remove data and you're done. 

The example below shows how to implement a ```CustomStorage``` class that uses the browser's localStorage (NOTE: you can also use ```AceBase.WithLocalStorage``` described above to do the same):

```javascript
const { AceBase, CustomStorageSettings, CustomStorageTransaction, CustomStorageHelpers } = require('acebase');

const dbname = 'test';

// Setup our CustomStorageSettings
const storageSettings = new CustomStorageSettings({
    name: 'LocalStorage',
    locking: true, // Let AceBase handle resource locking to prevent multiple simultanious updates to the same data. NOTE: This does not prevent multiple tabs from doing this!!
    
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
        // All changes have already been committed
        return Promise.resolve();
    }
    
    rollback(err) {
        // Not able to rollback changes, because we did not keep track
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

<a name="reflect-api"></a>
## Reflect API

AceBase has a built-in reflection API that enables browsing the database content without retrieving any (nested) data. This API is available for local databases, and remote databases ~~when signed in as the ```admin``` user~~ (from server v0.9.29+) on paths the authenticated user has access to.

The reflect API is also used internally: AceBase server's webmanager uses it to allow database exploration, and the ```DataReference``` class uses it to deliver results for ```count()``` and initial ```notify_child_added``` event callbacks.

<a name="reflect-info"></a>
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

<a name="reflect-children"></a>
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

<a name="export-api"></a>
## Export API (NEW v0.9.1)

To export data from any node to json, you can use the export API. Simply pass an object that has a ```write``` method to ```yourRef.export```, and the entire node's value (including nested data) will be streamed in ```json``` format. If your ```write``` function returns a ```Promise```, streaming will be paused until the promise resolves (local databases only). You can use this to back off writing if the target stream's buffer is full (eg while waiting for a file stream to "drain"). This API is available for local databases, and remote databases 
~~when signed in as the ```admin``` user~~ (from server v0.9.29+) on paths the authenticated user has access to.

```javascript
let json = '';
let stream = {
    write(str) {
        json += str;
    }
}
db.ref('posts').export(stream)
.then(() => {
    console.log('All posts have been exported:');
    console.log(json);
})
```

<a name="upgrade-notices"></a>
## Upgrade notices

* v0.7.0 - Changed DataReference.vars object for subscription events, it now contains all values for path wildcards and variables with their index, and (for named variables:) ```name``` and ($-)prefixed ```$name```. The ```wildcards``` array has been removed. See *Using variables and wildcards in subscription paths* in the documentation above.

* v0.6.0 - Changed ```db.types.bind``` method signature. Serialization and creator functions can now also access the ```DataReference``` for the object being serialized/instantiated, this enables the use of path variables.

* v0.4.0 - introduced fulltext, geo and array indexes. This required making changes to the index file format, you will have to delete all index files and create them again using ```db.indexes.create```.

<a name="known-issues"></a>
## Known issues

* No currently known issues. Please submit any issues you might find in the respective GitHub repository! For this repository go to [AceBase issues](https://github.com/appy-one/acebase/issues)

* FIXED: Before v0.9.18 Fulltext indexes were only able to index words with latin characters. All indexed texts are now stored "unidecoded", meaning that all unicode characters are translated into ascii characters and become searchable in both ways. Eg: Japanese "AceBaseはクールです" is indexed as "acebase wa kurudesu" and will be found with queries on both "クール", "kūru" and "kuru". (NOTE: Google translate says this is Japanese for "AceBase is cool", I had no idea..)

* FIXED: Before v0.9.11, indexes were not updated when the indexed key or included keys were updated. Also, there was an issue when indexed nodes were removed, corrupting the index file in some cases.

* FIXED: Before v0.8.0, event listening on the root node would have caused errors.

* FIXED: Before v0.7.0 ```fulltext:!contains``` queries on FullText indexes, and ```!contains``` queries on Array indexes did not produce the right results.

* FIXED: Before v0.7.0 index building was done in memory (heap), which could cause a "v8::internal::FatalProcessOutOfMemory" (JavaScript heap out of memory) crash on larger datasets. From v0.4.3 it used an output stream and allows for larger indexes to be created, but was still vulnerable to this issue. v0.7.0 now completely builds indexes using streams from/to disk, eliminating memory issues.

<a name="authors"></a>
## Authors

* **Ewout Stortenbeker** - *Initial work* - <me@appy.one>
* **You?** Please contribute!

<a name="contributing"></a>
## Contributing

If you would like to contribute to help move the project forward, you are welcome to do so!
What can you help me with?

* Bugfixes - if you find bugs please create a new issue on github. If you know how to fix one, feel free to submit a pull request or drop me an email
* Enhancements - if you've got code to make AceBase even faster or better, you're welcome to contribute!
* Ports - If you would like to port ```AceBaseClient``` to other languages (Java, Swift, C#, etc) that would be awesome!
* Ideas - I love new ideas, share them!
* Money - I am an independant developer and many (MANY) months were put into developing this. I also have a family to feed so if you like AceBase, feel free to send me a donation 👌

<a name="buy-me-coffee"></a>
## Buy me a coffee

If you like AceBase, please consider supporting its development by buying me a coffee or sending a donation!

* [Buy me a coffee](https://www.buymeacoffee.com/appyone)
* [Donate with PayPal](https://paypal.me/theappyone)
* BTC address: 3EgetGDnG9vvfJzjLYdKwWvZpHwePKNJYc

You rock! 🎸