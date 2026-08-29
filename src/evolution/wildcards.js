import { flattenGenomeLoci } from "../baseline/checkpoint.js";
import { reconstructGenomeGenes } from "./breeding.js";

/** Resolve independent wildcard slots using only the supplied breeding RNG. */
export function activateWildcardSlots(random, { slotCount = 5, probability = 0.5 } = {}) {
  if (!Number.isSafeInteger(slotCount) || slotCount < 0) throw new Error("Wildcard slot count must be nonnegative");
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new Error("Wildcard activation probability must be between zero and one");
  }
  if (typeof random?.nextFloat !== "function") throw new Error("Wildcard activation requires an explicit RNG");
  return Array.from({ length: slotCount }, (_, slot) => ({
    slot,
    active: random.nextFloat() < probability
  }));
}

/** Generate one full-range wildcard with every locus drawn independently. */
export function generateWildcardGenome({ id, population, slot, locusOrder, mutationRanges, random }) {
  if (typeof id !== "string" || id === "" || typeof population !== "string" || population === ""
    || !Number.isSafeInteger(slot) || slot < 0 || typeof random?.nextRange !== "function") {
    throw new Error("Invalid wildcard genome inputs");
  }
  const loci = locusOrder.map(path => {
    const range = mutationRanges.get(path);
    if (range === undefined) throw new Error(`Missing wildcard mutation range: ${path}`);
    return [path, random.nextRange(range.minimum, range.maximum)];
  });
  const genome = { id, population, genes: reconstructGenomeGenes(loci) };
  if (flattenGenomeLoci(genome).length !== locusOrder.length) throw new Error("Wildcard genome failed locus validation");
  return { genome, provenance: { origin: "wildcard", wildcardSlot: slot } };
}

/** Replace ordinary births with active wildcards, never guaranteed-father events. */
export function applyWildcardsToBirthPlan(parentPairs, decisions) {
  if (!Array.isArray(parentPairs) || !Array.isArray(decisions)) throw new Error("Invalid wildcard birth plan");
  const activeSlots = decisions.filter(decision => decision.active).map(decision => decision.slot);
  const ordinaryIndexes = parentPairs
    .map((pair, index) => pair.kind === "ordinary" ? index : null)
    .filter(index => index !== null);
  if (activeSlots.length > ordinaryIndexes.length) throw new Error("Active wildcards exceed ordinary birth slots");
  const replacements = new Map(activeSlots.map((slot, index) => [ordinaryIndexes[index], slot]));
  return parentPairs.map((pair, index) => replacements.has(index)
    ? { kind: "wildcard", wildcardSlot: replacements.get(index) }
    : pair);
}
