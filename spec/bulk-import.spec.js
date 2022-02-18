/// <reference types="@types/jasmine" />
const { createTempDB } = require("./tempdb");
const util = require('util');
const fs = require('fs');
const { PathReference, ID } = require("acebase-core");

describe('bulk import', () => {
    let db, removeDB;

    beforeAll(async ()=> {
        ({ db, removeDB } = await createTempDB({ config(options) { 
            options.logLevel = 'warn'; 
            options.storage.lockTimeout = 120;
            options.storage.pageSize = 8192; // 65536;
            options.storage.recordSize = 1024;
        }}));
    });
    afterAll(async () => {
        await removeDB();
    });

    it('batched performance', async () => {
        // Test based on https://github.com/appy-one/acebase/issues/65
        return; // This test takes at least an hour on a fast system

        // Generate 4GB of data in 3 million records - that's an average of 1432 bytes per record
        // We'll use a generated ID for each record (24 bytes), and an array of 50 strings of 28 bytes (14 utf-8 characters) each (28 * 50 = 1400 bytes)
        const path = '';
        const log = console.log.bind(console);
        const frac = (n, total) => `${n} of ${total}`;
        const numStargazerRows = 3_000_000;
        const processLines = async (path, callback) => {
            // Generate 1 CSV line item
            const data = new Array(50).fill('12345678901234').join('\t');
            for (let n = 0; n < numStargazerRows; n++) {
                const key = ID.generate();
                const line = `${key}\t${data}`;
                await callback(line, n);
            }
        }
        
        let giantObj = {};
        await processLines(path + '/data.tsv', async (line, num) => {
            if (num % 10_000 === 0) {
                log('on line', frac(num, numStargazerRows))
                // log('putting batch in database:')
                await db.ref('gazers').update(giantObj)
                log('batch done')
                // log('freeing old obj hopefully')
                giantObj = {}
            }
            const cols = line.split('\t')
            const head = cols[0].replace('/', '!!')
            const tail = cols.slice(1)
            // const obj = tail.reduce((obj, item, i) => obj[i] = item, {}); // SAME SPEED
            // const str = tail.join(','); // MUCH SLOWER?!!!
            giantObj[head] = tail //str //obj //tail
        });
    }, 24 * 60 * 60 * 1000)
});