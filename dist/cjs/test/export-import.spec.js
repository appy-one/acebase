"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tempdb_1 = require("./tempdb");
const fs_1 = require("fs");
const acebase_core_1 = require("acebase-core");
describe('export/import', () => {
    let db, removeDB;
    beforeAll(async () => {
        ({ db, removeDB } = await (0, tempdb_1.createTempDB)());
    });
    afterAll(async () => {
        await removeDB();
    });
    it('export string escaping', async () => {
        // Backslash test inspired by issue #56 https://github.com/appy-one/acebase/issues/56
        const ref = db.ref('backslashes');
        await ref.set({ text: 'Strings with multiple \\ backslashes \\ are \\ exported ok' });
        let json = '';
        await ref.export(str => { json += str; });
        expect(json).toEqual(`{"text":"Strings with multiple \\\\ backslashes \\\\ are \\\\ exported ok"}`);
        const obj = JSON.parse(json);
        expect(obj.text).toEqual('Strings with multiple \\ backslashes \\ are \\ exported ok');
    });
    it('typesafety', async () => {
        // Test typesafety of non-JSON data, inspired by issue #57 https://github.com/appy-one/acebase/issues/57
        const ref = db.ref('typesafety');
        const obj = {
            text: 'Checking typesafety',
            date: new Date(),
            binary: new Uint8Array([98, 105, 110, 97, 114, 121, 32, 100, 97, 116, 97]),
            reference: new acebase_core_1.PathReference('some/other/data'),
        };
        await ref.set(obj);
        let json = '';
        await ref.export(str => { json += str; });
        expect(json).toEqual(`{"text":"Checking typesafety","date":{".type":"date",".val":"${obj.date.toISOString()}"},"binary":{".type":"binary",".val":"<~@VK^gEd8d<@<>o~>"},"reference":{".type":"reference",".val":"some/other/data"}}`);
        // Now import again
        let index = 0;
        await ref.import(length => {
            const data = json.slice(index, index + length);
            index += data.length;
            return data;
        });
        const obj2 = (await ref.get()).val();
        expect(obj2.date).toBeInstanceOf(Date);
        expect(obj2.binary).toBeInstanceOf(ArrayBuffer);
        expect(obj2.reference).toBeInstanceOf(acebase_core_1.PathReference);
        obj2.binary = new Uint8Array(obj2.binary); // Convert ArrayBuffer to Uint8Array for value comparison
        expect(obj2).toEqual(obj);
    });
    it('import local datasets', async () => {
        const importFile = async (filename, path) => {
            const fd = (0, fs_1.openSync)(filename, 'r');
            const readBytes = (length) => {
                return new Promise((resolve, reject) => {
                    const buffer = new Uint8Array(length);
                    (0, fs_1.read)(fd, buffer, 0, length, null, err => {
                        if (err) {
                            reject(err);
                        }
                        else {
                            resolve(buffer);
                        }
                    });
                });
            };
            await db.ref(path).import(readBytes);
            (0, fs_1.closeSync)(fd);
            // Alternative: use read stream (ignores size argument because if too large, read returns null)
            // const stream = fs.createReadStream(filename, { encoding: 'utf-8' });
            // await new Promise(resolve => stream.once('readable', resolve));
            // let eof = false;
            // stream.once('end', () => { eof = true; })
            // const read = async (size) => {
            //     const data = stream.read();
            //     if (data === null) {
            //         if (eof) { throw new Error('Unexpected EOF'); }
            //         await new Promise(resolve => stream.once('readable', resolve));
            //         data = stream.read();
            //     }
            //     return data;
            // };
            // await db.ref(path).import(read);
            // stream.close();
        };
        // Import movies dataset. TODO: use larger dataset from https://raw.githubusercontent.com/prust/wikipedia-movie-data/master/movies.json
        await importFile(__dirname + '/dataset/movies.json', 'movies');
        // Import meteorites dataset
        await importFile(__dirname + '/dataset/meteorites.json', 'meteorites');
        // TODO: Check data now
    }, 1000e3);
});
//# sourceMappingURL=export-import.spec.js.map