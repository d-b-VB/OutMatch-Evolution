import { PERSISTENCE_SCHEMAS } from "../persistence/schema.js";
import { commitOmgenImport, createOmgenImportPlan, inspectOmgenImport } from "../portable/import.js";
import { exportOmgen } from "../portable/archive.js";
import { deleteRunData } from "../persistence/repositories.js";
import { inspectStorage } from "../persistence/storage.js";
import { validateLabControls } from "./controls.js";

function required(value, label) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

export async function createLabRun({ runRepository, title, runId, now = () => new Date().toISOString() }) {
  const record = {
    schema: PERSISTENCE_SCHEMAS.run, runId: required(runId, "Run ID"), title: required(title, "Run title"),
    createdAt: now(), activeGeneration: "ReachR29", originatingGeneration: "ReachR29"
  };
  await runRepository.save(record);
  return record;
}

export async function persistLabSelection(settingsRepository, state, previous = null) {
  const settings = {
    ...previous,
    schema: PERSISTENCE_SCHEMAS.settings, settingsId: "application",
    selectedRunId: state.selectedRunId, selectedGeneration: state.selectedGeneration,
    workerCount: previous?.workerCount ?? 4
  };
  await settingsRepository.save(settings);
  return settings;
}

export async function persistDraftControls(settingsRepository, state, controls, previous = null) {
  const draftControls = validateLabControls(controls);
  const settings = {
    ...previous,
    schema: PERSISTENCE_SCHEMAS.settings,
    settingsId: "application",
    selectedRunId: state.selectedRunId,
    selectedGeneration: state.selectedGeneration,
    workerCount: draftControls.workerCount,
    draftControls,
    controlReview: null
  };
  await settingsRepository.save(settings);
  return settings;
}

export async function persistControlReview(settingsRepository, state, controlReview, previous = null) {
  const settings = {
    ...previous,
    schema: PERSISTENCE_SCHEMAS.settings, settingsId: "application",
    selectedRunId: state.selectedRunId, selectedGeneration: state.selectedGeneration,
    workerCount: controlReview.controls.workerCount,
    draftControls: structuredClone(controlReview.controls),
    controlReview: structuredClone(controlReview)
  };
  await settingsRepository.save(settings);
  return settings;
}

export async function inspectLabImport(file, options = {}) {
  if (!file || typeof file.arrayBuffer !== "function") throw new Error("Choose an .omgen file to inspect");
  if (file.name && !file.name.toLowerCase().endsWith(".omgen")) throw new Error("Import file must use the .omgen extension");
  return inspectOmgenImport(new Uint8Array(await file.arrayBuffer()), options);
}

export async function commitLabImport({ database, inspected, targetRunId, title }) {
  const plan = createOmgenImportPlan(inspected, {
    targetRunId: required(targetRunId, "Target run ID"), title: required(title, "Imported run title")
  });
  await commitOmgenImport(database, plan);
  return plan;
}

export function omgenFilename(generation) {
  const safe = `${generation.runId}-${generation.generation}`.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${safe || "outmatch-generation"}.omgen`;
}

export async function exportLabGeneration({ generation, ledgerRepository, exporter = exportOmgen, options = {} }) {
  if (!generation) throw new Error("Select a completed generation to export");
  const ledger = await ledgerRepository.get(generation.ledgerRef);
  if (!ledger) throw new Error(`Ledger ${generation.ledgerRef} is missing`);
  return { filename: omgenFilename(generation), bytes: await exporter(generation, ledger, options) };
}

export async function removeLabRun(database, runId) {
  await deleteRunData(database, required(runId, "Run ID"));
  return runId;
}

export async function loadLabStorage(options = {}) {
  try { return await inspectStorage(options); }
  catch { return null; }
}
