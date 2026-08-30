import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { R29_POPULATIONS } from "../../src/baseline/checkpoint.js";
import {
  advanceGenerationMetadata,
  assembleGenerationPopulations,
  assemblePopulation,
  buildNextGeneration,
  generationFingerprint,
  validateChildGeneration,
  verifyR30BreedingFixture
} from "../../src/evolution/generation.js";
import { validateMutationRanges } from "../../src/evolution/breeding.js";

const parentGenomes = new Map(R29_POPULATIONS.flatMap(population => [1, 2].map(number => {
  const genome = { id: `${population}-${number}`, population, genes: { value: number } };
  return [genome.id, genome];
})));

function plan(population) {
  return {
    residents: [
      { id: `${population}-1`, rank: 1, origin: "native_survivor", breedingEligible: true },
      { id: `${population}-2`, rank: 2, origin: "native_survivor", breedingEligible: true }
    ],
    births: [{
      genome: { id: `${population}-child`, population, genes: { value: 3 } },
      provenance: { origin: "cross", fatherId: `${population}-1`, motherId: `${population}-2` }
    }]
  };
}

test("one population combines residents and births at an exact roster size", () => {
  const records = assemblePopulation({
    population: "horse_lords", ...plan("horse_lords"), parentGenomes, rosterSize: 3
  });
  assert.deepEqual(records.map(record => record.genome.id), ["horse_lords-1", "horse_lords-2", "horse_lords-child"]);
  assert.deepEqual(records[0].provenance, { origin: "survivor", sourceId: "horse_lords-1", breedingEligible: true });
  assert.equal(records[2].provenance.fatherId, "horse_lords-1");
});

test("all seven populations assemble in canonical order with indexed provenance", () => {
  const plans = Object.fromEntries(R29_POPULATIONS.map(population => [population, plan(population)]));
  const generation = assembleGenerationPopulations({ plans, parentGenomes, rosterSize: 3 });
  assert.equal(generation.population.length, 21);
  assert.equal(new Set(generation.population.map(genome => genome.id)).size, 21);
  assert.deepEqual(generation.population.map(genome => genome.population), R29_POPULATIONS.flatMap(population =>
    Array.from({ length: 3 }, () => population)));
  assert.equal(Object.keys(generation.provenance).length, 21);
  assert.equal(generation.provenance["generalists-child"].origin, "cross");
});

test("migrant provenance records source, destination, and insertion-cycle restriction", () => {
  const records = assemblePopulation({
    population: "horse_lords",
    residents: [{
      id: "generalists-1", origin: "automatic_migrant", sourcePopulation: "generalists",
      destinationPopulation: "horse_lords", breedingEligible: false
    }],
    births: [], parentGenomes, rosterSize: 1
  });
  assert.deepEqual(records[0].provenance, {
    origin: "automatic_migrant", sourceId: "generalists-1", sourcePopulation: "generalists",
    destinationPopulation: "horse_lords", breedingEligible: false
  });
  assert.equal(records[0].genome.population, "horse_lords");
});

test("manual copies clone their source genome under an audited identity", () => {
  const records = assemblePopulation({
    population: "pike_hunters",
    residents: [{
      id: "copied-general", sourceId: "generalists-1", name: "Copied General", origin: "manual_copy",
      sourcePopulation: "generalists", destinationPopulation: "pike_hunters", breedingEligible: false
    }],
    births: [], parentGenomes, rosterSize: 1
  });
  assert.deepEqual(records[0].genome, {
    ...parentGenomes.get("generalists-1"), id: "copied-general", name: "Copied General", population: "pike_hunters"
  });
  assert.deepEqual(records[0].provenance, {
    origin: "manual_copy", sourceId: "generalists-1", breedingEligible: false
  });
});

test("manual replacements assemble the uploaded genome with non-breeding provenance", () => {
  const genome = { id: "uploaded", name: "Uploaded", population: "pike_hunters", genes: { value: 42 } };
  const records = assemblePopulation({
    population: "pike_hunters", residents: [{
      id: genome.id, sourceId: genome.id, replacesId: "pike_hunters-1", genome,
      origin: "manual_replacement", breedingEligible: false
    }], births: [], parentGenomes, rosterSize: 1
  });
  assert.deepEqual(records[0].genome, genome);
  assert.deepEqual(records[0].provenance, {
    origin: "manual_replacement", sourceId: "uploaded", replacedId: "pike_hunters-1", breedingEligible: false
  });
});

