export class NotSupported {
    constructor(context = 'browser') { throw new Error(`This feature is not supported in ${context} context`); }
}
