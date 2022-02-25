"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pfs = void 0;
const fs = require("fs");
const flags_1 = require("./flags");
class pfs {
    static get hasFileSystem() { return typeof fs === 'object' && 'open' in fs; }
    static get fs() { return fs; }
    static get flags() {
        return flags_1.flags;
    }
    /**
     * @deprecated deprecated in Node.js since v1.0.0, don't use!
     * @param path
     * @returns returns a promise that resolves with a boolean indicating if the path exists
     */
    static exists(path) {
        return new Promise(resolve => {
            fs.exists(path, exists => {
                resolve(exists);
            });
        });
    }
    /**
     * Opens a file for reading, writing or both
     * @param path
     * @param flags see pfs.flags, default is pfs.flags.read ('r')
     * @param mode default is 0o666
     * @returns returns a promise that resolves with fd (file descriptor)
     */
    static open(path, flags, mode) {
        return new Promise((resolve, reject) => {
            fs.open(path, flags, mode, (err, fd) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve(fd);
                }
            });
        });
    }
    /**
     * Closes an open file
     * @param fd file descriptor
     * @returns returns a promise that resolves once the file has been closed
     */
    static close(fd) {
        return new Promise((resolve, reject) => {
            fs.close(fd, (err) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve();
                }
            });
        });
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
        return new Promise((resolve, reject) => {
            fs.write(fd, buffer, offset, length, position, (err, bytesWritten, buffer) => {
                if (err) {
                    err.args = { fd, buffer, offset, length, position };
                    reject(err);
                }
                else {
                    resolve({ bytesWritten, buffer });
                }
            });
        });
    }
    /**
     * Asynchronously writes data to a file, replacing the file if it already exists.
     * @param path filename or file descriptor
     * @param data string or binary data to write. if data is a buffer, encoding option is ignored
     * @param options encoding to use or object specifying encoding and/or flag and mode to use.
     * @param options.encoding default is 'utf8'. Not used if data is a buffer
     * @param options.mode
     * @param options.flag see pfs.flags, default is pfs.flags.write ('w')
     * @returns {} returns a promise that resolves once the file has been written
     */
    static writeFile(path, data, options) {
        return new Promise((resolve, reject) => {
            fs.writeFile(path, data, options, err => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve();
                }
            });
        });
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
        return new Promise((resolve, reject) => {
            fs.read(fd, buffer, offset, length, position, (err, bytesRead, buffer) => {
                if (err) {
                    err.args = { fd, buffer, offset, length, position };
                    reject(err);
                }
                else {
                    resolve({ bytesRead, buffer });
                }
            });
        });
    }
    /**
     * Asynchronously reads the entire contents of a file.
     * @param path filename or file descriptor
     * @param options encoding to use or object specifying encoding and/or flag to use. 'utf8' will return the read data as a string
     * @param options.encoding default is null, will return the raw buffer.
     * @param options.flag see pfs.flags, default is pfs.flags.read ('r')
     * @returns returns a promise that resolves with a string if an encoding was specified, or a raw buffer otherwise
     */
    static readFile(path, options) {
        return new Promise((resolve, reject) => {
            fs.readFile(path, options, (err, data) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve(data);
                }
            });
        });
    }
    /**
     * Truncates a file asynchronously
     * @param path
     * @param len byte length the file will be truncated to, default is 0.
     * @returns returns a promise that resolves once the file has been truncated
     */
    static truncate(path, len = 0) {
        return new Promise((resolve, reject) => {
            fs.truncate(path, len, (err) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve();
                }
            });
        });
    }
    /**
     * Truncates an open file asynchronously
     * @param fd file descriptor
     * @param len byte length the file will be truncated to, default is 0.
     * @returns returns a promise that resolves once the file has been truncated
     */
    static ftruncate(fd, len = 0) {
        return new Promise((resolve, reject) => {
            fs.ftruncate(fd, len, (err) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve();
                }
            });
        });
    }
    /**
     * Reads the contents of a directory. returns a promise that resolves with an array of names or entries
     * @param path
     * @param options can be a string specifying an encoding, or an object with an encoding property specifying the character encoding to use for the filenames passed to the callback. If the encoding is set to 'buffer', the filenames returned will be passed as Buffer objects.
     * @param options.encoding default 'utf8'
     * @param options.withFileTypes default is false
     * @returns returns a promise that resolves with an array of filenames or entries, excluding directories '.' and '..'.
     */
    static readdir(path, options) {
        return new Promise((resolve, reject) => {
            fs.readdir(path, options, (err, files) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve(files);
                }
            });
        });
    }
    /**
     * Asynchronously creates a directory
     * @param path
     * @param options optional, can be an integer specifying mode (permission and sticky bits), or an object with a mode property and a recursive property indicating whether parent folders should be created.
     * @param options.recursive default is false
     * @param options.mode Not supported on Windows. default is 0o777
     * @returns returns a promise that resolves once the dir has been created
     */
    static mkdir(path, options) {
        return new Promise((resolve, reject) => {
            fs.mkdir(path, options, (err) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve();
                }
            });
        });
    }
    /**
     * Asynchronously removes a file or symbolic link
     * @param path
     * @returns returns a promise that resolves once the file has been removed
     */
    static unlink(path) {
        return new Promise((resolve, reject) => {
            fs.unlink(path, (err) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve();
                }
            });
        });
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
    static rmdir(path, options) {
        return new Promise((resolve, reject) => {
            fs.rmdir(path, options, (err) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve();
                }
            });
        });
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
        return new Promise((resolve, reject) => {
            fs.rename(oldPath, newPath, (err) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve();
                }
            });
        });
    }
    /**
     * Asynchronous stat(2) - Get file status
     * @param path A path to a file. If a URL is provided, it must use the file:
     * @param options
     * @param options.bigint
     * @returns returns a promise that resolves with the file stats
     */
    static stat(path, options) {
        return new Promise((resolve, reject) => {
            fs.stat(path, options, (err, stats) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve(stats);
                }
            });
        });
    }
    /**
     * Asynchronous fsync(2) - synchronize a file's in-core state with the underlying storage device.
     * @param fd A file descriptor
     * @returns {Promise<void>} returns a promise that resolves when all data is flushed
     */
    static fsync(fd) {
        return new Promise((resolve, reject) => {
            fs.fsync(fd, (err) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve();
                }
            });
        });
    }
    /**
     * Asynchronous fdatasync(2) - synchronize a file's in-core state with storage device.
     * @param fd A file descriptor
     * @returns {Promise<void>} returns a promise that resolves when all data is flushed
     */
    static fdatasync(fd) {
        return new Promise((resolve, reject) => {
            fs.fdatasync(fd, (err, stats) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve(stats);
                }
            });
        });
    }
    /**
     * Opens a file and returns a writable stream
     * @param path A path to a file
     * @param options encoding or options
     * @returns Returns a new WriteStream object
     */
    static createWriteStream(path, options) {
        return fs.createWriteStream(path, options);
    }
}
exports.pfs = pfs;
//# sourceMappingURL=index.js.map