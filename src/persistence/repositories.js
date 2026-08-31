import { transactionDone, requestResult } from "./database.js";
import {
  STORE_NAMES,
  validateCompletedGenerationRecord,
  validateLedgerRecord,
  validateRunRecord,
  validateRunProgressRecord,
  validateIncrementalRunProgressRecord,
  validateReplayRecord,
  validateSettingsRecord
} from "./schema.js";

function requireId(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string`);
  return value;
}

/**
 * Run an operation inside one transaction and resolve only after it commits.
 * Starting the completion listener before issuing requests avoids missing a
 * fast transaction's complete event.
 */
export async function withTransaction(database, storeNames, mode, operation) {
  if (typeof operation !== "function") throw new Error("Transaction operation must be a function");
  const transaction = database.transaction(storeNames, mode);
  const committed = transactionDone(transaction);
  try {
    const result = await operation(transaction);
    await committed;
    return result;
  } catch (error) {
    if (typeof transaction.abort === "function") {
      try { transaction.abort(); } catch { /* The transaction may already be inactive. */ }
    }
    await committed.catch(() => {});
    throw error;
  }
}

export class RunRepository {
  constructor(database) {
    this.database = database;
  }

  async save(record) {
    validateRunRecord(record);
    return withTransaction(this.database, STORE_NAMES.runs, "readwrite", async transaction => {
      await requestResult(transaction.objectStore(STORE_NAMES.runs).put(record));
      return record;
    });
  }

  async get(runId) {
    requireId(runId, "Run ID");
    return withTransaction(this.database, STORE_NAMES.runs, "readonly", transaction =>
      requestResult(transaction.objectStore(STORE_NAMES.runs).get(runId)));
  }

  async list() {
    const records = await withTransaction(this.database, STORE_NAMES.runs, "readonly", transaction =>
      requestResult(transaction.objectStore(STORE_NAMES.runs).getAll()));
    records.forEach(validateRunRecord);
    return records.sort((left, right) => right.createdAt.localeCompare(left.createdAt)
      || left.runId.localeCompare(right.runId));
  }

  async delete(runId) {
    requireId(runId, "Run ID");
    return withTransaction(this.database, STORE_NAMES.runs, "readwrite", async transaction => {
      await requestResult(transaction.objectStore(STORE_NAMES.runs).delete(runId));
    });
  }
}

export class SettingsRepository {
  constructor(database, settingsId = "application") {
    this.database = database;
    this.settingsId = requireId(settingsId, "Settings ID");
  }

  async get() {
    const record = await withTransaction(this.database, STORE_NAMES.settings, "readonly", transaction =>
      requestResult(transaction.objectStore(STORE_NAMES.settings).get(this.settingsId)));
    if (record !== undefined) validateSettingsRecord(record);
    return record;
  }

  async save(record) {
    validateSettingsRecord(record);
    if (record.settingsId !== this.settingsId) throw new Error(`Settings record must use ID ${this.settingsId}`);
    return withTransaction(this.database, STORE_NAMES.settings, "readwrite", async transaction => {
      await requestResult(transaction.objectStore(STORE_NAMES.settings).put(record));
      return record;
    });
  }

  async clear() {
    return withTransaction(this.database, STORE_NAMES.settings, "readwrite", async transaction => {
      await requestResult(transaction.objectStore(STORE_NAMES.settings).delete(this.settingsId));
    });
  }
}

export class CompletedGenerationRepository {
  constructor(database) {
    this.database = database;
  }

  async save(record) {
    validateCompletedGenerationRecord(record);
    return withTransaction(this.database, STORE_NAMES.generations, "readwrite", async transaction => {
      const store = transaction.objectStore(STORE_NAMES.generations);
      try {
        await requestResult(store.add(record));
      } catch (error) {
        if (error?.name === "ConstraintError") {
          throw new Error(`Completed generation ${record.runId}/${record.generation} already exists`, { cause: error });
        }
        throw error;
      }
      return record;
    });
  }

  async get(runId, generation) {
    requireId(runId, "Run ID");
    requireId(generation, "Generation ID");
    const record = await withTransaction(this.database, STORE_NAMES.generations, "readonly", transaction =>
      requestResult(transaction.objectStore(STORE_NAMES.generations).get([runId, generation])));
    if (record !== undefined) validateCompletedGenerationRecord(record);
    return record;
  }

  async list(runId) {
    requireId(runId, "Run ID");
    const records = await withTransaction(this.database, STORE_NAMES.generations, "readonly", transaction =>
      requestResult(transaction.objectStore(STORE_NAMES.generations).index("runId").getAll(runId)));
    records.forEach(validateCompletedGenerationRecord);
    return records.sort((left, right) => right.completedAt.localeCompare(left.completedAt)
      || left.generation.localeCompare(right.generation));
  }
}

async function addImmutable(store, record, label) {
  try {
    await requestResult(store.add(record));
  } catch (error) {
    if (error?.name === "ConstraintError") throw new Error(`${label} already exists`, { cause: error });
    throw error;
  }
}

export class LedgerRepository {
  constructor(database) {
    this.database = database;
  }

  async save(record) {
    validateLedgerRecord(record);
    return withTransaction(this.database, STORE_NAMES.ledgers, "readwrite", async transaction => {
      await addImmutable(transaction.objectStore(STORE_NAMES.ledgers), record, `Ledger ${record.ledgerId}`);
      return record;
    });
  }

  async get(ledgerId) {
    requireId(ledgerId, "Ledger ID");
    const record = await withTransaction(this.database, STORE_NAMES.ledgers, "readonly", transaction =>
      requestResult(transaction.objectStore(STORE_NAMES.ledgers).get(ledgerId)));
    if (record !== undefined) validateLedgerRecord(record);
    return record;
  }

  async list(runId) {
    requireId(runId, "Run ID");
    const records = await withTransaction(this.database, STORE_NAMES.ledgers, "readonly", transaction =>
      requestResult(transaction.objectStore(STORE_NAMES.ledgers).index("runId").getAll(runId)));
    records.forEach(validateLedgerRecord);
    return records.sort((left, right) => left.generation.localeCompare(right.generation)
      || left.ledgerId.localeCompare(right.ledgerId));
  }
}

export class ProgressRepository {
  constructor(database) {
    this.database = database;
  }

  async save(record) {
    validateRunProgressRecord(record);
    return withTransaction(this.database, STORE_NAMES.progress, "readwrite", async transaction => {
      await requestResult(transaction.objectStore(STORE_NAMES.progress).put(record));
      return record;
    });
  }

  async saveIncremental(record, previousRecord) {
    validateIncrementalRunProgressRecord(record, previousRecord);
    return withTransaction(this.database, STORE_NAMES.progress, "readwrite", async transaction => {
      await requestResult(transaction.objectStore(STORE_NAMES.progress).put(record));
      return record;
    });
  }

  async get(runId) {
    requireId(runId, "Run ID");
    const record = await withTransaction(this.database, STORE_NAMES.progress, "readonly", transaction =>
      requestResult(transaction.objectStore(STORE_NAMES.progress).get(runId)));
    if (record !== undefined) validateRunProgressRecord(record);
    return record;
  }

  async clear(runId) {
    requireId(runId, "Run ID");
    return withTransaction(this.database, STORE_NAMES.progress, "readwrite", async transaction => {
      await requestResult(transaction.objectStore(STORE_NAMES.progress).delete(runId));
    });
  }
}

function validateGenerationLedgerPair(generation, ledger) {
  validateCompletedGenerationRecord(generation);
  validateLedgerRecord(ledger);
  if (generation.runId !== ledger.runId || generation.generation !== ledger.generation
    || generation.ledgerRef !== ledger.ledgerId) {
    throw new Error("Completed generation and ledger identities do not match");
  }
}

/** Persist a generation and its ledger in one all-or-nothing transaction. */
export async function saveCompletedGenerationWithLedger(database, generation, ledger) {
  validateGenerationLedgerPair(generation, ledger);
  return withTransaction(database, [STORE_NAMES.generations, STORE_NAMES.ledgers], "readwrite", async transaction => {
    await addImmutable(transaction.objectStore(STORE_NAMES.ledgers), ledger, `Ledger ${ledger.ledgerId}`);
    await addImmutable(transaction.objectStore(STORE_NAMES.generations), generation,
      `Completed generation ${generation.runId}/${generation.generation}`);
    return { generation, ledger };
  });
}

/** Create a run and its bundled immutable baseline in one transaction. */
export async function initializeRunWithGeneration(database, run, generation, ledger) {
  validateRunRecord(run);
  validateGenerationLedgerPair(generation, ledger);
  if (run.runId !== generation.runId) throw new Error("Run and baseline generation identities do not match");
  const stores = [STORE_NAMES.runs, STORE_NAMES.generations, STORE_NAMES.ledgers];
  return withTransaction(database, stores, "readwrite", async transaction => {
    const runStore = transaction.objectStore(STORE_NAMES.runs);
    const existing = await requestResult(runStore.get(run.runId));
    if (existing !== undefined) return { run: existing, initialized: false };
    await addImmutable(runStore, run, `Run ${run.runId}`);
    await addImmutable(transaction.objectStore(STORE_NAMES.ledgers), ledger, `Ledger ${ledger.ledgerId}`);
    await addImmutable(transaction.objectStore(STORE_NAMES.generations), generation,
      `Completed generation ${generation.runId}/${generation.generation}`);
    return { run, generation, ledger, initialized: true };
  });
}

/** Commit final artifacts and remove resumable progress in the same transaction. */
export async function finalizeCompletedGeneration(database, generation, ledger) {
  validateGenerationLedgerPair(generation, ledger);
  const stores = [STORE_NAMES.generations, STORE_NAMES.ledgers, STORE_NAMES.progress];
  return withTransaction(database, stores, "readwrite", async transaction => {
    await addImmutable(transaction.objectStore(STORE_NAMES.ledgers), ledger, `Ledger ${ledger.ledgerId}`);
    await addImmutable(transaction.objectStore(STORE_NAMES.generations), generation,
      `Completed generation ${generation.runId}/${generation.generation}`);
    await requestResult(transaction.objectStore(STORE_NAMES.progress).delete(generation.runId));
    return { generation, ledger };
  });
}

export class ReplayRepository {
  constructor(database) { this.database = database; }

  async save(record) {
    validateReplayRecord(record);
    return withTransaction(this.database, STORE_NAMES.replays, "readwrite", async transaction => {
      await addImmutable(transaction.objectStore(STORE_NAMES.replays), record, `Replay ${record.replayId}`);
      return record;
    });
  }

  async get(replayId) {
    requireId(replayId, "Replay ID");
    const record = await withTransaction(this.database, STORE_NAMES.replays, "readonly", transaction =>
      requestResult(transaction.objectStore(STORE_NAMES.replays).get(replayId)));
    if (record !== undefined) validateReplayRecord(record);
    return record;
  }

  async list(runId) {
    requireId(runId, "Run ID");
    const records = await withTransaction(this.database, STORE_NAMES.replays, "readonly", transaction =>
      requestResult(transaction.objectStore(STORE_NAMES.replays).index("runId").getAll(runId)));
    records.forEach(validateReplayRecord);
    return records.sort((left, right) => right.createdAt.localeCompare(left.createdAt)
      || left.replayId.localeCompare(right.replayId));
  }
}

async function deleteIndexedRecords(transaction, storeName, runId) {
  const store = transaction.objectStore(storeName);
  const keys = await requestResult(store.index("runId").getAllKeys(runId));
  for (const key of keys) await requestResult(store.delete(key));
}

/** Remove one run and every artifact owned by it in one transaction. */
export async function deleteRunData(database, runId) {
  requireId(runId, "Run ID");
  const stores = [STORE_NAMES.runs, STORE_NAMES.generations, STORE_NAMES.ledgers,
    STORE_NAMES.progress, STORE_NAMES.replays, STORE_NAMES.settings];
  return withTransaction(database, stores, "readwrite", async transaction => {
    await deleteIndexedRecords(transaction, STORE_NAMES.generations, runId);
    await deleteIndexedRecords(transaction, STORE_NAMES.ledgers, runId);
    await deleteIndexedRecords(transaction, STORE_NAMES.replays, runId);
    await requestResult(transaction.objectStore(STORE_NAMES.progress).delete(runId));
    await requestResult(transaction.objectStore(STORE_NAMES.runs).delete(runId));
    const settingsStore = transaction.objectStore(STORE_NAMES.settings);
    const settings = await requestResult(settingsStore.get("application"));
    if (settings?.selectedRunId === runId) {
      const updatedSettings = { ...settings, selectedRunId: null, selectedGeneration: null };
      validateSettingsRecord(updatedSettings);
      await requestResult(settingsStore.put(updatedSettings));
    }
  });
}
