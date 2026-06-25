/// <reference types="jasmine" />
/**
 * Long-running stability test for transaction logging.
 *
 * Continuously writes records and polls getMutations (which triggers background
 * cleanup of expired entries). With maxAge=0.1 day (144 min), cleanup kicks in
 * after ~2.4 hours. Observing no errors and stable latency over a full run
 * confirms the cleanup mechanism works and performance doesn't degrade.
 *
 * Also periodically re-reads a sample of previously written records to confirm
 * they are still actually present in the data file (and tracks the data file
 * and transaction log file sizes over time), to catch any divergence between
 * what's logged and what's actually persisted.
 *
 * Duration:       TEST_DURATION_HOURS  (default 24)
 * Write interval: TEST_WRITE_INTERVAL_MS (default 100 ms → ~10 writes/s)
 *
 * Run: npx jasmine --filter="Transaction logging - stress"
 */
import * as fs from 'fs';
import { AceBase, AceBaseLocalSettings } from '..';
import type { AceBaseStorage } from '../storage/binary/index.js';
import { createTempDB } from './tempdb.js';

const DURATION_HOURS    = parseFloat(process.env.TEST_DURATION_HOURS    ?? '24');
const WRITE_INTERVAL_MS = parseInt(process.env.TEST_WRITE_INTERVAL_MS   ?? '100');  // ~10 writes/s
const STATS_INTERVAL_MS = 5 * 60 * 1000;   // log progress every 5 minutes
const POLL_INTERVAL_MS  = 5 * 60 * 1000;   // call getMutations every 5 minutes
const VERIFY_INTERVAL_MS = 5 * 60 * 1000;  // re-check previously written records every 5 minutes
const CHECKPOINT_STRIDE  = 50;             // remember every 50th write as a checkpoint to verify later

