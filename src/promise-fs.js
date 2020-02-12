const fs = require('fs');

const pfs = {
    get hasFileSystem() { return typeof fs === 'object' && 'open' in fs; }
};

/**
 * @deprecated deprecated in Node.js since v1.0.0, don't use!
 * @param {string|Buffer|URL} path 
 * @returns {Promise<boolean>} returns a promise that resolves with a boolean indicating if the path exists
 */
function exists(path) {
    return new Promise(resolve => {
        fs.exists(path, exists => {
            resolve(exists);
        });
    });
}
pfs.exists = exists;

pfs.flags = {
    /** @description 'a' - Open file for appending. The file is created if it does not exist. */
    get append() { return 'a'; },
    /** @description 'ax' - Like append ('a') but fails if the path exists. */
    get appendAndCreate() { return 'ax'; },
    /** @description 'a+' - Open file for reading and appending. The file is created if it does not exist. */
    get readAndAppend() { return 'a+'; },
    /** @description 'ax+' - Like readAndAppend ('a+') but fails if the path exists. */
    get readAndAppendAndCreate() { return 'ax+'; },
    /** @description 'as' - Open file for appending in synchronous mode. The file is created if it does not exist. */
    get appendSynchronous() { return 'as'; },
    /** @description 'as+' - Open file for reading and appending in synchronous mode. The file is created if it does not exist. */
    get readAndAppendSynchronous() { return 'as+'; },
    /** @description 'r' - Open file for reading. An exception occurs if the file does not exist. */
    get read() { return 'r'; },
    /** @description 'r+' - Open file for reading and writing. An exception occurs if the file does not exist.*/
    get readAndWrite() { return 'r+'; },
    /** @description 'rs+' - Open file for reading and writing in synchronous mode. Instructs the operating system to bypass the local file system cache. This is primarily useful for opening files on NFS mounts as it allows skipping the potentially stale local cache. It has a very real impact on I/O performance so using this flag is not recommended unless it is needed. This doesn't turn fs.open() or fsPromises.open() into a synchronous blocking call. If synchronous operation is desired, something like fs.openSync() should be used.*/
    get readAndWriteSynchronous() { return 'rs+'; },
    /** @description 'w' - Open file for writing. The file is created (if it does not exist) or truncated (if it exists). */
    get write() { return 'w'; },
    /** @description 'wx' - Like write ('w') but fails if the path exists. */
    get writeAndCreate() { return 'wx'; },
    /** @description 'w+' - Open file for reading and writing. The file is created (if it does not exist) or truncated (if it exists). */
    get readAndWriteAndCreateOrOverwrite() { return 'w+'; },
    /** @description 'wx+' - Like readAndWriteAndCreateOrOverwrite ('w+') but fails if the path exists. */
    get readAndWriteAndCreate() { return 'wx+'; },
};

/**
 * Opens a file for reading, writing or both
 * @param {string|Buffer|URL} path 
 * @param {string|number} [flags] see pfs.flags, default is pfs.flags.read ('r')
 * @param {number} [mode=0o666] default is 0o666
 * @returns {Promise<number>} returns a promise that resolves with fd (file descriptor)
 */
function open(path, flags, mode) {
    return new Promise((resolve, reject) => {
        fs.open(path, flags, mode, (err, fd) => {
            if (err) { reject(err); }
            else { resolve(fd); }
        });
    });
}
pfs.open = open;

/**
 * Closes an open file
 * @param {number} fd file descriptor
 * @returns {Promise<void>} returns a promise that resolves once the file has been closed
 */
function close(fd) {
    return new Promise((resolve, reject) => {
        fs.close(fd, (err) => {
            if (err) { reject(err); }
            else { resolve(); }
        });
    });
}
pfs.close = close;

/**
 * Writes to an open file
 * @param {number} fd file descriptor
 * @param {Buffer|TypedArray|DataView} buffer buffer to write to the file
 * @param {number} [offset] start byte of the buffer to read from, default is 0
 * @param {number} [length] amount of bytes to write, default is buffer.byteLength-offset
 * @param {number} [position] offset from the beginning of the file where this data should be written. If typeof position !== 'number', the data will be written at the current position
 * @returns {Promise<{ bytesWritten: number, buffer: Buffer|TypedArray|DataView }} returns a Promise that resolves with an object containing the amount of bytes written and reference to the used buffer source
 */
