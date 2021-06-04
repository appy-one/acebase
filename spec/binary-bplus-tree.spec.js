/// <reference types="@types/jasmine" />
const { BPlusTree, BinaryWriter, BinaryBPlusTree, BlacklistingSearchOperator } = require('../src/btree');
const { ID } = require('acebase-core');
// require('jasmine');

describe('Unique Binary B+Tree', () => {
    // Tests basic operations of the BinaryBPlusTree implementation
    const FILL_FACTOR = 95; // AceBase uses 95% fill factor for key indexes
    const AUTO_GROW = false; // autoGrow is not used by AceBase atm

    const createBinaryTree = async () => {
        const tree = new BPlusTree(100, true);

        const bytes = [];
        await tree.toBinary(true, BinaryWriter.forArray(bytes));
        const binaryTree = new BinaryBPlusTree(bytes);
        binaryTree.id = ID.generate(); // Assign an id to allow edits (is enforced by tree to make sure multiple concurrent edits to the same source are sync locked)
        binaryTree.autoGrow = AUTO_GROW;
        return binaryTree;
    };

    const rebuildTree = async (tree) => {
        const bytes = [];
        const id = tree.id;
        await tree.rebuild(BinaryWriter.forArray(bytes), { fillFactor: FILL_FACTOR, keepFreeSpace: true, increaseMaxEntries: true });
        tree = new BinaryBPlusTree(bytes);
        tree.id = id;
        tree.autoGrow = AUTO_GROW;
        return tree;
    }
    
    it('is an instance', async () => {
        const tree = await createBinaryTree();
        expect(tree).toBeInstanceOf(BinaryBPlusTree);
    });

    it('entries can added & found', async () => {
        const tree = await createBinaryTree();

        // Add 1 key
        const testRecordPointer = [1,2,3,4];
        await tree.add('key', testRecordPointer);

        // Lookup the entry & check its value
        const value = await tree.find('key');
        expect(value).not.toBeNull();
        for (let i = 0; i < testRecordPointer.length; i++) {
            expect(value.recordPointer[i]).toEqual(testRecordPointer[i]);
        }
    });

    describe('entries', () => {

        const TEST_KEYS = 1000; // This simulates the amount of children to be added to an AceBase node
        const keys = [];
        // Create random keys
        for (let i = 0; i < TEST_KEYS; i++) {
            keys.push(ID.generate());
        }

        /** @type {BinaryBPlusTree} */
        let tree;
        beforeAll(async () => {
            // Create tree
            tree = await createBinaryTree();

            let rebuilds = 0;

            // Add keys 1 by 1
            for (let i = 0; i < keys.length; i++) {
                const key = keys[i];
                const recordPointer = Array.from(key).map(ch => ch.charCodeAt(0)); // Fake (unique) recordpointer
                try {
                    await tree.add(key, recordPointer);
                }
                catch(err) {
                    // While the tree grows, this happens. Rebuild the tree and try again
                    rebuilds++;
                    tree = await rebuildTree(tree);
                    await tree.add(key, recordPointer); // Retry add
                }
            }

            console.log(`Created a tree with ${keys.length} entries, ${rebuilds} rebuilds were needed`);
        });

        // Lookup all added entries
        it('can be found', async () => {
            for (let i = 0; i < keys.length; i++) {
                const key = keys[i];
                const value = await tree.find(key);
                expect(value).not.toBeNull();
            }
        });

        // Iterate the leafs from start to end, confirm the right order
        it('can be iterated in ascending order', async () => {
            let leaf = await tree.getFirstLeaf();
            expect(leaf).not.toBeNull();
            let lastEntry, count = 0;
            while (leaf) {
                for (let i = 0; i < leaf.entries.length; i++) {
                    count++;
                    const entry = leaf.entries[i];
                    if (i > 0) { 
                        // key > last
                        expect(entry.key).toBeGreaterThan(lastEntry.key);
                    }
                    lastEntry = entry;
                }
                leaf = leaf.getNext ? await leaf.getNext() : null;
            }
            expect(count).toEqual(keys.length);
        });

        // Iterate the leafs from end to start
        it('can be iterated in descending order', async () => {
            let leaf = await tree.getLastLeaf();
            expect(leaf).not.toBeNull();
            let count = 0;
            while (leaf) {
                for (let i = leaf.entries.length - 1; i >= 0 ; i--) {
                    count++;
                    const entry = leaf.entries[i];
                    if (i < leaf.entries.length - 1) { 
                        // key < last
                        expect(entry.key).toBeLessThan(lastEntry.key);
                    }
                    lastEntry = entry;
                }
                leaf = leaf.getPrevious ? await leaf.getPrevious() : null;
            }
            expect(count).toEqual(keys.length);
        });

        describe('can be queried', () => {

            const options = { entries: true, keys: true, values: true, count: true };

            const checkResults = (result, expectedKeys, log) => {
                log && console.log(log);
                expect(result.keyCount).toEqual(expectedKeys.length);
                expect(result.valueCount).toEqual(expectedKeys.length); // unique tree, 1 value per key
                expect(result.entries.length).toEqual(expectedKeys.length);
                expect(result.keys.length).toEqual(expectedKeys.length);
                expect(result.values.length).toEqual(expectedKeys.length);
                const allFound = expectedKeys.every(key => result.keys.includes(key));
                expect(allFound).toBeTrue();
            };

            it('with "==" operator', async () => {
                // Find first entry
                let result = await tree.search('==', keys[0], options);
                checkResults(result, [keys[0]], `== "${keys[0]}": expecting 1 result`);

                // Find a random entry
                let randomKey = keys[Math.floor(Math.random() * keys.length)];
                result = await tree.search('==', randomKey, options);
                checkResults(result, [randomKey], `== "${randomKey}": expecting 1 result`);
            });

            it('with "!=" operator', async () => {
                // Find all except 1 random entry
                let excludeIndex = Math.floor(Math.random() * keys.length);
                let excludeKey = keys[excludeIndex];
                let expectedKeys = keys.slice(0, excludeIndex).concat(keys.slice(excludeIndex+1));
                result = await tree.search('!=', excludeKey, options);
                checkResults(result, expectedKeys, `!= "${excludeKey}": expecting ${expectedKeys.length} results`);
            });

            it('with "<" operator', async () => {
                // Find first 10 keys
                let expectedKeys = keys.slice(0, 11); // Take 11, use last as <
                let lessThanKey = expectedKeys.pop();
                let result = await tree.search('<', lessThanKey, options);
                checkResults(result, expectedKeys, `< "${lessThanKey}": expecting ${expectedKeys.length} results`);
            });

            it('with "<=" operator', async () => {
                // Find first 10 keys
                let expectedKeys = keys.slice(0, 10);
                let key = expectedKeys.slice(-1)[0]
                let result = await tree.search('<=', key, options);
                checkResults(result, expectedKeys, `<= "${key}": expecting ${expectedKeys.length} results`);
            });

            it('with ">" operator', async () => {
                // Find last 10 keys
                let expectedKeys = keys.slice(-11); // Take 11, use first as >
                let greaterThanKey = expectedKeys.shift();
                let result = await tree.search('>', greaterThanKey, options);
                checkResults(result, expectedKeys, `> "${greaterThanKey}": expecting ${expectedKeys.length} results`);
            });

            it('with ">=" operator', async () => {
                // Find last 10 keys
                let expectedKeys = keys.slice(-10);
                let result = await tree.search('>=', expectedKeys[0], options);
                checkResults(result, expectedKeys, `>= "${expectedKeys[0]}": expecting ${expectedKeys.length} results`);
            });

            it('with "like" operator', async () => {
                // All keys that start with the same 10 characters as the first key
                let str = keys[0].slice(0, 10); 
                let expectedKeys = keys.filter(key => key.startsWith(str));
                let result = await tree.search('like', `${str}*`, options);
                checkResults(result, expectedKeys, `like "${str}*": expecting ${expectedKeys.length} keys to start with "${str}"`);

                // All keys that end with the same 3 last characters of the first key
                str = keys[0].slice(-3);
                expectedKeys = keys.filter(key => key.endsWith(str));
                result = await tree.search('like', `*${str}`, options);
                checkResults(result, expectedKeys, `like "*${str}": expecting ${expectedKeys.length} keys to end with "${str}"`);

                // All keys that contain the last 2 characters of the first key
                str = keys[0].slice(-2);
                expectedKeys = keys.filter(key => key.includes(str));
                result = await tree.search('like', `*${str}*`, options);
                checkResults(result, expectedKeys, `like "*${str}*": expecting ${expectedKeys.length} keys to contain "${str}"`);
            });

            it('with "between" operator', async () => {
                // Find custom range of keys
                let [startIndex, endIndex] = [Math.floor(Math.random() * (keys.length-1)), Math.floor(Math.random() * (keys.length-1))].sort((a,b) => a < b ? -1 : 1);
                let expectedKeys = startIndex === endIndex ? [keys[startIndex]] : keys.slice(startIndex, endIndex);
                let firstKey = expectedKeys[0], lastKey = expectedKeys.slice(-1)[0];

                let result = await tree.search('between', [firstKey, lastKey], options);
                checkResults(result, expectedKeys, `between "${firstKey}" and "${lastKey}": expecting ${expectedKeys.length} results`);

                result = await tree.search('between', [lastKey, firstKey], options);
                checkResults(result, expectedKeys, `between "${lastKey}" and "${firstKey}" (reversed): expecting ${expectedKeys.length} results`);
            });

            it('with "!between" operator', async () => {
                // Find custom range of keys (before and after given indexes)
                let [startIndex, endIndex] = [Math.floor(Math.random() * (keys.length-1)), Math.floor(Math.random() * (keys.length-1))].sort((a,b) => a < b ? -1 : 1);                
                let expectedKeys = keys.slice(0, startIndex).concat(keys.slice(endIndex));  // eg: expect [1,2,7,8,9] for indexes 2 and 6 of keys [1,2,3,4,5,6,7,8,9]
                let firstKey = keys[startIndex], lastKey = keys[endIndex-1];                // eg: 3 and 5
                
                let result = await tree.search('!between', [firstKey, lastKey], options);
                checkResults(result, expectedKeys, `!between "${firstKey}" and "${lastKey}": expecting ${expectedKeys.length} results`);

                result = await tree.search('!between', [lastKey, firstKey], options);
                checkResults(result, expectedKeys, `!between "${lastKey}" and "${firstKey}" (reversed): expecting ${expectedKeys.length} results`);
            });

            it('with "in" operator', async () => {
                // Find 5 random keys
                let r = () => Math.floor(Math.random() * keys.length);
                let randomIndexes = [r(), r(), r(), r(), r()].reduce((indexes, index) => (!indexes.includes(index) ? indexes.push(index) : 1) && indexes, []);
                let expectedKeys = randomIndexes.map(index => keys[index]);
                let result = await tree.search('in', expectedKeys, options);
                checkResults(result, expectedKeys, `in [${expectedKeys.map(key => `"${key}"`).join(',')}]: expecting ${expectedKeys.length} results`);
            });

            it('with "!in" operator', async () => {
                // Find 5 random keys
                let r = () => Math.floor(Math.random() * keys.length);
                let randomIndexes = [r(), r(), r(), r(), r()].reduce((indexes, index) => (!indexes.includes(index) ? indexes.push(index) : 1) && indexes, []);
                let blacklistedKeys = randomIndexes.map(index => keys[index]);
                let expectedKeys = keys.reduce((allowed, key) => (!blacklistedKeys.includes(key) ? allowed.push(key) : 1) && allowed, []);
                let result = await tree.search('!in', blacklistedKeys, options);
                checkResults(result, expectedKeys, `!in [${blacklistedKeys.map(key => `"${key}"`).join(',')}]: expecting ${expectedKeys.length} results`);
            });

            it('with "exists" operator', async () => {
                // Finds all keys with a defined value, same as search("!=", undefined)
                // --> all keys in our test
                result = await tree.search('exists', undefined, options);
                checkResults(result, keys, `exists: expecting ${keys.length} (all) results`);
            });

            it('with "!exists" operator', async () => {
                // Finds results for key with undefined value, same as search("==", undefined)
                // --> no keys in our test
                result = await tree.search('!exists', undefined, options);
                checkResults(result, [], `!exists: expecting NO results`);
            });

            it('with BlacklistingSearchOperator', async () => {
                let keysToBlacklist = keys.filter(key => Math.random() > 0.25); // blacklist ~75%
                let expectedKeys = keys.filter(key => !keysToBlacklist.includes(key));

                let blacklisted = [];
                const op = new BlacklistingSearchOperator(entry => {
                    if (keysToBlacklist.includes(entry.key)) {
                        blacklisted.push(entry);
                        return entry.values; // Return all values (1) as array to be blacklisted
                    }
                });

                let result = await tree.search(op, undefined, options);
                checkResults(result, expectedKeys, `BlacklistingSearchOperator: expecting ${expectedKeys.length} results`);
                expect(blacklisted.length).toEqual(keysToBlacklist.length);

                // Run again, using the previous results as filter. This should yield the same results
                // No additional entries should have been blacklisted (blacklisted.length should remain the same!)
                let filteredOptions = { filter: result.entries };
                Object.assign(filteredOptions, options);
                result = await tree.search(op, undefined, filteredOptions);
                expect(blacklisted.length).toEqual(keysToBlacklist.length);
                checkResults(result, expectedKeys, `BlacklistingSearchOperator + filter: expecting ${expectedKeys.length} results`);

                // Run again, using blacklisted results as filter. This should yield no results
                filteredOptions.filter = blacklisted;
                result = await tree.search(op, undefined, filteredOptions);
                expect(blacklisted.length).toEqual(keysToBlacklist.length);
                checkResults(result, [], `BlacklistingSearchOperator + blacklist filter: expecting 0 results`);
            });

            it('with "matches" operator', async () => {
                let regex = /[a-z]{6}/;
                let expectedKeys = keys.filter(key => regex.test(key));
                let result = await tree.search('matches', regex, options);
                checkResults(result, expectedKeys, `matches /${regex.source}/${regex.flags}: expecting ${expectedKeys.length} results`);
            });

            it('with "!matches" operator', async () => {
                let regex = /[a-z]{6}/;
                let expectedKeys = keys.filter(key => !regex.test(key));
                let result = await tree.search('!matches', regex, options);
                checkResults(result, expectedKeys, `!matches /${regex.source}/${regex.flags}: expecting ${expectedKeys.length} results`);
            });

        });

        afterAll(async () => {
            // Remove all entries
            let rebuilds = 0;
            for (let i = 0; i < keys.length; i++) {
                const key = keys[i];
                try {
                    await tree.remove(key);
                }
                catch(err) {
                    rebuilds++;
                    tree = await rebuildTree(tree);
                    await tree.remove(key); // Try again
                }
            }
            
            console.log(`Removed ${keys.length} entries from tree, ${rebuilds} rebuilds were needed`);

            // Expect the tree to be empty now
            const leafStats = await tree.getFirstLeaf({ stats: true });
            expect(leafStats.entries.length).toEqual(0);
        })
    });

    it('returns null for keys not present', async () => {
        const tree = await createBinaryTree();
        const value = await tree.find('unknown');
        expect(value).toBeNull();
    });

    it('must not accept duplicate keys', async () => {
        const tree = await createBinaryTree();
        await tree.add('unique_key', [1]);
        await expectAsync(tree.add('unique_key', [2])).toBeRejected();
    });
});