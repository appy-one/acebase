import { RecordInfo } from '../record-info.js';
import { AceBaseStorage } from '../binary-storage.js';
import { _writeNode } from './write-node.js';

export async function _lockAndWriteNode(storage: AceBaseStorage, path: string, value: any, parentTid: string | number): Promise<RecordInfo> {
    const lock = await storage.nodeLocker.lock(path, parentTid.toString(), true, `_lockAndWrite "${path}"`);
    try {
        const recordInfo = await _writeNode(storage, path, value, lock);
        return recordInfo;
    }
    finally {
        lock.release();
    }
}
