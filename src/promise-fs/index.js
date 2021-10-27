"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pfs = void 0;
const fs = require("fs");
class pfs {
    static get hasFileSystem() { return typeof fs === 'object' && 'open' in fs; }
    static get fs() { return fs; }
    static get flags() {
        return {
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
}
exports.pfs = pfs;
//# sourceMappingURL=index.js.map