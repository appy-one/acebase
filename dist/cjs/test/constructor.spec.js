"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const __1 = require("..");
const promises_1 = require("fs/promises");
const removeDB = async (db) => {
    // Make sure it was ready
    await db.ready();
    // Close database
    await db.close();
    // Remove database
    const dbdir = `${db.api.storage.settings.path}/${db.name}.acebase`;
    const files = await (0, promises_1.readdir)(dbdir);
    await Promise.all(files.map(file => (0, promises_1.rm)(dbdir + '/' + file)));
    await (0, promises_1.rmdir)(dbdir);
};
describe('constructor', () => {
    it('without arguments', async () => {
        const db = new __1.AceBase(__1.ID.generate());
        await removeDB(db);
    });
    it('with transaction logging', async () => {
        // See issue https://github.com/appy-one/acebase/issues/74
        const db = new __1.AceBase(__1.ID.generate(), { transactions: { log: true } });
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
        const db = new __1.AceBase(__1.ID.generate(), { ipc: { port: 54321, role: 'master' } });
        await removeDB(db);
    });
});
//# sourceMappingURL=constructor.spec.js.map