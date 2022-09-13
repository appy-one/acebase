import { NodeEntryKeyType } from '../btree/entry-key-type';
import { LeafEntryMetaData } from '../btree/leaf-entry-metadata';
import { LeafEntryRecordPointer } from '../btree/leaf-entry-recordpointer';
export declare type FileSystemError = Error & {
    code: string;
};
export declare type IndexableValue = NodeEntryKeyType;
export declare type IndexableValueOrArray = IndexableValue | IndexableValue[];
export declare type IndexRecordPointer = LeafEntryRecordPointer;
export declare type IndexMetaData = LeafEntryMetaData;
