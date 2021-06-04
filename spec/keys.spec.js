/// <reference types="@types/jasmine" />
const { createTempDB } = require("./tempdb");

describe('Keys', () => {
    let db, removeDB;
    beforeAll(async () => {
        const tmp = await createTempDB();
        db = tmp.db;
        removeDB = tmp.removeDB;
    });
    
    it('should allow unicode characters', async () => {

        // Create unicode keys
        const unicodeKeys = {
            "AceBaseはクールです": "AceBase is cool (in Japanese)",
            "I💗AceBase": "I (heart) AceBase"
        };
        let p = db.ref("unicode").set(unicodeKeys);
        await expectAsync(p).toBeResolved();

        // Load Unicode keys
        let snap = await db.ref("unicode").get();
        expect(snap.val()).toEqual(unicodeKeys);

        // Load a single unicode key
        snap = await db.ref("unicode/I💗AceBase").get();
        expect(snap.val()).toEqual(unicodeKeys["I💗AceBase"]);

    });

    it('should not allow special characters \\ / [ ] ', async () => {

        let p = db.ref("invalid").set({ "forward/slash": "Forward slashes are used to access nested objects" });
        await expectAsync(p).toBeRejected();

        p = db.ref("invalid").set({ "back\\slash": "Using backslashes would be confusing because of the special meaning of the forward slash" });
        await expectAsync(p).toBeRejected();

        p = db.ref("invalid").set({ "[brackets]": "Brackets are used to access array indexes" });
        await expectAsync(p).toBeRejected();

    });

    it('should not allow keys larger than 128 bytes', async () => {

        let max = '';
        for (let i = 0; i < 128; i++) {
            max += i % 10;       
        }
        let tooLong = max + 'x';

        let p = db.ref("key_length").set({ [max]: "This is the maximum length for a key" });
        await expectAsync(p).toBeResolved();

        p = db.ref("key_length").set({ [tooLong]: "This key is too long to store" });
        await expectAsync(p).toBeRejected();

    });

    describe('control character', () => {
        for (let cc = 0; cc < 32; cc++) {
            const prop = `control${String.fromCharCode(cc)}`;
            let allow = [9,10,13].includes(cc); // allow tab (9, \t), line feed (10, \n), carriage return (13, \r)
            
            it(`${cc} must ${!allow && 'NOT'} be allowed`, async () => {
                let p = db.ref("control").set({ [prop]: "Using control characters would be weird" });
                if (allow) {
                    await expectAsync(p).toBeResolved();
                }
                else {
                    await expectAsync(p).toBeRejected();
                }
            });
        }
    })

    it('should allow .', async () => {

        p = db.ref("dots").set({ "dot.dot": "Using dots would be confusing, but should be allowed" });
        await expectAsync(p).toBeResolved();

    });

    it('should allow whitespaces', async () => {

        p = db.ref("whitespace").set({ "Something with spaces": "Spaces in keys could cause confusion, but should be allowed" });
        await expectAsync(p).toBeResolved();

        p = db.ref("whitespace").set({ "Something\twith\ttabs": "Tabs in keys would be weird, but should be allowed" });
        await expectAsync(p).toBeResolved();

        p = db.ref("whitespace").set({ "Something\nwith\nnewline\nchars": "New lines in keys would be weird, but should be allowed" });
        await expectAsync(p).toBeResolved();
    });

    it('should be case insensitive', async () => {

        const lowercase = { key: 'caseinsensitive', value: 'the key has lowercase chars' };
        const camelcase = { key: 'caseInsensitive', value: 'the key has camelCase chars' };
        const pascalcase = { key: 'CaseInsensitive', value: 'the key has PascalCase chars' };
        const uppercase = { key: 'CASEINSENSITIVE', value: 'the key has UPPERCASE chars' };

        await db.ref(lowercase.key).set(lowercase.value);
        await db.ref(camelcase.key).set(camelcase.value);
        await db.ref(pascalcase.key).set(pascalcase.value);
        await db.ref(uppercase.key).set(uppercase.value);

        let snap = await db.ref(lowercase.key).get();
        expect(snap.val()).toEqual(lowercase.value);

        snap = await db.ref(camelcase.key).get();
        expect(snap.val()).toEqual(camelcase.value);
        
        snap = await db.ref(pascalcase.key).get();
        expect(snap.val()).toEqual(pascalcase.value);

        snap = await db.ref(uppercase.key).get();
        expect(snap.val()).toEqual(uppercase.value);

    })

    afterAll(async () => {
        await removeDB();
    })
});