let LOG_LEVEL = "log";
const debug = {
    log: ["log"].indexOf(LOG_LEVEL) >= 0 ? console.log.bind(console) : ()=>{},
    warn: ["log", "warn"].indexOf(LOG_LEVEL) >= 0  ? console.warn.bind(console) : ()=>{},
    error: ["log", "warn", "error"].indexOf(LOG_LEVEL) >= 0 ? console.error.bind(console) : ()=>{},
    setLevel(level) {
        LOG_LEVEL = level;
    }
};

module.exports = debug;