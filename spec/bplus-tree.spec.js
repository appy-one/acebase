/// <reference types="@types/jasmine" />
const { BPlusTree } = require('../src/btree');
const { ID } = require('acebase-core');
// require('jasmine');

describe('Unique B+Tree', () => {
    // Tests basic operations of the (append only) BPlusTree implementation

    it('is an instance', () => {
        const tree = new BPlusTree(10, true);
        expect(tree).toBeInstanceOf(BPlusTree);
    });

    it('entries can added & found', () => {
        const tree = new BPlusTree(10, true);

        // Add 1 key
        const testRecordPointer = [1,2,3,4];
        tree.add('key', testRecordPointer);

        // Lookup the entry & check its value
        const value = tree.find('key');
        expect(value).not.toBeNull();
        for (let i = 0; i < testRecordPointer.length; i++) {
            expect(value.recordPointer[i]).toEqual(testRecordPointer[i]);
        }
    });

    describe('entries', () => {
        const tree = new BPlusTree(10, true);

        // Add 10000 random keys
        const keys = [];
        for (let i = 0; i < 10000; i++) {
            const key = ID.generate();
            keys.push(key);
            tree.add(key, [1]);
        }

        // Lookup all added entries
        it('can be found', () => {
            keys.forEach(key => {
                const value = tree.find(key);
                expect(value).not.toBeNull();
            });
        });

        // Iterate the leafs from start to end, confirm the right order
        it('can be iterated in ascending order', () => {
            let leaf = tree.firstLeaf();
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
                leaf = leaf.nextLeaf;
            }
            expect(count).toEqual(keys.length);
        });

        // Iterate the leafs from end to start
        it('can be iterated in descending order', () => {
            let leaf = tree.lastLeaf();
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
                leaf = leaf.prevLeaf;
            }
            expect(count).toEqual(keys.length);
        });
    });

    it('returns null for keys not present', () => {
        const tree = new BPlusTree(10, true);
        const value = tree.find('unknown');
        expect(value).toBeNull();
    })

    it('must not accept duplicate keys', () => {
        const tree = new BPlusTree(10, true);
        tree.add('unique_key', [1]);
        expect(() => tree.add('unique_key', [2])).toThrow();
    });
});