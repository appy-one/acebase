// Ugly workaround to import an untyped commonjs module for usage in typescript
import * as unidecode from 'unidecode'; // declared in unidecode-module.ts
export default unidecode as unknown as (input: string) => string;
