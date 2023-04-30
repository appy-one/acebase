import { BlacklistingSearchOperator } from '../btree/index.js';
import { VALUE_TYPES } from '../node-value-types.js';
import { DataIndex } from './data-index.js';
import { IndexQueryResults } from './query-results.js';
import { IndexQueryStats } from './query-stats.js';
import * as Geohash from '../geohash.js';
function _getGeoRadiusPrecision(radiusM) {
    if (typeof radiusM !== 'number') {
        return;
    }
    if (radiusM < 0.01) {
        return 12;
    }
    if (radiusM < 0.075) {
        return 11;
    }
    if (radiusM < 0.6) {
        return 10;
    }
    if (radiusM < 2.3) {
        return 9;
    }
    if (radiusM < 19) {
        return 8;
    }
    if (radiusM < 76) {
        return 7;
    }
    if (radiusM < 610) {
        return 6;
    }
    if (radiusM < 2400) {
        return 5;
    }
    if (radiusM < 19500) {
        return 4;
    }
    if (radiusM < 78700) {
        return 3;
    }
    if (radiusM < 626000) {
        return 2;
    }
    return 1;
}
function _getGeoHash(obj) {
    if (typeof obj.lat !== 'number' || typeof obj.long !== 'number') {
        return;
    }
    const precision = 10; //_getGeoRadiusPrecision(obj.radius);
    const geohash = Geohash.encode(obj.lat, obj.long, precision);
    return geohash;
}
// Calculates which hashes (of different precisions) are within the radius of a point
function _hashesInRadius(lat, lon, radiusM, precision) {
    const isInCircle = (checkLat, checkLon, lat, lon, radiusM) => {
        const deltaLon = checkLon - lon;
        const deltaLat = checkLat - lat;
        return Math.pow(deltaLon, 2) + Math.pow(deltaLat, 2) <= Math.pow(radiusM, 2);
    };
    const getCentroid = (latitude, longitude, height, width) => {
        const y_cen = latitude + (height / 2);
        const x_cen = longitude + (width / 2);
        return { x: x_cen, y: y_cen };
    };
    const convertToLatLon = (y, x, lat, lon) => {
        const pi = 3.14159265359;
        const r_earth = 6371000;
        const lat_diff = (y / r_earth) * (180 / pi);
        const lon_diff = (x / r_earth) * (180 / pi) / Math.cos(lat * pi / 180);
        const final_lat = lat + lat_diff;
        const final_lon = lon + lon_diff;
        return { lat: final_lat, lon: final_lon };
    };
    const x = 0;
    const y = 0;
    const points = [];
    const geohashes = [];
    const gridWidths = [5009400.0, 1252300.0, 156500.0, 39100.0, 4900.0, 1200.0, 152.9, 38.2, 4.8, 1.2, 0.149, 0.0370];
    const gridHeights = [4992600.0, 624100.0, 156000.0, 19500.0, 4900.0, 609.4, 152.4, 19.0, 4.8, 0.595, 0.149, 0.0199];
    const height = gridHeights[precision - 1] / 2;
    const width = gridWidths[precision - 1] / 2;
    const latMoves = Math.ceil(radiusM / height);
    const lonMoves = Math.ceil(radiusM / width);
    for (let i = 0; i <= latMoves; i++) {
        const tmpLat = y + height * i;
        for (let j = 0; j < lonMoves; j++) {
            const tmpLon = x + width * j;
            if (isInCircle(tmpLat, tmpLon, y, x, radiusM)) {
                const center = getCentroid(tmpLat, tmpLon, height, width);
                points.push(convertToLatLon(center.y, center.x, lat, lon));
                points.push(convertToLatLon(-center.y, center.x, lat, lon));
                points.push(convertToLatLon(center.y, -center.x, lat, lon));
                points.push(convertToLatLon(-center.y, -center.x, lat, lon));
            }
        }
    }
    points.forEach(point => {
        const hash = Geohash.encode(point.lat, point.lon, precision);
        if (geohashes.indexOf(hash) < 0) {
            geohashes.push(hash);
        }
    });
    // Original optionally uses Georaptor compression of geohashes
    // This is my simple implementation
    geohashes.forEach((currentHash, index, arr) => {
        const precision = currentHash.length;
        const parentHash = currentHash.substr(0, precision - 1);
        let hashNeighbourMatches = 0;
        const removeIndexes = [];
        arr.forEach((otherHash, otherIndex) => {
            if (otherHash.startsWith(parentHash)) {
                removeIndexes.push(otherIndex);
                if (otherHash.length == precision) {
                    hashNeighbourMatches++;
                }
            }
        });
        if (hashNeighbourMatches === 32) {
            // All 32 areas of a less precise geohash are included.
            // Replace those with the less precise parent
            for (let i = removeIndexes.length - 1; i >= 0; i--) {
                arr.splice(i, 1);
            }
            arr.splice(index, 0, parentHash);
        }
    });
    return geohashes;
}
export class GeoIndex extends DataIndex {
    constructor(storage, path, key, options) {
        if (key === '{key}') {
            throw new Error('Cannot create geo index on node keys');
        }
        super(storage, path, key, options);
    }
    // get fileName() {
    //     return super.fileName.slice(0, -4) + '.geo.idx';
    // }
    get type() {
        return 'geo';
    }
    async handleRecordUpdate(path, oldValue, newValue) {
        const mutated = { old: {}, new: {} };
        oldValue !== null && typeof oldValue === 'object' && Object.assign(mutated.old, oldValue);
        newValue !== null && typeof newValue === 'object' && Object.assign(mutated.new, newValue);
        if (mutated.old[this.key] !== null && typeof mutated.old[this.key] === 'object') {
            mutated.old[this.key] = _getGeoHash(mutated.old[this.key]);
        }
        if (mutated.new[this.key] !== null && typeof mutated.new[this.key] === 'object') {
            mutated.new[this.key] = _getGeoHash(mutated.new[this.key]);
        }
        super.handleRecordUpdate(path, mutated.old, mutated.new);
    }
    build() {
        return super.build({
            addCallback: (add, obj, recordPointer, metadata) => {
                if (typeof obj !== 'object') {
                    this.storage.debug.warn(`GeoIndex cannot index location because value "${obj}" is not an object`);
                    return;
                }
                if (typeof obj.lat !== 'number' || typeof obj.long !== 'number') {
                    this.storage.debug.warn(`GeoIndex cannot index location because lat (${obj.lat}) or long (${obj.long}) are invalid`);
                    return;
                }
                const geohash = _getGeoHash(obj);
                add(geohash, recordPointer, metadata);
                return geohash;
            },
            valueTypes: [VALUE_TYPES.OBJECT],
        });
    }
    static get validOperators() {
        return ['geo:nearby'];
    }
    get validOperators() {
        return GeoIndex.validOperators;
    }
    test(obj, op, val) {
        if (!this.validOperators.includes(op)) {
            throw new Error(`Unsupported operator "${op}"`);
        }
        if (obj == null || typeof obj !== 'object') {
            // No source object
            return false;
        }
        const src = obj[this.key];
        if (typeof src !== 'object' || typeof src.lat !== 'number' || typeof src.long !== 'number') {
            // source object is not geo
            return false;
        }
        if (typeof val !== 'object' || typeof val.lat !== 'number' || typeof val.long !== 'number' || typeof val.radius !== 'number') {
            // compare object is not geo with radius
            return false;
        }
        const isInCircle = (checkLat, checkLon, lat, lon, radiusM) => {
            const deltaLon = checkLon - lon;
            const deltaLat = checkLat - lat;
            return Math.pow(deltaLon, 2) + Math.pow(deltaLat, 2) <= Math.pow(radiusM, 2);
        };
        return isInCircle(src.lat, src.long, val.lat, val.long, val.radius);
    }
    async query(op, val, options) {
        if (op instanceof BlacklistingSearchOperator) {
            throw new Error(`Not implemented: Can't query geo index with blacklisting operator yet`);
        }
        if (options) {
            this.storage.debug.warn('Not implemented: query options for geo indexes are ignored');
        }
        if (op === 'geo:nearby') {
            if (val === null || typeof val !== 'object' || !('lat' in val) || !('long' in val) || !('radius' in val) || typeof val.lat !== 'number' || typeof val.long !== 'number' || typeof val.radius !== 'number') {
                throw new Error(`geo nearby query expects an object with numeric lat, long and radius properties`);
            }
            return this.nearby(val);
        }
        else {
            throw new Error(`Geo indexes can only be queried with operators ${GeoIndex.validOperators.map(op => `"${op}"`).join(', ')}`);
        }
    }
    /**
     * @param op Only 'geo:nearby' is supported at the moment
     */
    async nearby(val) {
        const op = 'geo:nearby';
        // Check cache
        const cached = this.cache(op, val);
        if (cached) {
            // Use cached results
            return cached;
        }
        if (typeof val.lat !== 'number' || typeof val.long !== 'number' || typeof val.radius !== 'number') {
            throw new Error('geo:nearby query must supply an object with properties .lat, .long and .radius');
        }
        const stats = new IndexQueryStats('geo_nearby_query', val, true);
        const precision = _getGeoRadiusPrecision(val.radius / 10);
        const targetHashes = _hashesInRadius(val.lat, val.long, val.radius, precision);
        stats.queries = targetHashes.length;
        const promises = targetHashes.map(hash => {
            return super.query('like', `${hash}*`);
        });
        const resultSets = await Promise.all(promises);
        // Combine all results
        const results = new IndexQueryResults();
        results.filterKey = this.key;
        resultSets.forEach(set => {
            set.forEach(match => results.push(match));
        });
        stats.stop(results.length);
        results.stats = stats;
        this.cache(op, val, results);
        return results;
    }
}
//# sourceMappingURL=geo-index.js.map