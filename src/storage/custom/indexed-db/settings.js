"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IndexedDBStorageSettings = void 0;
const __1 = require("../..");
class IndexedDBStorageSettings extends __1.StorageSettings {
    constructor(settings) {
        super(settings);
        /**
         * Whether to enable cross-tab synchronization
         * @default false
         */
        this.multipleTabs = false;
        /**
         * How many seconds to keep node info in memory, to speed up IndexedDB performance.
         * @default 60
         */
        this.cacheSeconds = 60;
        /**
         * You can turn this on if you are a sponsor
         * @default false
         */
        this.sponsor = false;
        if (typeof settings.logLevel === 'string') {
            this.logLevel = settings.logLevel;
        }
        if (typeof settings.multipleTabs === 'boolean') {
            this.multipleTabs = settings.multipleTabs;
        }
        if (typeof settings.cacheSeconds === 'number') {
            this.cacheSeconds = settings.cacheSeconds;
        }
        if (typeof settings.sponsor === 'boolean') {
            this.sponsor = settings.sponsor;
        }
        ['type', 'ipc', 'path'].forEach((prop) => {
            if (prop in settings) {
                console.warn(`${prop} setting is not supported for AceBase IndexedDBStorage`);
            }
        });
    }
}
exports.IndexedDBStorageSettings = IndexedDBStorageSettings;
//# sourceMappingURL=settings.js.map