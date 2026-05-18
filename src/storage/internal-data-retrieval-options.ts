import { type DataRetrievalOptions } from 'acebase-core';

export type InternalDataRetrievalOptions = DataRetrievalOptions  & { tid?: string | number };
