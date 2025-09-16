import { createServer, Socket } from 'net';
import { getSocketPath } from './shared';
import { AceBase, type AceBaseLocalSettings } from '../../';
import { DebugLogger, LoggerPlugin } from 'acebase-core';

const ERROR = Object.freeze({
    ALREADY_RUNNING: { code: 'already_running', exitCode: 2 },
    UNKNOWN: { code: 'unknown', exitCode: 3 },
    NO_DB: { code: 'no_db', exitCode: 4 },
});

export async function startServer(
    dbFile: string,
    options: {
        /** path to code that returns an initialized logger plugin */
        loggerPluginPath?: string,
        logLevel: AceBaseLocalSettings['logLevel'],
        maxIdleTime: number,
        exit: (code: number) => void
    }
) {
    const fileMatch = dbFile.match(/^(?<storagePath>.*([\\\/]))(?<dbName>.+)\.acebase\2(?<storageType>[a-z]+)\.db$/);
    if (!fileMatch) {
        return options.exit(ERROR.NO_DB.exitCode);
    }
    const { storagePath, dbName, storageType } = fileMatch.groups;
    const logger = options.loggerPluginPath
        ? await (async () => {
            const logger = await import(options.loggerPluginPath);
            return (logger.default ?? logger) as LoggerPlugin;
        })()
        : new DebugLogger(options.logLevel, `[IPC service ${dbName}:${storageType}]`);
    let db: AceBase; // Will be opened when listening

    const sockets = [] as Socket[];

    const socketPath = getSocketPath(dbFile);
    logger.info(`[starting socket server on path ${socketPath}`);

    const server = createServer();
    server.listen({
        path: socketPath,
        readableAll: true,
        writableAll: true,
    });

    server.on('listening', () => {
        // Started successful
        process.on('SIGINT', () => server.close());
        process.on('exit', (code) => {
            logger.info(`exiting with code ${code}`);
        });

        // Start the "master" IPC client
        db = new AceBase(dbName, { logLevel: options.logLevel, logger, storage: { type: storageType, path: storagePath, ipc: server } });
    });

    server.on('error', (err: Error & { code: string }) => {
        if (err.code === 'EADDRINUSE') {
            logger.info(`socket server already running`);
            return options.exit(ERROR.ALREADY_RUNNING.exitCode);
        }
        logger.error(`socket server error ${err.code ?? err.message}`);
        options.exit(ERROR.UNKNOWN.exitCode);
    });

    let connectionsMade = false;
    server.on('connection', (socket) => {
        // New socket connected handler
        connectionsMade = true;
        sockets.push(socket);
        logger.info(`socket connected, total: ${sockets.length}`);

        socket.on('close', (hadError) => {
            // Socket is closed
            sockets.splice(sockets.indexOf(socket), 1);
            logger.info(`socket disconnected${hadError ? ' because of an error' : ''}, total: ${sockets.length}`);
            if (sockets.length === 0) {
                const stop = () => {
                    logger.info(`closing server socket because there are no more connected clients, exiting with code 0`);
                    // Stop socket server
                    server.close((err) => {
                        options.exit(err ? ERROR.UNKNOWN.exitCode : 0);
                    });
                };
                if (options.maxIdleTime > 0) {
                    setTimeout(() => {
                        if (sockets.length === 0) { stop(); }
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
                logger.info(`closing server socket because no clients connected, exiting with code 0`);
                // Stop socket server
                server.close((err) => {
                    options.exit(err ? ERROR.UNKNOWN.exitCode : 0);
                });
            }
        }, options.maxIdleTime).unref();
    }
}
