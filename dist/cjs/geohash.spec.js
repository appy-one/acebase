"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const geohash_1 = require("./geohash");
describe('Geohash', () => {
    it('encode', () => {
        let geohash = (0, geohash_1.encode)(52.205, 0.119, 7); // geohash: 'u120fxw'
        expect(geohash).toEqual('u120fxw');
        geohash = (0, geohash_1.encode)(52.359157, 4.884155, 8);
        expect(geohash).toBe('u173z5sw');
    });
    it('decode', () => {
        let coords = (0, geohash_1.decode)('u120fxw');
        expect(coords).toEqual({ lat: 52.205, lon: 0.1188 });
        coords = (0, geohash_1.decode)('u173z5sw');
        expect(coords).toEqual({ lat: 52.35921, lon: 4.88428 });
    });
});
//# sourceMappingURL=geohash.spec.js.map