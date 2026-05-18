import { ID } from 'acebase-core';
import { BinaryBPlusTree, BinaryWriter } from '../../../btree/index.js';
import { pfs } from '../../../promise-fs/index.js';
import { NodeReader } from '../node-reader.js';
import { _write } from './write.js';

export async function _rebuildKeyTree(tree: BinaryBPlusTree, nodeReader: NodeReader, options: Parameters<BinaryBPlusTree['rebuild']>[1]) {
    const storage = nodeReader.storage;
    const logger = storage.logger;
    const path = nodeReader.address.path;
    const tempFilepath = `${storage.settings.path}/${storage.name}.acebase/tree-${ID.generate()}.tmp`;
    let bytesWritten = 0;
    const fd = await pfs.open(tempFilepath, pfs.flags.readAndWriteAndCreate);
    const writer = BinaryWriter.forFunction(async (data, index) => {
        await pfs.write(fd, data, 0, data.length, index);
        bytesWritten += data.length;
    });
    await tree.rebuild(writer, options);

    // Now write the record with data read from the temp file
    let readOffset = 0;
    const reader = async (length: number) => {
        const buffer = new Uint8Array(length);
        const { bytesRead } = await pfs.read(fd, buffer, 0, buffer.length, readOffset);
        readOffset += bytesRead;
        if (bytesRead < length) {
            return buffer.slice(0, bytesRead); // throw new Error(`Failed to read ${length} bytes from file, only got ${bytesRead}`);
        }
        return buffer;
    };
    const newRecordInfo = await _write(storage, path, nodeReader.recordInfo.valueType, bytesWritten, true, reader, nodeReader.recordInfo);

    console.assert(
        newRecordInfo.allocation.totalAddresses * newRecordInfo.bytesPerRecord >= bytesWritten,
        `insufficient space allocated for tree of path ${path}: ${newRecordInfo.allocation.totalAddresses} records for ${bytesWritten} bytes`
    );

    // Close and remove the tmp file, don't wait for this
    pfs.close(fd)
        .then(() => pfs.rm(tempFilepath))
        .catch(err => {
            // Error removing the file?
            logger.error(`Can't remove temp rebuild file ${tempFilepath}: `, err);
        });

    return newRecordInfo;
}
