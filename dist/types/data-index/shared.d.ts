import { NodeEntryKeyType } from '../btree/entry-key-type';
import { LeafEntryMetaData } from '../btree/leaf-entry-metadata';
import { LeafEntryRecordPointer } from '../btree/leaf-entry-recordpointer';
export type FileSystemError = Error & {
    code: string;
};
export type IndexableValue = NodeEntryKeyType;
export type IndexableValueOrArray = IndexableValue | IndexableValue[];
export type IndexRecordPointer = LeafEntryRecordPointer;
export type IndexMetaData = LeafEntryMetaData;
//# sourceMappingURL=shared.d.ts.map