import { DataIndex } from './data-index';
import { FullTextIndex } from './fulltext-index';
import { GeoIndex } from './geo-index';
import { ArrayIndex } from './array-index';

export { DataIndex, FullTextIndex, GeoIndex, ArrayIndex };
export { IndexQueryResults } from './query-results';

DataIndex.KnownIndexTypes = {
    normal: DataIndex,
    fulltext: FullTextIndex,
    geo: GeoIndex,
    array: ArrayIndex,
};
