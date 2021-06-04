/// <reference types="@types/jasmine" />
const { Uint8ArrayBuilder } = require('../src/binary');

describe('Uint8ArrayBuilder', () => {
    it('write grows the buffer', () => {
        const builder = new Uint8ArrayBuilder();
        const bytesPerWrite = 500;
        for(let i = 0; i < 100; i++) {
            const data = new Uint8Array(bytesPerWrite);
            data.fill(i);
            builder.write(data, i * bytesPerWrite);
        }
        expect(builder.data.byteLength).toEqual(100 * bytesPerWrite);
        // Check written data
        for (let i = 0, nr = 0; i < builder.data.byteLength; i++, i % bytesPerWrite === 0 && nr++) {
            expect(builder.data[i]).toEqual(nr);
        }
    });
    it('append grows the buffer', () => {
        const builder = new Uint8ArrayBuilder();
        const bytesPerWrite = 500;
        for(let i = 0; i < 100; i++) {
            const data = new Uint8Array(bytesPerWrite);
            data.fill(i);
            builder.append(data);
        }
        expect(builder.data.byteLength).toEqual(100 * bytesPerWrite);
        // Check written data
        for (let i = 0, nr = 0; i < builder.data.byteLength; i++, i % bytesPerWrite === 0 && nr++) {
            expect(builder.data[i]).toEqual(nr);
        }
    });
    it('writeInt32 - positive', () => {
        const builder = new Uint8ArrayBuilder();
        builder.writeInt32(0xfedc);
        builder.writeInt32_old(0xfedc);
        expect(builder.data[0]).toEqual(builder.data[4]);
        expect(builder.data[1]).toEqual(builder.data[5]);
        expect(builder.data[2]).toEqual(builder.data[6]);
        expect(builder.data[3]).toEqual(builder.data[7]);
    });
    it('writeInt32 - negative', () => {
        const builder = new Uint8ArrayBuilder();
        builder.writeInt32(-0xfedc);
        builder.writeInt32_old(-0xfedc);
        expect(builder.data[0]).toEqual(builder.data[4]);
        expect(builder.data[1]).toEqual(builder.data[5]);
        expect(builder.data[2]).toEqual(builder.data[6]);
        expect(builder.data[3]).toEqual(builder.data[7]);
    });
    it('writeUint32', () => {
        const builder = new Uint8ArrayBuilder();
        builder.writeUint32(0xfedc);
        builder.writeUint32_old(0xfedc);
        expect(builder.data[0]).toEqual(builder.data[4]);
        expect(builder.data[1]).toEqual(builder.data[5]);
        expect(builder.data[2]).toEqual(builder.data[6]);
        expect(builder.data[3]).toEqual(builder.data[7]);
    });

    // writeInt48 is used by B+Trees (indexes) to write relative node/leaf offsets
    it('writeInt48 - positive', () => {
        const builder = new Uint8ArrayBuilder();
        builder.writeInt48(0xfedcba);
        builder.writeInt48_old(0xfedcba);
        expect(builder.data[0]).toEqual(builder.data[6]);
        expect(builder.data[1]).toEqual(builder.data[7]);
        expect(builder.data[2]).toEqual(builder.data[8]);
        expect(builder.data[3]).toEqual(builder.data[9]);
        expect(builder.data[4]).toEqual(builder.data[10]);
        expect(builder.data[5]).toEqual(builder.data[11]);
    });
    it('writeInt48 - negative', () => {
        const builder = new Uint8ArrayBuilder();
        builder.writeInt48(-0xfedcba);
        builder.writeInt48_old(-0xfedcba);
        expect(builder.data[0]).toEqual(builder.data[6]);
        expect(builder.data[1]).toEqual(builder.data[7]);
        expect(builder.data[2]).toEqual(builder.data[8]);
        expect(builder.data[3]).toEqual(builder.data[9]);
        expect(builder.data[4]).toEqual(builder.data[10]);
        expect(builder.data[5]).toEqual(builder.data[11]);
    });
})