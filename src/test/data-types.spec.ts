import { PathReference } from 'acebase-core';
import { AceBase } from '..';
import { createTempDB } from './tempdb';

describe('Data type', () => {
    let db: AceBase, removeDB: () => Promise<void>;
    beforeAll(async () => {
        const tmp = await createTempDB();
        db = tmp.db;
        removeDB = tmp.removeDB;
    });

    it('boolean', async () => {
        // Set to true
        await db.ref('datatypes').update({ boolean: true });

        let snap = await db.ref('datatypes/boolean').get();
        expect(snap.val()).toBeTrue();

        // Set to false
        await db.ref('datatypes').update({ boolean: false });

        snap = await db.ref('datatypes/boolean').get();
        expect(snap.val()).toBeFalse();
    });

    it('number', async () => {
        // Set to 1 (<= 15 will be stored as a "tiny value" using 4 bits)
        await db.ref('datatypes').update({ number: 1 });
        let snap = await db.ref('datatypes/number').get();
        expect(snap.val()).toBe(1);

        // Set to 15 (also tiny value)
        await db.ref('datatypes').update({ number: 15 });
        snap = await db.ref('datatypes/number').get();
        expect(snap.val()).toBe(15);

        // Set to 16 (>15 stored as "small value", stored inline in the parent object node)
        await db.ref('datatypes').update({ number: 16 });
        snap = await db.ref('datatypes/number').get();
        expect(snap.val()).toBe(16);

        // Set to Number.MAX_SAFE_INTEGER
        await db.ref('datatypes').update({ number: Number.MAX_SAFE_INTEGER });
        snap = await db.ref('datatypes/number').get();
        expect(snap.val()).toBe(Number.MAX_SAFE_INTEGER);

        // Set to Number.MAX_VALUE
        await db.ref('datatypes').update({ number: Number.MAX_VALUE });
        snap = await db.ref('datatypes/number').get();
        expect(snap.val()).toBe(Number.MAX_VALUE);

        // Set to negative -1 (should be stored as small value)
        await db.ref('datatypes').update({ number: -1 });
        snap = await db.ref('datatypes/number').get();
        expect(snap.val()).toBe(-1);

        // Set to negative -15 (should be stored as small value)
        await db.ref('datatypes').update({ number: -15 });
        snap = await db.ref('datatypes/number').get();
        expect(snap.val()).toBe(-15);

        // Set to negative -15 (should be stored as small value)
        await db.ref('datatypes').update({ number: -16 });
        snap = await db.ref('datatypes/number').get();
        expect(snap.val()).toBe(-16);

        // Set to Number.MIN_SAFE_INTEGER
        await db.ref('datatypes').update({ number: Number.MIN_SAFE_INTEGER });
        snap = await db.ref('datatypes/number').get();
        expect(snap.val()).toBe(Number.MIN_SAFE_INTEGER);

        // Set to Number.MIN_VALUE
        await db.ref('datatypes').update({ number: Number.MIN_VALUE });
        snap = await db.ref('datatypes/number').get();
        expect(snap.val()).toBe(Number.MIN_VALUE);

        // Set to NaN
        await db.ref('datatypes').update({ number: Number.NaN });
        snap = await db.ref('datatypes/number').get();
        expect(snap.val()).toBeNaN();

        // Set to positive infinity
        await db.ref('datatypes').update({ number: Number.POSITIVE_INFINITY });
        snap = await db.ref('datatypes/number').get();
        expect(snap.val()).toBe(Number.POSITIVE_INFINITY);

        // Set to negative infinity
        await db.ref('datatypes').update({ number: Number.NEGATIVE_INFINITY });
        snap = await db.ref('datatypes/number').get();
        expect(snap.val()).toBe(Number.NEGATIVE_INFINITY);

    });

    it('string', async () => {

        // Set to empty string (stored as "tiny value")
        await db.ref('datatypes').update({ string: '' });
        let snap = await db.ref('datatypes/string').get();
        expect(snap.val()).toBe('');

        // Set to small string (stored as "small value")
        await db.ref('datatypes').update({ string: 'small value' });
        snap = await db.ref('datatypes/string').get();
        expect(snap.val()).toBe('small value');

        // Set to small string (stored as "larger value")
        const larger = `this string will be too long to store inline (in the parent nodes's record). The default inline value length is 50 bytes`;
        await db.ref('datatypes').update({ string: larger });
        snap = await db.ref('datatypes/string').get();
        expect(snap.val()).toBe(larger);

        let str10kb = ''; // Generate 10KB string
        for (let i = 0; i < 1000; i++) {
            str10kb += '0123456789';
        }
        await db.ref('datatypes').update({ string: str10kb });
        snap = await db.ref('datatypes/string').get();
        expect(snap.val()).toBe(str10kb);

        let str5mb = ''; // Generate 5MB string
        for (let i = 0; i < 5 * 1000 * 100; i++) {
            str5mb += '0123456789';
        }
        await db.ref('datatypes').update({ string: str5mb });
        snap = await db.ref('datatypes/string').get();
        expect(snap.val()).toBe(str5mb);
    });

    it('date', async () => {
        // Store minimum date
        await db.ref('datatypes').update({ date: new Date(0) });
        let snap = await db.ref('datatypes/date').get();
        expect(snap.val()).toEqual(new Date(0));

        // Store current date/time
        const now = new Date();
        await db.ref('datatypes').update({ date: now });
        snap = await db.ref('datatypes/date').get();
        expect(snap.val()).toEqual(now);
    });

    it('binary', async () => {
        // Test Uint8Array storage

        // Test "tiny value" (0 bytes)
        let data = new Uint8Array(0);
        await db.ref('datatypes').update({ binary: data });
        let snap = await db.ref('datatypes/binary').get();
        expect(snap.val()).toBeInstanceOf(ArrayBuffer);
        expect(new Uint8Array(snap.val())).toEqual(data);

        // Test small value (<= 50 bytes default, stored inline)
        data = new Uint8Array([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]);
        await db.ref('datatypes').update({ binary: data });
        snap = await db.ref('datatypes/binary').get();
        expect(snap.val()).toBeInstanceOf(ArrayBuffer);
        expect(new Uint8Array(snap.val())).toEqual(data);

        // Test larger value
        data = new Uint8Array(250);
        for(let i = 0 ; i < data.length; i++) {
            data[i] = i;
        }
        await db.ref('datatypes').update({ binary: data });
        snap = await db.ref('datatypes/binary').get();
        expect(snap.val()).toBeInstanceOf(ArrayBuffer);
        expect(new Uint8Array(snap.val())).toEqual(data);

        // Test 5MB value
        data = new Uint8Array(5 * 1000 * 1000);
        for(let i = 0 ; i < data.length; i++) {
            data[i] = i % 255;
        }
        await db.ref('datatypes').update({ binary: data });
        snap = await db.ref('datatypes/binary').get();
        expect(snap.val()).toBeInstanceOf(ArrayBuffer);
        // expect(new Uint8Array(snap.val())).toEqual(data);   // <-- Disabled because Jasmine is very slow to perform this comparison!
        const stored = new Uint8Array(snap.val());
        let isEqual = true;
        for(let i = 0; i < data.length && isEqual; i++) {
            isEqual = data[i] === stored[i];
        }
        expect(isEqual).toBeTrue();
    });

    it('reference', async () => {
        // Test path reference - which is undocumented and currently has no benefits over using plain strings
        const refPath = 'path/to/somehwere/else';
        await db.ref('datatypes').update({ ref: new PathReference(refPath) });
        const snap = await db.ref('datatypes/ref').get();
        expect(snap.val()).toBeInstanceOf(PathReference);
        expect(snap.val().path).toEqual(refPath);
    });

    it('bigint', async () => {
        // Test bigint (new in v1.22.0)
        let val = BigInt(5000);
        await db.ref('datatypes').update({ bigint: val });
        let snap = await db.ref('datatypes/bigint').get();
        expect(snap.val()).toBe(val);

        val = BigInt(1); // Test "tiny" value
        await db.ref('datatypes').update({ bigint: val });
        snap = await db.ref('datatypes/bigint').get();
        expect(snap.val()).toBe(val);

        val = (BigInt(2) ** BigInt(63)) - BigInt(1); // Max (signed) bigint to store in 64 bits: 1st bit is for the sign
        await db.ref('datatypes').update({ bigint: val });
        snap = await db.ref('datatypes/bigint').get();
        expect(snap.val()).toBe(val);

        val = -(BigInt(2) ** BigInt(63)); // Max (negative) bigint to store in 64 bits
        await db.ref('datatypes').update({ bigint: val });
        snap = await db.ref('datatypes/bigint').get();
        expect(snap.val()).toBe(val);

    });

    afterAll(async () => {
        await removeDB();
    });
});
