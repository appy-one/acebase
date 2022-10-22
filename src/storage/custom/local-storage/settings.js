"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalStorageSettings = void 0;
const __1 = require("../..");
class LocalStorageSettings extends __1.StorageSettings {
    constructor(settings) {
        super(settings);
        /**
         * whether to use sessionStorage instead of localStorage
         * @default false
         */
        this.temp = false;
        /**
         * Whether to enable cross-tab synchronization
         * @default false
         */
        this.multipleTabs = false;
        if (typeof settings.temp === 'boolean') {
            this.temp = settings.temp;
        }
        if (typeof settings.provider === 'object') {
            this.provider = settings.provider;
        }
        if (typeof settings.multipleTabs === 'boolean') {
            this.multipleTabs = settings.multipleTabs;
        }
        if (typeof settings.logLevel === 'string') {
            this.logLevel = settings.logLevel;
        }
        if (typeof settings.sponsor === 'boolean') {
            this.sponsor = settings.sponsor;
        }
        ['type', 'ipc', 'path'].forEach((prop) => {
            if (prop in settings) {
                console.warn(`${prop} setting is not supported for AceBase LocalStorage`);
            }
        });
    }
}
exports.LocalStorageSettings = LocalStorageSettings;
//# sourceMappingURL=settings.js.map