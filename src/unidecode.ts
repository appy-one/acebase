import * as Unidecode from 'unidecode';
const unidecode = ((Unidecode as any).default ?? Unidecode) as (input: string) => string;
export default unidecode;
