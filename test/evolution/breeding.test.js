import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildResidentPool,
  breedChild,
  DEFAULT_ORDINARY_INHERITANCE,
  inheritOrdinaryLocus,
  inheritSelfCrossLocus,
  planGuaranteedFatherEvents,
  planParentPairs,
  rankLotteryWeights,
  reconstructGenomeGenes,
  rescaleMutationProbability,
  selectWeightedParent,
  validateMutationRanges
} from "../../src/evolution/breeding.js";
import { SplitMix64 } from "../../src/evolution/prng.js";

const rankings = Array.from({ length: 20 }, (_, index) => ({ id: `g${index + 1}`, rank: index + 1 }));

test("resident pools account for outgoing and incoming non-breeding entrants", () => {
  const pool = buildResidentPool(rankings, {
    survivorSlots: 5,
    outgoingIds: new Set(["g1"]),
    incoming: [{ id: "migrant", rank: 2, sourcePopulation: "elsewhere" }]
  });
  assert.deepEqual(pool.map(resident => resident.id), ["migrant", "g2", "g3", "g4", "g5"]);
  assert.equal(pool[0].breedingEligible, false);
  assert.ok(pool.slice(1).every(resident => resident.breedingEligible));
});

test("rank lottery weights are normalized and exclude ineligible entrants", () => {
  const residents = buildResidentPool(rankings, { survivorSlots: 4, incoming: [{ id: "entrant" }] });
  const weights = rankLotteryWeights(residents);
  assert.deepEqual(weights.map(entry => entry.resident.id), ["g1", "g2", "g3"]);
  assert.ok(Math.abs(weights.reduce((sum, entry) => sum + entry.weight, 0) - 1) < 1e-15);
  assert.equal(weights.at(-1).cumulative, 1);
  assert.throws(() => rankLotteryWeights([{ id: "a", rank: 1 }, { id: "b", rank: 1 }]), /duplicate breeding rank/);
});

test("weighted parent selection is frozen, repeatable, and isolated from Math.random", () => {
  const weights = rankLotteryWeights(buildResidentPool(rankings, { survivorSlots: 5 }));
  const selectSequence = () => {
    const random = new SplitMix64("202608231656");
    return Array.from({ length: 8 }, () => selectWeightedParent(weights, random).id);
  };
  const originalRandom = Math.random;
  Math.random = () => { throw new Error("Math.random must not be used for breeding"); };
  try {
    assert.deepEqual(selectSequence(), ["g2", "g1", "g4", "g4", "g5", "g4", "g2", "g3"]);
    assert.deepEqual(selectSequence(), selectSequence());
  } finally {
    Math.random = originalRandom;
  }
});

test("guaranteed fathers cover ranks 1-7 once and ranks 1-3 twice", () => {
  const residents = buildResidentPool(rankings, { survivorSlots: 14 });
  assert.deepEqual(planGuaranteedFatherEvents(residents).map(event => event.father.rank), [1, 2, 3, 4, 5, 6, 7, 1, 2, 3]);
  const pairs = planParentPairs(residents, 12, new SplitMix64("17"));
  assert.equal(pairs.filter(pair => pair.kind === "guaranteed_father").length, 10);
  assert.equal(pairs.filter(pair => pair.kind === "ordinary").length, 2);
  assert.ok(pairs.every(pair => pair.father && pair.mother));
});

test("fixed mutation ranges align with all 112 canonical loci", () => {
  const document = JSON.parse(readFileSync("seed/mutation_ranges.json", "utf8"));
  const baseline = JSON.parse(readFileSync("seed/genetic_similarity_baseline_r29.json", "utf8"));
  const ranges = validateMutationRanges(document, baseline.locusOrder);
  assert.equal(ranges.size, 112);
  assert.deepEqual(ranges.get("action.center"), {
    minimum: -42.859641988903164,
    maximum: 64.17337012457267
  });
  assert.throws(() => validateMutationRanges(document, baseline.locusOrder.slice(1)), /schema or locus count/);
});

function queuedRandom(floatDraws, rangeValue = 7) {
  return { nextFloat: () => floatDraws.shift(), nextRange: () => rangeValue };
}

