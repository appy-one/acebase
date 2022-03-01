"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pfs = void 0;
const acebase_core_1 = require("acebase-core");
const flags_1 = require("./flags");
// Work in progress: browser fs implementation for working with large binary files
const DEBUG_MODE = false;
// Polyfill for Node.js Buffer
class BrowserBuffer {
    constructor() { throw new Error(`Don't use Buffer constructor, use Buffer.alloc or Buffer.from`); }
    static from(arrayBuffer, byteOffset, length) {
        return new Uint8Array(arrayBuffer, byteOffset, length);
    }
    static alloc(byteLength) {
        return new Uint8Array(byteLength);
    }
}
;
window.Buffer = BrowserBuffer;
class pfs {
    static get hasFileSystem() { return true; } // Yeah!
    static get fs() { return null; }
    static get flags() {
        return flags_1.flags;
    }
    static async exists(path) {
        return exists(path);
    }
    static async open(path, flags, mode) {
        // TODO: flags, mode
        return await openFile(path, flags);
    }
    static async close(fd) {
        return closeFile(fd);
    }
    /**
     * Writes to an open file
     * @param fd file descriptor
     * @param buffer buffer to write to the file
     * @param offset start byte of the buffer to read from, default is 0
     * @param length amount of bytes to write, default is buffer.byteLength-offset
     * @param position offset from the beginning of the file where this data should be written. If typeof position !== 'number', the data will be written at the current position
     * @returns returns a Promise that resolves with an object containing the amount of bytes written and reference to the used buffer source
     */
    static write(fd, buffer, offset, length, position) {
        // NOTE: Changes fs.write behaviour by making offset, length and position optional
        if (typeof offset === 'undefined') {
            offset = 0;
        }
        if (typeof length === 'undefined') {
            length = buffer.byteLength - offset;
        }
        if (typeof position === 'undefined') {
            position = null;
        }
        return write(fd, buffer, offset, length, position);
    }
    /**
     * Asynchronously writes data to a file, replacing the file if it already exists.
     * @param path filename or file descriptor
     * @param data string or binary data to write. if data is a buffer, encoding option is ignored
     * @param options encoding to use or object specifying encoding and/or flag and mode to use.
     * @param options.encoding default is 'utf8'. Not used if data is a buffer
     * @param options.mode
     * @param options.flag see pfs.flags, default is pfs.flags.write ('w')
     * @returns returns a promise that resolves once the file has been written
     */
    static async writeFile(path, data, options) {
        const flag = (typeof options === 'object' && options.flag) || flags_1.flags.write;
        const fd = await openFile(path, flag);
        await truncate(fd, 0);
        if (typeof data === 'string') {
            const encoding = typeof options === 'string' ? options : options === null || options === void 0 ? void 0 : options.encoding;
            if (typeof encoding === 'string' && encoding !== 'utf8') {
                throw new Error(`${encoding} encoding not supported by browser fs`);
            }
            const encoder = new TextEncoder();
            data = encoder.encode(data);
        }
        await write(fd, data, 0, data.byteLength, 0);
        await closeFile(fd);
    }
    /**
     * Reads from an open file
     * @param fd file descriptor
     * @param buffer the buffer that the data will be written to
     * @param offset the offset in the buffer to start writing at, defaults to 0
     * @param length an integer specifying the number of bytes to read, defaults to buffer.byteLength-offset
     * @param position specifying where to begin reading from in the file. If position is null, data will be read from the current file position, and the file position will be updated. If position is an integer, the file position will remain unchanged.
     * @returns returns a promise that resolves with the amount of bytes read and a reference to the buffer that was written to
     */
    static read(fd, buffer, offset, length, position) {
        // NOTE: Changes fs.read behaviour by making offset, length and position optional
        if (typeof offset === 'undefined') {
            offset = 0;
        }
        if (typeof length === 'undefined') {
            length = buffer.byteLength;
        }
        if (typeof position === 'undefined') {
            position = null;
        }
        return read(fd, buffer, offset, length, position);
    }
    /**
     * Asynchronously reads the entire contents of a file.
     * @param path filename or file descriptor
     * @param options encoding to use or object specifying encoding and/or flag to use. 'utf8' will return the read data as a string
     * @param options.encoding default is null, will return the raw buffer.
     * @param options.flag see pfs.flags, default is pfs.flags.read ('r')
     * @returns returns a promise that resolves with a string if an encoding was specified, or a raw buffer otherwise
     */
    static async readFile(path, options) {
        const fd = await openFile(path, flags_1.flags.read);
        const encoding = typeof options === 'string' ? options : options === null || options === void 0 ? void 0 : options.encoding;
        const size = openFiles[fd].stat.size;
        const buffer = new Uint8Array(size); // Buffer.alloc(size);
        await read(fd, buffer, 0, size, 0);
        await closeFile(fd);
        if (typeof encoding === 'string') {
            const decoder = new TextDecoder(encoding);
            return decoder.decode(buffer);
        }
        return buffer;
    }
    /**
     * Truncates a file asynchronously
     * @param path
     * @param len byte length the file will be truncated to, default is 0.
     * @returns returns a promise that resolves once the file has been truncated
     */
    static async truncate(path, len = 0) {
        const fd = await openFile(path, flags_1.flags.write);
        await truncate(fd, len);
        await closeFile(fd);
    }
    /**
     * Truncates an open file asynchronously
     * @param fd file descriptor
     * @param len byte length the file will be truncated to, default is 0.
     * @returns returns a promise that resolves once the file has been truncated
     */
    static async ftruncate(fd, len = 0) {
        await truncate(fd, len);
    }
    /**
     * Reads the contents of a directory. returns a promise that resolves with an array of names or entries
     * @param path
     * @param options can be a string specifying an encoding, or an object with an encoding property specifying the character encoding to use for the filenames passed to the callback. If the encoding is set to 'buffer', the filenames returned will be passed as Buffer objects.
     * @param options.encoding default 'utf8'
     * @param options.withFileTypes default is false
     * @returns returns a promise that resolves with an array of filenames or entries, excluding directories '.' and '..'.
     */
    static async readdir(path, options) {
        const entries = await listDirEntries(path);
        if (typeof options === 'undefined' || (typeof options === 'object' && !options.withFileTypes)) {
            return entries.map(e => e.name);
        }
        return entries;
    }
    /**
     * Asynchronously creates a directory
     * @param path
     * @param options optional, can be an integer specifying mode (permission and sticky bits), or an object with a mode property and a recursive property indicating whether parent folders should be created.
     * @param options.recursive default is false
     * @param options.mode Not supported on Windows. default is 0o777
     * @returns returns a promise that resolves once the dir has been created
     */
    static async mkdir(path, options) {
        // noop
    }
    /**
     * Asynchronously removes a file or symbolic link
     * @param path
     * @returns returns a promise that resolves once the file has been removed
     */
    static async unlink(path) {
        return removeFile(path);
    }
    /**
     * (Alias for unlink) Asynchronously removes a file or symbolic link
     * @param path
     * @returns returns a promise that resolves once the file has been removed
     */
    static rm(path) { return this.unlink(path); }
    /**
     * Asynchronously removes a file or symbolic link
     * @param path
     * @returns returns a promise that resolves once the file has been removed
     */
    static async rmdir(path, options) {
        const entries = await listDirEntries(path);
        for (let entry of entries) {
            if (entry.isDirectory()) {
                if (!(options === null || options === void 0 ? void 0 : options.recursive)) {
                    const err = new Error('Directory not empty');
                    err.code = 'ENOTEMPTY';
                    throw err;
                }
                await this.rmdir(`${path}/${entry.name}`, options);
            }
            else {
                await removeFile(`${path}/${entry.name}`);
            }
        }
    }
    /**
     * Asynchronously rename file at oldPath to the pathname provided as newPath.
     * In the case that newPath already exists, it will be overwritten. If there is
     * a directory at newPath, an error will be raised instead
     * @param oldPath
     * @param newPath
     * @returns returns a promise that resolves once the file has been renamed
     */
    static rename(oldPath, newPath) {
        return rename(oldPath, newPath);
    }
    /**
     * Asynchronous stat(2) - Get file status
     * @param path A path to a file. If a URL is provided, it must use the file:
     * @param options
     * @param options.bigint
     * @returns returns a promise that resolves with the file stats
     */
    static stat(path, options) {
        return stat(path);
    }
    /**
     * Asynchronous fsync(2) - synchronize a file's in-core state with the underlying storage device.
     * @param fd A file descriptor
     * @returns returns a promise that resolves when all data is flushed
     */
    static async fsync(fd) {
        // noop
    }
    /**
     * Asynchronous fdatasync(2) - synchronize a file's in-core state with storage device.
     * @param fd A file descriptor
     * @returns returns a promise that resolves when all data is flushed
     */
    static async fdatasync(fd) {
        // noop
    }
    /**
     * Opens a file and returns a writable stream
     * @param path A path to a file
     * @param options encoding or options
     * @returns Returns a new WriteStream object
     */
    static createWriteStream(path, options) {
        return new WriteStream(path, options);
    }
}
exports.pfs = pfs;
class WriteStream extends acebase_core_1.SimpleEventEmitter {
    constructor(path, options) {
        super();
        this.init(path, options);
    }
    get bytesWritten() {
        return this.state.bytesWritten;
    }
    get path() {
        return this.state.path;
    }
    get pending() {
        return this.state.fileState === 'opening';
    }
    async init(path, options) {
        var _a, _b;
        this.state = { bytesWritten: 0, path, options, fd: null, position: 0, pendingWrites: 0, fileState: 'opening' };
        this.on('error', err => {
            const autoClose = typeof options !== 'object' || options.autoClose === true;
            if (autoClose) {
                this.close();
            }
        });
        // open file
        const flag = (typeof options === 'object' && options.flags) || flags_1.flags.write;
        const alreadyOpen = typeof options === 'object' && typeof options.fd === 'number';
        const fd = alreadyOpen ? options.fd : await openFile(path, flag);
        const file = openFiles[fd];
        if (!file) {
            const err = new Error('File not open');
            return this.emit('error', err);
        }
        if (alreadyOpen) {
            // Read file stat again
            const tx = file.db.transaction('stat', 'readonly');
            file.stat = await readFileStats(tx.objectStore('stat'));
            (_a = tx.commit) === null || _a === void 0 ? void 0 : _a.call(tx);
        }
        const position = ((_b = (typeof options === 'object' && options.start)) !== null && _b !== void 0 ? _b : flag.includes('a')) ? file.stat.size : 0;
        this.state.fd = fd;
        this.state.position = position;
        this.state.fileState = 'open';
        // Emit open & ready events
        this.emitOnce('open');
        this.emitOnce('ready');
    }
    write(chunk) {
        const { state } = this;
        const { fd, position, fileState } = state;
        const length = chunk.byteLength;
        if (length > 0) {
            if (fileState !== 'open') {
                const err = new Error('File is not open');
                return this.emit('error', err);
            }
            state.position += length;
            state.pendingWrites++;
            write(fd, chunk, 0, length, position).then(({ bytesWritten }) => {
                state.pendingWrites--;
                state.bytesWritten += bytesWritten;
                if (state.pendingWrites === 0) {
                    this.emit('drain');
                }
            });
        }
        return state.pendingWrites < 10; // Return true until >= 10 pending writes.
    }
    async end(...args) {
        let chunk;
        let callback;
        if (typeof args[0] === 'function') {
            callback = args[0];
        }
        else if (typeof args[0] === 'object') {
            chunk = args[0];
            if (typeof args[1] === 'function') {
                callback = args[1];
            }
        }
        if (chunk) {
            this.write(chunk);
        }
        await this.close(callback);
    }
    async close(callback) {
        this.state.fileState = 'closing';
        if (this.state.pendingWrites > 0) {
            // Wait until all writes are done
            await this.once('drain');
        }
        // Close it
        await closeFile(this.state.fd);
        this.state.fileState = 'closed';
        const emitClose = typeof this.state.options !== 'object' || this.state.options.emitClose === true;
        if (emitClose) {
            this.emitOnce('close');
        }
        callback === null || callback === void 0 ? void 0 : callback();
    }
}
let lastFd = 0;
const openFiles = {};
/**
 * Inserts or updates a key/key pair
 * @param store Object store to insert/update key/value pair into
 * @param key
 * @param value
 * @returns
 */
