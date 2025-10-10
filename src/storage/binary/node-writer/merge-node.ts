import { ColorStyle, PathInfo, Utils } from 'acebase-core';
import { IAceBaseIPCLock } from '../../../ipc/ipc.js';
import { NodeChange, NodeChangeTracker } from '../../../node-changes.js';
import { VALUE_TYPES } from '../../../node-value-types.js';
import { InternalNodeReference } from '../internal-node-reference.js';
import { NodeAllocation } from '../node-allocation.js';
import { BinaryNodeInfo } from '../node-info.js';
import { NodeReader } from '../node-reader.js';
import { RecordInfo } from '../record-info.js';
import { AceBaseStorage } from '../binary-storage.js';
import { _serializeValue } from './serialize-value.js';
import { SerializedKeyValue } from '../serialized-key-value.js';
import { _getValueBytes } from './get-value-bytes.js';
import { BinaryBPlusTreeTransactionOperation } from '../../../btree/binary-tree-transaction-operation.js';
import { BinaryBPlusTree } from '../../../btree/binary-tree.js';
import { _write } from './write.js';
import { _rebuildKeyTree } from './rebuild-key-tree.js';
import { _writeNode } from './write-node.js';

const { concatTypedArrays } = Utils;

/**
 * Merges an existing node with given updates
 */