test("ordinary one-locus inheritance supports all five default modes", () => {
  const range = { minimum: -10, maximum: 10 };
  assert.deepEqual(inheritOrdinaryLocus(2, 6, range, queuedRandom([0.1])), { value: 2, mode: "father" });
  assert.deepEqual(inheritOrdinaryLocus(2, 6, range, queuedRandom([0.5])), { value: 6, mode: "mother" });
  assert.deepEqual(inheritOrdinaryLocus(2, 6, range, queuedRandom([0.85])), { value: 4, mode: "mean" });
  assert.deepEqual(inheritOrdinaryLocus(2, 6, range, queuedRandom([0.92], 3)), { value: 3, mode: "between" });
  assert.deepEqual(inheritOrdinaryLocus(2, 6, range, queuedRandom([0.99], -8)), { value: -8, mode: "mutation" });
});

test("self-cross inheritance is exact or mutates within the fixed range", () => {
  const range = { minimum: -10, maximum: 10 };
  assert.deepEqual(inheritSelfCrossLocus(2, range, queuedRandom([0.94])), { value: 2, mode: "parent" });
  assert.deepEqual(inheritSelfCrossLocus(2, range, queuedRandom([0.95], -4)), { value: -4, mode: "mutation" });
});

test("inheritance probabilities validate and mutation rescaling preserves ratios", () => {
  const doubledMutation = rescaleMutationProbability(DEFAULT_ORDINARY_INHERITANCE, 0.1);
  assert.equal(doubledMutation.mutation, 0.1);
  assert.ok(Math.abs(doubledMutation.father / doubledMutation.mean - 4) < 1e-15);
  assert.ok(Math.abs(Object.values(doubledMutation).reduce((sum, value) => sum + value, 0) - 1) < 1e-15);
  assert.deepEqual(rescaleMutationProbability(DEFAULT_ORDINARY_INHERITANCE, 1), {
    father: 0, mother: 0, mean: 0, between: 0, mutation: 1
  });
  assert.throws(() => rescaleMutationProbability({ ...DEFAULT_ORDINARY_INHERITANCE, father: -1 }, 0.1), /nonnegative/);
});

test("ordered loci reconstruct an independent nested genome", () => {
  const genes = reconstructGenomeGenes([["action.center", 2], ["action.hold", 3], ["search.breadth", 4]]);
  assert.deepEqual(genes, { action: { center: 2, hold: 3 }, search: { breadth: 4 } });
  assert.throws(() => reconstructGenomeGenes([["action", 2], ["action.center", 3]]), /Conflicting/);
});

test("whole-child ordinary and self crosses have frozen 112-locus vectors", () => {
  const checkpoint = JSON.parse(readFileSync("seed/r29/Reach_R29_Complete_Checkpoint.json", "utf8"));
  const baseline = JSON.parse(readFileSync("seed/genetic_similarity_baseline_r29.json", "utf8"));
  const rangeDocument = JSON.parse(readFileSync("seed/mutation_ranges.json", "utf8"));
  const mutationRanges = validateMutationRanges(rangeDocument, baseline.locusOrder);
  const hashChild = result => createHash("sha256").update(JSON.stringify(result.child.genes)).digest("hex");
  const ordinary = breedChild({
    id: "ordinary", population: "horse_lords", father: checkpoint.population[0], mother: checkpoint.population[1],
    locusOrder: baseline.locusOrder, mutationRanges, random: new SplitMix64("202608231656")
  });
  const self = breedChild({
    id: "self", population: "horse_lords", father: checkpoint.population[0], mother: checkpoint.population[0],
    locusOrder: baseline.locusOrder, mutationRanges, random: new SplitMix64("202608231656")
  });
  assert.equal(Object.values(ordinary.provenance.modeCounts).reduce((sum, count) => sum + count, 0), 112);
  assert.equal(Object.values(self.provenance.modeCounts).reduce((sum, count) => sum + count, 0), 112);
  assert.equal(hashChild(ordinary), "b480f5679faa36a0b841a4bc750450425f1c223f8776e0eb50d1b4227d697ae2");
  assert.equal(hashChild(self), "db0a554a5e48335994779ebe337f45a723315ca2428f0b7efe6687119df1655d");
});
