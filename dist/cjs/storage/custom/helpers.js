"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CustomStorageHelpers = void 0;
const acebase_core_1 = require("acebase-core");
/**
 * Helper functions to build custom storage classes with
 */
class CustomStorageHelpers {
    /**
     * Helper function that returns a SQL where clause for all children of given path
     * @param path Path to get children of
     * @param columnName Name of the Path column in your SQL db, default is 'path'
     * @returns Returns the SQL where clause
     */
    static ChildPathsSql(path, columnName = 'path') {
        const where = path === ''
            ? `${columnName} <> '' AND ${columnName} NOT LIKE '%/%'`
            : `(${columnName} LIKE '${path}/%' OR ${columnName} LIKE '${path}[%') AND ${columnName} NOT LIKE '${path}/%/%' AND ${columnName} NOT LIKE '${path}[%]/%' AND ${columnName} NOT LIKE '${path}[%][%'`;
        return where;
    }
    /**
     * Helper function that returns a regular expression to test if paths are children of the given path
     * @param path Path to test children of
     * @returns Returns regular expression to test paths with
     */
    static ChildPathsRegex(path) {
        return new RegExp(`^${path}(?:/[^/[]+|\\[[0-9]+\\])$`);
    }
    /**
     * Helper function that returns a SQL where clause for all descendants of given path
     * @param path Path to get descendants of
     * @param columnName Name of the Path column in your SQL db, default is 'path'
     * @returns Returns the SQL where clause
     */
    static DescendantPathsSql(path, columnName = 'path') {
        const where = path === ''
            ? `${columnName} <> ''`
            : `${columnName} LIKE '${path}/%' OR ${columnName} LIKE '${path}[%'`;
        return where;
    }
    /**
     * Helper function that returns a regular expression to test if paths are descendants of the given path
     * @param path Path to test descendants of
     * @returns Returns regular expression to test paths with
     */
    static DescendantPathsRegex(path) {
        return new RegExp(`^${path}(?:/[^/[]+|\\[[0-9]+\\])`);
    }
    /**
     * PathInfo helper class. Can be used to extract keys from a given path, get parent paths, check if a path is a child or descendant of other path etc
     * @example
     * var pathInfo = CustomStorage.PathInfo.get('my/path/to/data');
     * pathInfo.key === 'data';
     * pathInfo.parentPath === 'my/path/to';
     * pathInfo.pathKeys; // ['my','path','to','data'];
     * pathInfo.isChildOf('my/path/to') === true;
     * pathInfo.isDescendantOf('my/path') === true;
     * pathInfo.isParentOf('my/path/to/data/child') === true;
     * pathInfo.isAncestorOf('my/path/to/data/child/grandchild') === true;
     * pathInfo.childPath('child') === 'my/path/to/data/child';
     * pathInfo.childPath(0) === 'my/path/to/data[0]';
     */
    static get PathInfo() {
        return acebase_core_1.PathInfo;
    }
}
exports.CustomStorageHelpers = CustomStorageHelpers;
//# sourceMappingURL=helpers.js.map