const set = (store, key, value) => {
    return new Promise((resolve, reject) => {
        const req = store.put(value, key);
        req.onsuccess = resolve;
        req.onerror = reject;
    });
};
/**
 * Deletes a key/value pair
 * @param store Object store to remove key/value pair from
 * @param key
 * @returns
 */
const remove = (store, key) => {
    return new Promise((resolve, reject) => {
        const req = store.delete(key);
        req.onsuccess = resolve;
        req.onerror = reject;
    });
};
/**
 * Gets te value of a key
 * @param store Object store
 * @param key
 * @returns
 */
const get = (store, key) => {
    return new Promise((resolve, reject) => {
        const req = store.get(key);
        req.onsuccess = () => {
            resolve(req.result);
        };
        req.onerror = reject;
    });
};
const getDbName = (path) => {
    return 'file:' + path; //.replace(/^\.\//, '');
};
const openFile = async (path, flags) => {
    return new Promise((resolve, reject) => {
        const dbName = getDbName(path);
        const request = indexedDB.open(dbName, 1);
        request.onupgradeneeded = async () => {
            // db created
            const db = request.result;
            // Create stat store
            const store = db.createObjectStore('stat');
            const now = new Date();
            await writeFileStats(null, store, { birthtime: now, ctime: now, mtime: now, atime: now, size: 0, blocks: 0, blksize: 4096 }); // Use 4KB blocks
            // Create data store
            db.createObjectStore('data');
        };
        request.onsuccess = async () => {
            var _a;
            // db created / opened
            const db = request.result;
            const tx = db.transaction('stat', 'readwrite');
            const store = tx.objectStore('stat');
            const stat = await readFileStats(store);
            await writeFileStats(null, store, { atime: new Date() }); // Update access time
            (_a = tx.commit) === null || _a === void 0 ? void 0 : _a.call(// Update access time
            tx);
            const position = flags.includes('a') ? stat.size : 0; // If appending, set position to end of file
            const fd = ++lastFd;
            openFiles[fd] = { db, path, position, stat };
            resolve(fd);
        };
        request.onerror = event => reject(event.target);
    });
};
const closeFile = async (fd) => {
    const file = openFiles[fd];
    if (!file) {
        const err = new Error('File not open');
        throw err;
    }
    file.db.close();
    delete openFiles[fd];
};
const removeFile = async (path) => {
    // Delete db
    return new Promise(async (resolve, reject) => {
        const dbName = getDbName(path);
        if (indexedDB.databases) {
            // indexedDB.databases() requires Safari 14+ (iOS / MacOS 14+), Chrome 71+ (-> Android 5+), Egde 79+, No Firefox support
            // indexedDB.deleteDatabase does not throw an error if database does not exist
            // We can emulate real fs behaviour, throwing ENOENT if the file does not exist
            const dbs = await indexedDB.databases();
            if (!dbs.find(db => db.name === dbName)) {
                const err = new Error('File not found');
                err.code = 'ENOENT';
                return reject(err);
            }
        }
        const request = indexedDB.deleteDatabase(dbName);
        request.onblocked = () => {
            const err = new Error(`Deletion of db "${dbName}" is blocked because it is still open`);
            err.code = 'EACCES';
            reject(err);
        };
        request.onsuccess = () => resolve();
        request.onerror = event => reject(event.target);
    });
};
const listDirEntries = async (path) => {
    var _a, _b;
    const dbs = (_b = await ((_a = indexedDB.databases) === null || _a === void 0 ? void 0 : _a.call(indexedDB))) !== null && _b !== void 0 ? _b : [];
    const prefix = `file:${path}`;
    const entries = [];
    dbs.forEach(db => {
        if (!db.name.startsWith(prefix)) {
            return;
        } // Skip
        const name = db.name.slice(prefix.length).replace(/^\/+/, '');
        if (name.includes('/')) {
            // add directory entry
            const dirName = name.slice(0, name.indexOf('/'));
            entries.find(e => e.name === dirName) || entries.push({ name: dirName, isFile: () => true, isDirectory: () => false });
        }
        else {
            // add file entry
            entries.push({ name, isFile: () => true, isDirectory: () => false });
        }
        return name;
    });
    return entries;
};
/**
 * Writes to an open file
 * @param fd file descriptor
 * @param buffer buffer to write to the file
 * @param offset start byte of the buffer to read from, default is 0
 * @param length amount of bytes to write, default is buffer.byteLength-offset
 * @param position offset from the beginning of the file where this data should be written. If typeof position !== 'number', the data will be written at the current position
 * @returns returns a Promise that resolves with an object containing the amount of bytes written and reference to the used buffer source
 */