test("generation metadata advances R29 to deterministic R30 values", () => {
  assert.deepEqual(advanceGenerationMetadata({
    generation: "ReachR29", breedingSeed: "202608231655", nextRecruitingPopulation: "horse_hunters",
    engineRulesVersion: "reach-v1", fitnessFormulaVersion: "reach-fitness-v1", breedingPrngVersion: "splitmix64-v1"
  }), {
    generation: "ReachR30", breedingSeed: "202608231656", recruitingPopulation: "horse_hunters",
    nextRecruitingPopulation: "pike_hunters", engineRulesVersion: "reach-v1",
    fitnessFormulaVersion: "reach-fitness-v1", breedingPrngVersion: "splitmix64-v1"
  });
});

test("child validation checks population, locus, ID, and provenance invariants", () => {
  const genes = Object.fromEntries(Array.from({ length: 4 }, (_, index) => [`l${index}`, index]));
  const population = R29_POPULATIONS.flatMap(populationName => [1, 2].map(number => ({
    id: `${populationName}-${number}`, population: populationName, genes
  })));
  const generation = { population, provenance: Object.fromEntries(population.map(genome => [genome.id, { origin: "test" }])) };
  assert.equal(validateChildGeneration(generation, { rosterSize: 2, locusCount: 4 }), generation);
  delete generation.provenance[population[0].id];
  assert.throws(() => validateChildGeneration(generation, { rosterSize: 2, locusCount: 4 }), /lacks provenance/);
});

test("canonical generation fingerprints ignore object key insertion order", () => {
  assert.equal(generationFingerprint({ b: 2, a: { d: 4, c: 3 } }),
    generationFingerprint({ a: { c: 3, d: 4 }, b: 2 }));
  assert.notEqual(generationFingerprint({ value: 1 }), generationFingerprint({ value: 2 }));
});

test("reduced end-to-end evolution is repeatable across equivalent tournament outputs", () => {
  const checkpoint = JSON.parse(readFileSync("seed/r29/Reach_R29_Complete_Checkpoint.json", "utf8"));
  const baseline = JSON.parse(readFileSync("seed/genetic_similarity_baseline_r29.json", "utf8"));
  const mutationRanges = validateMutationRanges(JSON.parse(readFileSync("seed/mutation_ranges.json", "utf8")), baseline.locusOrder);
  const selected = R29_POPULATIONS.flatMap(population => checkpoint.population.filter(genome => genome.population === population).slice(0, 3));
  const indexed = new Map(selected.map(genome => [genome.id, genome]));
  const rankings = Object.fromEntries(R29_POPULATIONS.map(population => [population,
    selected.filter(genome => genome.population === population).map((genome, index) => ({ id: genome.id, rank: index + 1 }))]));
  const options = {
    parentMetadata: {
      generation: "ReachR29", breedingSeed: "202608231655", nextRecruitingPopulation: "horse_hunters",
      engineRulesVersion: "reach-v1", fitnessFormulaVersion: "reach-fitness-v1", breedingPrngVersion: "splitmix64-v1"
    },
    rankings,
    parentGenomes: indexed,
    migrants: [{
      id: rankings.generalists[0].id,
      currentPopulation: "generalists",
      destinationPopulation: "horse_lords",
      destinationRank: 1
    }],
    locusOrder: baseline.locusOrder, mutationRanges,
    rosterSize: 8, survivorSlots: 2, wildcardSlots: 1, wildcardProbability: 0.5
  };
  const oneWorkerEquivalent = buildNextGeneration(options);
  const fourWorkerEquivalent = buildNextGeneration({ ...options, rankings: structuredClone(rankings) });
  assert.equal(oneWorkerEquivalent.population.length, 56);
  assert.equal(oneWorkerEquivalent.fingerprint, fourWorkerEquivalent.fingerprint);
  assert.equal(oneWorkerEquivalent.fingerprint, "fnv1a64:9fc24b80d02cef0f");
});

