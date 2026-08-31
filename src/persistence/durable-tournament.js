import { executeResumableSchedule } from "./executor.js";
import { assertSafeCheckpointBoundary, restoreProgressCheckpoint } from "./resume.js";
import { finalizeCompletedGeneration } from "./repositories.js";
import { validateCompletedGenerationRecord, validateLedgerRecord } from "./schema.js";

function validateHooks(hooks) {
  for (const name of [
    "executeGame", "saveCheckpoint", "rankStage1", "buildStage2Schedule", "rankStage2",
    "planChallengerIteration"
  ]) {
    if (typeof hooks[name] !== "function") throw new Error(`Durable tournament requires ${name}`);
  }
}

async function saveTransition(checkpoint, saveCheckpoint, now) {
  checkpoint.updatedAt = now();
  assertSafeCheckpointBoundary(checkpoint);
  await saveCheckpoint(structuredClone(checkpoint));
}

/**
 * Coordinate resumable tournament stages through stable challenger cleanup.
 */
export async function runDurableTournamentStages({
  checkpoint,
  expected,
  executeGame,
  executeBatch,
  saveCheckpoint,
  rankStage1,
  buildStage2Schedule,
  rankStage2,
  planChallengerIteration,
  maxChallengerIterations = 20,
  shouldPause = () => false,
  checkpointInterval = 1,
  checkpointRetries = 2,
  now = () => new Date().toISOString()
}) {
  const hooks = {
    executeGame, saveCheckpoint, rankStage1, buildStage2Schedule, rankStage2, planChallengerIteration
  };
  validateHooks(hooks);
  if (!Number.isSafeInteger(maxChallengerIterations) || maxChallengerIterations < 1) {
    throw new Error("Durable tournament requires a positive challenger iteration limit");
  }
  const restored = restoreProgressCheckpoint(checkpoint, expected);
  let state = structuredClone({ ...checkpoint, ...restored });
  state.completedLedger ??= [];

  if (state.phase === "stage1_running") {
    const execution = await executeResumableSchedule({
      checkpoint: state, executeGame, executeBatch, saveCheckpoint, shouldPause,
      checkpointInterval, checkpointRetries, now
    });
    state = execution.checkpoint;
    if (execution.status === "paused") return { status: "paused", checkpoint: state };
    state.phase = "stage1_ranking";
    await saveTransition(state, saveCheckpoint, now);
  }

  if (state.phase === "stage1_ranking") {
    const tentativeElites = await rankStage1(structuredClone(state.partialLedger));
    const stage2Schedule = await buildStage2Schedule(structuredClone(tentativeElites));
    state.completedLedger = [...state.completedLedger, ...state.partialLedger];
    state.tentativeElites = structuredClone(tentativeElites);
    state.phase = "stage2_running";
    state.schedule = structuredClone(stage2Schedule);
    state.partialLedger = [];
    state.cursor = 0;
    await saveTransition(state, saveCheckpoint, now);
  }

  if (state.phase === "stage2_running") {
    const execution = await executeResumableSchedule({
      checkpoint: state, executeGame, executeBatch, saveCheckpoint, shouldPause,
      checkpointInterval, checkpointRetries, now
    });
    state = execution.checkpoint;
    if (execution.status === "paused") return { status: "paused", checkpoint: state };
    state.phase = "stage2_ranking";
    await saveTransition(state, saveCheckpoint, now);
  }

  if (state.phase === "stage2_ranking") {
    const completeLedger = [...state.completedLedger, ...state.partialLedger];
    const rankings = await rankStage2(structuredClone(completeLedger));
    state.completedLedger = completeLedger;
    state.phase = "challenger_running";
    state.schedule = [];
    state.partialLedger = [];
    state.cursor = 0;
    await saveTransition(state, saveCheckpoint, now);
  }

  if (state.phase === "challenger_running") {
    let rankings;
    while (true) {
      if (state.schedule.length > 0) {
        const execution = await executeResumableSchedule({
          checkpoint: state, executeGame, executeBatch, saveCheckpoint, shouldPause,
          checkpointInterval, checkpointRetries, now
        });
        state = execution.checkpoint;
        if (execution.status === "paused") return { status: "paused", checkpoint: state };
        state.completedLedger.push(...state.partialLedger);
        const activeHistory = state.challengerHistory.at(-1);
        if (!activeHistory || activeHistory.completed) {
          throw new Error("Challenger schedule is missing its active history entry");
        }
        activeHistory.completed = true;
        activeHistory.resultCount = state.partialLedger.length;
        state.schedule = [];
        state.partialLedger = [];
        state.cursor = 0;
        await saveTransition(state, saveCheckpoint, now);
      }

      const iteration = state.challengerHistory.length + 1;
      if (iteration > maxChallengerIterations) {
        throw new Error(`Challenger cleanup exceeded ${maxChallengerIterations} iterations`);
      }
      const plan = await planChallengerIteration(structuredClone(state.completedLedger), iteration);
      if (!Array.isArray(plan?.challengers) || !Array.isArray(plan?.schedule)) {
        throw new Error(`Invalid challenger plan for iteration ${iteration}`);
      }
      rankings = plan.rankings;
      if (plan.challengers.length === 0) {
        if (plan.schedule.length !== 0) throw new Error("Stable challenger plan cannot contain games");
        state.phase = "finalizing";
        await saveTransition(state, saveCheckpoint, now);
        return { status: "ready_to_finalize", checkpoint: state, rankings };
      }
      if (plan.schedule.length === 0) {
        throw new Error(`Challenger cleanup made no progress in iteration ${iteration}`);
      }
      state.schedule = structuredClone(plan.schedule);
      state.challengerHistory.push({
        iteration,
        challengers: structuredClone(plan.challengers),
        schedule: structuredClone(plan.schedule),
        completed: false
      });
      await saveTransition(state, saveCheckpoint, now);
    }
  }
  throw new Error(`Unsupported durable tournament phase ${state.phase}`);
}

