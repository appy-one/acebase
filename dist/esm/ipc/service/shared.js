import { createHash } from 'crypto';
export function getSocketPath(filePath) {
    let path = process.platform === 'win32'
        ? `\\\\.\\pipe\\${filePath.replace(/^\//, '').replace(/\//g, '-')}`
        : `${filePath}.sock`;
    const maxLength = process.platform === 'win32' ? 256 : 108;
    if (path.length > maxLength) {
        // Use hash of filepath instead
        const hash = createHash('sha256').update(path).digest('hex');
        path = process.platform === 'win32'
            ? `\\\\.\\pipe\\${hash}`
            : `${hash}.sock`;
    }
    return path;
}
// export const MSG_DELIMITER = String.fromCharCode(0) + String.fromCharCode(1) + String.fromCharCode(3) + String.fromCharCode(5) + String.fromCharCode(0);
export const MSG_DELIMITER = '\n';
//# sourceMappingURL=shared.js.map