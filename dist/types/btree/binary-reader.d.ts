/// <reference types="node" />
export type ReadFunction = (index: number, length: number) => Promise<Buffer>;
export declare class BinaryReader {
    chunkSize: number;
    read: ReadFunction;
    close: () => Promise<void>;
    data: Buffer;
    /**
     * offset of loaded data (start index of current chunk in data source)
     */
    offset: number;
    /**
     * current chunk reading index ("cursor" in currently loaded chunk)
     */
    index: number;
    /**
     * BinaryReader is a helper class to make reading binary data easier and faster
     * @param file file name, file descriptor, or an open file, or read function that returns a promise
     * @param chunkSize how many bytes per read. default is 4KB
     */
    constructor(file: string | number | ReadFunction, chunkSize?: number);
    init(): Promise<void>;
    clone(): BinaryReader & this;
    get(byteCount: number): Promise<Buffer>;
    getInt32(): Promise<number>;
    getUint32(): Promise<number>;
    getValue(): Promise<string | number | bigint | boolean | Date>;
    more(chunks?: number): Promise<void>;
    seek(offset: number): Promise<void>;
    assert(byteCount: number): Promise<void>;
    skip(byteCount: number): void;
    rewind(byteCount: number): void;
    go(index: number): Promise<void>;
    savePosition(offsetCorrection?: number): {
        go: (offset?: number) => Promise<void>;
        index: number;
    };
    get sourceIndex(): number;
    static readValue(buffer: Buffer, index: number): {
        value: string | number | bigint | boolean | Date;
        byteLength: number;
    };
    static bytesToNumber(buffer: Buffer): number;
    static readUint32(buffer: Buffer, index: number): number;
    static readInt32(buffer: Buffer, index: number): number;
}
//# sourceMappingURL=binary-reader.d.ts.map