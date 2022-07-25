"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// I apparently started building a BinaryBPlusTreeLeafExtData class,
// which would be a good thing to try again soon!
// class BinaryBPlusTreeLeafExtData {
//     /**
//      *
//      * @param {object} [info]
//      * @param {number} [info.length=0]
//      * @param {number} [info.freeBytes=0]
//      * @param {boolean} [info.loaded]
//      * @param {()=>Promise<void>} [info.load]
//      */
//     constructor(info) {
//         this.length = typeof info.length === 'number' ? info.length : 0;
//         this.freeBytes = typeof info.freeBytes === 'number' ? info.freeBytes : 0;
//         this.loaded = typeof info.loaded === 'boolean' ? info.loaded : false;
//         if (typeof info.load === 'function') {
//             this.load = info.load;
//         }
//     }
//     /**
//      * MUST BE OVERRIDEN: Makes sure all extData blocks are read. Needed when eg rebuilding.
//      */
//     load() {
//         throw new Error('BinaryBPlusTreeLeaf.extData.load must be overriden');
//     }
// }
//# sourceMappingURL=binary-tree-leaf-entry-extdata.js.map