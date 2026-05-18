/**
 * Client config for usage with an acebase-ipc-server. See https://github.com/appy-one/acebase-ipc-server
 * Use this to horizontally scale database access: this allows multiple machines (or isolated instances of your app) to access and modify the
 * database simultaneously.
 */
export interface IPCClientSettings {
    /**
     * IPC Server host to connect to. Default is `"localhost"`
     * @default 'localhost'
     */
    host?: string;

    /**
     * IPC Server port number
     */
    port: number;

    /**
     * Whether to use a secure connection to the server. Strongly recommended if `host` is not `"localhost"`. Default is `false`
     * @default false
     */
    ssl?: boolean;

    /**
     * Token used in the IPC Server configuration (optional). The server will refuse connections using the wrong token.
     */
    token?: string;

    /**
     * Determines the role of this IPC client. Only 1 process can be assigned the 'master' role, all other processes must use the role 'worker'
     */
    role: 'master' | 'worker';
}
