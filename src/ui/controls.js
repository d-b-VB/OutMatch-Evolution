import { canonicalJsonBytes } from "../portable/canonical-json.js";
import { sha256Digest } from "../portable/integrity.js";
import { reviewInterventions, validateInterventionQueue } from "./interventions.js";

export const LAB_CONTROLS_SCHEMA = "outmatch-lab-controls-v1";
export const DEFAULT_LAB_CONTROLS = Object.freeze({
  schema: LAB_CONTROLS_SCHEMA,
  workerCount: 4,
  migrationEnabled: true,
  maximumMigrants: 7,
  wildcardProbability: 0.5,
  mutationProbability: 0.02,
  interventions: Object.freeze([])
});

function integer(value, label, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

function probability(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) throw new Error(`${label} must be between 0 and 1`);
  return parsed;
}

export function validateLabControls(controls) {
  if (controls?.schema !== LAB_CONTROLS_SCHEMA) throw new Error("Lab controls have an unsupported schema");
  if (!Array.isArray(controls.interventions)) throw new Error("Interventions must be an array");
  const normalized = {
    schema: LAB_CONTROLS_SCHEMA,
    workerCount: integer(controls.workerCount, "Worker count", 1, 16),
    migrationEnabled: controls.migrationEnabled === true,
    maximumMigrants: integer(controls.maximumMigrants, "Maximum migrants", 0, 49),
    wildcardProbability: probability(controls.wildcardProbability, "Wildcard probability"),
    mutationProbability: probability(controls.mutationProbability, "Mutation probability"),
    interventions: validateInterventionQueue(controls.interventions)
  };
  if (!normalized.migrationEnabled) normalized.maximumMigrants = 0;
  return normalized;
}

export function controlsFromForm(values) {
  return validateLabControls({
    schema: LAB_CONTROLS_SCHEMA,
    workerCount: values.workerCount,
    migrationEnabled: values.migrationEnabled === true || values.migrationEnabled === "on",
    maximumMigrants: values.maximumMigrants,
    wildcardProbability: values.wildcardProbability,
    mutationProbability: values.mutationProbability,
    interventions: values.interventions ?? []
  });
}

export async function reviewLabControls(controls, options = {}) {
  const normalized = validateLabControls(controls);
  const { interventions, ...controlValues } = normalized;
  const interventionReview = await reviewInterventions(interventions, options);
  return {
    controls: normalized,
    controlsHash: await sha256Digest(canonicalJsonBytes(controlValues), options),
    ...interventionReview
  };
}

export const CONTROL_EXPLANATIONS = Object.freeze({
  workerCount: "Changes throughput only; schedule order and results remain deterministic.",
  migration: "Allows qualified outsiders to enter a destination population before breeding.",
  wildcard: "Controls how often an ordinary birth slot becomes a fixed-range wildcard draw.",
  mutation: "Rescales inherited-locus mutation while retaining the frozen mutation ranges."
});
