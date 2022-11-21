import Jasmine from 'jasmine';
import Loader from 'jasmine/lib/loader.js';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Hijack loader to always `import` spec files instead of `require`ing them because they don't have .mjs extension
Loader.prototype.load = function(path) {
    return import(`file://${path}`);
};

const jasmine = new Jasmine({});
jasmine.loadConfigFile(`${__dirname}/jasmine.json`);

// TODO: add command line args
function parseOptions(argv) {
    function isEnvironmentVariable(command) {
        var envRegExp = /(.*)=(.*)/;
        return command.match(envRegExp);
    }
    function isFileArg(arg) {
        return arg.indexOf('--') !== 0 && !isEnvironmentVariable(arg);
    }
    var files = [],
        helpers = [],
        requires = [],
        unknownOptions = [],
        color = process.stdout.isTTY || false,
        reporter,
        configPath,
        filter,
        stopOnFailure,
        failFast,
        random,
        seed;

    for (var i in argv) {
        var arg = argv[i];
        if (arg === '--no-color') {
            color = false;
        } else if (arg === '--color') {
            color = true;
        } else if (arg.match('^--filter=')) {
            filter = arg.match('^--filter=(.*)')[1];
        } else if (arg.match('^--helper=')) {
            helpers.push(arg.match('^--helper=(.*)')[1]);
        } else if (arg.match('^--require=')) {
            requires.push(arg.match('^--require=(.*)')[1]);
        } else if (arg.match('^--stop-on-failure=')) {
            stopOnFailure = arg.match('^--stop-on-failure=(.*)')[1] === 'true';
        } else if (arg.match('^--fail-fast=')) {
            failFast = arg.match('^--fail-fast=(.*)')[1] === 'true';
        } else if (arg.match('^--random=')) {
            random = arg.match('^--random=(.*)')[1] === 'true';
        } else if (arg.match('^--seed=')) {
            seed = arg.match('^--seed=(.*)')[1];
        } else if (arg.match('^--config=')) {
            configPath = arg.match('^--config=(.*)')[1];
        } else if (arg.match('^--reporter=')) {
            reporter = arg.match('^--reporter=(.*)')[1];
        } else if (arg === '--') {
            break;
        } else if (isFileArg(arg)) {
            files.push(arg);
        } else if (!isEnvironmentVariable(arg)) {
            unknownOptions.push(arg);
        }
    }
    return {
        color: color,
        configPath: configPath,
        filter: filter,
        stopOnFailure: stopOnFailure,
        failFast: failFast,
        helpers: helpers,
        requires: requires,
        reporter: reporter,
        files: files,
        random: random,
        seed: seed,
        unknownOptions: unknownOptions,
    };
}

const options = parseOptions(process.argv.slice(2)); // don't include "node index.js"
jasmine.execute(options.files, options.filter);
