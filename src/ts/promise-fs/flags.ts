export const flags = {
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
}