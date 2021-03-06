const { AceBase, ID } = require("..");
const { pfs } = require('../src/promise-fs');

module.exports = {
    async createTempDB(enable = { transactionLogging: false }) {
        // Create temp db
        const dbname = 'test-' + ID.generate();
        const options = { storage: { path: __dirname }, logLevel: 'verbose' };
        if (enable.transactionLogging === true) {
            options.storage.transactions = { log: true };
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