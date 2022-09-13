"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IndexQueryResults = exports.ArrayIndex = exports.GeoIndex = exports.FullTextIndex = exports.DataIndex = void 0;
const data_index_1 = require("./data-index");
Object.defineProperty(exports, "DataIndex", { enumerable: true, get: function () { return data_index_1.DataIndex; } });
const fulltext_index_1 = require("./fulltext-index");
Object.defineProperty(exports, "FullTextIndex", { enumerable: true, get: function () { return fulltext_index_1.FullTextIndex; } });
const geo_index_1 = require("./geo-index");
Object.defineProperty(exports, "GeoIndex", { enumerable: true, get: function () { return geo_index_1.GeoIndex; } });
const array_index_1 = require("./array-index");
Object.defineProperty(exports, "ArrayIndex", { enumerable: true, get: function () { return array_index_1.ArrayIndex; } });
var query_results_1 = require("./query-results");
Object.defineProperty(exports, "IndexQueryResults", { enumerable: true, get: function () { return query_results_1.IndexQueryResults; } });
data_index_1.DataIndex.KnownIndexTypes = {
    normal: data_index_1.DataIndex,
    fulltext: fulltext_index_1.FullTextIndex,
    geo: geo_index_1.GeoIndex,
    array: array_index_1.ArrayIndex,
};
//# sourceMappingURL=index.js.map