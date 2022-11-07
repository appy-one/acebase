import { AceBase, AceBaseLocalSettings } from './acebase-local';
import { IndexedDBStorageSettings } from './storage/custom/indexed-db/settings';
export declare class BrowserAceBase extends AceBase {
    /**
     * Constructor that is used in browser context
     * @param name database name
     * @param settings settings
     */
    constructor(name: string, settings: Partial<AceBaseLocalSettings> & {
        multipleTabs?: boolean;
    });
    /**
     * Creates an AceBase database instance using IndexedDB as storage engine
     * @param dbname Name of the database
     * @param settings optional settings
     */
    static WithIndexedDB(dbname: string, init?: Partial<IndexedDBStorageSettings>): AceBase;
}
//# sourceMappingURL=acebase-browser.d.ts.map