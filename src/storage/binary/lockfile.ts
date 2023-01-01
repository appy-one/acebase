/*
Code based upon `proper-lockfile` (https://github.com/moxystudio/node-proper-lockfile)

See license in filelock.LICENSE

Adjustments made by Ewout Stortenbeker <me@appy.one>

I chose not to install `proper-lockfile` as dependency because:
    - project appears not to be maintained (last commit Jan 2021), has old open issues
    - package has no types
    - code uses callbacks instead of promises
    - has dependencies AceBase does not need

Here's what I changed:
    - ported to TypeScript
    - refactored callbacks to async promises
    - removed `signal-exit` dependency (not needed)
    - removed `retry` dependency (using own simple implementation)
    - removed `graceful-fs` dependency (using own pfs)
    - removed unused code
*/

import { resolve as resolvePath } from 'path';
import { pfs } from '../../promise-fs';
import { retry, type RetryOptions } from '../../retry';

type StatResult = Awaited<ReturnType<typeof pfs['stat']>>;
type FileLockOptions = { lockfilePath?: string; stale: number; update: number; retries: number | Partial<RetryOptions>; realpath: boolean; onCompromised: (err: Error) => any; };
type FileLock = { updateDelay?: number; updateTimeout?: NodeJS.Timeout; lockfilePath: string; lastUpdate: number; mtime: Date; mtimePrecision: 's' | 'ms'; released: boolean; options: FileLockOptions };
const locks: Record<string, FileLock> = {};

function getLockFile(file: string, options: Pick<FileLockOptions, 'lockfilePath'>) {
    return options.lockfilePath || `${file}.lock`;
}

async function resolveCanonicalPath(file: string, options: Pick<FileLockOptions, 'realpath'>) {
    if (!options.realpath) {
        return resolvePath(file);
    }

    // Use realpath to resolve symlinks
    // It also resolves relative paths
    return new Promise<string>((resolve, reject) => {
        pfs.fs.realpath(file, (err, path) => {
            if (err) { reject(err); }
            else { resolve(path); }
        });
    });
}

async function acquireLock(file: string, options: FileLockOptions): ReturnType<typeof probe> {
    const lockfilePath = getLockFile(file, options);

    // Use mkdir to create the lockfile (atomic operation)
    try {
        await pfs.mkdir(lockfilePath);
    }
    catch (err) {
        // If error is not EEXIST then some other error occurred while locking
        if (err.code !== 'EEXIST') {
            throw err;
        }

        // Otherwise, check if lock is stale by analyzing the file mtime
        if (options.stale <= 0) {
            throw Object.assign(new Error(`File ${lockfilePath} is locked by another process`), { code: 'ELOCKED', file });
        }

        let stat: StatResult;
        try {
            stat = await pfs.stat(lockfilePath);
        }
        catch (err) {
            // Retry if the lockfile has been removed (meanwhile)
            // Skip stale check to avoid recursiveness
            if (err.code === 'ENOENT') {
                return acquireLock(file, { ...options, stale: 0 });
            }
            throw err;
        }

        // No error
        if (!isLockStale(stat, options)) {
            throw Object.assign(new Error('Lock file is already being held'), { code: 'ELOCKED', file });
        }

        // If it's stale, remove it and try again!
        // Skip stale check to avoid recursiveness
        await removeLock(file, options);
        return acquireLock(file, { ...options, stale: 0 });
    }

    // At this point, we acquired the lock!
    // Probe the mtime & precision
    try {
        const result = await probe(lockfilePath);
        return result;
    }
    catch (err) {
        // If it failed, try to remove the lock..
        try {
            await pfs.rmdir(lockfilePath);
        }
        finally {
            throw err;
        }
    }
}

function isLockStale(stat: StatResult, options: Pick<FileLockOptions, 'stale'>) {
    return stat.mtime.getTime() < Date.now() - options.stale;
}

async function removeLock(file: string, options: Pick<FileLockOptions, 'lockfilePath'>) {
    // Remove lockfile, ignoring ENOENT errors
    try {
        await pfs.rmdir(getLockFile(file, options));
    }
    catch (err) {
        if (err.code !== 'ENOENT') { throw err; }
    }
}

function updateLock(file: string, options: FileLockOptions) {
    const lock = locks[file];

    // Just for safety, should never happen
    if (lock.updateTimeout) {
        return;
    }

    lock.updateDelay = lock.updateDelay || options.update;
    lock.updateTimeout = setTimeout(async () => {
        lock.updateTimeout = null;

        // Stat the file to check if mtime is still ours
        // If it is, we can still recover from a system sleep or a busy event loop
        let stat: StatResult;
        try {
            stat = await pfs.stat(lock.lockfilePath);
        }
        catch (err) {
            // If it failed to update the lockfile, keep trying unless
            // the lockfile was deleted or we are over the threshold
            const isOverThreshold = lock.lastUpdate + options.stale < Date.now();
            if (err.code === 'ENOENT' || isOverThreshold) {
                return setLockAsCompromised(file, lock, Object.assign(err, { code: 'ECOMPROMISED' }));
            }

            lock.updateDelay = 1000;
            return updateLock(file, options);
        }

        const isMtimeOurs = lock.mtime.getTime() === stat.mtime.getTime();
        if (!isMtimeOurs) {
            return setLockAsCompromised(
                file,
                lock,
                Object.assign(
                    new Error('Unable to update lock within the stale threshold'),
                    { code: 'ECOMPROMISED' }
                ));
        }

        const mtime = getMtime(lock.mtimePrecision);

        let err: any;
        try {
            await pfs.utimes(lock.lockfilePath, mtime, mtime);
        }
        catch (error: any) {
            err = error;
        }

        // Ignore if the lock was released
        if (lock.released) {
            return;
        }

        // If it failed to update the lockfile, keep trying unless
        // the lockfile was deleted or we are over the threshold
        if (err) {
            const isOverThreshold = lock.lastUpdate + options.stale < Date.now();
            if (err.code === 'ENOENT' || isOverThreshold) {
                return setLockAsCompromised(file, lock, Object.assign(err, { code: 'ECOMPROMISED' }));
            }

            lock.updateDelay = 1000;
            return updateLock(file, options);
        }

        // All ok, keep updating..
        lock.mtime = mtime;
        lock.lastUpdate = Date.now();
        lock.updateDelay = null;
        updateLock(file, options);
    }, lock.updateDelay);

    // Unref the timer so that the nodejs process can exit freely
    // This is safe because all acquired locks will be automatically released
    // on process exit

    // We first check that `lock.updateTimeout.unref` exists because some users
    // may be using this module outside of NodeJS (e.g., in an electron app),
    // and in those cases `setTimeout` return an integer.
    /* istanbul ignore else */
    if (lock.updateTimeout.unref) {
        lock.updateTimeout.unref();
    }
}

