/**
 * IPC settings to automatically spawn (or connect to) a local service/daemon process.
 * Use this to vertically scale database access: this allows multiple processes/threads on a single machine to access and modify the
 * database simultaneously.
 */
export interface IPCSocketSettings {
    /**
     * Use 'socket' IPC service/daemon with additional options
     */
    role: 'socket';

    /**
     * Max time in ms to keep started daemon running after the last client disconnects, defaults to 5000 (5s)
     */
    maxIdleTime?: number;

    /**
     * Path to code that returns an initialized logger plugin. Uses the built-in logger if not specified
     */
    loggerPluginPath?: string;
}
