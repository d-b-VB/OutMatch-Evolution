export const DATABASE_NAME = "outmatch-reach";
export const DATABASE_VERSION = 2;
export const STORE_NAMES = Object.freeze({
  runs: "runs",
  generations: "generations",
  ledgers: "ledgers",
  progress: "run_progress",
  settings: "settings",
  replays: "replays",
  combatCache: "combat_cache"
});

export const PERSISTENCE_SCHEMAS = Object.freeze({
  run: "outmatch-run-v1",
  generation: "outmatch-generation-record-v1",
  ledger: "outmatch-ledger-record-v1",
  progress: "outmatch-run-progress-v1",
  settings: "outmatch-settings-v1",
  replay: "outmatch-replay-v1",
  combatCache: "outmatch-combat-cache-v1"
});

export const PROGRESS_PHASES = Object.freeze([
  "initialized",
  "breeding_migration",
  "stage1_running",
  "stage1_ranking",
  "stage2_running",
  "stage2_ranking",
  "challenger_running",
  "finalizing"
]);

function requiredString(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string`);
}

function requiredIsoDate(value, label) {
  requiredString(value, label);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be an ISO date string`);
  }
}

/** Reject values that cannot be durably represented as ordinary structured data. */
export function assertDurableData(value, path = "record") {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${path} contains a non-finite number`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertDurableData(item, `${path}[${index}]`));
    return;
  }
  if (typeof value !== "object" || value instanceof Date || value instanceof Map || value instanceof Set
    || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`${path} contains unsupported durable data`);
  }
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) throw new Error(`${path}.${key} is undefined`);
    assertDurableData(item, `${path}.${key}`);
  }
}

function validateCommonIdentity(record, expectedSchema, label) {
  if (record?.schema !== expectedSchema) throw new Error(`${label} has an unsupported schema`);
  requiredString(record.runId, `${label}.runId`);
  assertDurableData(record, label);
}

export function validateRunRecord(record) {
  validateCommonIdentity(record, PERSISTENCE_SCHEMAS.run, "Run record");
  requiredString(record.title, "Run record.title");
  requiredIsoDate(record.createdAt, "Run record.createdAt");
  requiredString(record.activeGeneration, "Run record.activeGeneration");
  if (record.originatingGeneration !== null) requiredString(record.originatingGeneration, "Run record.originatingGeneration");
  return record;
}

/** Validate the compact immutable record for one completed generation. */
export function validateCompletedGenerationRecord(record) {
  validateCommonIdentity(record, PERSISTENCE_SCHEMAS.generation, "Generation record");
  requiredString(record.generation, "Generation record.generation");
  requiredString(record.parentGeneration, "Generation record.parentGeneration", { nullable: true });
  requiredIsoDate(record.completedAt, "Generation record.completedAt");
  requiredString(record.fingerprint, "Generation record.fingerprint");
  requiredString(record.ledgerRef, "Generation record.ledgerRef");
  if (!Array.isArray(record.checkpoint?.population) || !Array.isArray(record.rankings)
    || !Array.isArray(record.interventions)
    || [record.manifest, record.controls, record.migration, record.breeding, record.reports]
      .some(value => value === null || typeof value !== "object" || Array.isArray(value))) {
    throw new Error("Generation record is missing required completed-generation data");
  }
  return record;
}

function gameKey(row) {
  return `${row.stage}\0${row.challengerIteration ?? ""}\0${row.scheduleIndex}`;
}

function validateGameRows(rows, label) {
  if (!Array.isArray(rows)) throw new Error(`${label} rows must be an array`);
  const keys = new Set();
  for (const [index, row] of rows.entries()) {
    if (!Number.isSafeInteger(row.scheduleIndex) || row.scheduleIndex < 0) throw new Error(`${label} row ${index} has invalid schedule index`);
    requiredString(row.stage, `${label} row ${index}.stage`);
    requiredString(row.redId, `${label} row ${index}.redId`);
    requiredString(row.blueId, `${label} row ${index}.blueId`);
    if (row.redId === row.blueId) throw new Error(`${label} row ${index} is a self-game`);
    const key = gameKey(row);
    if (keys.has(key)) throw new Error(`${label} contains duplicate scheduled game ${key}`);
    keys.add(key);
  }
}

export function validateLedgerRecord(record) {
  validateCommonIdentity(record, PERSISTENCE_SCHEMAS.ledger, "Ledger record");
  requiredString(record.generation, "Ledger record.generation");
  requiredString(record.ledgerId, "Ledger record.ledgerId");
  validateGameRows(record.rows, "Ledger");
  return record;
}

const RESUMABLE_ARRAY_FIELDS = ["completedLedger", "tentativeElites", "challengerHistory"];

/** Require the durable fields needed to resume without rescanning large schedules. */
export function validateResumableStateFields(record) {
  for (const field of RESUMABLE_ARRAY_FIELDS) {
    if (!Object.hasOwn(record ?? {}, field)) {
      throw new Error(`Progress record is missing resumable tournament state field: ${field}`);
    }
    if (!Array.isArray(record[field])) {
      throw new Error(`Progress record resumable tournament state field ${field} must be an array`);
    }
  }
  if (!Object.hasOwn(record ?? {}, "childCandidate")) {
    throw new Error("Progress record is missing resumable tournament state field: childCandidate");
  }
  if (record.childCandidate !== null && typeof record.childCandidate !== "object") {
    throw new Error("Progress record resumable tournament state field childCandidate must be an object or null");
  }
  return record;
}

/** Validate resumable state without performing any database I/O. */
export function validateRunProgressRecord(record) {
  validateCommonIdentity(record, PERSISTENCE_SCHEMAS.progress, "Progress record");
  requiredString(record.parentGeneration, "Progress record.parentGeneration");
  requiredString(record.parentFingerprint, "Progress record.parentFingerprint");
  requiredString(record.targetGeneration, "Progress record.targetGeneration");
  requiredString(record.controlsHash, "Progress record.controlsHash");
  requiredString(record.interventionsHash, "Progress record.interventionsHash");
  requiredString(record.breedingSeed, "Progress record.breedingSeed");
  requiredString(record.breedingPrngVersion, "Progress record.breedingPrngVersion");
  requiredIsoDate(record.updatedAt, "Progress record.updatedAt");
  if (!PROGRESS_PHASES.includes(record.phase)) throw new Error(`Progress record has unknown phase ${record.phase}`);
  validateGameRows(record.schedule, "Progress schedule");
  validateGameRows(record.partialLedger, "Progress ledger");
  validateResumableStateFields(record);
  validateGameRows(record.completedLedger, "Completed progress ledger");
  if (!Number.isSafeInteger(record.cursor) || record.cursor < 0 || record.cursor > record.schedule.length) {
    throw new Error("Progress cursor is outside its schedule");
  }
  return record;
}

/** Validate only one append-only running checkpoint against a previously full-validated record. */
export function validateIncrementalRunProgressRecord(record, previous) {
  validateResumableStateFields(record);
  validateResumableStateFields(previous);
  for (const key of ["schema", "runId", "parentGeneration", "parentFingerprint", "targetGeneration",
    "controlsHash", "interventionsHash", "breedingSeed", "breedingPrngVersion", "phase"]) {
    if (record?.[key] !== previous?.[key]) throw new Error(`Incremental checkpoint changed ${key}`);
  }
  if (!record || record.schema !== PERSISTENCE_SCHEMAS.progress || !PROGRESS_PHASES.includes(record.phase)) {
    throw new Error("Incremental checkpoint has invalid identity or phase");
  }
  requiredIsoDate(record.updatedAt, "Progress record.updatedAt");
  if (record.schedule?.length !== previous.schedule?.length || record.cursor < previous.cursor
    || record.cursor > record.schedule.length || record.partialLedger?.length !== record.cursor) {
    throw new Error("Incremental checkpoint is not an append-only schedule prefix");
  }
  const appended = record.partialLedger.slice(previous.cursor);
  validateGameRows(appended, "Incremental progress ledger");
  for (let index = 0; index < appended.length; index += 1) {
    const scheduled = previous.schedule[previous.cursor + index];
    const result = appended[index];
    if (scheduled.stage !== result.stage || scheduled.scheduleIndex !== result.scheduleIndex
      || scheduled.redId !== result.redId || scheduled.blueId !== result.blueId
      || (scheduled.challengerIteration ?? null) !== (result.challengerIteration ?? null)) {
      throw new Error("Incremental checkpoint result does not match its schedule");
    }
  }
  return record;
}

/** Validate only one append-only running checkpoint against a previously full-validated record. */
export function validateIncrementalRunProgressRecord(record, previous) {
  for (const key of ["schema", "runId", "parentGeneration", "parentFingerprint", "targetGeneration",
    "controlsHash", "interventionsHash", "breedingSeed", "breedingPrngVersion", "phase"]) {
    if (record?.[key] !== previous?.[key]) throw new Error(`Incremental checkpoint changed ${key}`);
  }
  if (!record || record.schema !== PERSISTENCE_SCHEMAS.progress || !PROGRESS_PHASES.includes(record.phase)) {
    throw new Error("Incremental checkpoint has invalid identity or phase");
  }
  requiredIsoDate(record.updatedAt, "Progress record.updatedAt");
  if (record.schedule?.length !== previous.schedule?.length || record.cursor < previous.cursor
    || record.cursor > record.schedule.length || record.partialLedger?.length !== record.cursor) {
    throw new Error("Incremental checkpoint is not an append-only schedule prefix");
  }
  const appended = record.partialLedger.slice(previous.cursor);
  validateGameRows(appended, "Incremental progress ledger");
  for (let index = 0; index < appended.length; index += 1) {
    const scheduled = previous.schedule[previous.cursor + index];
    const result = appended[index];
    if (scheduled.stage !== result.stage || scheduled.scheduleIndex !== result.scheduleIndex
      || scheduled.redId !== result.redId || scheduled.blueId !== result.blueId
      || (scheduled.challengerIteration ?? null) !== (result.challengerIteration ?? null)) {
      throw new Error("Incremental checkpoint result does not match its schedule");
    }
  }
  return record;
}

export function validateSettingsRecord(record) {
  if (record?.schema !== PERSISTENCE_SCHEMAS.settings) throw new Error("Settings record has an unsupported schema");
  requiredString(record.settingsId, "Settings record.settingsId");
  requiredString(record.selectedRunId, "Settings record.selectedRunId", { nullable: true });
  requiredString(record.selectedGeneration, "Settings record.selectedGeneration", { nullable: true });
  if (!Number.isSafeInteger(record.workerCount) || record.workerCount < 1) throw new Error("Settings worker count must be positive");
  assertDurableData(record, "Settings record");
  return record;
}

export function validateReplayRecord(record) {
  validateCommonIdentity(record, PERSISTENCE_SCHEMAS.replay, "Replay record");
  requiredString(record.replayId, "Replay record.replayId");
  requiredString(record.generation, "Replay record.generation");
  requiredIsoDate(record.createdAt, "Replay record.createdAt");
  if (!record.game || typeof record.game !== "object" || Array.isArray(record.game)) {
    throw new Error("Replay record.game must be an object");
  }
  return record;
}

export function validateCombatCacheRecord(record) {
  if (record?.schema !== PERSISTENCE_SCHEMAS.combatCache || typeof record.cacheKey !== "string" || !record.cacheKey) {
    throw new Error("Combat cache record has an unsupported identity");
  }
  const row = record.combat;
  for (const field of ["outcome", "winner", "round", "redScore", "blueScore", "engineRulesVersion",
    "redP", "redA", "redC", "redPokes", "redKillByP", "redKillByA", "redKillByC",
    "redVictimP", "redVictimA", "redVictimC", "blueP", "blueA", "blueC", "bluePokes",
    "blueKillByP", "blueKillByA", "blueKillByC", "blueVictimP", "blueVictimA", "blueVictimC"]) {
    if (row?.[field] === undefined) throw new Error(`Combat cache record is missing ${field}`);
  }
  assertDurableData(record, "Combat cache record");
  return record;
}
