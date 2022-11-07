"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotSupported = void 0;
class NotSupported {
    constructor(context = 'browser') { throw new Error(`This feature is not supported in ${context} context`); }
}
exports.NotSupported = NotSupported;
//# sourceMappingURL=not-supported.js.map