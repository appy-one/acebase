const { AceBase, ID } = require('..');
const { pfs } = require('../src/promise-fs');

module.exports = {
    /**
     *
     * @param {{ transactionLogging?: boolean; logLevel?: 'verbose'|'log'|'warn'|'error'; config?: (options: any) => void }} enable
     * @returns
     */
    async createTempDB(enable = {}) {
        // Create temp db
        const dbname = 'test-' + ID.generate();
        const options = { storage: { path: __dirname }, logLevel: enable.logLevel || 'log' };
        if (enable.transactionLogging === true) {
            options.transactions = { log: true };
        }
        if (typeof enable.config === 'function') {
            enable.config(options);
        }
        const db = new AceBase(dbname, options);
        await db.ready();

        const nodeVersion = process.versions.node.split('.').reduce((v, n, i) => (v[i === 0 ? 'major' : i === 1 ? 'minor' : 'patch'] = +n, v), { major: 0, minor: 0, patch: 0 });
        const removeDB = async () => {
            // Close database
            await db.close();

            // Remove database
            const dbdir = `${__dirname}/${dbname}.acebase`;

            if (nodeVersion.major < 12) {
                // console.error(`Node ${process.version} cannot remove temp database directory ${dbdir}. Remove it manually!`);
                const files = await pfs.readdir(dbdir);
                await Promise.all(files.map(file => pfs.rm(dbdir + '/' + file)));
                await pfs.rmdir(dbdir);
            }
            else {
                await pfs.rmdir(dbdir, { recursive: true, maxRetries: 10 });
            }
        };

        return { db, removeDB };
    },
};