function setLockAsCompromised(file: string, lock: FileLock, err: Error) {
    // Signal the lock has been released
    lock.released = true;

    // Cancel lock mtime update
    // Just for safety, at this point updateTimeout should be null
    /* istanbul ignore if */
    if (lock.updateTimeout) {
        clearTimeout(lock.updateTimeout);
    }

    if (locks[file] === lock) {
        delete locks[file];
    }

    lock.options.onCompromised(err);
}

let cachedPrecision: 's' | 'ms';

async function probe(file: string) {
    if (!cachedPrecision) {
        // Set mtime by ceiling Date.now() to seconds + 5ms so that it's "not on the second"
        const mtime = new Date((Math.ceil(Date.now() / 1000) * 1000) + 5);
        await pfs.utimes(file, mtime, mtime);
    }

    const stat = await pfs.stat(file);
    if (!cachedPrecision) {
        cachedPrecision = stat.mtime.getTime() % 1000 === 0 ? 's' : 'ms';
    }

    return { mtime: stat.mtime, precision: cachedPrecision };
}

function getMtime(precision: 's' | 'ms') {
    let now = Date.now();

    if (precision === 's') {
        now = Math.ceil(now / 1000) * 1000;
    }

    return new Date(now);
}

// ----------------------------------------------------------

export type ReleaseFunction = () => Promise<any>;
export async function lock(file: string, opts?: Partial<FileLockOptions>) {
    const options: FileLockOptions = {
        stale: 10000,
        update: null,
        realpath: true,
        retries: 0,
        onCompromised: (err: Error) => { throw err; },
        ...opts,
    };

    options.retries = options.retries ?? 0;
    options.retries = typeof options.retries === 'number' ? { retries: options.retries } : options.retries;
    options.stale = Math.max(options.stale || 0, 2000);
    options.update = options.update == null ? options.stale / 2 : options.update || 0;
    options.update = Math.max(Math.min(options.update, options.stale / 2), 1000);

    // Resolve to a canonical file path
    file = await resolveCanonicalPath(file, options);

    // Attempt to acquire the lock
    const operation = () => acquireLock(file, options);
    const result = await retry(operation, options.retries);
    const { mtime, precision } = result;

    // We now own the lock
    const lock = locks[file] = {
        released: false,
        lockfilePath: getLockFile(file, options),
        mtime,
        mtimePrecision: precision,
        options,
        lastUpdate: Date.now(),
    };

    // We must keep the lock fresh to avoid staleness
    updateLock(file, options);

    return async function release() {
        if (lock.released) {
            throw Object.assign(new Error('Lock is already released'), { code: 'ERELEASED' });
        }

        // Not necessary to use realpath twice when unlocking
        await unlock(file, { ...options, realpath: false });
    };
}

export async function unlock(file: string, opts?: Partial<FileLockOptions>) {
    const options = {
        realpath: true,
        ...opts,
    };

    // Resolve to a canonical file path
    file = await resolveCanonicalPath(file, options);

    // Skip if the lock is not acquired
    const lock = locks[file];

    if (!lock) {
        throw Object.assign(new Error('Lock is not acquired/owned by you'), { code: 'ENOTACQUIRED' });
    }

    lock.updateTimeout && clearTimeout(lock.updateTimeout); // Cancel lock mtime update
    lock.released = true; // Signal the lock has been released
    delete locks[file]; // Delete from locks

    await removeLock(file, options);
}

export async function check(file: string, opts: Partial<FileLockOptions>) {
    const options = {
        stale: 10000,
        realpath: true,
        ...opts,
    };

    options.stale = Math.max(options.stale || 0, 2000);

    // Resolve to a canonical file path
    file = await resolveCanonicalPath(file, options);

    // Check if lockfile exists
    let stat: StatResult;
    try {
        stat = await pfs.stat(getLockFile(file, options));
    }
    catch (err) {
        // If does not exist, file is not locked. Otherwise, throw error
        if (err.code === 'ENOENT') {
            return false;
        }
        throw err;
    }

    // Check if lock is stale by analyzing the file mtime
    return !isLockStale(stat, options);
}

export function getLocks() {
    return locks;
}

// // Remove acquired locks on exit
// /* istanbul ignore next */
// onExit(() => {
//     for (const file in locks) {
//         const options = locks[file].options;

//         try { pfs.rmdirSync(getLockFile(file, options)); } catch (e) { /* Empty */ }
//     }
// });
