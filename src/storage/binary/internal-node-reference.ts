import { BinaryNodeAddress } from './node-address.js';

export class InternalNodeReference {
    private _address: BinaryNodeAddress;
    constructor(public type: number, address: BinaryNodeAddress) {
        this._address = address;
    }
    get address() {
        return this._address;
    }
    get path() {
        return this._address.path;
    }
    get pageNr() {
        return this._address.pageNr;
    }
    get recordNr() {
        return this._address.recordNr;
    }
}
