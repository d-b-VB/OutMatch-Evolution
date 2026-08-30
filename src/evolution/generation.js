import { R29_POPULATIONS } from "../baseline/checkpoint.js";
import { flattenGenomeLoci } from "../baseline/checkpoint.js";
import {
  breedChild,
  DEFAULT_ORDINARY_INHERITANCE,
  planParentPairs,
  rescaleMutationProbability
} from "./breeding.js";
import { applyMigrationToResidentPools, nextRecruitingPopulation, planManualPopulationInterventions, validateMigrationResidentPools } from "./migration.js";
import { SplitMix64 } from "./prng.js";
import { activateWildcardSlots, applyWildcardsToBirthPlan, generateWildcardGenome } from "./wildcards.js";

function residentProvenance(resident, sourceGenome) {
  if (resident.origin === "automatic_migrant" || resident.origin === "manual_migrant") {
    return {
      origin: resident.origin,
      sourceId: sourceGenome.id,
      sourcePopulation: resident.sourcePopulation,
      destinationPopulation: resident.destinationPopulation,
      breedingEligible: false
    };
  }
  if (resident.origin === "manual_copy") {
    return { origin: "manual_copy", sourceId: resident.sourceId, breedingEligible: false };
  }
  return { origin: "survivor", sourceId: sourceGenome.id, breedingEligible: true };
}

/** Assemble one fixed-size population from residents and completed births. */
export function assemblePopulation({ population, residents, births, parentGenomes, rosterSize = 49 }) {
  if (!R29_POPULATIONS.includes(population) || !(parentGenomes instanceof Map)
    || !Array.isArray(residents) || !Array.isArray(births)
    || !Number.isSafeInteger(rosterSize) || rosterSize < 1) throw new Error("Invalid population assembly inputs");
  if (residents.length + births.length !== rosterSize) {
    throw new Error(`${population} assembly has ${residents.length + births.length} genomes; expected ${rosterSize}`);
  }
  const records = residents.map(resident => {
    const source = parentGenomes.get(resident.sourceId ?? resident.id);
    if (source === undefined) throw new Error(`Missing resident genome: ${resident.id}`);
    return {
      genome: { ...source, id: resident.id, population, ...(resident.name ? { name: resident.name } : {}) },
      provenance: residentProvenance(resident, source)
    };
  });
  for (const birth of births) {
    if (birth?.genome === undefined || birth?.provenance === undefined) throw new Error("Birth lacks genome provenance");
    records.push({ genome: { ...birth.genome, population }, provenance: { ...birth.provenance } });
  }
  const ids = new Set(records.map(record => record.genome.id));
  if (ids.size !== rosterSize) throw new Error(`Duplicate genome ID in ${population} assembly`);
  return records;
}

/** Assemble all seven child populations in canonical order. */
export function assembleGenerationPopulations({ plans, parentGenomes, rosterSize = 49 }) {
  const records = R29_POPULATIONS.flatMap(population => {
    const plan = plans[population];
    if (plan === undefined) throw new Error(`Missing child population plan: ${population}`);
    return assemblePopulation({ population, residents: plan.residents, births: plan.births, parentGenomes, rosterSize });
  });
  const ids = new Set(records.map(record => record.genome.id));
  if (ids.size !== records.length) throw new Error("Child genome ID appears in multiple populations");
  return {
    population: records.map(record => record.genome),
    provenance: Object.fromEntries(records.map(record => [record.genome.id, record.provenance]))
  };
}

/** Advance generation, seed, recruiting rotation, and versioned manifest metadata. */
export function advanceGenerationMetadata(parent) {
  const match = /^ReachR(\d+)$/.exec(parent.generation);
  if (match === null || typeof parent.breedingSeed !== "string" || !/^\d+$/.test(parent.breedingSeed)
    || !R29_POPULATIONS.includes(parent.nextRecruitingPopulation)) {
    throw new Error("Invalid parent generation metadata");
  }
  return {
    generation: `ReachR${Number(match[1]) + 1}`,
    breedingSeed: (BigInt(parent.breedingSeed) + 1n).toString(),
    recruitingPopulation: parent.nextRecruitingPopulation,
    nextRecruitingPopulation: nextRecruitingPopulation(parent.nextRecruitingPopulation),
    engineRulesVersion: parent.engineRulesVersion,
    fitnessFormulaVersion: parent.fitnessFormulaVersion,
    breedingPrngVersion: parent.breedingPrngVersion
  };
}

