"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const _1 = require(".");
(async () => {
    try {
        const dbFile = process.argv[2]; // full path to db storage file, eg '/home/ewout/project/db.acebase/data.db'
        await (0, _1.startServer)(dbFile, (code) => {
            process.exit(code);
        });
    }
    catch (err) {
        console.error(`Start error:`, err);
        process.exit(1);
    }
})();
//# sourceMappingURL=start.js.map