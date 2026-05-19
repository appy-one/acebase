// Injects ESM-compatible __dirname shim into compiled ESM output files.
// TypeScript's @types/node declares __dirname globally so it type-checks fine,
// but Node.js does not provide it in ES modules at runtime.
import { readdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';

// Uses the global URL constructor (no import needed) to derive the directory.
// new URL('.', import.meta.url) => file:///path/to/dir/  (trailing slash)
const SHIM = 'const __dirname = new URL(\'.\', import.meta.url).pathname.slice(0, -1);\n';

async function fix(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            await fix(fullPath);
        } else if (entry.name.endsWith('.js')) {
            const src = await readFile(fullPath, 'utf8');
            if (src.includes('__dirname')) {
                await writeFile(fullPath, SHIM + src);
            }
        }
    }
}

fix('./dist/esm').catch(err => { console.error(err); process.exit(1); });
