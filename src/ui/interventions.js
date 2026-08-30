import { flattenGenomeLoci, R29_POPULATIONS } from "../baseline/checkpoint.js";
import { canonicalJsonBytes } from "../portable/canonical-json.js";
import { sha256Digest } from "../portable/integrity.js";

export const INTERVENTIONS_SCHEMA_V1 = "outmatch-reach-interventions-v1";
export const INTERVENTIONS_SCHEMA = "outmatch-reach-interventions-v2";
export const INTERVENTION_TYPES = Object.freeze(["manual-move", "copy-entrant", "replacement-upload"]);

function required(value, label) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function population(value, label) {
  const normalized = required(value, label);
  if (!R29_POPULATIONS.includes(normalized)) throw new Error(`${label} is not a Reach population`);
  return normalized;
}

export function validateIntervention(operation) {
  if (!INTERVENTION_TYPES.includes(operation?.type)) throw new Error("Intervention type is unsupported");
  const note = required(operation.note, "Intervention note");
  if (operation.type === "manual-move") {
    const from = population(operation.from, "Source population");
    const to = population(operation.to, "Destination population");
    if (from === to) throw new Error("Manual move must change populations");
    return { type: operation.type, generalId: required(operation.generalId, "General ID"), from, to, note };
  }
  if (operation.type === "replacement-upload") {
    const to = population(operation.to, "Destination population");
    const genome = structuredClone(operation.genome);
    if (genome === null || typeof genome !== "object" || Array.isArray(genome)) throw new Error("Replacement genome is required");
    genome.id = required(genome.id, "Replacement genome ID");
    genome.name = required(genome.name, "Replacement genome name");
    genome.population = to;
    if (flattenGenomeLoci(genome).length !== 112) throw new Error("Replacement genome must contain 112 loci");
    return {
      type: operation.type, replacesGeneralId: required(operation.replacesGeneralId, "Replaced general ID"),
      to, genome, note
    };
  }
  return {
    type: operation.type,
    sourceGeneralId: required(operation.sourceGeneralId, "Source general ID"),
    to: population(operation.to, "Destination population"),
    newId: required(operation.newId, "New general ID"),
    newName: required(operation.newName, "New general name"),
    note
  };
}

export function interventionFromForm(values) {
  return validateIntervention(values.type === "manual-move" ? {
    type: values.type, generalId: values.generalId, from: values.from, to: values.to, note: values.note
  } : values.type === "copy-entrant" ? {
    type: values.type, sourceGeneralId: values.generalId, to: values.to,
    newId: values.newId, newName: values.newName, note: values.note
  } : {
    type: values.type, replacesGeneralId: values.generalId, to: values.to,
    genome: typeof values.genomeJson === "string" && values.genomeJson.trim()
      ? JSON.parse(values.genomeJson) : values.genome, note: values.note
  });
}

/** Read a bounded UTF-8 JSON genome selected by the replacement intervention UI. */
export async function replacementGenomeFromFile(file, { maximumBytes = 1_000_000 } = {}) {
  if (!file || typeof file.text !== "function") throw new Error("Choose a replacement genome JSON file");
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) throw new Error("Replacement file limit is invalid");
  if (Number.isFinite(file.size) && file.size > maximumBytes) throw new Error("Replacement genome file is too large");
  const text = await file.text();
  if (new TextEncoder().encode(text).byteLength > maximumBytes) throw new Error("Replacement genome file is too large");
  let genome;
  try { genome = JSON.parse(text); }
  catch { throw new Error("Replacement genome file must contain valid JSON"); }
  return genome;
}

export function validateInterventionQueue(operations) {
  if (!Array.isArray(operations)) throw new Error("Interventions must be an array");
  const normalized = operations.map(validateIntervention);
  const moved = new Set();
  const created = new Set();
  const replaced = new Set();
  for (const operation of normalized) {
    const sourceId = operation.generalId ?? operation.sourceGeneralId;
    if (operation.type === "manual-move" && moved.has(sourceId)) throw new Error(`General is moved more than once: ${sourceId}`);
    if (operation.type === "manual-move" && replaced.has(sourceId)) throw new Error(`General has conflicting interventions: ${sourceId}`);
    if (operation.type === "manual-move") moved.add(sourceId);
    if (operation.type === "copy-entrant" && created.has(operation.newId)) throw new Error(`Duplicate copied general ID: ${operation.newId}`);
    if (operation.type === "copy-entrant") created.add(operation.newId);
    if (operation.type === "replacement-upload" && replaced.has(operation.replacesGeneralId)) {
      throw new Error(`General is replaced more than once: ${operation.replacesGeneralId}`);
    }
    if (operation.type === "replacement-upload" && moved.has(operation.replacesGeneralId)) {
      throw new Error(`General has conflicting interventions: ${operation.replacesGeneralId}`);
    }
    if (operation.type === "replacement-upload") {
      replaced.add(operation.replacesGeneralId);
      if (created.has(operation.genome.id)) throw new Error(`Duplicate manual entrant ID: ${operation.genome.id}`);
      created.add(operation.genome.id);
    }
  }
  return normalized;
}

/** Validate stored review documents while preserving the original schema for hashing and resume. */
export function validateInterventionDocument(document) {
  if (![INTERVENTIONS_SCHEMA_V1, INTERVENTIONS_SCHEMA].includes(document?.schema)) {
    throw new Error("Intervention document has an unsupported schema");
  }
  const parentGeneration = required(document.parentGeneration, "Parent generation");
  if (!/^ReachR\d+$/.test(parentGeneration)) throw new Error("Parent generation must use ReachR<number>");
  const operations = validateInterventionQueue(document.operations);
  if (document.schema === INTERVENTIONS_SCHEMA_V1
    && operations.some(operation => operation.type === "replacement-upload")) {
    throw new Error("Replacement uploads require intervention schema v2");
  }
  return { schema: document.schema, parentGeneration, operations };
}

export async function reviewInterventions(operations, options = {}) {
  const normalized = validateInterventionQueue(operations);
  const document = validateInterventionDocument({
    schema: INTERVENTIONS_SCHEMA, parentGeneration: options.parentGeneration, operations: normalized
  });
  return { interventions: document, interventionsHash: await sha256Digest(canonicalJsonBytes(document), options) };
}
