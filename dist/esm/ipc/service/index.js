import { createServer } from 'net';
import { getSocketPath } from './shared.js';
import { AceBase } from '../..//index.js';
const ERROR = Object.freeze({
    ALREADY_RUNNING: { code: 'already_running', exitCode: 2 },
    UNKNOWN: { code: 'unknown', exitCode: 3 },
    NO_DB: { code: 'no_db', exitCode: 4 },
});
export async function startServer(dbFile, exit) {
    const fileMatch = dbFile.match(/^(?<storagePath>.*([\\\/]))(?<dbName>.+)\.acebase\2(?<storageType>[a-z]+)\.db$/);
    if (!fileMatch) {
        return exit(ERROR.NO_DB.exitCode);
    }
    const { storagePath, dbName, storageType } = fileMatch.groups;
    let db; // Will be opened when listening
    const sockets = [];
    const socketPath = getSocketPath(dbFile);
    console.log(`starting socket server on path ${socketPath}`);
    const server = createServer();
    server.listen({
        path: socketPath,
        readableAll: true,
        writableAll: true,
    });
    server.on('listening', () => {
        // Started successful
        // state = STATE.STARTED;
        // process.send(`state:${state}`);
        process.on('SIGINT', () => server.close());
        process.on('exit', (code) => {
            console.log(`exiting with code ${code}`);
        });
        // Start the "master" IPC client
        db = new AceBase(dbName, { storage: { type: storageType, path: storagePath, ipc: server } });
        // Bind socket server to the instance
        // (db.api.storage.ipc as IPCSocketPeer).server = server;
    });
    server.on('error', (err) => {
        // state = STATE.ERROR;
        // process.send(`state:${state}`);
        // process.send(`error:${err.code ?? err.message}`);
        if (err.code === 'EADDRINUSE') {
            console.log('socket server already running');
            return exit(ERROR.ALREADY_RUNNING.exitCode);
        }
        console.error(`socket server error ${err.code ?? err.message}`);
        exit(ERROR.UNKNOWN.exitCode);
    });
    server.on('connection', (socket) => {
        // New socket connected handler
        sockets.push(socket);
        console.log(`socket connected, total: ${sockets.length}`);
        // socket.on('data', (data) => {
        //     // Received data from a connected client (master or worker)
        //     // Socket IPC implementation handles this
        // });
        socket.on('close', (hadError) => {
            // Socket is closed
            sockets.splice(sockets.indexOf(socket), 1);
            console.log(`socket disconnected${hadError ? ' because of an error' : ''}, total: ${sockets.length}`);
            if (sockets.length === 0) {
                // setTimeout(() => {
                //     if (sockets.length === 0) {
                console.log(`closing server socket because there are no more connected clients, exiting with code 0`);
                // Stop socket server
                server.close((err) => {
                    exit(0);
                });
                //     }
                // }, 5000);
            }
        });
    });
    server.on('close', () => {
        db.close();
    });
}
//# sourceMappingURL=index.js.map