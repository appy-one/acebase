import { LoggerPlugin, LoggingLevel } from 'acebase-core';

export interface StorageEnv {
    logLevel: LoggingLevel;
    logColors: boolean;
    logger?: LoggerPlugin;
}
