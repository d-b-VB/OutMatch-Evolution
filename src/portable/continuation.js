import {
  advanceGenerationMetadata,
  generationFingerprint,
  validateChildGeneration
} from "../evolution/generation.js";
import { buildProgressCheckpoint } from "../persistence/resume.js";
import { validateCompletedGenerationRecord } from "../persistence/schema.js";

function checkpointFingerprint(checkpoint) {
  const value = structuredClone(checkpoint);
  delete value.fingerprint;
  return generationFingerprint(value);
}

/** Validate and expose the deterministic parent inputs needed for another generation. */
export function prepareImportedContinuation(plan, {
  controlsHash,
  interventionsHash,
  rosterSize = 49,
  locusCount = 112,
  updatedAt = new Date().toISOString()
}) {
  validateCompletedGenerationRecord(plan.generation);
  const checkpoint = structuredClone(plan.generation.checkpoint);
  validateChildGeneration(checkpoint, { rosterSize, locusCount });
  if (checkpoint.generation !== plan.generation.generation) {
    throw new Error("Imported checkpoint generation does not match its completed record");
  }
  const actualFingerprint = checkpointFingerprint(checkpoint);
  if (plan.generation.fingerprint !== actualFingerprint
    || (checkpoint.fingerprint !== undefined && checkpoint.fingerprint !== actualFingerprint)) {
    throw new Error("Imported checkpoint fingerprint does not match its completed record");
  }
  const childMetadata = advanceGenerationMetadata(checkpoint);
  const parentGenomes = new Map(checkpoint.population.map(genome => [genome.id, genome]));
  if (parentGenomes.size !== checkpoint.population.length) throw new Error("Imported checkpoint has duplicate genome IDs");
  const progress = buildProgressCheckpoint({
    runId: plan.run.runId,
    parentGeneration: checkpoint.generation,
    parentFingerprint: actualFingerprint,
    targetGeneration: childMetadata.generation,
    controlsHash,
    interventionsHash,
    breedingSeed: childMetadata.breedingSeed,
    breedingPrngVersion: childMetadata.breedingPrngVersion,
    phase: "initialized",
    childCandidate: null,
    updatedAt
  });
  return {
    checkpoint,
    rankings: structuredClone(plan.generation.rankings),
    parentGenomes,
    childMetadata,
    progress
  };
}

/** Execute continuation code with clones so imported immutable records stay untouched. */
export async function continueImportedGeneration(prepared, continueGeneration) {
  if (typeof continueGeneration !== "function") throw new Error("Continuation requires an evolution function");
  return continueGeneration({
    parentMetadata: structuredClone(prepared.checkpoint),
    rankings: structuredClone(prepared.rankings),
    parentGenomes: new Map([...prepared.parentGenomes].map(([id, genome]) => [id, structuredClone(genome)])),
    progress: structuredClone(prepared.progress)
  });
}
