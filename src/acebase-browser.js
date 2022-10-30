"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrowserAceBase = void 0;
const acebase_local_1 = require("./acebase-local");
const indexed_db_1 = require("./storage/custom/indexed-db");
const deprecatedConstructorError = `Using AceBase constructor in the browser to use localStorage is deprecated!
Switch to:
IndexedDB implementation (FASTER, MORE RELIABLE):
    let db = AceBase.WithIndexedDB(name, settings)
Or, new LocalStorage implementation:
    let db = AceBase.WithLocalStorage(name, settings)
Or, write your own CustomStorage adapter:
    let myCustomStorage = new CustomStorageSettings({ ... });
    let db = new AceBase(name, { storage: myCustomStorage })`;
class BrowserAceBase extends acebase_local_1.AceBase {
    /**
     * Constructor that is used in browser context
     * @param name database name
     * @param settings settings
     */
    constructor(name, settings) {
        if (typeof settings !== 'object' || typeof settings.storage !== 'object') {
            // Client is using old AceBaseBrowser signature, eg:
            // let db = new AceBase('name', { temp: false })
            //
            // Don't allow this anymore. If client wants to use localStorage,
            // they need to switch to AceBase.WithLocalStorage('name', settings).
            // If they want to use custom storage in the browser, they must
            // use the same constructor signature AceBase has:
            // let db = new AceBase('name', { storage: new CustomStorageSettings({ ... }) });
            throw new Error(deprecatedConstructorError);
        }
        super(name, settings);
        this.settings.ipcEvents = settings.multipleTabs === true;
    }
    /**
     * Creates an AceBase database instance using IndexedDB as storage engine
     * @param dbname Name of the database
     * @param settings optional settings
     */
    static WithIndexedDB(dbname, init = {}) {
        return (0, indexed_db_1.createIndexedDBInstance)(dbname, init);
    }
}
exports.BrowserAceBase = BrowserAceBase;
//# sourceMappingURL=acebase-browser.js.map