import { assert } from '../assert.js';
import { DetailedError } from '../detailed-error.js';
export class TxDetailedError extends DetailedError {
    constructor(code, msg, originalError) {
        super(code, msg, originalError);
        this.transactionErrors = null;
        this.rollbackErrors = null;
    }
}
export class TX {
    constructor() {
        this._queue = [];
        this._rollbackSteps = [];
    }
    // TODO: refactor to async
    run(action, rollback) {
        assert(this._queue.length === 0, 'queue must be empty');
        typeof rollback === 'function' && this._rollbackSteps.push(rollback);
        const p = action instanceof Promise ? action : action();
        return p.catch((err) => {
            console.error(`TX.run error: ${err.message}. Initiating rollback`);
            // rollback
            const steps = this._rollbackSteps.map(step => step());
            return Promise.all(steps)
                .then(() => {
                // rollback successful
                throw err; // run().catch will fire with the original error
            })
                .catch(err2 => {
                // rollback failed!!
                console.error(`Critical: could not rollback changes. Error: ${err2.message}`);
                err.rollbackError = err2;
                throw err;
            });
        });
    }
    /**
     * For parallel transactions
     */
    queue(step) {
        this._queue.push({
            name: step.name || `Step ${this._queue.length + 1}`,
            action: step.action,
            rollback: step.rollback,
            state: 'idle',
            error: null,
        });
    }
    async execute(parallel = true) {
        if (!parallel) {
            // Sequentially run actions in queue
            const rollbackSteps = [];
            let result;
            while (this._queue.length > 0) {
                const step = this._queue.shift();
                rollbackSteps.push(step.rollback);
                try {
                    const prevResult = result;
                    result = await step.action(prevResult);
                }
                catch (err) {
                    // rollback
                    const actions = rollbackSteps.map(step => step());
                    await Promise.all(actions)
                        .catch(err2 => {
                        // rollback failed!!
                        console.error(`Critical: could not rollback changes. Error: ${err2.message}`);
                        err.rollbackError = err2;
                        throw err;
                    });
                    // rollback successful
                    throw err; // execute().catch will fire with the original error
                }
            }
            return result;
        }
        // Run actions in parallel:
        const executeStepAction = async (step, action) => {
            try {
                const promise = step[action]();
                if (!(promise instanceof Promise)) {
                    throw new DetailedError('invalid-tx-step-code', `step "${step.name}" action "${action}" must return a promise`);
                }
                const result = await promise;
                step.state = 'success';
                step.result = result;
            }
            catch (err) {
                step.state = 'failed';
                step.error = err;
            }
            return step;
        };
        const actions = this._queue.map(step => executeStepAction(step, 'action'));
        let results = await Promise.all(actions);
        // Check if they were all successful
        let success = results.every(step => step.state === 'success');
        if (success) {
            return;
        }
        // Rollback
        const transactionErrors = results.filter(step => step.state === 'failed').map(result => result.error);
        // console.warn(`Rolling back tx: `, transactionErrors);
        const rollbackSteps = this._queue.filter(step => typeof step.rollback === 'function').map(step => executeStepAction(step, 'rollback')); // this._queue.map(step => step.state === 'failed' || typeof step.rollback !== 'function' ? null : step.rollback());
        results = await Promise.all(rollbackSteps);
        // Check if rollback was successful
        success = results.every(step => step.state === 'success');
        if (success) {
            const err = new TxDetailedError('tx-failed', 'Tx failed, rolled back. See .info for details');
            err.transactionErrors = transactionErrors;
            throw err;
        }
        // rollback failed!!
        const err = new TxDetailedError('tx-rollback-failed', 'Critical: could not rollback failed transaction. See transactionErrors and rollbackErrors for details');
        err.transactionErrors = transactionErrors;
        err.rollbackErrors = results.filter(step => step.state === 'failed').map(result => result.error);
        console.error('Critical: could not rollback transaction. Errors:', err.rollbackErrors);
        throw err;
    }
}
//# sourceMappingURL=tx.js.map