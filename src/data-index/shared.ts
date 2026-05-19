import { NodeEntryKeyType } from '../btree/entry-key-type.js';
import { LeafEntryMetaData } from '../btree/leaf-entry-metadata.js';
import { LeafEntryRecordPointer } from '../btree/leaf-entry-recordpointer.js';

export type FileSystemError = Error & { code: string };

export type IndexableValue = NodeEntryKeyType;
export type IndexableValueOrArray = IndexableValue | IndexableValue[];
export type IndexRecordPointer = LeafEntryRecordPointer;
export type IndexMetaData = LeafEntryMetaData;