export async function _mergeNode(storage: AceBaseStorage, nodeInfo: BinaryNodeInfo, updates: Record<string | number, any>, lock: IAceBaseIPCLock) {
    if (typeof updates !== 'object') {
        throw new TypeError('updates parameter must be an object');
    }

    const logger = storage.logger;
    let nodeReader = new NodeReader(storage, nodeInfo.address, lock, false);
    const affectedKeys: Array<string | number> = Object.keys(updates);
    const changes = new NodeChangeTracker(nodeInfo.path);

    const discardAllocation = new NodeAllocation([]);
    let isArray = false;
    let isInternalUpdate = false;

    let recordInfo = await nodeReader.readHeader();
    isArray = recordInfo.valueType === VALUE_TYPES.ARRAY;
    nodeInfo.type = recordInfo.valueType; // Set in nodeInfo too, because it might be unknown

    let recordMoved = false;
    const done = (newRecordInfo: RecordInfo) => {
        if (newRecordInfo !== nodeReader.recordInfo) {
            // release the old record allocation
            discardAllocation.ranges.push(...nodeReader.recordInfo.allocation.ranges);
            recordMoved = true;
        }
        // Necessary?
        storage.updateCache(false, new BinaryNodeInfo({ path: nodeInfo.path, type: nodeInfo.type, address: newRecordInfo.address, exists: true }), recordMoved);
        return { recordMoved, recordInfo: newRecordInfo, deallocate: discardAllocation };
    };

    const childValuePromises = [] as Promise<unknown>[];

    if (isArray) {
        // keys to update must be integers
        for (let i = 0; i < affectedKeys.length; i++) {
            if (isNaN(affectedKeys[i] as number)) {
                throw new Error(`Cannot merge existing array of path "${nodeInfo.path}" with an object (properties ${Object.keys(updates).slice(0, 5).map(p => `"${p}"`).join(',')}...)`);
            }
            affectedKeys[i] = +affectedKeys[i]; // Now an index
        }
    }

    const newKeys = affectedKeys.slice();

    await nodeReader.getChildStream({ keyFilter: affectedKeys as string[] | number[] })
        .next(child => {

            const keyOrIndex = isArray ? child.index : child.key;
            newKeys.splice(newKeys.indexOf(keyOrIndex), 1); // Remove from newKeys array, it exists already
            const newValue = updates[keyOrIndex];

            // Get current value
            if (child.address) {

                if (newValue instanceof InternalNodeReference) {
                // This update originates from a child node update, its record location changed
                // so we only have to update the reference to the new location

                    isInternalUpdate = true;
                    const oldAddress = child.address; //child.storedAddress || child.address;
                    const currentValue = new InternalNodeReference(child.type, oldAddress);
                    changes.add(keyOrIndex, currentValue, newValue);
                    return true; // Proceed with next (there is no next, right? - this update must has have been triggered by child node that moved, the parent node only needs to update the reference to the child node)
                }

                // Child is stored in own record, and it is updated or deleted so we need to get
                // its allocation so we can release it when updating is done
                const promise = storage.nodeLocker.lock(child.address.path, lock.tid, false, `_mergeNode: read child "/${child.address.path}"`)
                    .then(async childLock => {
                        const childReader = new NodeReader(storage, child.address, childLock, false);
                        const allocation = await childReader.getAllocation(true);
                        childLock.release();
                        discardAllocation.ranges.push(...allocation.ranges);
                        const currentChildValue = new InternalNodeReference(child.type, child.address);
                        changes.add(keyOrIndex, currentChildValue, newValue);
                    });
                childValuePromises.push(promise);
            }
            else {
                changes.add(keyOrIndex, child.value, newValue);
            }
        });

    await Promise.all(childValuePromises);

    // Check which keys we haven't seen (were not in the current node), these will be added
    newKeys.forEach(key => {
        const newValue = updates[key];
        if (newValue !== null) {
            changes.add(key, null, newValue);
        }
    });

    if (changes.all.length === 0) {
        logger.info(`No effective changes to update node "/${nodeInfo.path}" with`.colorize(ColorStyle.yellow));
        return done(nodeReader.recordInfo);
    }

    if (isArray) {
        // Check if resulting array is dense: every item must have a value, no gaps allowed
        const getSequenceInfo = (changes: NodeChange[]) => {
            const indice = changes.map(ch => ch.keyOrIndex as number).sort(); // sorted from low index to high index
            const gaps = indice.map((_, i, arr) => i === 0 ? 0 : arr[i-1] - arr[i]);
            return { indice, hasGaps: gaps.some(g => g > 1) };
        };
        const deleteSeqInfo = getSequenceInfo(changes.deletes);
        const insertSeqInfo = getSequenceInfo(changes.inserts);
        let isSparse = deleteSeqInfo.hasGaps || deleteSeqInfo.hasGaps;
        if (!isSparse && changes.deletes.length > 0) {
            // Only allow deletes at the end of an array, check if is there's an entry with a higher index
            const highestIndex = deleteSeqInfo.indice.slice(-1)[0];
            const nextEntryInfo = await nodeReader.getChildInfo(highestIndex + 1);
            if (nextEntryInfo.exists) { isSparse = true; }
        }
        if (!isSparse && changes.inserts.length > 0) {
            // Only allow inserts at the end of an array, check if there's an entry with a lower index
            const lowestIndex = insertSeqInfo.indice[0];
            if (lowestIndex > 0) {
                const prevEntryInfo = await nodeReader.getChildInfo(lowestIndex - 1);
                if (!prevEntryInfo.exists) { isSparse = true; }
            }
        }
        if (isSparse) {
            throw new Error(`Elements cannot be inserted beyond, or removed before the end of an array. Rewrite the whole array at path "${nodeInfo.path}" or change your schema to use an object collection instead`);
        }
    }

    const maxDebugItems = 10;
    logger.info(`Node "/${nodeInfo.path}" being updated:${isInternalUpdate ? ' (internal)' : ''} adding ${changes.inserts.length} keys (${changes.inserts.slice(0, maxDebugItems).map(ch => `"${ch.keyOrIndex}"`).join(',')}${changes.inserts.length > maxDebugItems ? '...' : ''}), updating ${changes.updates.length} keys (${changes.updates.slice(0, maxDebugItems).map(ch => `"${ch.keyOrIndex}"`).join(',')}${changes.updates.length > maxDebugItems ? '...' : ''}), removing ${changes.deletes.length} keys (${changes.deletes.slice(0, maxDebugItems).map(ch => `"${ch.keyOrIndex}"`).join(',')}${changes.deletes.length > maxDebugItems ? '...' : ''})`.colorize(ColorStyle.cyan));
    if (!isInternalUpdate) {
        // Update cache (remove entries or mark them as deleted)
        // const pathInfo = PathInfo.get(nodeInfo.path);
        // const invalidatePaths = changes.all
        //     .filter(ch => !(ch.newValue instanceof InternalNodeReference))
        //     .map(ch => {
        //         const childPath = pathInfo.childPath(ch.keyOrIndex);
        //         return {
        //             path: childPath,
        //             pathInfo: PathInfo.get(childPath),
        //             action: ch.changeType === NodeChange.CHANGE_TYPE.DELETE ? 'delete' : 'invalidate'
        //         };
        //     });
        // storage.invalidateCache(false, nodeInfo.path, false, 'mergeNode');
        // invalidatePaths.forEach(item => {
        //     if (item.action === 'invalidate') { storage.invalidateCache(false, item.path, true, 'mergeNode'); }
        //     else { storage.nodeCache.delete(item.path); }
        // });
        const inv = changes.all
            .filter(ch => !(ch.newValue instanceof InternalNodeReference))
            .reduce((obj, ch) => {
                obj[ch.keyOrIndex] = ch.changeType === NodeChange.CHANGE_TYPE.DELETE ? 'delete' : 'invalidate';
                return obj;
            }, {} as Record<string | number, 'delete' | 'invalidate'>);
        storage.invalidateCache(false, nodeInfo.path, inv, 'mergeNode');
    }

    // What we need to do now is make changes to the actual record data.
    // The record is either a binary B+Tree (larger records),
    // or a list of key/value pairs (smaller records).
    // let updatePromise;
    let newRecordInfo;
    if (nodeReader.recordInfo.hasKeyIndex) {

        // Try to have the binary B+Tree updated. If there is not enough free space for this
        // (eg, if a leaf to add to is full), we have to rebuild the whole tree and write new records

        const pathInfo = PathInfo.get(nodeInfo.path);
        const childPromises = [];
        for (const change of changes.all) {
            // changes.all.forEach(change => {
            const childPath = pathInfo.childPath(change.keyOrIndex); //PathInfo.getChildPath(nodeInfo.path, change.keyOrIndex);
            if (change.oldValue !== null) {
                const kvp = _serializeValue(storage, childPath, change.keyOrIndex, change.oldValue, null);
                if(!(kvp instanceof SerializedKeyValue)) {
                    throw new Error('return value must be of type SerializedKeyValue, it cannot be a Promise!');
                }
                const bytes = _getValueBytes(kvp);
                change.oldValue = bytes;
            }
            if (change.newValue !== null) {
                const s = _serializeValue(storage, childPath, change.keyOrIndex, change.newValue, lock.tid);
                const convert = (kvp: SerializedKeyValue) => {
                    const bytes = _getValueBytes(kvp);
                    change.newValue = bytes;
                };
                if (s instanceof Promise) {
                    childPromises.push(s.then(convert));
                }
                else {
                    convert(s);
                }
            }
            // if (childPromises.length === 100) {
            //     // Too many promises. Wait before continuing?
            //     await Promise.all(childPromises.splice(0));
            // }
        } //);

        const operations = [] as BinaryBPlusTreeTransactionOperation[];
        let tree = nodeReader.getChildTree();
        await Promise.all(childPromises);

        changes.deletes.forEach(change => {
            const op = BinaryBPlusTree.TransactionOperation.remove(change.keyOrIndex, change.oldValue as Uint8Array);
            operations.push(op);
        });
        changes.updates.forEach(change => {
            const oldEntryValue = new BinaryBPlusTree.EntryValue(change.oldValue as Uint8Array);
            const newEntryValue = new BinaryBPlusTree.EntryValue(change.newValue as Uint8Array);
            const op = BinaryBPlusTree.TransactionOperation.update(change.keyOrIndex, newEntryValue, oldEntryValue);
            operations.push(op);
        });
        changes.inserts.forEach(change => {
            const op = BinaryBPlusTree.TransactionOperation.add(change.keyOrIndex, change.newValue as Uint8Array);
            operations.push(op);
        });

        // Changed behaviour:
        // previously, if 1 operation failed, the tree was rebuilt. If any operation thereafter failed, it stopped processing
        // now, processOperations() will be called after each rebuild, so all operations will be processed
        const opCountsLog: number[] = [], fixHistory = [] as any[];
        const processOperations = async (retry = 0): Promise<RecordInfo> => {
            if (retry > 2 && operations.length === opCountsLog[opCountsLog.length-1]) {
                // Number of pending operations did not decrease after 2 possible tree fixes
                throw new Error(`DEV: Applied tree fixes did not change ${operations.length} pending operation(s) failing to execute. Debug this, check fixHistory!`);
            }
            opCountsLog.push(operations.length);
            try {
                await tree.transaction(operations);
                logger.info(`Updated tree for node "/${nodeInfo.path}"`.colorize(ColorStyle.green));
                return recordInfo; // We do our own cleanup, return current allocation which is always the same as nodeReader.recordInfo
            }
            catch (err) {
                logger.info(`Could not update tree for "/${nodeInfo.path}"${retry > 0 ? ` (retry ${retry})` : ''}: ${err.message}, ${err.codes}`.colorize(ColorStyle.yellow));

                if (err.hasErrorCode && err.hasErrorCode('tree-full-no-autogrow')) {
                    logger.trace('Tree needs more space');

                    const growBytes = Math.ceil(tree.info.byteLength * 0.1); // grow 10%
                    const bytesRequired = tree.info.byteLength + growBytes;

                    fixHistory.push({ err, fix: 'grow', from: tree.info.byteLength, to: bytesRequired, growBytes });

                    // Copy from original allocation to new allocation
                    let sourceIndex = 0;
                    const originalLength = tree.info.byteLength;
                    const reader = async (length: number) => {
                        let data: any;
                        if (sourceIndex > originalLength) {
                            // 0s only
                            data = new Uint8Array(length);
                        }
                        else {
                            const readLength = sourceIndex + length < originalLength ? length : originalLength - sourceIndex;
                            data = await nodeReader._treeDataReader(sourceIndex, readLength);
                            if (data.length < length) {
                                // Append 0s
                                data = concatTypedArrays(new Uint8Array(data), new Uint8Array(length - data.length));
                            }
                            else if (data.length > length) {
                                // cut off unrequested bytes. TODO: check _treeDataReader logic
                                data = data.slice(0, length);
                            }
                        }
                        if (sourceIndex === 0) {
                            // Overwrite allocation bytes with new sizes.
                            // Doing this in-memory helps prevent issue #183, if writing the new tree fails because of a storage issue
                            tree.setAllocationBytes(data, bytesRequired, tree.info.freeSpace + growBytes);
                        }
                        sourceIndex += data.byteLength;
                        return data;
                    };
                    recordInfo = await _write(storage, nodeInfo.path, nodeReader.recordInfo.valueType, bytesRequired, true, reader, nodeReader.recordInfo);
                }
                else {
                    // Failed to update the binary data, we need to rebuild the tree
                    logger.trace(`B+Tree for path ${nodeInfo.path} needs rebuild`);
                    fixHistory.push({ err, fix: 'rebuild' });
                    recordInfo = await _rebuildKeyTree(tree, nodeReader, { reserveSpaceForNewEntries: changes.inserts.length - changes.deletes.length });
                }

                if (recordInfo !== nodeReader.recordInfo) {
                    // release previous allocation
                    discardAllocation.ranges.push(...nodeReader.recordInfo.allocation.ranges);
                    recordMoved = true;
                }

                // Create new node reader and new tree
                nodeReader = new NodeReader(storage, recordInfo.address, lock, false);
                recordInfo = await nodeReader.readHeader();
                tree = new BinaryBPlusTree({
                    readFn: nodeReader._treeDataReader.bind(nodeReader),
                    chunkSize: 1024 * 100, // 100KB reads/writes
                    writeFn: nodeReader._treeDataWriter.bind(nodeReader),
                    logger: storage.logger,
                    id: 'record@' + nodeReader.recordInfo.address.toString(),
                });

                // // Retry remaining operations
                return processOperations(retry+1);
            }
        };
        newRecordInfo = await processOperations();
    }
    else {
        // This is a small record. In the future, it might be nice to make changes
        // in the record itself, but let's just rewrite it for now.
        // Record (de)allocation is managed by _writeNode

        const mergedValue: Record<string | number, any> = isArray ? [] : {};

        await nodeReader.getChildStream()
            .next(child => {
                const keyOrIndex = isArray ? child.index : child.key;
                if (child.address) { //(child.storedAddress || child.address) {
                    //mergedValue[keyOrIndex] = new InternalNodeReference(child.type, child.storedAddress || child.address);
                    mergedValue[keyOrIndex] = new InternalNodeReference(child.type, child.address);
                }
                else {
                    mergedValue[keyOrIndex] = child.value;
                }
            });

        changes.deletes.forEach(change => {
            delete mergedValue[change.keyOrIndex];
        });
        changes.updates.forEach(change => {
            mergedValue[change.keyOrIndex] = change.newValue;
        });
        changes.inserts.forEach(change => {
            mergedValue[change.keyOrIndex] = change.newValue;
        });
        if (isArray) {
            mergedValue.length += changes.inserts.length - changes.deletes.length;
        }

        // Check below has moved to more extensive test above which is done before the cache is altered - fixes an issue!
        // if (isArray) {
        //     const isExhaustive = Object.keys(mergedValue).every((key, i) => +key === i); // test if there are gaps in the array (eg misses value at index 3)
        //     if (!isExhaustive) {
        //         throw new Error(`Elements cannot be inserted beyond, or removed before the end of an array. Rewrite the whole array at path "${nodeInfo.path}" or change your schema to use an object collection instead`);
        //     }
        // }
        newRecordInfo = await _writeNode(storage, nodeInfo.path, mergedValue, lock, nodeReader.recordInfo);
    }

    return done(newRecordInfo);
}
