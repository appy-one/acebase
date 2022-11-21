"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTempDB = void 0;
const __1 = require("..");
const promises_1 = require("fs/promises");
async function createTempDB(enable = {}) {
    // Create temp db
    const dbname = 'test-' + __1.ID.generate();
    const options = { storage: { path: __dirname }, logLevel: enable.logLevel || 'log' };
    if (enable.transactionLogging === true) {
        options.transactions = { log: true };
    }
    if (typeof enable.config === 'function') {
        enable.config(options);
    }
    const db = new __1.AceBase(dbname, options);
    await db.ready();
    const nodeVersion = process.versions.node.split('.').reduce((v, n, i) => (v[i === 0 ? 'major' : i === 1 ? 'minor' : 'patch'] = +n, v), { major: 0, minor: 0, patch: 0 });
    const removeDB = async () => {
        // Close database
        await db.close();
        // Remove database
        const dbdir = `${__dirname}/${dbname}.acebase`;
        if (nodeVersion.major < 12) {
            // console.error(`Node ${process.version} cannot remove temp database directory ${dbdir}. Remove it manually!`);
            const files = await (0, promises_1.readdir)(dbdir);
            await Promise.all(files.map(file => (0, promises_1.rm)(dbdir + '/' + file)));
            await (0, promises_1.rmdir)(dbdir);
        }
        else {
            await (0, promises_1.rmdir)(dbdir, { recursive: true, maxRetries: 10 });
        }
    };
    return { db, removeDB };
}
exports.createTempDB = createTempDB;
//# sourceMappingURL=tempdb.js.map