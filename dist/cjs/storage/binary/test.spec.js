"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tempdb_1 = require("../../test/tempdb");
describe('issue', () => {
    let db, removeDB;
    beforeAll(async () => {
        ({ db, removeDB } = await (0, tempdb_1.createTempDB)({ config(options) {
                options.logLevel = 'warn';
            } }));
    });
    afterAll(async () => {
        await removeDB();
    });
    it('#239', async () => {
        // Created for issue #239 ("TypeError when trying to add new records after removing old ones")
        const ref = db.ref('table');
        // add "large" dataset to the database
        const songIds1 = Array(110).fill(0).map((_value, index) => `id-${index}`);
        await ref.update(songIds1.reduce((obj, songId) => {
            obj[songId] = { playlistId: 'playlist1' };
            return obj;
        }, {}));
        // remove all the added records with the query
        await ref.query().filter('playlistId', '==', 'playlist1').remove();
        // add new "small" dataset to the database -> error
        const songIds2 = Array(10).fill(0).map((_value, index) => `id-${index}`);
        await ref.update(songIds2.reduce((obj, songId) => {
            obj[songId] = { playlistId: 'playlist1' };
            return obj;
        }, {}));
    });
});
//# sourceMappingURL=test.spec.js.map