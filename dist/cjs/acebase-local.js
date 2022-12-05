"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AceBase = exports.AceBaseLocalSettings = exports.IndexedDBStorageSettings = exports.LocalStorageSettings = void 0;
const acebase_core_1 = require("acebase-core");
const binary_1 = require("./storage/binary");
const api_local_1 = require("./api-local");
const local_storage_1 = require("./storage/custom/local-storage");
Object.defineProperty(exports, "LocalStorageSettings", { enumerable: true, get: function () { return local_storage_1.LocalStorageSettings; } });
const settings_1 = require("./storage/custom/indexed-db/settings");
Object.defineProperty(exports, "IndexedDBStorageSettings", { enumerable: true, get: function () { return settings_1.IndexedDBStorageSettings; } });
class AceBaseLocalSettings extends acebase_core_1.AceBaseBaseSettings {
    constructor(options = {}) {
        super(options);
        if (options.storage) {
            this.storage = options.storage;
            // If they were set on global settings, copy IPC and transaction settings to storage settings
            if (options.ipc) {
                this.storage.ipc = options.ipc;
            }
            if (options.transactions) {
                this.storage.transactions = options.transactions;
            }
        }
    }
}
exports.AceBaseLocalSettings = AceBaseLocalSettings;
class AceBase extends acebase_core_1.AceBaseBase {
    /**
     * @param dbname Name of the database to open or create
     */
    constructor(dbname, init = {}) {
        const settings = new AceBaseLocalSettings(init);
        super(dbname, settings);
        this.recovery = {
            /**
             * Repairs a node that cannot be loaded by removing the reference from its parent, or marking it as removed
             */
            repairNode: async (path, options) => {
                await this.ready();
                if (this.api.storage instanceof binary_1.AceBaseStorage) {
                    await this.api.storage.repairNode(path, options);
                }
                else if (!this.api.storage.repairNode) {
                    throw new Error(`repairNode is not supported with chosen storage engine`);
                }
            },
            /**
             * Repairs a node that uses a B+Tree for its keys (100+ children).
             * See https://github.com/appy-one/acebase/issues/183
             * @param path Target path to fix
             */
            repairNodeTree: async (path) => {
                await this.ready();
                const storage = this.api.storage;
                await storage.repairNodeTree(path);
            },
        };
        const apiSettings = {
            db: this,
            settings,
        };
        this.api = new api_local_1.LocalApi(dbname, apiSettings, () => {
            this.emit('ready');
        });
    }
    async close() {
        // Close the database by calling exit on the ipc channel, which will emit an 'exit' event when the database can be safely closed.
        await this.api.storage.close();
    }
    get settings() {
        const ipc = this.api.storage.ipc, debug = this.debug;
        return {
            get logLevel() { return debug.level; },
            set logLevel(level) { debug.setLevel(level); },
            get ipcEvents() { return ipc.eventsEnabled; },
            set ipcEvents(enabled) { ipc.eventsEnabled = enabled; },
        };
    }
    /**
     * Creates an AceBase database instance using LocalStorage or SessionStorage as storage engine. When running in non-browser environments, set
     * settings.provider to a custom LocalStorage provider, eg 'node-localstorage'
     * @param dbname Name of the database
     * @param settings optional settings
     */
    static WithLocalStorage(dbname, settings = {}) {
        const db = (0, local_storage_1.createLocalStorageInstance)(dbname, settings);
        return db;
    }
    /**
     * Creates an AceBase database instance using IndexedDB as storage engine. Only available in browser contexts!
     * @param dbname Name of the database
     * @param settings optional settings
     */
    static WithIndexedDB(dbname, init = {}) {
        throw new Error(`IndexedDB storage can only be used in browser contexts`);
    }
}
exports.AceBase = AceBase;
//# sourceMappingURL=acebase-local.js.map