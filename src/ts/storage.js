// Used for TS compiler only. Because outDir is different, this makes the import from '../storage' work
const { Storage, NodeNotFoundError } = require('../storage');
module.exports = { Storage, NodeNotFoundError };