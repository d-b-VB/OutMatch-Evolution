import { flattenGenomeLoci } from "../baseline/checkpoint.js";

export const DEFAULT_ORDINARY_INHERITANCE = Object.freeze({
  father: 0.4,
  mother: 0.4,
  mean: 0.1,
  between: 0.05,
  mutation: 0.05
});
export const DEFAULT_SELF_INHERITANCE = Object.freeze({ parent: 0.95, mutation: 0.05 });

/** Build the fixed-size survivor/entrant pool used to plan one population's births. */
export function buildResidentPool(rankings, {
  survivorSlots = 14,
  outgoingIds = new Set(),
  incoming = []
} = {}) {
  if (!Number.isSafeInteger(survivorSlots) || survivorSlots < 1) throw new Error("Survivor slots must be positive");
  if (!(outgoingIds instanceof Set) || !Array.isArray(incoming)) throw new Error("Invalid survivor-pool inputs");
  if (incoming.length > survivorSlots) throw new Error("Incoming entrants exceed survivor slots");
  const ids = new Set();
  const entrants = incoming.map(entrant => {
    if (typeof entrant?.id !== "string" || entrant.id === "" || ids.has(entrant.id)) throw new Error("Invalid or duplicate incoming entrant");
    ids.add(entrant.id);
    return { ...entrant, origin: entrant.origin ?? "incoming", breedingEligible: false };
  });
  const natives = [];
  for (const ranking of rankings) {
    if (entrants.length + natives.length === survivorSlots) break;
    if (outgoingIds.has(ranking.id) || ids.has(ranking.id)) continue;
    if (!Number.isSafeInteger(ranking.rank) || ranking.rank < 1) throw new Error(`Invalid resident rank for ${ranking.id}`);
    ids.add(ranking.id);
    natives.push({ ...ranking, origin: "native_survivor", breedingEligible: true });
  }
  if (entrants.length + natives.length !== survivorSlots) throw new Error("Not enough eligible residents to fill survivor pool");
  return [...entrants, ...natives];
}

/** Compute normalized 1/sqrt(rank) lottery weights for breeding-eligible residents. */
export function rankLotteryWeights(residents) {
  const eligible = residents.filter(resident => resident.breedingEligible !== false);
  if (eligible.length === 0) throw new Error("Breeding pool has no eligible residents");
  const ranks = new Set();
  const weighted = eligible.map(resident => {
    if (!Number.isSafeInteger(resident.rank) || resident.rank < 1 || ranks.has(resident.rank)) {
      throw new Error(`Invalid or duplicate breeding rank: ${resident.rank}`);
    }
    ranks.add(resident.rank);
    return { resident, rawWeight: 1 / Math.sqrt(resident.rank) };
  });
  const total = weighted.reduce((sum, entry) => sum + entry.rawWeight, 0);
  let cumulative = 0;
  return weighted.map((entry, index) => {
    const weight = entry.rawWeight / total;
    cumulative = index === weighted.length - 1 ? 1 : cumulative + weight;
    return { resident: entry.resident, weight, cumulative };
  });
}

/** Draw one parent using only the explicitly supplied deterministic breeding RNG. */
export function selectWeightedParent(weightedResidents, random) {
  if (!Array.isArray(weightedResidents) || weightedResidents.length === 0 || typeof random?.nextFloat !== "function") {
    throw new Error("Weighted parent selection requires residents and an explicit RNG");
  }
  const draw = random.nextFloat();
  const selected = weightedResidents.find(entry => draw < entry.cumulative);
  if (selected === undefined) throw new Error(`Breeding RNG returned an out-of-range draw: ${draw}`);
  return selected.resident;
}

/** Plan the ten canonical guaranteed-father events from eligible resident ranks. */
export function planGuaranteedFatherEvents(residents) {
  const byRank = new Map(residents
    .filter(resident => resident.breedingEligible !== false)
    .map(resident => [resident.rank, resident]));
  const events = [];
  for (const rank of [1, 2, 3, 4, 5, 6, 7]) {
    if (byRank.has(rank)) events.push({ father: byRank.get(rank), guaranteedRank: rank });
  }
  for (const rank of [1, 2, 3]) {
    if (byRank.has(rank)) events.push({ father: byRank.get(rank), guaranteedRank: rank });
  }
  return events;
}