const write = async (fd, buffer, offset, length, position) => {
    var _a;
    const file = openFiles[fd];
    if (!file) {
        throw new Error('File not open');
    }
    const updatePosition = position === null || position === -1;
    if (updatePosition) {
        position = file.position;
    }
    DEBUG_MODE && console.warn(`File ${file.db.name}: Writing ${length} bytes at position ${position}`);
    // What blocks are being written to?
    const start = getBlockAndOffset(file.stat.blksize, position);
    const end = getBlockAndOffset(file.stat.blksize, position + length);
    if (end.offset === 0) {
        end.block--;
        end.offset = file.stat.blksize;
    }
    // Create transaction
    const tx = file.db.transaction(['data', 'stat'], 'readwrite');
    const dataStore = tx.objectStore('data');
    // Fetch blocks and modify data
    const blocks = await loadBlocks(file, dataStore, start.block, end.block, true);
    let bytesWritten = 0;
    for (let blockNr = start.block; blockNr <= end.block; blockNr++) {
        const block = new Uint8Array(blocks[blockNr]);
        const length = file.stat.blksize - (blockNr === start.block ? start.offset : 0) - (blockNr === end.block ? file.stat.blksize - end.offset : 0);
        const data = new Uint8Array(buffer.buffer, offset + bytesWritten, length);
        block.set(data, blockNr === start.block ? start.offset : 0);
        bytesWritten += length;
    }
    // Write data back to the db
    const sizeChanged = await writeBlocks(file, dataStore, blocks);
    // Update file stats
    const statStore = tx.objectStore('stat');
    const statUpdates = { mtime: new Date() };
    if (position + length > file.stat.size) {
        // Update stats
        statUpdates.blocks = end.block + 1;
        statUpdates.size = position + bytesWritten; //length;
        DEBUG_MODE && console.warn(`File ${file.db.name} size changed to ${file.stat.blocks} blocks, last block written to is ${end.block}`);
    }
    if (updatePosition) {
        file.position += bytesWritten;
    }
    // Write new file stats
    await writeFileStats(file, statStore, statUpdates);
    // Commit
    (_a = tx.commit) === null || _a === void 0 ? void 0 : _a.call(tx);
    return { bytesWritten, buffer };
};
const truncate = async (fd, len) => {
    var _a;
    const file = openFiles[fd];
    if (!file) {
        throw new Error('File not open');
    }
    // Create transaction
    const tx = file.db.transaction(['data', 'stat'], 'readwrite');
    // Update file stats
    const statStore = tx.objectStore('stat');
    file.stat = await readFileStats(statStore);
    if (file.stat.size === len) {
        // Filesize stays as it is
        return;
    }
    const store = tx.objectStore('data');
    const statUpdates = { size: len, mtime: new Date() };
    if (file.stat.size < len) {
        // file grows, add blocks
        const to = getBlockAndOffset(file.stat.blksize, len);
        if (to.offset === 0) {
            to.block--;
            to.offset = file.stat.blksize;
        }
        const promises = [];
        const emptyBlock = new ArrayBuffer(file.stat.blksize);
        DEBUG_MODE && console.warn(`truncate: file grows, adding blocks ${file.stat.blocks} to ${to.block}`);
        for (let blockNr = file.stat.blocks; blockNr <= to.block; blockNr++) {
            const p = set(store, blockNr, emptyBlock);
            promises.push(p);
        }
        await Promise.all(promises);
        statUpdates.blocks = to.block + 1;
    }
    else {
        // file shrinks, remove blocks
        const from = getBlockAndOffset(file.stat.blksize, len);
        // Create cursor from start block to the end
        DEBUG_MODE && console.warn(`truncate: file shrinks, removing blocks ${from.block} to ${file.stat.blocks - 1}`);
        await new Promise((resolve, reject) => {
            const cursorRequest = store.openCursor(IDBKeyRange.lowerBound(from.block));
            cursorRequest.onsuccess = async () => {
                const cursor = cursorRequest.result;
                if (!cursor) {
                    return resolve();
                }
                if (cursor.key === from.block && from.offset > 0) {
                    // Overwrite empty space with 0s
                    const buffer = cursor.value;
                    const data = new Uint8Array(buffer, from.offset);
                    data.fill(0);
                    const req = cursor.update(buffer);
                    await new Promise((resolve, reject) => {
                        req.onsuccess = resolve;
                        req.onerror = reject;
                    });
                }
                else {
                    // Remove block
                    const req = cursor.delete();
                    await new Promise((resolve, reject) => {
                        req.onsuccess = resolve;
                        req.onerror = reject;
                    });
                }
                cursor.continue();
            };
            cursorRequest.onerror = event => reject(event.target);
        });
        statUpdates.blocks = len === 0 ? 0 : from.block + 1;
    }
    // Update stats
    await writeFileStats(file, statStore, statUpdates);
    DEBUG_MODE && console.warn(`truncated file ${file.db.name} to ${len} bytes, is now ${file.stat.blocks} blocks`);
    (_a = tx.commit) === null || _a === void 0 ? void 0 : _a.call(tx);
};
/**
 * Reads from an open file
 * @param fd file descriptor
 * @param buffer the buffer that the data will be written to
 * @param offset the offset in the buffer to start writing at
 * @param length an integer specifying the number of bytes to read
 * @param position specifying where to begin reading from in the file. If position is null, data will be read from the current file position, and the file position will be updated. If position is an integer, the file position will remain unchanged.
 * @returns returns a promise that resolves with the amount of bytes read and a reference to the buffer that was written to
 */
