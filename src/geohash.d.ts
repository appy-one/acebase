/**
 * Encodes latitude/longitude to geohash, either to specified precision or to automatically
 * evaluated precision.
 * @param lat - Latitude in degrees.
 * @param lon - Longitude in degrees.
 * @param precision - Number of characters in resulting
 * @returns Geohash of supplied latitude/longitude.
 * @example
 * let geohash = encode(52.205, 0.119, 7); // geohash: 'u120fxw'
 */
export declare const encode: (lat: number, lon: number, precision?: number) => string;
/**
 * Decode geohash to latitude/longitude (location is approximate centre of geohash cell,
 * to reasonable precision).
 * @param geohash Geohash string to be converted to latitude/longitude.
 * @returns (Center of) geohashed location.
 *
 * @example
 * let latlon = decode('u120fxw'); // latlon: { lat: 52.205, lon: 0.1188 }
 */
export declare const decode: (geohash: string) => {
    lat: number;
    lon: number;
};
/**
 * Returns SW/NE latitude/longitude bounds of specified cell
 * @param geohash Cell that bounds are required of.
 */
export declare const bounds: (geohash: string) => {
    sw: {
        lat: number;
        lon: number;
    };
    ne: {
        lat: number;
        lon: number;
    };
};
/**
 * Determines adjacent cell in given direction.
 * @param geohash Cell to which adjacent cell is required.
 * @param direction Direction from geohash (N/S/E/W).
 * @returns Geocode of adjacent cell.
 * @throws  Invalid
 */
export declare const adjacent: (geohash: string, direction: 'N' | 'n' | 'S' | 's' | 'E' | 'e' | 'W' | 'w') => string;
/**
 * Returns all 8 adjacent cells to specified cell
 * @param geohash Geohash neighbours are required of.
 */
export declare const neighbours: (geohash: string) => {
    n: string;
    ne: string;
    e: string;
    se: string;
    s: string;
    sw: string;
    w: string;
    nw: string;
};
//# sourceMappingURL=geohash.d.ts.map