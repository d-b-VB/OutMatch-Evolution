import { importOmgen } from "./archive.js";
import { requestResult } from "../persistence/database.js";
import { withTransaction } from "../persistence/repositories.js";
import {
  PERSISTENCE_SCHEMAS,
  STORE_NAMES,
  validateCompletedGenerationRecord,
  validateLedgerRecord,
  validateRunRecord
} from "../persistence/schema.js";

function requireId(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string`);
  return value;
}

export async function inspectOmgenImport(bytes, options = {}) {
  return importOmgen(bytes, options);
}

/** Rewrite storage identities while preserving the exported generation fingerprint. */
export function createOmgenImportPlan({ manifest, generation, ledger }, {
  targetRunId = generation.runId,
  title = `Imported ${generation.generation}`
} = {}) {
  requireId(targetRunId, "Target run ID");
  requireId(title, "Imported run title");
  const renamed = targetRunId !== generation.runId;
  const ledgerId = renamed ? `${targetRunId}:${ledger.ledgerId}` : ledger.ledgerId;
  const importedLedger = { ...structuredClone(ledger), runId: targetRunId, ledgerId };
  const importedGeneration = {
    ...structuredClone(generation), runId: targetRunId, ledgerRef: ledgerId
  };
  const run = {
    schema: PERSISTENCE_SCHEMAS.run,
    runId: targetRunId,
    title,
    createdAt: manifest.createdAt,
    activeGeneration: importedGeneration.generation,
    originatingGeneration: importedGeneration.parentGeneration
  };
  validateRunRecord(run);
  validateCompletedGenerationRecord(importedGeneration);
  validateLedgerRecord(importedLedger);
  return {
    source: structuredClone(manifest.generation),
    renamed,
    run,
    generation: importedGeneration,
    ledger: importedLedger
  };
}

export async function detectOmgenImportConflicts(database, plan) {
  return withTransaction(database, [STORE_NAMES.runs, STORE_NAMES.generations, STORE_NAMES.ledgers], "readonly",
    async transaction => {
      const [run, generation, ledger] = await Promise.all([
        requestResult(transaction.objectStore(STORE_NAMES.runs).get(plan.run.runId)),
        requestResult(transaction.objectStore(STORE_NAMES.generations)
          .get([plan.generation.runId, plan.generation.generation])),
        requestResult(transaction.objectStore(STORE_NAMES.ledgers).get(plan.ledger.ledgerId))
      ]);
      return [run && "run", generation && "generation", ledger && "ledger"].filter(Boolean);
    });
}

function validateImportPlan(plan) {
  validateRunRecord(plan.run);
  validateCompletedGenerationRecord(plan.generation);
  validateLedgerRecord(plan.ledger);
  if (plan.run.runId !== plan.generation.runId
    || plan.run.runId !== plan.ledger.runId
    || plan.run.activeGeneration !== plan.generation.generation
    || plan.generation.generation !== plan.ledger.generation
    || plan.generation.ledgerRef !== plan.ledger.ledgerId) {
    throw new Error("OMGEN import plan has inconsistent run, generation, or ledger identities");
  }
}

/** Insert the run, immutable generation, and ledger in one all-or-nothing transaction. */
export async function commitOmgenImport(database, plan) {
  validateImportPlan(plan);
  const conflicts = await detectOmgenImportConflicts(database, plan);
  if (conflicts.length > 0) throw new Error(`OMGEN import conflicts with existing ${conflicts.join(", ")}`);
  return withTransaction(database, [STORE_NAMES.runs, STORE_NAMES.generations, STORE_NAMES.ledgers], "readwrite",
    async transaction => {
      await requestResult(transaction.objectStore(STORE_NAMES.runs).add(plan.run));
      await requestResult(transaction.objectStore(STORE_NAMES.ledgers).add(plan.ledger));
      await requestResult(transaction.objectStore(STORE_NAMES.generations).add(plan.generation));
      return plan;
    });
}