const read = async (fd, buffer, offset, length, position) => {
    var _a;
    const file = openFiles[fd];
    if (!file) {
        throw new Error('File not open');
    }
    const updatePosition = position === null || position === -1;
    if (updatePosition) {
        position = file.position;
    }
    // What blocks are being written to?
    const start = getBlockAndOffset(file.stat.blksize, position);
    const end = getBlockAndOffset(file.stat.blksize, position + length);
    if (end.offset === 0) {
        end.block--;
        end.offset = file.stat.blksize;
    }
    // Create transaction
    const tx = file.db.transaction(['data', 'stat'], 'readonly');
    file.stat = await readFileStats(tx.objectStore('stat'));
    const store = tx.objectStore('data');
    // Fetch blocks
    const blocks = await loadBlocks(file, store, start.block, end.block, false);
    (_a = tx.commit) === null || _a === void 0 ? void 0 : _a.call(tx);
    // Copy read data to buffer
    let bytesRead = 0;
    const target = new Uint8Array(buffer.buffer, offset);
    for (let blockNr = start.block; blocks[blockNr] && blockNr <= end.block; blockNr++) {
        const length = file.stat.blksize - (blockNr === start.block ? start.offset : 0) - (blockNr === end.block ? file.stat.blksize - end.offset : 0);
        const data = new Uint8Array(blocks[blockNr], blockNr === start.block ? start.offset : 0, length);
        target.set(data, bytesRead);
        bytesRead += length;
    }
    if (position + bytesRead > file.stat.size) {
        bytesRead = file.stat.size - position; // Correct amount of bytes read
    }
    if (updatePosition) {
        file.position += bytesRead;
    }
    return { bytesRead, buffer };
};
const getBlockAndOffset = (blockSize, position) => {
    const offset = position % blockSize;
    const block = (position - offset) / blockSize;
    return { block: block, offset };
};
const loadBlocks = async (file, store, start, end, addMissingBlocks = false) => {
    // TODO: get blocks from cache if available
    const blocks = await new Promise((resolve, reject) => {
        const cursorRequest = store.openCursor(IDBKeyRange.bound(start, end));
        const blocks = {};
        cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (!cursor) {
                return resolve(blocks);
            }
            blocks[cursor.key] = cursor.value;
            cursor.continue();
        };
        cursorRequest.onerror = event => reject(event.target);
    });
    if (addMissingBlocks) {
        for (let i = start; i <= end; i++) {
            if (!(i in blocks)) {
                blocks[i] = new ArrayBuffer(file.stat.blksize);
            }
        }
    }
    return blocks;
};
/**
 *
 * @param file
 * @param store
 * @param blocks
 * @returns whether blocks were added and file metadata should be updated
 */
