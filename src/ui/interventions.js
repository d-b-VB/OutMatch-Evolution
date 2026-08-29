import { R29_POPULATIONS } from "../baseline/checkpoint.js";
import { canonicalJsonBytes } from "../portable/canonical-json.js";
import { sha256Digest } from "../portable/integrity.js";

export const INTERVENTIONS_SCHEMA = "outmatch-reach-interventions-v1";
export const INTERVENTION_TYPES = Object.freeze(["manual-move", "copy-entrant"]);

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
  } : {
    type: values.type, sourceGeneralId: values.generalId, to: values.to,
    newId: values.newId, newName: values.newName, note: values.note
  });
}

export function validateInterventionQueue(operations) {
  if (!Array.isArray(operations)) throw new Error("Interventions must be an array");
  const normalized = operations.map(validateIntervention);
  const moved = new Set();
  const created = new Set();
  for (const operation of normalized) {
    const sourceId = operation.generalId ?? operation.sourceGeneralId;
    if (operation.type === "manual-move" && moved.has(sourceId)) throw new Error(`General is moved more than once: ${sourceId}`);
    if (operation.type === "manual-move") moved.add(sourceId);
    if (operation.type === "copy-entrant" && created.has(operation.newId)) throw new Error(`Duplicate copied general ID: ${operation.newId}`);
    if (operation.type === "copy-entrant") created.add(operation.newId);
  }
  return normalized;
}

export async function reviewInterventions(operations, options = {}) {
  const normalized = validateInterventionQueue(operations);
  const parentGeneration = required(options.parentGeneration, "Parent generation");
  if (!/^ReachR\d+$/.test(parentGeneration)) throw new Error("Parent generation must use ReachR<number>");
  const document = { schema: INTERVENTIONS_SCHEMA, parentGeneration, operations: normalized };
  return { interventions: document, interventionsHash: await sha256Digest(canonicalJsonBytes(document), options) };
}
