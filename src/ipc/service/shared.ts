import { createHash } from 'crypto';

export function getSocketPath(filePath: string) {
    if (process.platform === 'win32') {
        let path = `\\\\.\\pipe\\${filePath.replace(/^\//, '').replace(/\//g, '-')}`;
        if (path.length > 256) {
            const hash = createHash('sha256').update(path).digest('hex');
            path = `\\\\.\\pipe\\${hash}`;
        }
        return path;
    }
    // Create a Unix socket at /tmp/[dbName]-[dbType]-[shortHash].acebase.sock
    const match = filePath.match(/[\\\/]([^\\\/]+)\.acebase[\\\/]([^\\\/]+)\.([^.\\\/]+)$/);
    const dbName = match ? match[1] : 'db';
    const dbType = match ? match[2] : 'data';
    const shortHash = createHash('sha256').update(filePath).digest('hex').slice(0, 8);
    return `/tmp/${dbName}-${dbType}-${shortHash}.acebase.sock`;
}

// export const MSG_DELIMITER = String.fromCharCode(0) + String.fromCharCode(1) + String.fromCharCode(3) + String.fromCharCode(5) + String.fromCharCode(0);
export const MSG_DELIMITER = '\n';
