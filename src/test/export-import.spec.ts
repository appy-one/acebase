import { createTempDB } from './tempdb';
import { openSync, closeSync, read } from 'fs';
import { PathReference } from 'acebase-core';
import { AceBase } from '..';
import { getDataSetPath } from './dataset';

describe('export/import', () => {
    let db: AceBase, removeDB: () => Promise<void>;

    beforeAll(async ()=> {
        ({ db, removeDB } = await createTempDB());
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
            binary: new Uint8Array([98, 105, 110, 97, 114, 121, 32, 100, 97, 116, 97]), // TextEncoder().encode('binary data'),
            reference: new PathReference('some/other/data'),
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
        expect(obj2.reference).toBeInstanceOf(PathReference);

        obj2.binary = new Uint8Array(obj2.binary); // Convert ArrayBuffer to Uint8Array for value comparison
        expect(obj2).toEqual(obj);
    });

    it('import local datasets', async () => {
        const importFile = async (name: string) => {
            const filePath = getDataSetPath(name);
            const fd = openSync(filePath, 'r');
            const readBytes = (length: number) => {
                return new Promise<Uint8Array>((resolve, reject) => {
                    const buffer = new Uint8Array(length);
                    read(fd, buffer, 0, length, null, err => {
                        if (err) { reject(err); }
                        else { resolve(buffer); }
                    });
                });
            };
            await db.ref(name).import(readBytes);
            closeSync(fd);

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
        await importFile('movies');

        // Import meteorites dataset
        await importFile('meteorites');

        // TODO: Check data now
    }, 1000e3);

    it('export/import roundtrip of ~5MB randomly nested data', async () => {
        // Seeded pseudo-random generator (mulberry32) so failures are reproducible
        const seed = Date.now() >>> 0;
        let state = seed;
        const random = () => {
            state = (state + 0x6D2B79F5) >>> 0;
            let t = state;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        const randomInt = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
        const pick = <T>(arr: T[]) => arr[randomInt(0, arr.length - 1)];

        const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,:;!?-_\'"\n\\äëïöüéèñçß€✓😀';
        const randomString = (maxLength: number) => {
            const length = randomInt(0, maxLength);
            let str = '';
            for (let i = 0; i < length; i++) { str += pick([...chars]); }
            return str;
        };
        // Note: keys cannot contain control characters, \ / [ or ], but quotes are allowed (and must be escaped on export)
        const keyChars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-" ';
        const randomKey = () => {
            const length = randomInt(1, 12);
            let key = '';
            for (let i = 0; i < length; i++) { key += keyChars[randomInt(0, keyChars.length - 1)]; }
            return key;
        };

        // Keep track of approximate generated size
        let generatedBytes = 0;
        const targetBytes = 5 * 1000 * 1000;

        const randomPrimitive = (): any => {
            switch (randomInt(0, 8)) {
                case 0: { const s = randomString(pick([10, 50, 500])); generatedBytes += s.length + 2; return s; }
                case 1: { generatedBytes += 8; return randomInt(-1000000, 1000000); }
                case 2: {
                    generatedBytes += 16;
                    // Include NaN, Infinity and -Infinity, which are not valid JSON and need type-safe exporting
                    return random() < 0.05
                        ? pick([NaN, Infinity, -Infinity])
                        : (random() - 0.5) * Math.pow(10, randomInt(-10, 15));
                }
                case 3: { generatedBytes += 5; return random() < 0.5; }
                case 4: { generatedBytes += 40; return new Date(randomInt(0, 4102444800000)); }
                case 5: {
                    const bytes = new Uint8Array(randomInt(0, pick([16, 100, 1000])));
                    for (let i = 0; i < bytes.length; i++) { bytes[i] = randomInt(0, 255); }
                    generatedBytes += Math.ceil(bytes.length * 1.25) + 30;
                    return bytes;
                }
                case 6: { generatedBytes += 40; return new PathReference(`some/path/${randomKey()}/${randomKey()}`); }
                case 7: { generatedBytes += 40; return BigInt(randomInt(-1e9, 1e9)) * BigInt(randomInt(1, 1e9)) * BigInt(randomInt(1, 1e9)); }
                default: { const s = randomString(20); generatedBytes += s.length + 2; return s; }
            }
        };
        const randomArray = (depth: number): any[] => {
            const length = randomInt(1, 10);
            const arr = [] as any[];
            for (let i = 0; i < length; i++) {
                // Arrays contain either primitives or (shallow) objects
                arr.push(depth > 0 && random() < 0.2 ? randomObject(depth - 1, 5) : randomPrimitive());
            }
            return arr;
        };
        const randomObject = (depth: number, maxChildren: number): Record<string, any> => {
            const obj = {} as Record<string, any>;
            const nrChildren = randomInt(1, maxChildren);
            for (let i = 0; i < nrChildren && generatedBytes < targetBytes; i++) {
                const key = randomKey();
                generatedBytes += key.length + 3;
                const r = random();
                obj[key] = depth > 0 && r < 0.25
                    ? randomObject(depth - 1, maxChildren)
                    : depth > 0 && r < 0.3
                        ? randomArray(depth - 1)
                        : randomPrimitive();
            }
            if (Object.keys(obj).length === 0) {
                obj.value = randomPrimitive();
            }
            return obj;
        };

        const data = {} as Record<string, any>;
        while (generatedBytes < targetBytes) {
            data[`item${Object.keys(data).length}`] = randomObject(6, 15);
        }

        const ref = db.ref('roundtrip');
        await ref.set(data);

        // 1st export
        let export1 = '';
        await ref.export(str => { export1 += str; });
        expect(export1.length).toBeGreaterThan(targetBytes * 0.8);

        // Remove the node
        await ref.remove();
        expect((await ref.get()).exists()).toBeFalse();

        // Import the 1st export
        let index = 0;
        await ref.import(length => {
            const chunk = export1.slice(index, index + length);
            index += chunk.length;
            return chunk;
        });

        // 2nd export must contain the same data as the 1st.
        // Note that the exported JSON strings are not compared directly because property order is not guaranteed:
        // export writes inline values before values stored in their own records, and import may store a child
        // inline first (eg an empty object placeholder) before moving it to its own record.
        let export2 = '';
        await ref.export(str => { export2 += str; });
        expect(export2.length).withContext(`seed ${seed}`).toEqual(export1.length);
        const exported1 = JSON.parse(export1), exported2 = JSON.parse(export2);
        if (!jasmine.matchersUtil.equals(exported2, exported1)) {
            // Narrow down to the first differing top-level item (comparing 5MB objects with toEqual produces unreadable output)
            const key = Object.keys(exported1).find(key => !jasmine.matchersUtil.equals(exported2[key], exported1[key])) as string;
            expect(exported2[key]).withContext(`seed ${seed}, item "${key}"`).toEqual(exported1[key]);
            fail(`Exports differ (seed ${seed})`);
        }

        // Loaded data must equal the generated data
        const normalize = (val: any): any => {
            if (val instanceof ArrayBuffer) { return new Uint8Array(val); }
            if (val instanceof Array) { return val.map(normalize); }
            if (typeof val === 'object' && val !== null && !(val instanceof Date) && !(val instanceof Uint8Array) && !(val instanceof PathReference)) {
                return Object.keys(val).reduce((obj, key) => { obj[key] = normalize(val[key]); return obj; }, {} as Record<string, any>);
            }
            return val;
        };
        const loaded = normalize((await ref.get()).val());
        const isEqual = jasmine.matchersUtil.equals(loaded, data);
        if (!isEqual) {
            // Narrow down to the first differing top-level item
            const key = Object.keys(data).find(key => !jasmine.matchersUtil.equals(loaded[key], data[key])) as string;
            expect(loaded[key]).withContext(`seed ${seed}, item "${key}"`).toEqual(data[key]);
        }
        expect(isEqual).withContext(`seed ${seed}`).toBeTrue();
    }, 600e3);

});
