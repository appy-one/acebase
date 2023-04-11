"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MSG_DELIMITER = exports.getSocketPath = void 0;
function getSocketPath(filePath) {
    return process.platform === 'win32'
        ? `\\\\.\\pipe\\${filePath.replace(/^\//, '').replace(/\//g, '-')}`
        : `${filePath}.sock`;
}
exports.getSocketPath = getSocketPath;
// export const MSG_DELIMITER = String.fromCharCode(0) + String.fromCharCode(1) + String.fromCharCode(3) + String.fromCharCode(5) + String.fromCharCode(0);
exports.MSG_DELIMITER = '\n';
//# sourceMappingURL=shared.js.map