import { ColorStyle, Utils } from 'acebase-core';
import { NodeValueType } from '../../../node-value-types.js';
import { FLAG_KEY_TREE } from '../flags.js';
import { NodeAllocation } from '../node-allocation.js';
import { RecordInfo } from '../record-info.js';
import { AceBaseStorage } from '../binary-storage.js';
import { BinaryNodeAddress } from '../node-address.js';
import { BinaryNodeInfo } from '../node-info.js';

const { concatTypedArrays } = Utils;

export async function _write(
    storage: AceBaseStorage,
    path: string,
    type: NodeValueType,
    length: number,
    hasKeyTree: boolean,
    reader: (length: number) => Uint8Array | number[] | Promise<Uint8Array | number[]>,
    currentRecordInfo: RecordInfo,
): Promise<RecordInfo> {
    // Record layout:
    // record           := record_header, record_data
    // record_header    := record_info, value_type, chunk_table, last_record_len
    // record_info      := 4 bits = [0, FLAG_KEY_TREE, FLAG_READ_LOCK, FLAG_WRITE_LOCK]
    // value_type       := 4 bits number
    // chunk_table      := chunk_entry, [chunk_entry, [chunk_entry...]]
    // chunk_entry      := ct_entry_type, [ct_entry_data]
    // ct_entry_type    := 1 byte number,
    //                      0 = end of table, no entry data
    //                      1 = number of contigious following records (if first range with multiple records, start is current record)
    //                      2 = following range (start address, nr of contigious following record)
    //                      3 = NEW: contigious pages (start page nr, nr of contigious pages)
    //
    // ct_entry_data    := ct_entry_type?
    //                      1: nr_records
    //                      2: start_page_nr, start_record_nr, nr_records
    //                      3: NEW: start_page_nr, nr_pages
    //
    // nr_records       := 2 byte number, (actual nr - 1)
    // nr_pages         := 2 byte number, (actual nr - 1)
    // start_page_nr    := 4 byte number
    // start_record_nr  := 2 byte number
    // last_record_len  := 2 byte number
    // record_data      := value_type?
    //                      OBJECT: FLAG_TREE?
    //                          0: object_property, [object_property, [object_property...]]
    //                          1: object_tree
    //                      ARRAY: array_entry, [array_entry, [array_entry...]]
    //                      STRING: binary_data
    //                      BINARY: binary_data
    //
    // object_property  := key_info, child_info
    // object_tree      := bplus_tree_binary<key_index_or_name, child_info>
    // array_entry      := child_value_type, tiny_value, value_info, [value_data]
    // key_info         := key_indexed, key_index_or_name
    // key_indexed      := 1 bit
    // key_index_or_name:= key_indexed?
    //                      0: key_length, key_name
    //                      1: key_index
    //
    // key_length       := 7 bits (actual length - 1)
    // key_index        := 15 bits
    // key_name         := [key_length] byte string (ASCII)
    // child_info       := child_value_type, tiny_value, value_info, [value_data]
    // child_value_type := 4 bits number
    // tiny_value       := child_value_type?
    //                      BOOLEAN: [0000] or [0001]
    //                      NUMBER: [0000] to [1111] (positive number between 0 and 15)
    //                      (other): (empty string, object, array)
    //
    // value_info       := value_location, inline_length
    // value_location   := 2 bits,
    //                      [00] = DELETED (not implemented yet)
    //                      [01] = TINY
    //                      [10] = INLINE
    //                      [11] = RECORD
    //
    // inline_length    := 6 bits number (actual length - 1)
    // value_data       := value_location?
    //                      INLINE: [inline_length] byte value
    //                      RECORD: value_page_nr, value_record_nr
    //
    // value_page_nr    := 4 byte number
    // value_record_nr  := 2 byte number
    //
    const logger = storage.logger;
    const bytesPerRecord = storage.settings.recordSize;
    let headerByteLength = 0, totalBytes = 0, requiredRecords = 0, lastChunkSize = 0;

    const calculateStorageNeeds = (nrOfChunks: number) => {
        // Calculate amount of bytes and records needed
        headerByteLength = 4; // Minimum length: 1 byte record_info and value_type, 1 byte CT (ct_entry_type 0), 2 bytes last_chunk_length
        totalBytes = (length + headerByteLength);
        requiredRecords = Math.ceil(totalBytes / bytesPerRecord);
        if (requiredRecords > 1) {
            // More than 1 record, header size increases
            headerByteLength += 3; // Add 3 bytes: 1 byte for ct_entry_type 1, 2 bytes for nr_records
            headerByteLength += (nrOfChunks - 1) * 9; // Add 9 header bytes for each additional range (1 byte ct_entry_type 2, 4 bytes start_page_nr, 2 bytes start_record_nr, 2 bytes nr_records)
            // Recalc total bytes and required records
            totalBytes = (length + headerByteLength);
            requiredRecords = Math.ceil(totalBytes / bytesPerRecord);
        }
        lastChunkSize = requiredRecords === 1 ? length : totalBytes % bytesPerRecord;
        if (lastChunkSize === 0 && length > 0) {
            // Data perfectly fills up the last record!
            // If we don't set it to bytesPerRecord, reading later will fail: 0 bytes will be read from the last record...
            lastChunkSize = bytesPerRecord;
        }
    };

    calculateStorageNeeds(1); // Initialize with calculations for 1 contigious chunk of data

    if (requiredRecords > 1) {
        // In the worst case scenario, we get fragmented record space for each required record.
        // Calculate with this scenario. If we claim a record too many, we'll free it again when done
        const wholePages = Math.floor(requiredRecords / storage.settings.pageSize);
        const remainingRecords = requiredRecords % storage.settings.pageSize;
        const maxChunks = Math.max(0, wholePages) + Math.min(storage.FST.maxScraps, remainingRecords);
        // If the existing allocation has more ranges than maxChunks, use the actual range count
        // so requiredRecords correctly accounts for the larger header before the useExistingAllocation check.
        const existingRanges = currentRecordInfo ? currentRecordInfo.allocation.ranges.length : 0;
        calculateStorageNeeds(Math.max(maxChunks, existingRanges));
    }

    // Request storage space for these records
    const useExistingAllocation = currentRecordInfo && currentRecordInfo.allocation.totalAddresses === requiredRecords;
    const ranges = useExistingAllocation
        ? currentRecordInfo.allocation.ranges
        : await storage.FST.allocate(requiredRecords);

    let allocation = new NodeAllocation(ranges);
    !useExistingAllocation && logger.trace(`Allocated ${allocation.totalAddresses} addresses for node "/${path}": ${allocation}`.colorize(ColorStyle.grey));

    calculateStorageNeeds(allocation.ranges.length);
    if (requiredRecords < allocation.totalAddresses) {
        const addresses = allocation.addresses;
        const deallocate = addresses.splice(requiredRecords);
        logger.trace(`Requested ${deallocate.length} too many addresses to store node "/${path}", releasing them`.colorize(ColorStyle.grey));
        storage.FST.release(NodeAllocation.fromAdresses(deallocate).ranges);
        allocation = NodeAllocation.fromAdresses(addresses);
        calculateStorageNeeds(allocation.ranges.length);
    }

    // Build the binary header data
    const header = new Uint8Array(headerByteLength);
    const headerView = new DataView(header.buffer, 0, header.length);
    header[0] = type; // value_type
    if (hasKeyTree) {
        header[0] |= FLAG_KEY_TREE;
    }

    // Add chunk table
    const chunkTable = allocation.toChunkTable();
    let offset = 1;
    chunkTable.ranges.forEach(range => {
        headerView.setUint8(offset, range.type);
        if (range.type === 0) {
            return; // No additional CT data
        }
        else if (range.type === 1) {
            headerView.setUint16(offset + 1, range.length);
            offset += 3;
        }
        else if (range.type === 2) {
            headerView.setUint32(offset + 1, range.pageNr);
            headerView.setUint16(offset + 5, range.recordNr);
            headerView.setUint16(offset + 7, range.length);
            offset += 9;
        }
        else {
            throw 'Unsupported range type';
        }
    });
    headerView.setUint8(offset, 0);             // ct_type 0 (end of CT), 1 byte
    offset++;
    headerView.setUint16(offset, lastChunkSize);  // last_chunk_size, 2 bytes
    offset += 2;

    let bytesRead = 0;
    const readChunk = async (length: number) => {
        let headerBytes;
        if (bytesRead < header.byteLength) {
            headerBytes = header.slice(bytesRead, bytesRead + length);
            bytesRead += headerBytes.byteLength;
            length -= headerBytes.byteLength;
            if (length === 0) { return headerBytes; }
        }
        let dataBytes = reader(length);
        if (dataBytes instanceof Promise) { dataBytes = await dataBytes; }
        if (dataBytes instanceof Array) {
            dataBytes = Uint8Array.from(dataBytes);
        }
        else if (!(dataBytes instanceof Uint8Array)) {
            throw new Error('bytes must be Uint8Array or plain byte Array');
        }
        bytesRead += dataBytes.byteLength;
        if (headerBytes) {
            dataBytes = concatTypedArrays(headerBytes, dataBytes);
        }
        return dataBytes;
    };

    try {
        // Create and write all chunks
        const bytesWritten = await chunkTable.ranges.reduce(async (promise, range) => {
            const fileIndex = storage.getRecordFileIndex(range.pageNr, range.recordNr);
            if (isNaN(fileIndex)) {
                throw new Error('fileIndex is NaN!!');
            }
            let bytesWritten = promise ? await promise : 0;
            const data = await readChunk(range.length * bytesPerRecord);
            bytesWritten += data.byteLength;
            await storage.writeData(fileIndex, data);
            return bytesWritten;
        }, null as Promise<number>);

        const chunks = chunkTable.ranges.length;
        const address = new BinaryNodeAddress(path, allocation.ranges[0].pageNr, allocation.ranges[0].recordNr);
        const nodeInfo = new BinaryNodeInfo({ path, type, exists: true, address });

        storage.updateCache(false, nodeInfo, true); // hasMoved?
        logger.info(`Node "/${address.path}" saved at address ${address.pageNr},${address.recordNr} - ${allocation.totalAddresses} addresses, ${bytesWritten} bytes written in ${chunks} chunk(s)`.colorize(ColorStyle.green));
        // storage.logwrite({ address: address, allocation, chunks, bytesWritten });

        let recordInfo;
        if (useExistingAllocation) {
            // By using the exising info, caller knows it should not release the allocation
            recordInfo = currentRecordInfo;
            recordInfo.allocation = allocation; // Necessary?
            recordInfo.hasKeyIndex = hasKeyTree;
            recordInfo.headerLength = headerByteLength;
            recordInfo.lastChunkSize = lastChunkSize;
        }
        else {
            recordInfo = new RecordInfo(address.path, hasKeyTree, type, allocation, headerByteLength, lastChunkSize, bytesPerRecord);
            recordInfo.fileIndex = storage.getRecordFileIndex(address.pageNr, address.recordNr);
        }
        recordInfo.timestamp = Date.now();

        if (address.path === '') {
            await storage.rootRecord.update(address); // Wait for this, the address update has to be written to file
        }
        return recordInfo;
    }
    catch (reason) {
        // If any write failed, what do we do?
        logger.error(`Failed to write node "/${path}": ${reason}`);
        throw reason;
    }
}
