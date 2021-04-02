"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrowserTabIPC = void 0;
const acebase_core_1 = require("acebase-core");
class BrowserTabIPC {
    static enable(db, name) {
        // Create BroadcastChannel to allow multi-tab communication
        // This allows other tabs to make changes to the database, notifying us of those changes.
        if (typeof window.BroadcastChannel === 'undefined') {
            console.warn(`BroadCastChannel not available, browser tabs IPC not possible yet`);
            return;
        }
        const tabId = acebase_core_1.ID.generate();
        // Keep track of active event subscriptions
        const ourSubscriptions = [];
        const remoteSubscriptions = [];
        const otherTabs = [];
        const channel = new BroadcastChannel(name || db.name); // TODO: polyfill for Safari
        function sendMessage(message) {
            // if (['subscribe_ack','unsubscribe_ack'].includes(message.type)) {
            //     return;
            // }
            console.log(`[BroadcastChannel] sending: `, message);
            channel.postMessage(message);
        }
        // Monitor incoming messages
        channel.addEventListener('message', event => {
            const message = event.data;
            if (message.to && message.to !== tabId) {
                // Message is for somebody else. Ignore
                return;
            }
            console.log(`[BroadcastChannel] received: `, message);
            switch (message.type) {
                case 'hello': {
                    // New browser tab opened
                    if (otherTabs.some(tab => tab.id === message.from)) {
                        // We've seen this tab before. Happens when 2 tabs reload at the same time, both sending initial "hello" message, then both replying to one another.
                        break;
                    }
                    otherTabs.push({ id: message.from, lastSeen: Date.now() });
                    if (message.to === tabId) {
                        // This message was sent to us specifically, so it was a reply to our own "hello". We're done
                        break;
                    }
                    // Reply to sender & inform them about our subscriptions
                    const to = message.from;
                    // Send hello back to sender
                    sendMessage({ type: 'hello', from: tabId, to });
                    // Send our active subscriptions through
                    ourSubscriptions.forEach(sub => {
                        // Request to keep us updated
                        const message = { type: 'subscribe', from: tabId, to, data: { path: sub.path, event: sub.event } };
                        sendMessage(message);
                    });
                    break;
                }
                case 'pulse': {
                    // Other tab letting us know it's still open
                    const tab = otherTabs.find(tab => tab.id === message.from);
                    if (!tab) {
                        // Tab's pulse came before we were introduced with "hello". Ignore
                        return;
                    }
                    tab.lastSeen = Date.now();
                    break;
                }
                case 'bye': {
                    // Other tab is being closed
                    const tab = otherTabs.find(tab => tab.id === message.from);
                    if (!tab) {
                        // We had no knowlegde of this tab's existance. Ignore.
                        return;
                    }
                    // Remove all their events
                    const subscriptions = remoteSubscriptions.filter(sub => sub.for === message.from);
                    subscriptions.forEach(sub => {
                        // Remove & stop subscription
                        remoteSubscriptions.splice(remoteSubscriptions.indexOf(sub), 1);
                        db.api.unsubscribe(sub.path, sub.event, sub.callback);
                    });
                    break;
                }
                case 'subscribe': {
                    // Other tab wants to subscribe to our events
                    const subscribe = message.data;
                    // Subscribe
                    // console.log(`remote subscription being added`);
                    if (remoteSubscriptions.some(sub => sub.for === message.from && sub.event === subscribe.event && sub.path === subscribe.path)) {
                        // We're already serving this event for the other tab. Ignore
                        break;
                    }
                    // Add remote subscription
                    const subscribeCallback = (err, path, val, previous, context) => {
                        // db triggered an event, send notification to remote subscriber
                        let eventMessage = {
                            type: 'event',
                            from: tabId,
                            to: message.from,
                            path: subscribe.path,
                            event: subscribe.event,
                            data: {
                                path,
                                val,
                                previous,
                                context
                            }
                        };
                        sendMessage(eventMessage);
                    };
                    remoteSubscriptions.push({ for: message.from, event: subscribe.event, path: subscribe.path, callback: subscribeCallback });
                    db.api.subscribe(subscribe.path, subscribe.event, subscribeCallback);
                    break;
                }
                case 'unsubscribe': {
                    // Other tab requests to remove previously subscribed event
                    const unsubscribe = message.data;
                    const sub = remoteSubscriptions.find(sub => sub.for === message.from && sub.event === unsubscribe.event && sub.path === unsubscribe.event);
                    if (!sub) {
                        // We don't know this subscription so we weren't notifying in the first place. Ignore
                        return;
                    }
                    // Stop subscription
                    db.api.unsubscribe(unsubscribe.path, unsubscribe.event, sub.callback);
                    break;
                }
                case 'event': {
                    const eventMessage = message;
                    const context = eventMessage.data.context || {};
                    context.acebase_ipc = { type: 'crosstab', origin: eventMessage.from }; // Add IPC details
                    // Other tab raised an event we are monitoring
                    const subscriptions = ourSubscriptions.filter(sub => sub.event === eventMessage.event && sub.path === eventMessage.path);
                    subscriptions.forEach(sub => {
                        sub.callback(null, eventMessage.data.path, eventMessage.data.val, eventMessage.data.previous, context);
                    });
                    break;
                }
                default: {
                    // Other unhandled event
                }
            }
        });
        db.on('subscribe', (subscription) => {
            // Subscription was added to db
            // console.log(`database subscription being added`);
            const remoteSubscription = remoteSubscriptions.find(sub => sub.callback === subscription.callback);
            if (remoteSubscription) {
                // Send ack
                // return sendMessage({ type: 'subscribe_ack', from: tabId, to: remoteSubscription.for, data: { path: subscription.path, event: subscription.event } });
                return;
            }
            const othersAlreadyNotifying = ourSubscriptions.some(sub => sub.event === subscription.event && sub.path === subscription.path);
            // Add subscription
            ourSubscriptions.push(subscription);
            if (othersAlreadyNotifying) {
                // Same subscription as other previously added. Others already know we want to be notified
                return;
            }
            // Request other tabs to keep us updated of this event
            const message = { type: 'subscribe', from: tabId, data: { path: subscription.path, event: subscription.event } };
            sendMessage(message);
        });
        db.on('unsubscribe', (subscription) => {
            // Subscription was removed from db
            const remoteSubscription = remoteSubscriptions.find(sub => sub.callback === subscription.callback);
            if (remoteSubscription) {
                // Remove
                remoteSubscriptions.splice(remoteSubscriptions.indexOf(remoteSubscription), 1);
                // Send ack
                // return sendMessage({ type: 'unsubscribe_ack', from: tabId, to: remoteSubscription.for, data: { path: subscription.path, event: subscription.event } });
                return;
            }
            ourSubscriptions
                .filter(sub => sub.path === subscription.path && (!subscription.event || sub.event === subscription.event) && (!subscription.callback || sub.callback === subscription.callback))
                .forEach(sub => {
                // Remove from our subscriptions
                ourSubscriptions.splice(ourSubscriptions.indexOf(sub), 1);
                // Request other tabs to stop notifying
                const message = { type: 'unsubscribe', from: tabId, data: { path: sub.path, event: sub.event } };
                sendMessage(message);
            });
        });
        // Monitor onbeforeunload event to say goodbye when the window is closed
        window.addEventListener('beforeunload', () => {
            sendMessage({ type: 'bye', from: tabId });
        });
        // Send "hello" to others
        sendMessage({ from: tabId, type: 'hello' });
        // // Schedule periodic "pulse" to let others know we're still around
        // setInterval(() => {
        //     sendMessage(<IPulseMessage>{ from: tabId, type: 'pulse' });
        // }, 30000);
        console.log(`[BroadcastChannel] AceBase multitabs enabled`);
    }
}
exports.BrowserTabIPC = BrowserTabIPC;
//tsc src/index.ts --target es6 --lib es2017 --module commonjs --outDir . -d --sourceMap
//# sourceMappingURL=browser-tabs.js.map