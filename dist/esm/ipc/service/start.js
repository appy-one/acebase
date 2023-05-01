import { startServer } from './index.js';
(async () => {
    try {
        const dbFile = process.argv[2]; // full path to db storage file, eg '/home/ewout/project/db.acebase/data.db'
        const settings = process.argv.slice(3).reduce((settings, arg, i, args) => {
            switch (arg.toLowerCase()) {
                case '--loglevel':
                    settings.logLevel = args[i + 1];
                    break;
                case '--maxidletime':
                    settings.maxIdleTime = parseInt(args[i + 1]);
                    break;
            }
            return settings;
        }, { logLevel: 'log', maxIdleTime: 5000 });
        await startServer(dbFile, {
            logLevel: settings.logLevel,
            maxIdleTime: settings.maxIdleTime,
            exit: (code) => {
                process.exit(code);
            },
        });
    }
    catch (err) {
        console.error(`Start error:`, err);
        process.exit(1);
    }
})();
//# sourceMappingURL=start.js.map