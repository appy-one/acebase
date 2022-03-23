const { AceBase, ID } = require("..");
const { pfs } = require('../src/promise-fs');

/**
 * 
 * @param {AceBase} db 
 */
const removeDB = async (db) => {
    // Make sure it was ready
    await db.ready();

    // Close database
    await db.close();

    // Remove database
    const dbdir = `${db.api.storage.settings.path}/${db.name}.acebase`;
    const files = await pfs.readdir(dbdir);
    await Promise.all(files.map(file => pfs.rm(dbdir + '/' + file)));
    await pfs.rmdir(dbdir);
}

describe('constructor', () => {

    it('without arguments', async () => {
        const db = new AceBase(ID.generate());
        await removeDB(db);
    });

    it('with transaction logging', async () => {
        // See issue https://github.com/appy-one/acebase/issues/74
        const db = new AceBase(ID.generate(), { transactions: { log: true } });
        await removeDB(db);
    });

    it('with ipc', async () => {
        // This will only work if 'ws' package is installed
        try {
            require('ws');
        }
        catch (err) {
            console.warn('Skipping ipc constructor test because (optional) ws package is not installed');
            return;
        }
        // Use ipc settings with random port in master role
        const db = new AceBase(ID.generate(), { ipc: { port: 54321, role: 'master' } });
        await removeDB(db);
    });

});