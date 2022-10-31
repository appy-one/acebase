import { DataIndex } from './data-index.js';
import { FullTextIndex } from './fulltext-index.js';
import { GeoIndex } from './geo-index.js';
import { ArrayIndex } from './array-index.js';
export { DataIndex, FullTextIndex, GeoIndex, ArrayIndex };
export { IndexQueryResults } from './query-results.js';
DataIndex.KnownIndexTypes = {
    normal: DataIndex,
    fulltext: FullTextIndex,
    geo: GeoIndex,
    array: ArrayIndex,
};
//# sourceMappingURL=index.js.map