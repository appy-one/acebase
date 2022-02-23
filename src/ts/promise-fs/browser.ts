import { flags } from './flags';
export type TypedArray = Uint8Array | Int8Array | Uint16Array | Int16Array | Uint32Array | Int32Array | BigUint64Array | BigInt64Array;

// Work in progress: browser fs implementation for working with large binary files
export abstract class pfs {
    static get hasFileSystem() { return true; } // Yeah!
    static get fs() { return null; }
    static get flags() {
        return flags;
    }

    static async exists(path: string): Promise<boolean> {
        const dir = path.slice(0, path.lastIndexOf('/'));
        const fileName = path.slice(dir.length + 1);
        const files = await listFiles(dir);
        return files.includes(fileName);
    }
    
    static async open(path: string, flags?:string|number, mode?:number): Promise<number> {
        // TODO: flags, mode
        return await openFile(path);
    }

    static async close(fd: number): Promise<void> {
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
     static write(fd: number, buffer: Buffer|TypedArray, offset?:number, length?:number, position?:number): Promise<{ bytesWritten: number, buffer: Buffer|TypedArray }> {
        // NOTE: Changes fs.write behaviour by making offset, length and position optional
        if (typeof offset === 'undefined') { offset = 0; }
        if (typeof length === 'undefined') { length = buffer.byteLength - offset; }
        if (typeof position === 'undefined') { position = null; }
        return write(fd, buffer, offset, length, position);
     }
}

let lastFd = 0;
const openFiles: { [fd: number]: { db: IDBDatabase, path: string, size: number, pageSize: number, pages: number, position: number } } = {};

/**
 * Inserts or updates a key/key pair
 * @param store Object store to insert/update key/value pair into
 * @param key 
 * @param value 
 * @returns 
 */
const set = (store: IDBObjectStore, key: any, value: any) => {
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
const remove = (store: IDBObjectStore, key: any) => {
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
const get = <T>(store: IDBObjectStore, key: any): Promise<T> => {
    return new Promise((resolve, reject) => {
        const req = store.get(key);
        req.onsuccess = () => {
            resolve(req.result);
        };
        req.onerror = reject;
    });
}

const getDbName = (path: string) => {
    return 'file:' + path; //.replace(/^\.\//, '');
}

const openFile = async (path: string, flags?:string) : Promise<number> => {
    return new Promise((resolve, reject) => {
        const dbName = getDbName(path);
        const request = indexedDB.open(dbName, 1);

        request.onupgradeneeded = async () => {
            // db created
            const db = request.result;
            const metadataStore = db.createObjectStore('metadata');
            await set(metadataStore, 'path', path);
            await set(metadataStore, 'created', new Date());
            await set(metadataStore, 'size', 0);
            await set(metadataStore, 'pages', 0);
            await set(metadataStore, 'page_size', 4096); // Try 4KB pages
            db.createObjectStore('content');
        };

        request.onsuccess = async () => {
            // db created / opened
            const db = request.result;
            const tx = db.transaction('metadata');
            const metadataStore = tx.objectStore('metadata');
            await set(metadataStore, 'accessed', new Date());
            const size = await get<number>(metadataStore, 'size');
            const pages = await get<number>(metadataStore, 'pages');
            const pageSize = await get<number>(metadataStore, 'page_size');
            const position = (() => {
                return 0; // TODO: depends on read/write/append flags?
            })();
            const fd = ++lastFd;
            openFiles[fd] = { db, path, size, pages, pageSize, position };
            resolve(fd);
        };

        request.onerror = err => {
            reject(err);
        };
    });
};

const closeFile = async (fd: number) => {
    const file = openFiles[fd];
    if (!file) { const err = new Error('File not open'); throw err; }
    file.db.close();
    delete openFiles[fd];
};

const removeFile = async (path: string) => {
    // Delete db
    return new Promise((resolve, reject) => {
        const dbName = getDbName(path);
        const request = indexedDB.deleteDatabase(dbName);
        request.onblocked = () => {
            console.warn(`Deletion of db "${dbName}" is blocked because it is still open`);
        }
        request.onsuccess = resolve;
        request.onerror = reject;
    });
};

const listFiles = async (path: string) => {
    const dbs = await indexedDB.databases();
    const prefix = `file:${path}`;
    return dbs.filter(db => db.name.startsWith(prefix)).map(db => {
        const name = db.name.slice(prefix.length).replace(/^\/+/, '');
        return name;
    });
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
const write = async (fd: number, buffer: Buffer|TypedArray, offset:number, length:number, position?:number): Promise<{ bytesWritten: number, buffer: Buffer|TypedArray }> => {
    const file = openFiles[fd];
    if (!file) { throw new Error('File not open'); }
    const updatePosition = position === null || position === -1;
    if (updatePosition) {
        position = file.position;
    }

    // What pages are being written to?
    const start = getPageAndOffset(file.pageSize, position);
    const end = getPageAndOffset(file.pageSize, position + length);

    // Create transaction
    const tx = file.db.transaction(['content','metadata'], 'readwrite');
    const store = tx.objectStore('content');

    // Fetch pages and modify data
    const pages = await loadPages(file, store, start.page, end.page);
    let bytesWritten = 0;
    for (let pageNr = start.page; pageNr <= end.page; pageNr++) {
        const page = new Uint8Array(pages[pageNr]);
        const data = new Uint8Array(buffer, offset + bytesWritten, length - bytesWritten);
        page.set(data, pageNr === start.page ? start.offset : 0);
        bytesWritten += file.pageSize - (pageNr === start.page ? start.offset : 0);
    }

    // Write data back to the db
    const sizeChanged = await writePages(file, store, pages);

    if (sizeChanged) {
        // Update metadata
        const metadataStore = tx.objectStore('content');
        await Promise.all([
            set(metadataStore, 'pages', file.pages),
            set(metadataStore, 'size', file.size)
        ]);
    }

    if (updatePosition) {
        file.position += length;
    }
    
    // Commit
    tx.commit();

    return { bytesWritten, buffer };
}

const getPageAndOffset = (pageSize: number, position: number) => {
    const offset = pageSize % position;
    const page = pageSize / (position - offset);
    return { page, offset };
};

const loadPages = async (file: typeof openFiles[0], store: IDBObjectStore, start: number, end: number) => {
    // TODO: get pages from cache if available
    const pages = await new Promise<{ [page: number]: ArrayBuffer }>((resolve, reject) => {
        const cursorRequest = store.openCursor(IDBKeyRange.bound(start, end));
        const pages = {};
        cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (!cursor) { return resolve(pages); }
            pages[cursor.key as number] = cursor.value as ArrayBuffer;
            cursor.continue();
        };
        cursorRequest.onerror = reject;
    });
    for (let i = start; i <= end; i++) {
        if (!(i in pages)) { pages[i] = new ArrayBuffer(file.pageSize); }
    }
    return pages;
};

/**
 * 
 * @param file 
 * @param store 
 * @param pages 
 * @returns whether pages were added and file metadata should be updated
 */
const writePages = async (file: typeof openFiles[0], store: IDBObjectStore, pages: { [page: number]: ArrayBuffer }) => {
    const pageNrs = Object.keys(pages).map(p => +p);
    const start = pageNrs[0], end = pageNrs.slice(-1)[0];
    
    // Update existing pages with cursor
    await new Promise<void>((resolve, reject) => {
        const cursorRequest = store.openKeyCursor(IDBKeyRange.bound(start, end));
        const pages = {};
        cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (!cursor) { return resolve(); }
            const nr = cursor.key as number
            cursor.update(pages[nr]);
            pageNrs.splice(pageNrs.indexOf(nr), 1);
            cursor.continue();
        };
        cursorRequest.onerror = reject;
    });

    // Add new pages if there were any left
    if (pageNrs.length > 0) {
        const promises = pageNrs.map(nr => set(store, nr, pages[nr]));
        await Promise.all(promises);

        file.pages = end;
        file.size = file.pageSize * file.pages;
        return true;
    }
    return false;
}