function write(fd, buffer, offset, length, position) {
    // NOTE: Changes fs.write behaviour by making offset, length and position optional
    if (typeof offset === 'undefined') { offset = 0; }
    if (typeof length === 'undefined') { length = buffer.byteLength - offset; }
    if (typeof position === 'undefined') { position = null; }

    return new Promise((resolve, reject) => {
        fs.write(fd, buffer, offset, length, position, (err, bytesWritten, buffer) => {
            if (err) { 
                err.args = { fd, buffer, offset, length, position };
                reject(err);
            }
            else { resolve({ bytesWritten, buffer }); }
        });
    });
}
pfs.write = write;

/**
 * Asynchronously writes data to a file, replacing the file if it already exists.
 * @param {string|Buffer|URL|number} path filename or file descriptor
 * @param {string|Buffer|TypedArray|DataView} data string or binary data to write. if data is a buffer, encoding option is ignored
 * @param {object|string} [options] encoding to use or object specifying encoding and/or flag and mode to use.
 * @param {string|null} [options.encoding='utf8'] default is 'utf8'. Not used if data is a buffer
 * @param {number} [options.mode=0o666]
 * @param {string} [options.flag] see pfs.flags, default is pfs.flags.write ('w')
 * @returns {Promise<void>} returns a promise that resolves once the file has been written
 */
function writeFile(path, data, options) {
    return new Promise((resolve, reject) => {
        fs.writeFile(path, data, options, err => {
            if (err) { reject(err); }
            else { resolve(); }
        });
    });
}
pfs.writeFile = writeFile;

/**
 * Reads from an open file
 * @param {number} fd file descriptor
 * @param {Buffer|TypedArray|DataView} buffer the buffer that the data will be written to
 * @param {number} [offset] the offset in the buffer to start writing at, defaults to 0
 * @param {number} [length] an integer specifying the number of bytes to read, defaults to buffer.byteLength-offset
 * @param {number|null} [position] specifying where to begin reading from in the file. If position is null, data will be read from the current file position, and the file position will be updated. If position is an integer, the file position will remain unchanged.
 * @returns {Promise<{ bytesRead: number, buffer: Buffer|TypedArray|DataView}} returns a promise that resolves with the amount of bytes read and a reference to the buffer that was written to
 */
function read(fd, buffer, offset, length, position) {
    // NOTE: Changes fs.read behaviour by making offset, length and position optional
    if (typeof offset === 'undefined') { offset = 0; }
    if (typeof length === 'undefined') { length = buffer.byteLength; }
    if (typeof position === 'undefined') { position = null; }

    return new Promise((resolve, reject) => {
        fs.read(fd, buffer, offset, length, position, (err, bytesRead, buffer) => {
            if (err) { 
                err.args = { fd, buffer, offset, length, position };
                reject(err); 
            }
            else { resolve({ bytesRead, buffer }); }
        });
    });
}
pfs.read = read;

/**
 * Asynchronously reads the entire contents of a file.
 * @param {string|Buffer|URL|number} path filename or file descriptor
 * @param {object|string} [options] encoding to use or object specifying encoding and/or flag to use. 'utf8' will return the read data as a string
 * @param {string|null} [options.encoding=null] default is null, will return the raw buffer.
 * @param {string} [options.flag] see pfs.flags, default is pfs.flags.read ('r')
 * @returns {Promise<Buffer|string>} returns a promise that resolves with a string if an encoding was specified, or a raw buffer otherwise
 */
function readFile(path, options) {
    return new Promise((resolve, reject) => {
        fs.readFile(path, options, (err, data) => {
            if (err) { reject(err); }
            else { resolve(data); }
        });
    });
}
pfs.readFile = readFile;

/**
 * Truncatates a file asynchronously
 * @param {string|Buffer|URL} path 
 * @param {number} [len=0] byte length the file will be truncated to, default is 0.
 * @returns {Promise<void>} returns a promise that resolves once the file has been truncated
 */
