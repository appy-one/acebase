"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MSG_DELIMITER = exports.getSocketPath = void 0;
const crypto_1 = require("crypto");
function getSocketPath(filePath) {
    let path = process.platform === 'win32'
        ? `\\\\.\\pipe\\${filePath.replace(/^\//, '').replace(/\//g, '-')}`
        : `${filePath}.sock`;
    const maxLength = process.platform === 'win32' ? 256 : 108;
    if (path.length > maxLength) {
        // Use hash of filepath instead
        const hash = (0, crypto_1.createHash)('sha256').update(path).digest('hex');
        path = process.platform === 'win32'
            ? `\\\\.\\pipe\\${hash}`
            : `${hash}.sock`;
    }
    return path;
}
exports.getSocketPath = getSocketPath;
// export const MSG_DELIMITER = String.fromCharCode(0) + String.fromCharCode(1) + String.fromCharCode(3) + String.fromCharCode(5) + String.fromCharCode(0);
exports.MSG_DELIMITER = '\n';
//# sourceMappingURL=shared.js.map