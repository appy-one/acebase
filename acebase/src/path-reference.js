class PathReference {
    /**
     * Creates a reference to a path that can be stored in the database. Use this to create cross-references to other data in your database
     * @param {string} path
     */
    constructor(path) {
        this.path = path;
    }
}
module.exports = { PathReference };