import { AsyncTaskBatch } from './async-task-batch';

describe('Async task batches', () => {
    it('works', async () => {
        let currentIndex = 0;
        const expectedResults = [] as number[];
        const batch = new AsyncTaskBatch(10);
        for (let i = 0; i < 1000; i++) {
            batch.add(() => {
                const ms = Math.floor(Math.random() * 10); // task to run between 0-10ms
                expectedResults[currentIndex] = ms;
                currentIndex++;
                return new Promise((resolve) => setTimeout(() => resolve(ms), ms));
            });
        }
        const results = await batch.finish();
        expect(results).toEqual(expectedResults);
    }, 10e3);
});
