"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports._compareBinary = exports._sortCompare = exports._isMoreOrEqual = exports._isMore = exports._isLessOrEqual = exports._isLess = exports._isNotEqual = exports._isEqual = exports._getComparibleValue = void 0;
function _getComparibleValue(val) {
    if (typeof val === 'undefined' || val === null) {
        val = null;
    }
    else if (val instanceof Date) {
        val = val.getTime();
    }
    return val;
}
exports._getComparibleValue = _getComparibleValue;
function _isEqual(val1, val2) {
    val1 = _getComparibleValue(val1);
    val2 = _getComparibleValue(val2);
    if (typeof val1 !== typeof val2) {
        return false;
    }
    return val1 === val2;
}
exports._isEqual = _isEqual;
function _isNotEqual(val1, val2) {
    val1 = _getComparibleValue(val1);
    val2 = _getComparibleValue(val2);
    if (typeof val1 !== typeof val2) {
        return true;
    }
    return val1 != val2;
}
exports._isNotEqual = _isNotEqual;
function _isLess(val1, val2) {
    val1 = _getComparibleValue(val1);
    val2 = _getComparibleValue(val2);
    if (val2 === null) {
        return false;
    }
    if (val1 === null) {
        return val2 !== null;
    }
    if (typeof val1 !== typeof val2) {
        return typeof val1 < typeof val2;
    } // boolean, number (+Dates), string
    return val1 < val2;
}
exports._isLess = _isLess;
function _isLessOrEqual(val1, val2) {
    val1 = _getComparibleValue(val1);
    val2 = _getComparibleValue(val2);
    if (val1 === null) {
        return true;
    }
    else if (val2 === null) {
        return false;
    }
    if (typeof val1 !== typeof val2) {
        return typeof val1 < typeof val2;
    } // boolean, number (+Dates), string
    return val1 <= val2;
}
exports._isLessOrEqual = _isLessOrEqual;
function _isMore(val1, val2) {
    val1 = _getComparibleValue(val1);
    val2 = _getComparibleValue(val2);
    if (val1 === null) {
        return false;
    }
    else if (val2 === null) {
        return true;
    }
    if (typeof val1 !== typeof val2) {
        return typeof val1 > typeof val2;
    } // boolean, number (+Dates), string
    return val1 > val2;
}
exports._isMore = _isMore;
function _isMoreOrEqual(val1, val2) {
    val1 = _getComparibleValue(val1);
    val2 = _getComparibleValue(val2);
    if (val1 === null) {
        return val2 === null;
    }
    else if (val2 === null) {
        return true;
    }
    if (typeof val1 !== typeof val2) {
        return typeof val1 > typeof val2;
    } // boolean, number (+Dates), string
    return val1 >= val2;
}
exports._isMoreOrEqual = _isMoreOrEqual;
function _sortCompare(val1, val2) {
    val1 = _getComparibleValue(val1);
    val2 = _getComparibleValue(val2);
    if (val1 === null && val2 !== null) {
        return -1;
    }
    if (val1 !== null && val2 === null) {
        return 1;
    }
    if (typeof val1 !== typeof val2) {
        // boolean, number (+Dates), string
        if (typeof val1 < typeof val2) {
            return -1;
        }
        if (typeof val1 > typeof val2) {
            return 1;
        }
    }
    if (val1 < val2) {
        return -1;
    }
    if (val1 > val2) {
        return 1;
    }
    return 0;
}
exports._sortCompare = _sortCompare;
function _compareBinary(val1, val2) {
    return val1.length === val2.length && val1.every((byte, index) => val2[index] === byte);
}
exports._compareBinary = _compareBinary;
//# sourceMappingURL=typesafe-compare.js.map