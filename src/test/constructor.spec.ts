import { AceBase, ID } from '..';
import { readdir, rm, rmdir } from 'fs/promises';

const removeDB = async (db: AceBase) => {
    // Make sure it was ready
    await db.ready();

    // Close database
    await db.close();

    // Remove database
    const dbdir = `${db.api.storage.settings.path}/${db.name}.acebase`;
    const files = await readdir(dbdir);
    await Promise.all(files.map(file => rm(dbdir + '/' + file).catch(err => { if (err.code !== 'ENOENT') { throw err; }})));
    await rmdir(dbdir);
};

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

    it('prevents duplicate file access', async () => {
        const name = ID.generate();
        const db1 = new AceBase(name);
        const db2 = new AceBase(name);
        const counts = { ready: 0, error: 0, total: 0 };
        let thrownError: any;
        await new Promise<void>((resolve, reject) => {
            const event = (arg: any) => {
                counts.total++;
                if (counts.total === 2) { resolve(); }
            };
            const ready = () => { console.log('ready event fired'); event(++counts.ready); };
            const error = (err: any) => { console.log('error event fired'); thrownError = err; event(++counts.error); };
            db1.once('ready', ready);
            db2.once('ready', ready);
            db1.once('error', error);
            db2.once('error', error);
        });
        expect(counts.total).toBe(2);
        expect(counts.ready).toBe(1);
        expect(counts.error).toBe(1);

        // TODO: check thrownError

        await removeDB(db1);
    }, 5000);

});
