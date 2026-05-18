import { StorageSettings } from '../storage-settings.js';

export class AceBaseStorageSettings extends StorageSettings {
    /**
     * record size in bytes, defaults to 128 (recommended). Max is 65536
     * @default 128
     */
    recordSize = 128;

    /**
     * page size in records, defaults to 1024 (recommended). Max is 65536
     * @default 1024
     */
    pageSize = 1024;

    /**
     * type of database content. Determines the name of the file within the .acebase directory
     */
    type: 'data' | 'transaction' | 'auth' = 'data';

    /**
     * settings to use for transaction logging
     */
    transactions: AceBaseTransactionLogSettings;

    /**
     * Use future FST version (not implemented yet)
     */
    fst2 = false;

    constructor(settings: Partial<AceBaseStorageSettings> = {}) {
        super(settings);
        if (typeof settings.recordSize === 'number') { this.recordSize = settings.recordSize; }
        if (typeof settings.pageSize === 'number') { this.pageSize = settings.pageSize; }
        if (typeof settings.type === 'string') { this.type = settings.type; }
        this.transactions = new AceBaseTransactionLogSettings(settings.transactions);
    }
}

class AceBaseTransactionLogSettings {

    /**
     * Whether transaction logging is enabled.
     * @default false
     */
    log = false;

    /**
     * Max age of transactions to keep in logfile. Set to 0 to disable cleaning up and keep all transactions
     * @default 30
     */
    maxAge = 30;

    /**
     * Whether write operations wait for the transaction to be logged before resolving their promises.
     */
    noWait = false;

    /**
     * BETA functionality - logs mutations made to a separate database file so they can be retrieved later
     * for database syncing / replication. Implementing this into acebase itself will allow the current
     * sync implementation in acebase-client to become better: it can simply request a mutations stream from
     * the server after disconnects by passing a cursor or timestamp, instead of downloading whole nodes before
     * applying local changes. This will also enable horizontal scaling: replication with remote db instances
     * becomes possible.
     *
     * Still under development, disabled by default. See transaction-logs.spec for tests
     */
    constructor(settings: Partial<AceBaseTransactionLogSettings> = {}) {
        if (typeof settings.log === 'boolean') { this.log = settings.log; }
        if (typeof settings.maxAge === 'number') { this.maxAge = settings.maxAge; }
        if (typeof settings.noWait === 'boolean') { this.noWait = settings.noWait; }
    }
}
