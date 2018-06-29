const Observable = require('observable');

// TODO: Remove observable dependency, replace with own implementation
class EventSubscription {

    constructor() {
        const observable = Observable();
        const subscribers = [];
        let hasValue = false;

        /**
         * Subscribes to new value events
         * @param {function} callback | function(val) to run once a new value is published
         */
        this.subscribe = (callback) => {
            if (typeof callback === "function") {
                if (hasValue) {
                    const stop = observable(callback);
                    subscribers.push({ callback, stop });
                }
                else {
                    subscribers.push({ callback })
                }
            }
        };

        /**
         * For publishing side: adds a value that will trigger callbacks to all subscribers
         * @param {any} val
         */
        this.publish = (val) => {
            observable(val);
            if (!hasValue) {
                hasValue = true;
                subscribers.forEach(sub => {
                    const stop = observable(sub.callback);
                    sub.stop = stop;
                });
            }
        };

        /**
         * Stops monitoring new value events
         * @param {function} callback | (optional) specific callback to remove. Will remove all callbacks when omitted
         */
        this.stop = (callback = undefined) => {
            const remove = callback 
                ? subscribers.filter(sub => sub.callback === callback)
                : subscribers;
            remove.forEach(sub => {
                sub.stop();
                subscribers.splice(subscribers.indexOf(sub));
            });
        };
    }
}

module.exports = { EventSubscription };