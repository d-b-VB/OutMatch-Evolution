import { PERSISTENCE_SCHEMAS, validateRunProgressRecord } from "./schema.js";

const PRE_CHALLENGER_PHASES = new Set([
  "initialized", "breeding_migration", "stage1_running", "stage1_ranking", "stage2_running", "stage2_ranking"
]);

function recoverCompletedChallengerHistory(completedLedger) {
  const byIteration = new Map();
  for (const row of completedLedger) {
    if (row.challengerIteration == null) continue;
    if (!Number.isSafeInteger(row.challengerIteration) || row.challengerIteration < 1) {
      throw new Error("Cannot recover progress: completed ledger has an invalid challenger iteration");
    }
    if (!byIteration.has(row.challengerIteration)) byIteration.set(row.challengerIteration, []);
    byIteration.get(row.challengerIteration).push(structuredClone(row));
  }
  const iterations = [...byIteration.keys()].sort((left, right) => left - right);
  if (iterations.some((iteration, index) => iteration !== index + 1)) {
    throw new Error("Cannot recover progress: completed challenger iterations are not contiguous");
  }
  return iterations.map(iteration => ({
    iteration, challengers: [], schedule: byIteration.get(iteration),
    completed: true, resultCount: byIteration.get(iteration).length, recovered: true
  }));
}

/** Upgrade older stored checkpoints without inventing deterministic child or active challenger state. */
export function normalizePersistedProgressRecord(record) {
  if (record === undefined) return undefined;
  const normalized = structuredClone(record);
  normalized.completedLedger ??= [];
  normalized.tentativeElites ??= [];
  if (normalized.challengerHistory === undefined) {
    if (PRE_CHALLENGER_PHASES.has(normalized.phase)) normalized.challengerHistory = [];
    else if (["challenger_running", "finalizing"].includes(normalized.phase)) {
      if (normalized.schedule?.length > 0) {
        throw new Error("Cannot recover progress: challengerHistory is missing for an active challenger schedule; discard only the incomplete progress and restart from its completed parent");
      }
      normalized.challengerHistory = recoverCompletedChallengerHistory(normalized.completedLedger);
    }
  }
  return normalized;
}

function sameScheduledGame(left, right) {
  return left.stage === right.stage
    && (left.challengerIteration ?? null) === (right.challengerIteration ?? null)
    && left.scheduleIndex === right.scheduleIndex
    && left.redId === right.redId
    && left.blueId === right.blueId;
}

/** Require a checkpoint taken between games rather than during an operation. */
export function assertSafeCheckpointBoundary(record) {
  validateRunProgressRecord(record);
  if (record.partialLedger.length !== record.cursor) {
    throw new Error("Progress checkpoint must contain one ledger row per completed schedule entry");
  }
  for (let index = 0; index < record.cursor; index += 1) {
    if (!sameScheduledGame(record.schedule[index], record.partialLedger[index])) {
      throw new Error(`Progress checkpoint ledger diverges from its schedule at index ${index}`);
    }
  }
  if (["initialized", "breeding_migration"].includes(record.phase)
    && (record.schedule.length !== 0 || record.cursor !== 0)) {
    throw new Error(`${record.phase} checkpoints cannot contain tournament work`);
  }
  if (["stage1_ranking", "stage2_ranking", "finalizing"].includes(record.phase)
    && record.cursor !== record.schedule.length) {
    throw new Error(`${record.phase} checkpoints require a completed schedule`);
  }
  return record;
}

/** Build an independent durable record from a live between-games state. */
export function buildProgressCheckpoint({
  runId,
  parentGeneration,
  parentFingerprint,
  targetGeneration,
  controlsHash,
  interventionsHash,
  breedingSeed,
  breedingPrngVersion,
  phase,
  schedule = [],
  partialLedger = [],
  completedLedger = [],
  cursor = partialLedger.length,
  tentativeElites = [],
  challengerHistory = [],
  childCandidate = null,
  updatedAt = new Date().toISOString()
}) {
  const record = {
    schema: PERSISTENCE_SCHEMAS.progress,
    runId,
    parentGeneration,
    parentFingerprint,
    targetGeneration,
    controlsHash,
    interventionsHash,
    breedingSeed,
    breedingPrngVersion,
    updatedAt,
    phase,
    schedule: structuredClone(schedule),
    partialLedger: structuredClone(partialLedger),
    completedLedger: structuredClone(completedLedger),
    cursor,
    tentativeElites: structuredClone(tentativeElites),
    challengerHistory: structuredClone(challengerHistory),
    childCandidate: structuredClone(childCandidate)
  };
  return assertSafeCheckpointBoundary(record);
}

/** Reject resume attempts whose deterministic inputs differ from the checkpoint. */
export function verifyResumeCompatibility(record, expected) {
  assertSafeCheckpointBoundary(record);
  const fields = [
    "runId", "parentGeneration", "parentFingerprint", "targetGeneration",
    "controlsHash", "interventionsHash", "breedingSeed", "breedingPrngVersion"
  ];
  for (const field of fields) {
    if (record[field] !== expected?.[field]) {
      throw new Error(`Cannot resume: ${field} does not match the persisted checkpoint`);
    }
  }
  return record;
}

/** Restore mutable tournament inputs without exposing the stored record itself. */
export function restoreProgressCheckpoint(record, expected) {
  verifyResumeCompatibility(record, expected);
  return structuredClone({
    phase: record.phase,
    schedule: record.schedule,
    partialLedger: record.partialLedger,
    completedLedger: record.completedLedger ?? [],
    cursor: record.cursor,
    tentativeElites: record.tentativeElites,
    challengerHistory: record.challengerHistory,
    childCandidate: record.childCandidate
  });
}
