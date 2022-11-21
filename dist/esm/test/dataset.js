import { readFile } from 'fs/promises';
import { resolve } from 'path';
export async function readDataSet(name) {
    const path = getDataSetPath(name);
    const file = await readFile(path, 'utf8');
    return JSON.parse(file);
}
export function getDataSetPath(name) {
    const path = resolve(/file:\/{2,3}(.+)\/[^/]/.exec(import.meta.url)[1], '../../../spec/dataset'); // dir relative to dist/[cjs|esm]/test
    return `${path}/${name}.json`;
}
//# sourceMappingURL=dataset.js.map