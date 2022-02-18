const { AceBase, ID } = require("..");
const { pfs } = require('../src/promise-fs');

module.exports = {
    async createTempDB(enable = { transactionLogging: false, logLevel: 'log', config: (options) => { } }) {
        // Create temp db
        const dbname = 'test-' + ID.generate();
        const options = { storage: { path: __dirname }, logLevel: enable.logLevel || 'verbose' };
        if (enable.transactionLogging === true) {
            options.transactions = { log: true };
        }
        if (typeof enable.config === 'function') {
            enable.config(options);
        }
        const db = new AceBase(dbname, options);
        await db.ready();

        const removeDB = async () => {
            // Close database
            await db.close();

            // Remove database
            const dbdir = `${__dirname}/${dbname}.acebase`;
            await pfs.rmdir(dbdir, { recursive: true });
        }

        return { db, removeDB };
    }
}