function sameLedgerRows(expected, actual) {
  if (!Array.isArray(actual) || expected.length !== actual.length) return false;
  return expected.every((row, index) => {
    const candidate = actual[index];
    return row.stage === candidate?.stage
      && (row.challengerIteration ?? null) === (candidate.challengerIteration ?? null)
      && row.scheduleIndex === candidate.scheduleIndex
      && row.redId === candidate.redId
      && row.blueId === candidate.blueId;
  });
}

/** Build final artifacts from a stable checkpoint and commit them atomically. */
export async function finalizeDurableTournament({
  database,
  checkpoint,
  expected,
  rankFinal,
  buildReports,
  buildLedgerRecord,
  buildGenerationRecord,
  commitCompletedGeneration = finalizeCompletedGeneration
}) {
  for (const [name, hook] of Object.entries({
    rankFinal, buildReports, buildLedgerRecord, buildGenerationRecord, commitCompletedGeneration
  })) {
    if (typeof hook !== "function") throw new Error(`Durable finalization requires ${name}`);
  }
  const restored = restoreProgressCheckpoint(checkpoint, expected);
  if (restored.phase !== "finalizing") throw new Error("Durable tournament is not ready to finalize");
  const ledger = structuredClone(restored.completedLedger);
  const rankings = await rankFinal(structuredClone(ledger));
  const reports = await buildReports({ ledger: structuredClone(ledger), rankings: structuredClone(rankings) });
  const ledgerRecord = await buildLedgerRecord({ checkpoint: structuredClone(checkpoint), ledger: structuredClone(ledger) });
  validateLedgerRecord(ledgerRecord);
  if (!sameLedgerRows(ledger, ledgerRecord.rows)) {
    throw new Error("Final ledger record does not preserve the completed tournament ledger");
  }
  const generationRecord = await buildGenerationRecord({
    checkpoint: structuredClone(checkpoint),
    rankings: structuredClone(rankings),
    reports: structuredClone(reports),
    ledgerRecord: structuredClone(ledgerRecord)
  });
  validateCompletedGenerationRecord(generationRecord);
  const committed = await commitCompletedGeneration(database, generationRecord, ledgerRecord);
  return { status: "complete", generation: generationRecord, ledger: ledgerRecord, rankings, reports, committed };
}