(process.env.RUN_STRESS_TESTS ? describe : xdescribe)('Transaction logging - stress', () => {
    let db: AceBase, removeDB: () => Promise<void>;

    beforeAll(async () => {
        ({ db, removeDB } = await createTempDB({ config(options: AceBaseLocalSettings) {
            options.logLevel = 'warn';
            options.storage!.transactions = { log: true, maxAge: 0.1 }; // 0.1 day = 144 min
        }}));
    });

    afterAll(async () => {
        await removeDB();
    });

    it(`logs ~10 writes/s for ${DURATION_HOURS}h with maxAge=0.1 day — verifying cleanup and stability`, async () => {
        const storage   = db.api.storage as AceBaseStorage;
        const startTime = Date.now();
        const endTime   = startTime + DURATION_HOURS * 3_600_000;

        // --- counters -------------------------------------------------------
        let totalWrites          = 0;
        let writeErrors          = 0;
        let statPeriodWrites     = 0;
        let statPeriodStart      = startTime;

        let totalPolls           = 0;
        let pollErrors           = 0;
        let lastPollLatencyMs    = 0;
        let lastPollNewMutations = 0;

        let totalVerifyRuns      = 0;
        let dataMissingErrors    = 0;
        let dataMismatchErrors   = 0;

        // sample of previously written records, kept around to confirm they're still
        // retrievable later (writeLoop only stores every CHECKPOINT_STRIDE-th write)
        const checkpoints: { key: string; ts: number; v: number }[] = [];

        let running = true;
        const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

        // Sleeps in 1s ticks so it exits within 1s after running=false.
        const sleepI = async (ms: number) => {
            const end = Date.now() + ms;
            while (running && Date.now() < end) {
                await sleep(Math.min(1000, end - Date.now()));
            }
        };

        // --- write loop: sequential writes at WRITE_INTERVAL_MS each --------
        const writeLoop = (async () => {
            while (running) {
                try {
                    const ts = Date.now();
                    const v  = Math.random();
                    const ref = await db.ref('stress/items').push({ ts, v });
                    totalWrites++;
                    statPeriodWrites++;
                    if (totalWrites % CHECKPOINT_STRIDE === 0) {
                        checkpoints.push({ key: ref.key as string, ts, v });
                    }
                }
                catch (err: any) {
                    writeErrors++;
                    console.error(`[tx-stress] write error: ${err?.message}`);
                }
                await sleepI(WRITE_INTERVAL_MS);
            }
        })();

        // --- getMutations polling loop: advances cursor and triggers cleanup -
        let lastCursor = '00000000';
        const pollLoop = (async () => {
            await sleepI(POLL_INTERVAL_MS); // wait a full period before first poll
            while (running) {
                try {
                    const t0 = Date.now();
                    const result = await storage.getMutations({ cursor: lastCursor });
                    lastPollLatencyMs    = Date.now() - t0;
                    lastPollNewMutations = result.mutations.length;
                    lastCursor           = result.new_cursor;
                    totalPolls++;
                }
                catch (err: any) {
                    pollErrors++;
                    console.error(`[tx-stress] getMutations error: ${err?.message}`);
                }
                await sleepI(POLL_INTERVAL_MS);
            }
        })();

        // --- verify loop: re-reads previously written checkpoints to confirm ---
        // they're still actually present in the data file, not just in the tx log.
        const verifyLoop = (async () => {
            await sleepI(VERIFY_INTERVAL_MS); // wait a full period before first verification
            while (running) {
                try {
                    for (const checkpoint of checkpoints) {
                        const data = await db.ref(`stress/items/${checkpoint.key}`).get();
                        if (!data.exists()) {
                            dataMissingErrors++;
                            console.error(`[tx-stress] data verify error: stress/items/${checkpoint.key} is missing (written at ts=${checkpoint.ts})`);
                            continue;
                        }
                        const value = data.val() as { ts: number; v: number };
                        if (value?.ts !== checkpoint.ts || value?.v !== checkpoint.v) {
                            dataMismatchErrors++;
                            console.error(`[tx-stress] data verify error: stress/items/${checkpoint.key} value mismatch (expected ts=${checkpoint.ts} v=${checkpoint.v}, got ts=${value?.ts} v=${value?.v})`);
                        }
                    }
                    totalVerifyRuns++;
                }
                catch (err: any) {
                    console.error(`[tx-stress] data verify run error: ${err?.message}`);
                }
                await sleepI(VERIFY_INTERVAL_MS);
            }
        })();

        // --- stats loop: print a summary line every STATS_INTERVAL_MS -------
        const statsLoop = (async () => {
            await sleepI(STATS_INTERVAL_MS);
            while (running) {
                const now          = Date.now();
                const elapsedH     = (now - startTime) / 3_600_000;
                const periodSec    = (now - statPeriodStart) / 1000;
                const writesPerSec = statPeriodWrites / periodSec;

                let dataSizeMB = NaN, txLogSizeMB = NaN;
                try {
                    dataSizeMB = (await fs.promises.stat(storage.fileName)).size / (1024 * 1024);
                    const txStorage = (storage as any).txStorage;
                    if (txStorage) {
                        txLogSizeMB = (await fs.promises.stat(txStorage.fileName)).size / (1024 * 1024);
                    }
                }
                catch (err: any) {
                    console.error(`[tx-stress] file size check error: ${err?.message}`);
                }

                console.log(
                    `[tx-stress ${elapsedH.toFixed(2)}h]`,
                    `writes=${totalWrites} (+${statPeriodWrites} @ ${writesPerSec.toFixed(1)}/s)`,
                    `writeErrors=${writeErrors}`,
                    `polls=${totalPolls} lastLatency=${lastPollLatencyMs}ms newMutations=${lastPollNewMutations}`,
                    `pollErrors=${pollErrors}`,
                    `verifyRuns=${totalVerifyRuns} checkpoints=${checkpoints.length} dataMissing=${dataMissingErrors} dataMismatch=${dataMismatchErrors}`,
                    `dataFile=${dataSizeMB.toFixed(2)}MB txLogFile=${txLogSizeMB.toFixed(2)}MB`,
                );

                statPeriodWrites = 0;
                statPeriodStart  = now;

                await sleepI(STATS_INTERVAL_MS);
            }
        })();

        // --- wait until the configured end time -----------------------------
        while (Date.now() < endTime) {
            await sleep(Math.min(10_000, endTime - Date.now()));
        }
        running = false;
        await Promise.all([writeLoop, pollLoop, verifyLoop, statsLoop]);

        const elapsedH = (Date.now() - startTime) / 3_600_000;
        console.log(`\n[tx-stress] completed after ${elapsedH.toFixed(2)}h`);
        console.log(`  Total writes:       ${totalWrites}`);
        console.log(`  Write errors:       ${writeErrors}`);
        console.log(`  getMutations polls: ${totalPolls}`);
        console.log(`  Poll errors:        ${pollErrors}`);
        console.log(`  Data verify runs:   ${totalVerifyRuns} (${checkpoints.length} checkpoints each)`);
        console.log(`  Data missing:       ${dataMissingErrors}`);
        console.log(`  Data mismatched:    ${dataMismatchErrors}`);

        expect(writeErrors).toBe(0);
        expect(pollErrors).toBe(0);
        expect(dataMissingErrors).toBe(0);
        expect(dataMismatchErrors).toBe(0);
    }, (DURATION_HOURS * 3600 + 120) * 1000); // jasmine timeout = duration + 2 min buffer
});