/** Plan guaranteed-father and ordinary parent pairs for a fixed number of births. */
export function planParentPairs(residents, birthCount, random) {
  if (!Number.isSafeInteger(birthCount) || birthCount < 0) throw new Error("Birth count must be a nonnegative integer");
  const weighted = rankLotteryWeights(residents);
  const guaranteed = planGuaranteedFatherEvents(residents);
  if (guaranteed.length > birthCount) throw new Error("Birth count cannot fit guaranteed-father events");
  const pairs = guaranteed.map(event => ({
    father: event.father,
    mother: selectWeightedParent(weighted, random),
    kind: "guaranteed_father",
    guaranteedRank: event.guaranteedRank
  }));
  while (pairs.length < birthCount) pairs.push({
    father: selectWeightedParent(weighted, random),
    mother: selectWeightedParent(weighted, random),
    kind: "ordinary",
    guaranteedRank: null
  });
  return pairs;
}

/** Validate fixed expanded mutation ranges against canonical locus ordering. */
export function validateMutationRanges(document, locusOrder) {
  if (document?.schema !== "outmatch-reach-mutation-ranges-v1" || document.locusCount !== locusOrder.length) {
    throw new Error("Mutation ranges have an incompatible schema or locus count");
  }
  const names = Object.keys(document.ranges);
  if (names.length !== locusOrder.length || names.some((name, index) => name !== locusOrder[index])) {
    throw new Error("Mutation ranges do not match canonical locus order");
  }
  return new Map(names.map(name => {
    const range = document.ranges[name];
    if (!Number.isFinite(range.expandedMin) || !Number.isFinite(range.expandedMax)
      || range.expandedMax < range.expandedMin) throw new Error(`Invalid mutation range for ${name}`);
    return [name, Object.freeze({ minimum: range.expandedMin, maximum: range.expandedMax })];
  }));
}

/** Apply the default ordinary-cross inheritance rule to one locus. */
export function inheritOrdinaryLocus(
  fatherValue,
  motherValue,
  mutationRange,
  random,
  probabilities = DEFAULT_ORDINARY_INHERITANCE
) {
  if (![fatherValue, motherValue, mutationRange?.minimum, mutationRange?.maximum].every(Number.isFinite)
    || mutationRange.maximum < mutationRange.minimum || typeof random?.nextFloat !== "function"
    || typeof random?.nextRange !== "function") throw new Error("Invalid ordinary locus inheritance inputs");
  validateInheritanceProbabilities(probabilities, Object.keys(DEFAULT_ORDINARY_INHERITANCE));
  const draw = random.nextFloat();
  let boundary = probabilities.father;
  if (draw < boundary) return { value: fatherValue, mode: "father" };
  boundary += probabilities.mother;
  if (draw < boundary) return { value: motherValue, mode: "mother" };
  boundary += probabilities.mean;
  if (draw < boundary) return { value: (fatherValue + motherValue) / 2, mode: "mean" };
  boundary += probabilities.between;
  if (draw < boundary) return {
    value: random.nextRange(Math.min(fatherValue, motherValue), Math.max(fatherValue, motherValue)),
    mode: "between"
  };
  return { value: random.nextRange(mutationRange.minimum, mutationRange.maximum), mode: "mutation" };
}

/** Apply the 95%-exact, 5%-mutation self-cross rule to one locus. */
export function inheritSelfCrossLocus(parentValue, mutationRange, random, probabilities = DEFAULT_SELF_INHERITANCE) {
  if (![parentValue, mutationRange?.minimum, mutationRange?.maximum].every(Number.isFinite)
    || mutationRange.maximum < mutationRange.minimum || typeof random?.nextFloat !== "function"
    || typeof random?.nextRange !== "function") throw new Error("Invalid self-cross locus inheritance inputs");
  validateInheritanceProbabilities(probabilities, Object.keys(DEFAULT_SELF_INHERITANCE));
  if (random.nextFloat() < probabilities.parent) return { value: parentValue, mode: "parent" };
  return { value: random.nextRange(mutationRange.minimum, mutationRange.maximum), mode: "mutation" };
}

