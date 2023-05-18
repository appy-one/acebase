import { AceBase, ID } from '../index.js';
import { readdir, rm, rmdir } from 'fs/promises';
export async function createTempDB(enable = {}) {
    // Create temp db
    const dbname = 'test-' + ID.generate();
    const options = { storage: { path: `${process.platform === 'win32' ? '' : '/'}${/file:\/{2,3}(.+)\/[^/]/.exec(import.meta.url)[1]}` }, logLevel: enable.logLevel || 'log' };
    if (enable.transactionLogging === true) {
        options.transactions = { log: true };
    }
    if (typeof enable.config === 'function') {
        enable.config(options);
    }
    options.storage.ipc = 'socket';
    const db = new AceBase(dbname, options);
    await db.ready();
    const nodeVersion = process.versions.node.split('.').reduce((v, n, i) => (v[i === 0 ? 'major' : i === 1 ? 'minor' : 'patch'] = +n, v), { major: 0, minor: 0, patch: 0 });
    const removeDB = async () => {
        // Close database
        await db.close();
        // Remove database
        const dbdir = `${`${process.platform === 'win32' ? '' : '/'}${/file:\/{2,3}(.+)\/[^/]/.exec(import.meta.url)[1]}`}/${dbname}.acebase`;
        if (nodeVersion.major < 12) {
            // console.error(`Node ${process.version} cannot remove temp database directory ${dbdir}. Remove it manually!`);
            const files = await readdir(dbdir);
            await Promise.all(files.map(file => rm(dbdir + '/' + file)));
            await rmdir(dbdir);
        }
        else {
            await rmdir(dbdir, { recursive: true, maxRetries: 10 });
        }
    };
    return { db, removeDB };
}
//# sourceMappingURL=tempdb.js.map