const writeBlocks = async (file, store, blocks) => {
    const blockNrs = Object.keys(blocks).map(p => +p);
    const start = blockNrs[0], end = blockNrs.slice(-1)[0];
    // Update existing blocks with cursor
    await new Promise((resolve, reject) => {
        const cursorRequest = store.openCursor(IDBKeyRange.bound(start, end));
        cursorRequest.onsuccess = async () => {
            const cursor = cursorRequest.result;
            if (!cursor) {
                return resolve();
            }
            const nr = cursor.key;
            const data = blocks[nr];
            await new Promise((resolve, reject) => {
                const req = cursor.update(data);
                req.onsuccess = resolve;
                req.onerror = reject;
            });
            blockNrs.splice(blockNrs.indexOf(nr), 1);
            cursor.continue();
        };
        cursorRequest.onerror = event => reject(event.target);
    });
    // Add new blocks if there were any left
    const addBlocks = blockNrs.length > 0;
    if (addBlocks) {
        const promises = blockNrs.map(nr => set(store, nr, blocks[nr]));
        await Promise.all(promises);
    }
    return addBlocks;
};
const exists = async (path) => {
    const dir = path.slice(0, path.lastIndexOf('/'));
    const fileName = path.slice(dir.length + 1);
    const entries = await listDirEntries(dir);
    return entries.find(e => e.name === fileName) && true;
};
const stat = async (path) => {
    var _a;
    if (!exists(path)) {
        const err = new Error('File does not exist');
        err.code = 'ENOENT';
        throw err;
    }
    const fd = await openFile(path, flags_1.flags.read);
    const file = openFiles[fd];
    const tx = file.db.transaction('stat', 'readonly');
    const stat = await readFileStats(tx.objectStore('stat'));
    (_a = tx.commit) === null || _a === void 0 ? void 0 : _a.call(tx);
    await closeFile(fd);
    return stat;
};
const readFileStats = async (store) => {
    const stat = { size: 0, blksize: 0, blocks: 0, birthtime: null, ctime: null, mtime: null, atime: null };
    const promises = Object.keys(stat).map(async (key) => stat[key] = await get(store, key));
    await Promise.all(promises);
    return stat;
};
const writeFileStats = async (file, store, stat) => {
    const keys = Object.keys(stat);
    file && keys.forEach(key => file.stat[key] = stat[key]);
    const promises = keys.map(key => set(store, key, stat[key]));
    await Promise.all(promises);
};
const rename = async (oldPath, newPath) => {
    // delete target db if it exists
    await removeFile(newPath).catch(err => {
        if (err.code != 'ENOENT') {
            throw err;
        }
    });
    // Open old db & new db
    const openDb = async (path, upgradeCallback) => {
        const db = await new Promise((resolve, reject) => {
            const name = getDbName(path);
            const req = indexedDB.open(name, 1);
            if (upgradeCallback) {
                req.onupgradeneeded = () => upgradeCallback(req.result);
            }
            req.onsuccess = () => resolve(req.result);
            req.onblocked = event => reject(event.target);
            req.onerror = event => reject(event.target);
        });
        return db;
    };
    const oldDb = await openDb(oldPath);
    const newDb = await openDb(newPath, db => {
        // Upgrade callback: Create empty stores
        db.createObjectStore('stat');
        db.createObjectStore('data');
    });
    // Copy data from old to new
    const copyStore = async (name) => {
        await new Promise((resolve, reject) => {
            const readTx = oldDb.transaction(name, 'readonly');
            let req = readTx.objectStore(name).openCursor();
            req.onsuccess = () => {
                const cursor = req.result;
                if (!cursor) {
                    return resolve();
                }
                const writeTx = newDb.transaction(name, 'readwrite');
                DEBUG_MODE && console.warn(`Copying key ${cursor.key} in store ${name}`);
                let value = cursor.value;
                if (name === 'stat' && cursor.key === 'ctime') {
                    value = new Date(); // birthtime and ctime will now have different values
                }
                const writeReq = writeTx.objectStore(name).add(value, cursor.key);
                writeReq.onsuccess = () => {
                    var _a;
                    (_a = writeTx.commit) === null || _a === void 0 ? void 0 : _a.call(writeTx);
                };
                writeReq.onerror = event => reject(event.target);
                cursor.continue();
            };
        });
    };
    await copyStore('data');
    await copyStore('stat');
    // Close databases
    oldDb.close();
    newDb.close();
    // Delete old db
    await removeFile(oldPath);
};
window.pfs = pfs;
//# sourceMappingURL=browser.js.map