test("R30 fixture verifier is ready but rejects missing external acceptance data", () => {
  assert.throws(() => verifyR30BreedingFixture({ fingerprint: "value" }, null), /Invalid R30 breeding acceptance fixture/);
  assert.equal(verifyR30BreedingFixture({ fingerprint: "value" }, {
    schema: "outmatch-reach-r30-breeding-expected-v1", fingerprint: "value"
  }), true);
});

test("default-size generation assembly produces 343 validated deterministic genomes", () => {
  const checkpoint = JSON.parse(readFileSync("seed/r29/Reach_R29_Complete_Checkpoint.json", "utf8"));
  const baseline = JSON.parse(readFileSync("seed/genetic_similarity_baseline_r29.json", "utf8"));
  const mutationRanges = validateMutationRanges(JSON.parse(readFileSync("seed/mutation_ranges.json", "utf8")), baseline.locusOrder);
  const fixtureText = execFileSync("unzip", ["-p", "OutMatch_Reach_Codex_Bootstrap.zip",
    "OutMatch_Reach_Codex_Bootstrap/fixtures/r29_fitness_formula_verification.json"], { encoding: "utf8" });
  const fixture = JSON.parse(fixtureText);
  const rankings = Object.fromEntries(R29_POPULATIONS.map(population => [population,
    fixture.rows.filter(row => row.population === population).map((row, index) => ({ id: row.id, rank: index + 1 }))]));
  const parentGenomes = new Map(checkpoint.population.map(genome => [genome.id, genome]));
  const options = {
    parentMetadata: {
      generation: "ReachR29", breedingSeed: "202608231655", nextRecruitingPopulation: "horse_hunters",
      engineRulesVersion: "reach-v1", fitnessFormulaVersion: "reach-fitness-v1", breedingPrngVersion: "splitmix64-v1"
    },
    rankings,
    parentGenomes,
    locusOrder: baseline.locusOrder,
    mutationRanges
  };
  const first = buildNextGeneration(options);
  const second = buildNextGeneration(options);
  assert.equal(first.population.length, 343);
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(first.fingerprint, "fnv1a64:dcc14f93d7c7ce2e");
  assert.equal(validateChildGeneration(first), first);
});

test("generation mutation control rescales ordinary and self-cross births deterministically", () => {
  const checkpoint = JSON.parse(readFileSync("seed/r29/Reach_R29_Complete_Checkpoint.json", "utf8"));
  const baseline = JSON.parse(readFileSync("seed/genetic_similarity_baseline_r29.json", "utf8"));
  const mutationRanges = validateMutationRanges(JSON.parse(readFileSync("seed/mutation_ranges.json", "utf8")), baseline.locusOrder);
  const selected = R29_POPULATIONS.flatMap(population => checkpoint.population.filter(genome => genome.population === population).slice(0, 3));
  const rankings = Object.fromEntries(R29_POPULATIONS.map(population => [population,
    selected.filter(genome => genome.population === population).map((genome, index) => ({ id: genome.id, rank: index + 1 }))]));
  const options = {
    parentMetadata: {
      generation: "ReachR29", breedingSeed: "202608231655", nextRecruitingPopulation: "horse_hunters",
      engineRulesVersion: "reach-v1", fitnessFormulaVersion: "reach-fitness-v1", breedingPrngVersion: "splitmix64-v1"
    },
    rankings, parentGenomes: new Map(selected.map(genome => [genome.id, genome])),
    locusOrder: baseline.locusOrder, mutationRanges, rosterSize: 8, survivorSlots: 2,
    wildcardSlots: 0, mutationProbability: 0.02
  };
  const first = buildNextGeneration(options);
  const second = buildNextGeneration(options);
  const defaultMutation = buildNextGeneration({ ...options, mutationProbability: 0.05 });
  assert.equal(first.fingerprint, second.fingerprint);
  assert.notEqual(first.fingerprint, defaultMutation.fingerprint);
  assert.throws(() => buildNextGeneration({ ...options, mutationProbability: 1.1 }), /between 0 and 1/);
});
