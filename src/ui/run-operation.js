import { ResumableExecutionError } from "../persistence/executor.js";

export const RUN_OPERATION_STATES = Object.freeze([
  "idle", "running", "pause_requested", "paused", "finalizing", "failed"
]);

export function createRunOperation(overrides = {}) {
  const operation = {
    status: "idle",
    errorKind: null,
    errorMessage: null,
    safeCursor: null,
    stopRequested: false,
    ...overrides
  };
  if (!RUN_OPERATION_STATES.includes(operation.status)) {
    throw new Error(`Unknown run operation state: ${operation.status}`);
  }
  return operation;
}

/** Derive every button state from durable progress and the active operation. */
export function runControlState({ run, generation, reviewed, progress, operation = createRunOperation() }) {
  const active = ["running", "pause_requested", "finalizing"].includes(operation.status);
  const paused = operation.status === "paused" || (progress != null && !active);
  const canStart = Boolean(run && generation && reviewed && !progress && !active);
  return {
    runNextDisabled: !canStart,
    runManyDisabled: !canStart,
    pauseDisabled: operation.status !== "running",
    resumeDisabled: !paused,
    stopDisabled: !active || operation.stopRequested,
    countDisabled: !canStart,
    active,
    paused
  };
}

function classifyFailure(error) {
  if (error instanceof ResumableExecutionError) {
    return {
      errorKind: error.kind === "checkpoint" ? "persistence" : "execution",
      safeCursor: error.safeCursor
    };
  }
  return { errorKind: "application", safeCursor: null };
}

/**
 * Keep async operation state outside DOM handlers. Progress callbacks receive
 * only service results which have already crossed a durable checkpoint.
 */
export class RunOperationController {
  constructor({ service, onChange = () => {}, onDurableProgress = () => {} }) {
    if (!service || typeof service.start !== "function" || typeof service.resume !== "function") {
      throw new Error("Run operation controller requires a browser run service");
    }
    this.service = service;
    this.onChange = onChange;
    this.onDurableProgress = onDurableProgress;
    this.operation = createRunOperation();
  }

  #set(values) {
    this.operation = createRunOperation({ ...this.operation, ...values });
    this.onChange(structuredClone(this.operation));
  }

  requestPause() {
    if (this.operation.status !== "running") return false;
    this.service.requestPause();
    this.#set({ status: "pause_requested" });
    return true;
  }

  stopAfterGeneration() {
    if (!["running", "pause_requested", "finalizing"].includes(this.operation.status)) return false;
    this.service.stopAfterGeneration();
    this.#set({ stopRequested: true });
    return true;
  }

  async start(input) { return this.#run(() => this.service.start(input)); }

  async resume(input) { return this.#run(() => this.service.resume(input)); }

  async #run(invoke) {
    this.#set({ status: "running", errorKind: null, errorMessage: null, safeCursor: null });
    try {
      const result = await invoke();
      if (result.checkpoint) this.onDurableProgress(structuredClone(result.checkpoint));
      if (result.status === "paused") {
        this.#set({ status: "paused", safeCursor: result.checkpoint.cursor });
      } else {
        this.#set({ status: "idle", stopRequested: false });
      }
      return result;
    } catch (error) {
      const failure = classifyFailure(error);
      this.#set({ status: "failed", errorMessage: error?.message ?? String(error), ...failure });
      throw error;
    }
  }
}
