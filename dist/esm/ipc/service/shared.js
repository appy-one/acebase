export function getSocketPath(filePath) {
    return process.platform === 'win32'
        ? `\\\\.\\pipe\\${filePath.replace(/^\//, '').replace(/\//g, '-')}`
        : `${filePath}.sock`;
}
// export const MSG_DELIMITER = String.fromCharCode(0) + String.fromCharCode(1) + String.fromCharCode(3) + String.fromCharCode(5) + String.fromCharCode(0);
export const MSG_DELIMITER = '\n';
//# sourceMappingURL=shared.js.map