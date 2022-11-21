"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDataSetPath = exports.readDataSet = void 0;
const promises_1 = require("fs/promises");
const path_1 = require("path");
async function readDataSet(name) {
    const path = getDataSetPath(name);
    const file = await (0, promises_1.readFile)(path, 'utf8');
    return JSON.parse(file);
}
exports.readDataSet = readDataSet;
function getDataSetPath(name) {
    const path = (0, path_1.resolve)(__dirname, '../../../spec/dataset'); // dir relative to dist/[cjs|esm]/test
    return `${path}/${name}.json`;
}
exports.getDataSetPath = getDataSetPath;
//# sourceMappingURL=dataset.js.map