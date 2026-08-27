import { PERSISTENCE_SCHEMAS, validateRunProgressRecord } from "./schema.js";

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
    cursor: record.cursor,
    tentativeElites: record.tentativeElites,
    challengerHistory: record.challengerHistory,
    childCandidate: record.childCandidate
  });
}
