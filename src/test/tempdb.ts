import { AceBase, ID, AceBaseLocalSettings } from '..';
import { readdir, rm, rmdir } from 'fs/promises';
// import { resolve as resolvePath } from 'path';
import customLogger from './custom-logger';

export async function createTempDB(enable: { transactionLogging?: boolean; logLevel?: 'verbose'|'log'|'warn'|'error'; config?: (options: any) => void } = {}) {
    // Create temp db
    const dbname = 'test-' + ID.generate();
    const options: Partial<AceBaseLocalSettings> = { storage: { path: __dirname }, logLevel: enable.logLevel || 'log' };
    if (enable.transactionLogging === true) {
        options.transactions = { log: true };
    }
    if (typeof enable.config === 'function') {
        enable.config(options);
    }
    // options.storage.ipc = 'socket';
    // options.storage.ipc = { role: 'socket', maxIdleTime: 0, loggerPluginPath: resolvePath(__dirname, 'custom-logger.js') };
    options.logger = customLogger;
    // options.logColors = false;
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
