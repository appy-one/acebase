export class SchemaValidationError extends Error {
    constructor(public reason: string) {
        super(`Schema validation failed: ${reason}`);
    }
}
