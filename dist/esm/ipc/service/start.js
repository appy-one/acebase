import { startServer } from './index.js';
(async () => {
    try {
        const dbFile = process.argv[2]; // full path to db storage file, eg '/home/ewout/project/db.acebase/data.db'
        await startServer(dbFile, (code) => {
            process.exit(code);
        });
    }
    catch (err) {
        console.error(`Start error:`, err);
        process.exit(1);
    }
})();
//# sourceMappingURL=start.js.map