/** Validate complete child population and provenance invariants. */
export function validateChildGeneration(generation, { rosterSize = 49, locusCount = 112 } = {}) {
  if (!Array.isArray(generation.population) || generation.population.length !== rosterSize * R29_POPULATIONS.length) {
    throw new Error("Child generation has an invalid total population size");
  }
  const ids = new Set();
  const counts = Object.fromEntries(R29_POPULATIONS.map(population => [population, 0]));
  for (const genome of generation.population) {
    if (ids.has(genome.id)) throw new Error(`Duplicate child genome ID: ${genome.id}`);
    ids.add(genome.id);
    if (!Object.hasOwn(counts, genome.population)) throw new Error(`Unknown child population: ${genome.population}`);
    counts[genome.population] += 1;
    if (flattenGenomeLoci(genome).length !== locusCount) throw new Error(`Child ${genome.id} has an invalid locus count`);
    if (generation.provenance?.[genome.id] === undefined) throw new Error(`Child ${genome.id} lacks provenance`);
  }
  if (Object.values(counts).some(count => count !== rosterSize)
    || Object.keys(generation.provenance).length !== generation.population.length) {
    throw new Error("Child generation population or provenance counts are invalid");
  }
  return generation;
}

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort()
    .map(key => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

/** Produce a cross-browser deterministic FNV-1a fingerprint of canonical generation data. */
export function generationFingerprint(generation) {
  const input = new TextEncoder().encode(canonicalize(generation));
  let hash = 0xcbf29ce484222325n;
  for (const byte of input) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}

/** Deterministically breed and assemble one complete next generation. */
export function buildNextGeneration({
  parentMetadata,
  rankings,
  parentGenomes,
  migrants = [],
  interventions = [],
  locusOrder,
  mutationRanges,
  rosterSize = 49,
  survivorSlots = 14,
  wildcardSlots = 5,
  wildcardProbability = 0.5,
  mutationProbability = DEFAULT_ORDINARY_INHERITANCE.mutation
}) {
  if (!Number.isFinite(mutationProbability) || mutationProbability < 0 || mutationProbability > 1) {
    throw new Error("Generation mutation probability must be between 0 and 1");
  }
  const metadata = advanceGenerationMetadata(parentMetadata);
  const random = new SplitMix64(metadata.breedingSeed);
  const ordinaryProbabilities = rescaleMutationProbability(DEFAULT_ORDINARY_INHERITANCE, mutationProbability);
  const selfProbabilities = { parent: 1 - mutationProbability, mutation: mutationProbability };
  const manualEntrants = planManualPopulationInterventions(interventions, parentGenomes);
  const pools = applyMigrationToResidentPools(rankings, [...migrants, ...manualEntrants], survivorSlots);
  validateMigrationResidentPools(pools, survivorSlots);
  const plans = {};
  for (const population of R29_POPULATIONS) {
    const birthCount = rosterSize - survivorSlots;
    const pairs = planParentPairs(pools[population], birthCount, random);
    const ordinaryBirths = pairs.filter(pair => pair.kind === "ordinary").length;
    const decisions = activateWildcardSlots(random, {
      slotCount: Math.min(wildcardSlots, ordinaryBirths),
      probability: wildcardProbability
    });
    const birthPlan = applyWildcardsToBirthPlan(pairs, decisions);
    const births = birthPlan.map((item, index) => {
      const id = `${metadata.generation}_${population}_B${String(index + 1).padStart(2, "0")}`;
      if (item.kind === "wildcard") return generateWildcardGenome({
        id, population, slot: item.wildcardSlot, locusOrder, mutationRanges, random
      });
      const result = breedChild({
        id,
        population,
        father: parentGenomes.get(item.father.id),
        mother: parentGenomes.get(item.mother.id),
        locusOrder,
        mutationRanges,
        random,
        ordinaryProbabilities,
        selfProbabilities
      });
      result.provenance.origin = "cross";
      result.provenance.parentSelection = item.kind;
      return { genome: result.child, provenance: result.provenance };
    });
    plans[population] = { residents: pools[population], births };
  }
  const assembled = assembleGenerationPopulations({ plans, parentGenomes, rosterSize });
  const generation = { ...metadata, ...assembled };
  validateChildGeneration(generation, { rosterSize, locusCount: locusOrder.length });
  return { ...generation, fingerprint: generationFingerprint(generation) };
}

/** Compare a generated R30 fingerprint when the external acceptance fixture is supplied. */
export function verifyR30BreedingFixture(generation, fixture) {
  if (fixture?.schema !== "outmatch-reach-r30-breeding-expected-v1"
    || typeof fixture.fingerprint !== "string") throw new Error("Invalid R30 breeding acceptance fixture");
  const actual = generation.fingerprint ?? generationFingerprint(generation);
  if (actual !== fixture.fingerprint) throw new Error(`R30 breeding fingerprint mismatch: ${actual}`);
  return true;
}
