// Used for TS compiler only. Because outDir is different, this makes the import from '../node-lock' work
const { NodeLocker, NodeLock } = require('../node-lock');
module.exports = { NodeLocker, NodeLock }