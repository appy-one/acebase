import { createHash } from 'crypto';

export function getSocketPath(filePath: string) {
    const match = filePath.match(/[\\\/]([^\\\/]+)\.acebase[\\\/]([^\\\/]+)\.([^.\\\/]+)$/);
    const dbName = match ? match[1] : 'db';
    const dbType = match ? match[2] : 'data';
    const shortHash = createHash('sha256').update(filePath).digest('hex').slice(0, 8);
    if (process.platform === 'win32') {
        // Create named pipe
        return `\\\\.\\pipe\\${dbName}-${dbType}-${shortHash}.acebase`;
    } else {
        // Create Unix socket at /tmp/[dbName]-[dbType]-[shortHash].acebase.sock
        return `/tmp/${dbName}-${dbType}-${shortHash}.acebase.sock`;
    }
}

// export const MSG_DELIMITER = String.fromCharCode(0) + String.fromCharCode(1) + String.fromCharCode(3) + String.fromCharCode(5) + String.fromCharCode(0);
export const MSG_DELIMITER = '\n';
