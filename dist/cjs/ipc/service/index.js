"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startServer = void 0;
const net_1 = require("net");
const shared_1 = require("./shared");
const __1 = require("../../");
const acebase_core_1 = require("acebase-core");
const ERROR = Object.freeze({
    ALREADY_RUNNING: { code: 'already_running', exitCode: 2 },
    UNKNOWN: { code: 'unknown', exitCode: 3 },
    NO_DB: { code: 'no_db', exitCode: 4 },
});
async function startServer(dbFile, options) {
    const fileMatch = dbFile.match(/^(?<storagePath>.*([\\\/]))(?<dbName>.+)\.acebase\2(?<storageType>[a-z]+)\.db$/);
    if (!fileMatch) {
        return options.exit(ERROR.NO_DB.exitCode);
    }
    const { storagePath, dbName, storageType } = fileMatch.groups;
    const logger = new acebase_core_1.DebugLogger(options.logLevel, `[IPC service ${dbName}:${storageType}]`);
    let db; // Will be opened when listening
    const sockets = [];
    const socketPath = (0, shared_1.getSocketPath)(dbFile);
    logger.log(`[starting socket server on path ${socketPath}`);
    const server = (0, net_1.createServer)();
    server.listen({
        path: socketPath,
        readableAll: true,
        writableAll: true,
    });
    server.on('listening', () => {
        // Started successful
        process.on('SIGINT', () => server.close());
        process.on('exit', (code) => {
            logger.log(`exiting with code ${code}`);
        });
        // Start the "master" IPC client
        db = new __1.AceBase(dbName, { logLevel: options.logLevel, storage: { type: storageType, path: storagePath, ipc: server } });
    });
    server.on('error', (err) => {
        var _a;
        if (err.code === 'EADDRINUSE') {
            logger.log(`socket server already running`);
            return options.exit(ERROR.ALREADY_RUNNING.exitCode);
        }
        logger.error(`socket server error ${(_a = err.code) !== null && _a !== void 0 ? _a : err.message}`);
        options.exit(ERROR.UNKNOWN.exitCode);
    });
    let connectionsMade = false;
    server.on('connection', (socket) => {
        // New socket connected handler
        connectionsMade = true;
        sockets.push(socket);
        logger.log(`socket connected, total: ${sockets.length}`);
        socket.on('close', (hadError) => {
            // Socket is closed
            sockets.splice(sockets.indexOf(socket), 1);
            logger.log(`socket disconnected${hadError ? ' because of an error' : ''}, total: ${sockets.length}`);
            if (sockets.length === 0) {
                const stop = () => {
                    logger.log(`closing server socket because there are no more connected clients, exiting with code 0`);
                    // Stop socket server
                    server.close((err) => {
                        options.exit(err ? ERROR.UNKNOWN.exitCode : 0);
                    });
                };
                if (options.maxIdleTime > 0) {
                    setTimeout(() => {
                        if (sockets.length === 0) {
                            stop();
                        }
                    }, 5000);
                }
                else {
                    stop();
                }
            }
        });
    });
    server.on('close', () => {
        db.close();
    });
    if (options.maxIdleTime > 0) {
        setTimeout(() => {
            if (!connectionsMade) {
                logger.log(`closing server socket because no clients connected, exiting with code 0`);
                // Stop socket server
                server.close((err) => {
                    options.exit(err ? ERROR.UNKNOWN.exitCode : 0);
                });
            }
        }, options.maxIdleTime).unref();
    }
}
exports.startServer = startServer;
//# sourceMappingURL=index.js.map