function truncate(path, len) {
    return new Promise((resolve, reject) => {
        fs.truncate(path, len, (err) => {
            if (err) { reject(err); }
            else { resolve(); }
        });
    });
}
pfs.truncate = truncate;

/**
 * Truncatates an open file asynchronously
 * @param {number} fd file descriptor
 * @param {number} [len=0] byte length the file will be truncated to, default is 0.
 * @returns {Promise<void>} returns a promise that resolves once the file has been truncated
 */
function ftruncate(fd, len) {
    return new Promise((resolve, reject) => {
        fs.ftruncate(fd, len, (err) => {
            if (err) { reject(err); }
            else { resolve(); }
        });
    });
}
pfs.ftruncate = ftruncate;

/**
 * Reads the contents of a directory. returns a promise that resolves with an array of names or entries
 * @param {string|Buffer|URL} path 
 * @param {object} [options] can be a string specifying an encoding, or an object with an encoding property specifying the character encoding to use for the filenames passed to the callback. If the encoding is set to 'buffer', the filenames returned will be passed as Buffer objects.
 * @param {string} [options.encoding='utf8'] default 'utf8'
 * @param {boolean} [options.withFileTypes=false] default is false
 * @returns {Promise<string[]|Buffer[]|fs.Dirent[]>} returns a promise that resolves with an array of filenames or entries, excluding directories '.' and '..'.
 */
function readdir(path, options) {
    return new Promise((resolve, reject) => {
        fs.readdir(path, options, (err, files) => {
            if (err) { reject(err); }
            else { resolve(files); }
        });
    });
}
pfs.readdir = readdir;

/**
 * Asynchronously creates a directory
 * @param {string|Buffer|URL} path 
 * @param {object|number} [options] optional, can be an integer specifying mode (permission and sticky bits), or an object with a mode property and a recursive property indicating whether parent folders should be created.
 * @param {boolean} [options.recursive=false] default is false
 * @param {number} [options.mode=0o777] Not supported on Windows. default is 0o777
 * @returns {Promise<void>} returns a promise that resolves once the dir has been created
 */
function mkdir(path, options) {
    return new Promise((resolve, reject) => {
        fs.mkdir(path, options, (err) => {
            if (err) { reject(err); }
            else { resolve(); }
        });
    });
}
pfs.mkdir = mkdir;

/**
 * Asynchronously removes a file or symbolic link
 * @param {string|Buffer|URL} path 
 * @returns {Promise<void>} returns a promise that resolves once the file has been removed
 */
function unlink(path) {
    return new Promise((resolve, reject) => {
        fs.unlink(path, (err) => {
            if (err) { reject(err); }
            else { resolve(); }
        });
    })
}

pfs.unlink = pfs.rm = unlink;

/**
 * Asynchronously rename file at oldPath to the pathname provided as newPath. 
 * In the case that newPath already exists, it will be overwritten. If there is 
 * a directory at newPath, an error will be raised instead
 * @param {string|Buffer|URL} oldPath 
 * @param {string|Buffer|URL} newPath 
 * @returns {Promise<void>} returns a promise that resolves once the file has been renamed
 */
function rename(oldPath, newPath) {
    return new Promise((resolve, reject) => {
        fs.rename(oldPath, newPath, (err) => {
            if (err) { reject(err); }
            else { resolve(); }
        });
    })
}

pfs.rename = rename;

/**
 * Asynchronous stat(2) - Get file status
 * @param {string|Buffer|URL} path A path to a file. If a URL is provided, it must use the file:
 * @param {object} [options] 
 * @param {boolean} [options.bigint=false]
 * @returns {Promise<fs.Stats|fs.BigIntStats>} returns a promise that resolves with the file stats
 */
function stat(path, options) {
    return new Promise((resolve, reject) => {
        fs.stat(path, options, (err, stats) => {
            if (err) { reject(err); }
            else { resolve(stats); }
        });
    })
}
pfs.stat = stat;

pfs.fs = fs;
module.exports = pfs;