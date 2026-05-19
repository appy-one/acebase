import { readFile } from 'fs/promises';
import { resolve } from 'path';

export async function readDataSet(name: string) {
    const path = getDataSetPath(name);
    const file = await readFile(path, 'utf8');
    return JSON.parse(file);
}

export function getDataSetPath(name: string) {
    const path = resolve(process.cwd(), 'spec/dataset');
    return `${path}/${name}.json`;
}
