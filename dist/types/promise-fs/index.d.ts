/// <reference types="node" />
/// <reference types="node" />
import * as fs from 'fs';
export type TypedArray = Uint8Array | Int8Array | Uint16Array | Int16Array | Uint32Array | Int32Array | BigUint64Array | BigInt64Array;
export declare abstract class pfs {
    static get hasFileSystem(): boolean;
    static get fs(): typeof fs;
    static get flags(): {
        /** @description 'a' - Open file for appending. The file is created if it does not exist. */
        readonly append: string;
        /** @description 'ax' - Like append ('a') but fails if the path exists. */
        readonly appendAndCreate: string;
        /** @description 'a+' - Open file for reading and appending. The file is created if it does not exist. */
        readonly readAndAppend: string;
        /** @description 'ax+' - Like readAndAppend ('a+') but fails if the path exists. */
        readonly readAndAppendAndCreate: string;
        /** @description 'as' - Open file for appending in synchronous mode. The file is created if it does not exist. */
        readonly appendSynchronous: string;
        /** @description 'as+' - Open file for reading and appending in synchronous mode. The file is created if it does not exist. */
        readonly readAndAppendSynchronous: string;
        /** @description 'r' - Open file for reading. An exception occurs if the file does not exist. */
        readonly read: string;
        /** @description 'r+' - Open file for reading and writing. An exception occurs if the file does not exist.*/
        readonly readAndWrite: string;
        /** @description 'rs+' - Open file for reading and writing in synchronous mode. Instructs the operating system to bypass the local file system cache. This is primarily useful for opening files on NFS mounts as it allows skipping the potentially stale local cache. It has a very real impact on I/O performance so using this flag is not recommended unless it is needed. This doesn't turn fs.open() or fsPromises.open() into a synchronous blocking call. If synchronous operation is desired, something like fs.openSync() should be used.*/
        readonly readAndWriteSynchronous: string;
        /** @description 'w' - Open file for writing. The file is created (if it does not exist) or truncated (if it exists). */
        readonly write: string;
        /** @description 'wx' - Like write ('w') but fails if the path exists. */
        readonly writeAndCreate: string;
        /** @description 'w+' - Open file for reading and writing. The file is created (if it does not exist) or truncated (if it exists). */
        readonly readAndWriteAndCreateOrOverwrite: string;
        /** @description 'wx+' - Like readAndWriteAndCreateOrOverwrite ('w+') but fails if the path exists. */
        readonly readAndWriteAndCreate: string;
    };
    /**
     * @deprecated deprecated in Node.js since v1.0.0, don't use!
     * @param path
     * @returns returns a promise that resolves with a boolean indicating if the path exists
     */
    static exists(path: string | Buffer | fs.PathLike): Promise<boolean>;
    /**
     * Opens a file for reading, writing or both
     * @param path
     * @param flags see pfs.flags, default is pfs.flags.read ('r')
     * @param mode default is 0o666
     * @returns returns a promise that resolves with fd (file descriptor)
     */
    static open(path: string | Buffer | fs.PathLike, flags?: string | number, mode?: number): Promise<number>;
    /**
     * Closes an open file
     * @param fd file descriptor
     * @returns returns a promise that resolves once the file has been closed
     */
    static close(fd: number): Promise<void>;
    /**
     * Writes to an open file
     * @param fd file descriptor
     * @param buffer buffer to write to the file
     * @param offset start byte of the buffer to read from, default is 0
     * @param length amount of bytes to write, default is buffer.byteLength-offset
     * @param position offset from the beginning of the file where this data should be written. If typeof position !== 'number', the data will be written at the current position
     * @returns returns a Promise that resolves with an object containing the amount of bytes written and reference to the used buffer source
     */
    static write(fd: number, buffer: Buffer | TypedArray | DataView, offset?: number, length?: number, position?: number): Promise<{
        bytesWritten: number;
        buffer: Buffer | TypedArray | DataView;
    }>;
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
    static writeFile(path: string | Buffer | number | fs.PathLike, data: string | Buffer | TypedArray | DataView, options?: BufferEncoding | {
        encoding?: BufferEncoding;
        mode?: number;
        flag?: string;
    }): Promise<void>;
    /**
     * Reads from an open file
     * @param fd file descriptor
     * @param buffer the buffer that the data will be written to
     * @param offset the offset in the buffer to start writing at, defaults to 0
     * @param length an integer specifying the number of bytes to read, defaults to buffer.byteLength-offset
     * @param position specifying where to begin reading from in the file. If position is null, data will be read from the current file position, and the file position will be updated. If position is an integer, the file position will remain unchanged.
     * @returns returns a promise that resolves with the amount of bytes read and a reference to the buffer that was written to
     */
    static read<T extends Buffer | TypedArray | DataView>(fd: number, buffer: T, offset?: number, length?: number, position?: number): Promise<{
        bytesRead: number;
        buffer: T;
    }>;
    /**
     * Asynchronously reads the entire contents of a file.
     * @param path filename or file descriptor
     * @param options encoding to use or object specifying encoding and/or flag to use. 'utf8' will return the read data as a string
     * @param options.encoding default is null, will return the raw buffer.
     * @param options.flag see pfs.flags, default is pfs.flags.read ('r')
     * @returns returns a promise that resolves with a string if an encoding was specified, or a raw buffer otherwise
     */
    static readFile(path: string | Buffer | number | fs.PathLike, options: BufferEncoding | {
        encoding: BufferEncoding | null;
        flag: string;
    }): Promise<Buffer | string>;
    /**
     * Truncates a file asynchronously
     * @param path
     * @param len byte length the file will be truncated to, default is 0.
     * @returns returns a promise that resolves once the file has been truncated
     */
    static truncate(path: string | Buffer | fs.PathLike, len?: number): Promise<void>;
    /**
     * Truncates an open file asynchronously
     * @param fd file descriptor
     * @param len byte length the file will be truncated to, default is 0.
     * @returns returns a promise that resolves once the file has been truncated
     */
    static ftruncate(fd: number, len?: number): Promise<void>;
    /**
     * Reads the contents of a directory. returns a promise that resolves with an array of names or entries
     * @param path
     * @param options can be a string specifying an encoding, or an object with an encoding property specifying the character encoding to use for the filenames passed to the callback. If the encoding is set to 'buffer', the filenames returned will be passed as Buffer objects.
     * @param options.encoding default 'utf8'
     * @param options.withFileTypes default is false
     * @returns returns a promise that resolves with an array of filenames or entries, excluding directories '.' and '..'.
     */
    static readdir(path: string | Buffer | fs.PathLike, options?: BufferEncoding | {
        encoding?: BufferEncoding;
        withFileTypes?: false;
    }): Promise<string[] | Buffer[] | fs.Dirent[]>;
    /**
     * Asynchronously creates a directory
     * @param path
     * @param options optional, can be an integer specifying mode (permission and sticky bits), or an object with a mode property and a recursive property indicating whether parent folders should be created.
     * @param options.recursive default is false
     * @param options.mode Not supported on Windows. default is 0o777
     * @returns returns a promise that resolves once the dir has been created
     */
    static mkdir(path: string | Buffer | fs.PathLike, options?: number | {
        recursive?: boolean;
        mode?: number;
    }): Promise<void>;
    /**
     * Asynchronously removes a file or symbolic link
     * @param path
     * @returns returns a promise that resolves once the file has been removed
     */
    static unlink(path: string | Buffer | fs.PathLike): Promise<void>;
    /**
     * (Alias for unlink) Asynchronously removes a file or symbolic link
     * @param path
     * @returns returns a promise that resolves once the file has been removed
     */
    static rm(path: string | Buffer | fs.PathLike): Promise<void>;
    /**
     * Asynchronously removes a file or symbolic link
     * @param path
     * @returns returns a promise that resolves once the file has been removed
     */
    static rmdir(path: string | Buffer | fs.PathLike, options?: {
        maxRetries?: number;
        recursive?: boolean;
        retryDelay?: number;
    }): Promise<void>;
    /**
     * Asynchronously rename file at oldPath to the pathname provided as newPath.
     * In the case that newPath already exists, it will be overwritten. If there is
     * a directory at newPath, an error will be raised instead
     * @param oldPath
     * @param newPath
     * @returns returns a promise that resolves once the file has been renamed
     */
    static rename(oldPath: string | Buffer | fs.PathLike, newPath: string | Buffer | fs.PathLike): Promise<void>;
    /**
     * Asynchronous stat(2) - Get file status
     * @param path A path to a file. If a URL is provided, it must use the file:
     * @param options
     * @param options.bigint
     * @returns returns a promise that resolves with the file stats
     */
    static stat(path: string | Buffer | fs.PathLike, options?: {
        bigint?: boolean;
    }): Promise<fs.Stats | fs.BigIntStats>;
    /**
     * Asynchronous fsync(2) - synchronize a file's in-core state with the underlying storage device.
     * @param fd A file descriptor
     * @returns {Promise<void>} returns a promise that resolves when all data is flushed
     */
    static fsync(fd: number): Promise<void>;
    /**
     * Asynchronous fdatasync(2) - synchronize a file's in-core state with storage device.
     * @param fd A file descriptor
     * @returns {Promise<void>} returns a promise that resolves when all data is flushed
     */
    static fdatasync(fd: number): Promise<void>;
}
//# sourceMappingURL=index.d.ts.map