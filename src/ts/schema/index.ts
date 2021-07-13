export interface IType {
    typeOf: string, // typeof
    instanceOf?: Function, // eg: instanceof 'Array'
    value?:string|number|boolean|null,
    genericTypes?: IType[],
    children?: IProperty[]
}

export interface IProperty {
    name: string,
    optional: boolean,
    wildcard: boolean,
    types: IType[]
}

// parses a typestring, creates checker functions 
function parse(definition: string) {
    // tokenize
    let pos = 0;
    function consumeSpaces() {
        let c;
        while (c = definition[pos], [' ','\r','\n','\t'].includes(c)) { pos++; }
    }
    function consumeCharacter(c) {
        if (definition[pos] !== c) {
            throw new Error(`Unexpected character at position ${pos}. Expected: '${c}', found '${definition[pos]}'`);
        }
        pos++;
    }
    function readProperty() {
        consumeSpaces();
        let prop = { name: '', optional: false, wildcard: false }, c;
        while (c = definition[pos], c === '_' || c === '$' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (prop.name.length > 0 && c >= '0' && c <= '9') || (prop.name.length === 0 && c === '*')) {
            prop.name += c;
            pos++;
        }
        if (prop.name.length === 0) {
            throw new Error(`Property name expected at position ${pos}`);
        }
        if (definition[pos] === '?') {
            prop.optional = true;
            pos++;
        }
        if (prop.name === '*' || prop.name[0] === '$') {
            prop.optional = true;
            prop.wildcard = true;
        }
        consumeSpaces();
        consumeCharacter(':');
        return prop;
    }
    function readType() {
        consumeSpaces();
        let type: IType = { typeOf: 'any' }, c;
        
        // try reading simple type first: (string,number,boolean,Date etc)
        let name = '';
        while (c = definition[pos], (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) {
            name += c;
            pos++;
        }
        
        if (name.length === 0) {

            if (definition[pos] === '*') {
                // any value
                consumeCharacter('*');
                type.typeOf = 'any';
            }
            else if ([`'`,`"`,'`'].includes(definition[pos])) {
                // Read string value
                type.typeOf = 'string';
                type.value = '';
                const quote = definition[pos];
                consumeCharacter(quote);
                while(c = definition[pos], c && c !== quote) {
                    type.value += c;
                    pos++;
                }
                consumeCharacter(quote);
            }
            else if (definition[pos] >= '0' && definition[pos] <= '9') {
                // read numeric value
                type.typeOf = 'number';
                let nr = '';
                while(c = definition[pos], c === '.' || (c >= '0' && c <= '9')) {
                    nr += c;
                    pos++;
                }
                type.value = nr.includes('.') ? parseFloat(nr) : parseInt(nr);
            }
            else if (definition[pos] === '{') {
                // Read object (interface) definition 
                consumeCharacter('{');
                type.typeOf = 'object';
                type.instanceOf = Object;
                // Read children:
                type.children = [];
                while (true) {
                    const prop = readProperty();
                    const types = readTypes();
                    type.children.push({ name: prop.name, optional: prop.optional, wildcard: prop.wildcard, types });
                    consumeSpaces();
                    if (definition[pos] === '}') { break; }
                    consumeCharacter(',');
                }
                consumeCharacter('}');
            }
            else {
                throw new Error(`Expected a type definition at position ${pos}, found character '${definition[pos]}'`);
            }
        }
        else if (['string','number','boolean','undefined'].includes(name)) {
            type.typeOf = name;
        }
        else if (name === 'Object' || name === 'object') {
            type.typeOf = 'object';
            type.instanceOf = Object;
        }
        else if (name === 'Date') {
            type.typeOf = 'object';
            type.instanceOf = Date;
        }
        else if (name === 'Binary' || name === 'binary') {
            type.typeOf = 'object';
            type.instanceOf = ArrayBuffer;
        }
        else if (name === 'any') {
            type.typeOf = 'any';
        }
        else if (name === 'null') {
            // This is ignored, null values are not stored in the db (null indicates deletion)
            type.typeOf = 'object';
            type.value = null;
        }
        else if (name === 'Array') {
            // Read generic Array defintion
            consumeCharacter('<');
            type.typeOf = 'object';
            type.instanceOf = Array; //name;
            type.genericTypes = readTypes();
            consumeCharacter('>');
        }
        else if ([`'`,`"`,'`'].includes(name[0]) && name.slice(-1) === name[0]) {
            type.typeOf = 'string';
            type.value = name.slice(1, -1);
        }
        else if (['true','false'].includes(name)) {
            type.typeOf = 'boolean';
            type.value = name === 'true';
        }
        else {
            throw new Error(`Unknown type at position ${pos}: "${type}"`);
        }

        // Check if it's an Array of given type (eg: string[] or string[][])
        // Also converts to generics, string[] becomes Array<string>, string[][] becomes Array<Array<string>>
        consumeSpaces();
        while (definition[pos] === '[') { 
            consumeCharacter('[');
            consumeCharacter(']');
            type = { typeOf: 'object', instanceOf: Array, genericTypes: [type] };
        }
        return type; 
    }
    function readTypes() {
        consumeSpaces();
        const types = [readType()];
        while (definition[pos] === '|') {
            consumeCharacter('|');
            types.push(readType());
            consumeSpaces();
        }
        return types;
    }
    return readType();
}

function checkObject(path: string, properties: IProperty[], obj: Object, partial: boolean) {
    // Are there any properties that should not be in there?
    const invalidProperties = 
        properties.find(prop => prop.name === '*' || prop.name[0] === '$') // Only if no wildcard properties are allowed
        ? []
        : Object.keys(obj).filter(key =>
            [null,undefined].includes(obj[key]) // Ignore null or undefined values
            || !properties.find(prop => prop.name === key)
        );
    if (invalidProperties.length > 0) {
        return { ok: false, reason: `Object at path "${path}" cannot have properties ${invalidProperties.map(p => `"${p}"`).join(', ')}`}
    }
    // Loop through properties that should be present
    function checkProperty(property: IProperty) {
        const hasValue = ![null,undefined].includes(obj[property.name]);
        if (!property.optional && !hasValue && !partial) {
            return { ok: false, reason: `Property at path "${path}/${property.name}" is not optional` };
        }
        if (hasValue && property.types.length === 1) {
            return checkType(`${path}/${property.name}`, property.types[0], obj[property.name], false);
        }
        if (hasValue && !property.types.some(type => checkType(`${path}/${property.name}`, type, obj[property.name], false).ok)) {
            return { ok: false, reason: `Property at path "${path}/${property.name}" is of the wrong type` };
        }
        return { ok: true };
    }
    const namedProperties = properties.filter(prop => !prop.wildcard);
    const failedProperty = namedProperties.find(prop => !checkProperty(prop).ok);
    if (failedProperty) {
        const reason = checkProperty(failedProperty).reason;
        return { ok: false, reason };
    }
    const wildcardProperty = properties.find(prop => prop.wildcard);
    if (!wildcardProperty) {
        return { ok: true };
    }
    const wildcardChildKeys = Object.keys(obj).filter(key => !namedProperties.find(prop => prop.name === key));
    let result = { ok: true };
    for (let i = 0; i < wildcardChildKeys.length && result.ok; i++) {
        const childKey = wildcardChildKeys[i];
        result = checkProperty({ name: childKey, types: wildcardProperty.types, optional: true, wildcard: true });
    }
    return result;
}

export interface ISchemaCheckResult {
    ok: boolean,
    reason?: string
}
function checkType(path: string, type: IType, value: any, partial: boolean) : ISchemaCheckResult {
    if (value === null) {
        return { ok: true };
    }
    if (type.typeOf !== 'any' && typeof value !== type.typeOf) {
        return { ok: false, reason: `"${path}" must be typeof ${type.typeOf}` };
    }
    if (type.instanceOf === Object && (typeof value !== 'object' || value instanceof Array || value instanceof Date)) {
        return { ok: false, reason: `"${path}" must be an object collection` };
    }
    if (type.instanceOf && (typeof value !== 'object' || value.constructor !== type.instanceOf)) { // !(value instanceof type.instanceOf) // value.constructor.name !== type.instanceOf
        return { ok: false, reason: `"${path}" must be an instance of ${type.instanceOf.name}` };
    }
    if ('value' in type && value !== type.value) {
        return { ok: false, reason: `"${path}" must be value: ${type.value}` };
    }
    if (type.instanceOf === Array && type.genericTypes && !(value as Array<any>).every(v => type.genericTypes.some(t => checkType(path, t, v, false).ok ))) {
        return { ok: false, reason: `every array value of "${path}" must match one of the specified types` };
    }
    if (type.typeOf === 'object' && type.children) {
        return checkObject(path, type.children, value as Object, partial);
    }
    return { ok: true };
}

function getConstructorType(val: Function) {
    switch (val) {
        case String: return 'string';
        case Number: return 'number';
        case Boolean: return 'boolean';
        case Date: return 'Date';
        case Array: throw new Error(`Schema error: Array cannot be used without a type. Use string[] or Array<string> instead`);
        default: throw new Error(`Schema error: unknown type used: ${val.name}`);
    }
}

export class SchemaDefinition {
    readonly source: string|Object
    readonly text: string
    readonly type: IType
    constructor(definition: string|Object) {
        this.source = definition;
        if (typeof definition === 'object') {
            // Turn object into typescript definitions
            // eg:
            // const example = {
            //     name: String,
            //     born: Date,
            //     instrument: "'guitar'|'piano'",
            //     "address?": {
            //         street: String
            //     }
            // };
            // Resulting ts: "{name:string,born:Date,instrument:'guitar'|'piano',address?:{street:string}"
            const toTS = obj => {
                return '{' + Object.keys(obj)
                .map(key => {
                    let val = obj[key];
                    if (val === undefined) { val = 'undefined'; }
                    if (typeof val === 'object') { val = toTS(val); }
                    else if (typeof val === 'function') { val = getConstructorType(val); }
                    else if (typeof val !== 'string') { throw new Error(`Type definition for ${key} must be a string, object, or constructor function (String,Number,Boolean,Date)`); }
                    return `${key}:${val}`;
                })
                .join(',') + '}';
            }
            this.text = toTS(definition);
        }
        else if (typeof definition === 'string') {
            this.text = definition;
        }
        else {
            throw new Error(`Type definiton must be a string or an object`);
        }
        this.type = parse(this.text);
    }
    check(path: string, value: any, partial: boolean) {
        return checkType(path, this.type, value, partial);
    }
}