/** Validate a complete probability configuration with a stable mode set. */
export function validateInheritanceProbabilities(probabilities, modes) {
  if (probabilities === null || typeof probabilities !== "object"
    || Object.keys(probabilities).length !== modes.length
    || modes.some(mode => !Object.hasOwn(probabilities, mode)
      || !Number.isFinite(probabilities[mode]) || probabilities[mode] < 0)) {
    throw new Error("Inheritance probabilities must define finite nonnegative values for every mode");
  }
  const total = modes.reduce((sum, mode) => sum + probabilities[mode], 0);
  if (Math.abs(total - 1) > 1e-12) throw new Error(`Inheritance probabilities sum to ${total}; expected 1`);
  return probabilities;
}

/** Change ordinary mutation probability while preserving other modes' relative proportions. */
export function rescaleMutationProbability(probabilities, mutationProbability) {
  const modes = Object.keys(DEFAULT_ORDINARY_INHERITANCE);
  validateInheritanceProbabilities(probabilities, modes);
  if (!Number.isFinite(mutationProbability) || mutationProbability < 0 || mutationProbability > 1) {
    throw new Error("Mutation probability must be between zero and one");
  }
  const oldNonMutation = 1 - probabilities.mutation;
  if (oldNonMutation === 0 && mutationProbability !== 1) throw new Error("Cannot rescale zero non-mutation probability");
  const scale = oldNonMutation === 0 ? 0 : (1 - mutationProbability) / oldNonMutation;
  return Object.freeze(Object.fromEntries(modes.map(mode => [
    mode,
    mode === "mutation" ? mutationProbability : probabilities[mode] * scale
  ])));
}

/** Reconstruct the canonical nested genes object from ordered path/value loci. */
export function reconstructGenomeGenes(loci) {
  const genes = {};
  for (const [path, value] of loci) {
    if (typeof path !== "string" || path === "" || !Number.isFinite(value)) throw new Error(`Invalid reconstructed locus: ${path}`);
    const parts = path.split(".");
    let target = genes;
    for (const part of parts.slice(0, -1)) {
      if (!Object.hasOwn(target, part)) target[part] = {};
      else if (target[part] === null || typeof target[part] !== "object") throw new Error(`Conflicting reconstructed locus: ${path}`);
      target = target[part];
    }
    const leaf = parts.at(-1);
    if (Object.hasOwn(target, leaf)) throw new Error(`Duplicate reconstructed locus: ${path}`);
    target[leaf] = value;
  }
  return genes;
}

/** Breed one complete deterministic child and retain auditable inheritance counts. */
export function breedChild({
  id,
  population,
  father,
  mother,
  locusOrder,
  mutationRanges,
  random,
  ordinaryProbabilities = DEFAULT_ORDINARY_INHERITANCE,
  selfProbabilities = DEFAULT_SELF_INHERITANCE
}) {
  if (typeof id !== "string" || id === "" || typeof population !== "string" || population === "") {
    throw new Error("Child requires non-empty ID and population");
  }
  const fatherLoci = new Map(flattenGenomeLoci(father));
  const motherLoci = new Map(flattenGenomeLoci(mother));
  if (fatherLoci.size !== locusOrder.length || motherLoci.size !== locusOrder.length) throw new Error("Parent loci do not match locus order");
  const selfCross = father.id === mother.id;
  const modeCounts = {};
  const childLoci = locusOrder.map(path => {
    if (!fatherLoci.has(path) || !motherLoci.has(path) || !mutationRanges.has(path)) throw new Error(`Missing breeding locus: ${path}`);
    const inherited = selfCross
      ? inheritSelfCrossLocus(fatherLoci.get(path), mutationRanges.get(path), random, selfProbabilities)
      : inheritOrdinaryLocus(fatherLoci.get(path), motherLoci.get(path), mutationRanges.get(path), random, ordinaryProbabilities);
    modeCounts[inherited.mode] = (modeCounts[inherited.mode] ?? 0) + 1;
    return [path, inherited.value];
  });
  const child = { id, population, genes: reconstructGenomeGenes(childLoci) };
  if (flattenGenomeLoci(child).length !== locusOrder.length) throw new Error("Child genome failed locus validation");
  return {
    child,
    provenance: { fatherId: father.id, motherId: mother.id, selfCross, modeCounts }
  };
}
