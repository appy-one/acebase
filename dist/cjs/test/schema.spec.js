"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tempdb_1 = require("./tempdb");
const ok = { ok: true };
describe('schema', () => {
    let db;
    let removeDB;
    beforeAll(async () => {
        ({ db, removeDB } = await (0, tempdb_1.createTempDB)());
    });
    it('can be defined with strings and objects', async () => {
        // const { db, removeDB } = await createTempDB();
        // Try using string type definitions
        const clientSchema1 = {
            name: 'string',
            url: 'string',
            email: 'string',
            'contacts?': {
                '*': {
                    type: 'string',
                    name: 'string',
                    email: 'string',
                    telephone: 'string',
                },
            },
            'addresses?': {
                '*': {
                    type: '"postal"|"visit"',
                    street: 'string',
                    nr: 'number',
                    city: 'string',
                    'state?': 'string',
                    country: '"nl"|"be"|"de"|"fr"',
                },
            },
        };
        expect(() => db.schema.set('clients/*', clientSchema1)).not.toThrow();
        // Test if we can add client without contacts and addresses
        let result = await db.schema.check('clients/client1', { name: 'Ewout', url: '', email: '' }, false);
        expect(result).toEqual({ ok: true });
        // Test without email
        result = await db.schema.check('clients/client1', { name: 'Ewout', url: '' }, false);
        expect(result.ok).toBeFalse();
        // Test with wrong email data type
        result = await db.schema.check('clients/client1', { name: 'Ewout', url: '', email: 35 }, false);
        expect(result.ok).toBeFalse();
        // Test with invalid property
        result = await db.schema.check('clients/client1', { name: 'Ewout', url: '', email: '', wrong: 'not allowed' }, false);
        expect(result.ok).toBeFalse();
        // Test with wrong contact
        result = await db.schema.check('clients/client1', { name: 'Ewout', url: '', email: '', contacts: 'none' }, false);
        expect(result.ok).toBeFalse();
        // Test with empty contacts
        result = await db.schema.check('clients/client1', { name: 'Ewout', url: '', email: '', contacts: {} }, false);
        expect(result).toEqual({ ok: true });
        // Test with wrong contact item data type
        result = await db.schema.check('clients/client1', { name: 'Ewout', url: '', email: '', contacts: { contact1: 'wrong contact' } }, false);
        expect(result.ok).toBeFalse();
        // Test with ok contact item
        result = await db.schema.check('clients/client1', { name: 'Ewout', url: '', email: '', contacts: { contact1: { type: 'sales', name: 'John', email: '', telephone: '' } } }, false);
        expect(result).toEqual({ ok: true });
        // Test wrong contact item on target path
        result = await db.schema.check('clients/client1/contacts/contact1', 'wrong contact', false);
        expect(result.ok).toBeFalse();
        // Test with ok contact item on target path
        result = await db.schema.check('clients/client1/contacts/contact1', { type: 'sales', name: 'John', email: '', telephone: '' }, false);
        expect(result).toEqual({ ok: true });
        // Test updating a single property
        result = await db.schema.check('clients/client1', { name: 'John' }, true);
        expect(result).toEqual({ ok: true });
        // Test removing a mandatory property
        result = await db.schema.check('clients/client1', { name: null }, true);
        expect(result.ok).toBeFalse();
        // Test removing an optional property
        result = await db.schema.check('clients/client1', { addresses: null }, true);
        expect(result).toEqual({ ok: true });
        // Test removing an unknown property
        result = await db.schema.check('clients/client1', { unknown: null }, true);
        expect(result).toEqual({ ok: true });
        // Test updating a higher path that does not have a schema set (#217)
        result = await db.schema.check('', { test: 'Test' }, true);
        expect(result).toEqual({ ok: true });
        // Try using classnames & regular expressions
        const emailRegex = /[a-z.\-_]+@(?:[a-z\-_]+\.){1,}[a-z]{2,}$/i;
        const clientSchema2 = {
            name: String,
            url: /^https:\/\//,
            email: emailRegex,
            'contacts?': {
                '*': {
                    type: String,
                    name: String,
                    email: emailRegex,
                    telephone: /^\+[0-9\-]{10,}$/,
                },
            },
            'addresses?': {
                '*': {
                    type: '"postal"|"visit"',
                    street: String,
                    nr: Number,
                    city: String,
                    'state?': String,
                    country: /^[A-Z]{2}$/,
                },
            },
        };
        // Overwrite previous schema
        expect(() => db.schema.set('clients/*', clientSchema2)).not.toThrow();
        // Test valid input
        result = await db.schema.check('clients/client1', { name: 'My client', url: 'https://client.com', email: 'info@client.com' }, false);
        expect(result).toEqual({ ok: true });
        // Test with empty email
        result = await db.schema.check('clients/client1/email', '', false);
        expect(result.ok).toBeFalse();
        // Test with invalid email
        result = await db.schema.check('clients/client1/email', 'not valid @address.com', false);
        expect(result.ok).toBeFalse();
        // Test with valid email
        result = await db.schema.check('clients/client1/email', 'test@address.com', false);
        expect(result).toEqual({ ok: true });
        // Test valid address
        result = await db.schema.check('clients/client1/addresses/address1', { type: 'visit', street: 'Main', nr: 253, city: 'Capital', country: 'NL' }, false);
        expect(result).toEqual({ ok: true });
        // Test invalid address type
        result = await db.schema.check('clients/client1/addresses/address1', { type: 'invalid', street: 'Main', nr: 253, city: 'Capital', country: 'NL' }, false);
        expect(result.ok).toBeFalse();
        // Test invalid country (lowercase)
        result = await db.schema.check('clients/client1/addresses/address1', { type: 'postal', street: 'Main', nr: 253, city: 'Capital', country: 'nl' }, false);
        expect(result.ok).toBeFalse();
        // Test updating property to valid value
        result = await db.schema.check('clients/client1/addresses/address1', { country: 'NL' }, true);
        expect(result).toEqual({ ok: true });
        // Test updating property to invalid value
        result = await db.schema.check('clients/client1/addresses/address1', { country: 'nl' }, true);
        expect(result.ok).toBeFalse();
        // Test updating target to valid value
        result = await db.schema.check('clients/client1/addresses/address1/country', 'NL', true);
        expect(result).toEqual({ ok: true });
        // Test updating target to invalid value
        result = await db.schema.check('clients/client1/addresses/address1/country', 'nl', true);
        expect(result.ok).toBeFalse();
        // Create new schema to test static values
        const staticValuesSchema = {
            'bool?': true,
            'int?': 35,
            'float?': 101.101,
        };
        expect(() => db.schema.set('static', staticValuesSchema)).not.toThrow();
        // Test valid boolean value:
        result = await db.schema.check('static', { bool: true }, false);
        expect(result).toEqual({ ok: true });
        // Test invalid boolean value:
        result = await db.schema.check('static', { bool: false }, false);
        expect(result.ok).toBeFalse();
        // Test valid int value:
        result = await db.schema.check('static', { int: 35 }, false);
        expect(result).toEqual({ ok: true });
        // Test invalid int value:
        result = await db.schema.check('static', { int: 2323 }, false);
        expect(result.ok).toBeFalse();
        // Test valid float value:
        result = await db.schema.check('static', { float: 101.101 }, false);
        expect(result).toEqual({ ok: true });
        // Test invalid float value:
        result = await db.schema.check('static', { float: 897.452 }, false);
        expect(result.ok).toBeFalse();
    });
    it('type Object must allow any property', async () => {
        const schema = 'Object';
        expect(() => db.schema.set('generic-object', schema)).not.toThrow();
        let result = await db.schema.check('generic-object', { custom: 'allowed' }, false);
        expect(result).toEqual(ok);
        result = await db.schema.check('generic-object/custom', 'allowed', false);
        expect(result).toEqual(ok);
        result = await db.schema.check('generic-object', 'NOT allowed', false);
        expect(result.ok).toBeFalse();
    });
    // it('array of objects #127', async() => {
    //     // Created for #127 (https://github.com/appy-one/acebase/discussions/127)
    //     await db.schema.set('chats/$chatid',{
    //         id: 'string',
    //         messages:'{ message: string }[]'
    //     });
    //     const proxy = await db.ref('chats/chat1').proxy({ defaultValue: { id: 'chat1', messages: [] } });
    //     let promise = new Promise((resolve, reject) => {
    //         proxy.on('mutation', event => {
    //             resolve(event);
    //         });
    //         proxy.on('error', error => {
    //             reject(error);
    //         });
    //     });
    //     const chat = proxy.value;
    //     chat.messages.push({
    //         message: 'hello'
    //     });
    //     await expectAsync(promise).not.toBeRejected();
    // }, 120e3);
    afterAll(async () => {
        await removeDB();
    });
});
//# sourceMappingURL=schema.spec.js.map