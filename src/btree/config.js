"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_LEAF_ENTRY_VALUES = exports.MAX_SMALL_LEAF_VALUE_LENGTH = exports.WRITE_SMALL_LEAFS = void 0;
exports.WRITE_SMALL_LEAFS = true;
exports.MAX_SMALL_LEAF_VALUE_LENGTH = 127 - 4; // -4 because value_list_length is now included in data length
exports.MAX_LEAF_ENTRY_VALUES = Math.pow(2, 32) - 1;
//# sourceMappingURL=config.js.map