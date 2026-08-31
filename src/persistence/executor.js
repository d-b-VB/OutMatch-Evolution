import { assertSafeCheckpointBoundary } from "./resume.js";

function sameGame(schedule, result) {
  return schedule.stage === result?.stage
    && (schedule.challengerIteration ?? null) === (result.challengerIteration ?? null)
    && schedule.scheduleIndex === result.scheduleIndex
    && schedule.redId === result.redId
    && schedule.blueId === result.blueId;
}

function validateOptions({ executeGame, executeBatch, saveCheckpoint, checkpointInterval, shouldPause, now }) {
  if (typeof executeGame !== "function") throw new Error("Resumable executor requires an executeGame function");
  if (executeBatch !== undefined && typeof executeBatch !== "function") throw new Error("Batch executor must be a function");
  if (typeof saveCheckpoint !== "function") throw new Error("Resumable executor requires a saveCheckpoint function");
  if (!Number.isSafeInteger(checkpointInterval) || checkpointInterval < 1) {
    throw new Error("Checkpoint interval must be a positive integer");
  }
  if (typeof shouldPause !== "function" || typeof now !== "function") {
    throw new Error("Pause and clock hooks must be functions");
  }
}

const TRANSIENT_PERSISTENCE_ERRORS = new Set(["AbortError", "TransactionInactiveError", "UnknownError"]);

export class ResumableExecutionError extends Error {
  constructor(kind, message, safeCursor, cause) {
    super(message, { cause });
    this.name = "ResumableExecutionError";
    this.kind = kind;
    this.safeCursor = safeCursor;
  }
}

function isTransientPersistenceError(error) {
  return TRANSIENT_PERSISTENCE_ERRORS.has(error?.name);
}

/** Execute only unfinished games and durably checkpoint at safe boundaries. */
export async function executeResumableSchedule({
  checkpoint,
  executeGame,
  executeBatch,
  saveCheckpoint,
  checkpointInterval = 1,
  checkpointRetries = 2,
  shouldPause = () => false,
  now = () => new Date().toISOString()
}) {
  validateOptions({ executeGame, executeBatch, saveCheckpoint, checkpointInterval, shouldPause, now });
  if (!Number.isSafeInteger(checkpointRetries) || checkpointRetries < 0) {
    throw new Error("Checkpoint retries must be a non-negative integer");
  }
  assertSafeCheckpointBoundary(checkpoint);
  const state = { ...checkpoint, schedule: checkpoint.schedule,
    partialLedger: checkpoint.partialLedger.slice(), completedLedger: checkpoint.completedLedger };
  let completedSinceSave = 0;
  let safeCursor = state.cursor;

  const persist = async () => {
    state.updatedAt = now();
    assertSafeCheckpointBoundary(state);
    let attempt = 0;
    while (true) {
      try {
        await saveCheckpoint({ ...state, partialLedger: state.partialLedger.slice() });
        safeCursor = state.cursor;
        break;
      } catch (error) {
        if (!isTransientPersistenceError(error) || attempt >= checkpointRetries) {
          throw new ResumableExecutionError(
            "checkpoint", `Failed to persist checkpoint at cursor ${state.cursor}`, safeCursor, error
          );
        }
        attempt += 1;
      }
    }
    completedSinceSave = 0;
  };

  if (shouldPause()) {
    await persist();
    return { status: "paused", checkpoint: state };
  }

  while (state.cursor < state.schedule.length) {
    const scheduledGames = executeBatch
      ? state.schedule.slice(state.cursor, state.cursor + checkpointInterval)
      : [state.schedule[state.cursor]];
    let results;
    try {
      results = executeBatch
        ? await executeBatch(structuredClone(scheduledGames))
        : [await executeGame(structuredClone(scheduledGames[0]))];
    } catch (error) {
      throw new ResumableExecutionError(
        "execution", `Game execution failed at cursor ${state.cursor}`, safeCursor, error
      );
    }
    if (!Array.isArray(results) || results.length !== scheduledGames.length) {
      throw new ResumableExecutionError("execution", `Game batch failed at cursor ${state.cursor}`,
        safeCursor, new Error("Batch result count does not match schedule"));
    }
    for (let index = 0; index < scheduledGames.length; index += 1) {
      if (!sameGame(scheduledGames[index], results[index])) {
        throw new ResumableExecutionError(
          "execution", `Game result does not match schedule entry at cursor ${state.cursor + index}`,
          safeCursor, new Error("Mismatched game result")
        );
      }
    }
    state.partialLedger.push(...structuredClone(results));
    state.cursor += results.length;
    completedSinceSave += results.length;

    const pauseRequested = shouldPause();
    if (pauseRequested || completedSinceSave >= checkpointInterval || state.cursor === state.schedule.length) {
      await persist();
    }
    if (pauseRequested) return { status: "paused", checkpoint: state };
  }
  return { status: "complete", checkpoint: state };
}
