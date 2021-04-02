import { AceBaseBase, ID } from "acebase-core";

type AceBaseSubscribeCallback = (error: Error, path: string, newValue: any, oldValue: any, eventContext: any) => void


interface IMessage {
    /**
     * Message type, determines how to handle data
     */
    type: string
    /**
     * Who sends this message (tab id)
     */
    from: string
    /**
     * Who is this message for (not present for broadcast messages)
     */
    to?: string
    /**
     * Optional payload
     */
    data?: any
}

// interface IAcknowledgementMessage extends IMessage {
//     /**
//      * id of the message being acknowledged. (Acknowledgement messages do not have their own id)
//      */
//      id: string
//     /**
//      * Recipient of the acknowledgment
//      */
//      to: string
// }

interface IHelloMessage extends IMessage {
    type: 'hello'
    data: void
}

interface IByeMessage extends IMessage {
    type: 'bye'
    data: void
}

interface IPulseMessage extends IMessage {
    type: 'pulse'
    data: void
}

type AceBaseEventType = string; //'value' | 'child_added' | 'child_changed' | 'child_removed' | 'mutated' | 'mutations' | 'notify_value' | 'notify_child_added' | 'notify_child_changed' | 'notify_child_removed' | 'notify_mutated' | 'notify_mutations'

interface ISubscriptionData {
    path: string
    event: AceBaseEventType    
}

interface ISubscribeMessage extends IMessage {
    type: 'subscribe'
    data: ISubscriptionData
}

// interface ISubscribeAcknowledgement extends IAcknowledgementMessage {
//     type: 'subscribe_ack'
//     data: ISubscriptionData
// }

interface IUnsubscribeMessage extends IMessage {
    type: 'unsubscribe',
    data: ISubscriptionData
}

// interface IUnsubscribeAcknowledgement extends IAcknowledgementMessage {
//     type: 'unsubscribe_ack'
//     data: ISubscriptionData
// }

interface IEventMessage extends IMessage {
    type: 'event'
    event: AceBaseEventType
    /**
     * Path the subscription is on
     */
    path: string
    data: {
        /**
         * The path the event fires on
         */
        path: string
        val?: any
        previous?: any
        context: any
    }
}

export class BrowserTabIPC {

    static enable (db: AceBaseBase, name?: string) {
        // Create BroadcastChannel to allow multi-tab communication
        // This allows other tabs to make changes to the database, notifying us of those changes.

        if (typeof window.BroadcastChannel === 'undefined') {
            console.warn(`BroadCastChannel not available, browser tabs IPC not possible yet`);
            return;
        }

        const tabId = ID.generate();

        // Keep track of active event subscriptions
        const ourSubscriptions: Array<{ path: string, event: AceBaseEventType, callback: AceBaseSubscribeCallback }> = [];
        const remoteSubscriptions: Array<{ for?: string, path: string, event: AceBaseEventType, callback: AceBaseSubscribeCallback }> = [];
        const otherTabs: Array<{ id: string, lastSeen: number }> = [];

        const channel = new BroadcastChannel(name || db.name); // TODO: polyfill for Safari

        function sendMessage(message: IMessage) {
            // if (['subscribe_ack','unsubscribe_ack'].includes(message.type)) {
            //     return;
            // }
            console.log(`[BroadcastChannel] sending: `, message);
            channel.postMessage(message);
        }

        // Monitor incoming messages
        channel.addEventListener('message', event => {
            const message:IMessage = event.data;

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
                    sendMessage(<IHelloMessage> { type: 'hello', from: tabId, to });

                    // Send our active subscriptions through
                    ourSubscriptions.forEach(sub => {
                        // Request to keep us updated
                        const message:ISubscribeMessage = { type: 'subscribe', from: tabId, to, data: { path: sub.path, event: sub.event } };
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
                        (db as any).api.unsubscribe(sub.path, sub.event, sub.callback);                        
                    });
                    break;
                }

                case 'subscribe': {
                    // Other tab wants to subscribe to our events
                    const subscribe:ISubscriptionData = message.data;

                    // Subscribe
                    // console.log(`remote subscription being added`);

                    if (remoteSubscriptions.some(sub => sub.for === message.from && sub.event === subscribe.event && sub.path === subscribe.path)) {
                        // We're already serving this event for the other tab. Ignore
                        break;
                    }

                    // Add remote subscription
                    const subscribeCallback = (err: Error, path: string, val: any, previous: any, context: any) => {
                        // db triggered an event, send notification to remote subscriber
                        let eventMessage: IEventMessage = {
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
                    (db as any).api.subscribe(subscribe.path, subscribe.event, subscribeCallback);
                    break;
                }

                case 'unsubscribe': {
                    // Other tab requests to remove previously subscribed event
                    const unsubscribe:ISubscriptionData = message.data;
                    const sub = remoteSubscriptions.find(sub => sub.for === message.from && sub.event === unsubscribe.event && sub.path === unsubscribe.event);
                    if (!sub) {
                        // We don't know this subscription so we weren't notifying in the first place. Ignore
                        return;
                    }

                    // Stop subscription
                    (db as any).api.unsubscribe(unsubscribe.path, unsubscribe.event, sub.callback);
                    break;
                }

                case 'event': {
                    const eventMessage = message as IEventMessage;
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

        db.on('subscribe', (subscription: { path: string, event: string, callback: AceBaseSubscribeCallback }) => {
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
            const message:ISubscribeMessage = { type: 'subscribe', from: tabId, data: { path: subscription.path, event: subscription.event } };
            sendMessage(message);
        });
        
        db.on('unsubscribe', (subscription: { path: string, event?: string, callback?: AceBaseSubscribeCallback }) => {
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
                const message:IUnsubscribeMessage = { type: 'unsubscribe', from: tabId, data: { path: sub.path, event: sub.event } };
                sendMessage(message);                    
            });

        });

        // Monitor onbeforeunload event to say goodbye when the window is closed
        window.addEventListener('beforeunload', () => {
            sendMessage(<IByeMessage>{ type: 'bye', from: tabId });
        })

        // Send "hello" to others
        sendMessage(<IHelloMessage>{ from: tabId, type: 'hello' });

        // // Schedule periodic "pulse" to let others know we're still around
        // setInterval(() => {
        //     sendMessage(<IPulseMessage>{ from: tabId, type: 'pulse' });
        // }, 30000);

        console.log(`[BroadcastChannel] AceBase multitabs enabled`);
    }
}
//tsc src/index.ts --target es6 --lib es2017 --module commonjs --outDir . -d --sourceMap