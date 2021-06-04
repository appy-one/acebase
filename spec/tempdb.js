const { AceBase, ID } = require("..");
const { pfs } = require('../src/promise-fs');

module.exports = {
    async createTempDB() {
        // Create temp db
        const dbname = 'test-' + ID.generate();
        const db = new AceBase(dbname, { storage: { path: __dirname }, logLevel: 'verbose' });
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