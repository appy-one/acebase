export interface IType {
    typeOf: string;
    instanceOf?: Function;
    value?: string | number | boolean | null;
    genericTypes?: IType[];
    children?: IProperty[];
}
export interface IProperty {
    name: string;
    optional: boolean;
    wildcard: boolean;
    types: IType[];
}
export interface ISchemaCheckResult {
    ok: boolean;
    reason?: string;
}
export declare class SchemaDefinition {
    readonly source: string | Object;
    readonly text: string;
    readonly type: IType;
    constructor(definition: string | Object);
    check(path: string, value: any, partial: boolean): ISchemaCheckResult;
}
