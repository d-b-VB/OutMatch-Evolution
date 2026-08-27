import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  betweenPopulationSimilarity,
  buildSimilarityReport,
  genomeSimilarity,
  locusSimilarity,
  similarityStatistics,
  withinPopulationSimilarity,
  validateSimilarityBaseline
} from "../../src/reports/similarity.js";

const checkpoint = JSON.parse(fs.readFileSync(
  new URL("../../seed/r29/Reach_R29_Complete_Checkpoint.json", import.meta.url)
));
const baseline = JSON.parse(fs.readFileSync(
  new URL("../../seed/genetic_similarity_baseline_r29.json", import.meta.url)
));

test("frozen similarity baseline contains 112 loci aligned with R29 genomes", () => {
  assert.equal(validateSimilarityBaseline(baseline, checkpoint.population[0]), baseline);
});

test("locus similarity clamps at zero and applies the frozen zero-span rule", () => {
  assert.equal(locusSimilarity(2, 2, 0), 1);
  assert.equal(locusSimilarity(2, 3, 0), 0);
  assert.equal(locusSimilarity(2, 3, 4), 0.75);
  assert.equal(locusSimilarity(2, 7, 4), 0);
  assert.throws(() => locusSimilarity(1, 2, -1), /non-negative span/);
});

test("genome similarity is one for self-comparison and symmetric for an R29 pair", () => {
  const [a, b] = checkpoint.population;
  assert.equal(genomeSimilarity(a, a, baseline), 1);
  const ab = genomeSimilarity(a, b, baseline);
  assert.equal(ab, genomeSimilarity(b, a, baseline));
  assert.ok(ab >= 0 && ab <= 1);
});

test("similarity baseline validation rejects misaligned locus order", () => {
  const misaligned = structuredClone(baseline);
  [misaligned.locusOrder[0], misaligned.locusOrder[1]] = [
    misaligned.locusOrder[1], misaligned.locusOrder[0]
  ];
  assert.throws(
    () => validateSimilarityBaseline(misaligned, checkpoint.population[0]),
    /locus order does not match/
  );
});

test("similarity statistics calculate odd and even medians without mutating values", () => {
  const even = [0.8, 0.2, 0.4, 0.6];
  assert.deepEqual(similarityStatistics(even), {
    n_pairs: 4, min: 0.2, median: 0.5, mean: 0.5, max: 0.8
  });
  assert.deepEqual(even, [0.8, 0.2, 0.4, 0.6]);
  assert.equal(similarityStatistics([0.1, 0.9, 0.5]).median, 0.5);
});

test("within and between population comparisons enumerate the required pairs", () => {
  const horseLords = checkpoint.population.filter(genome => genome.population === "horse_lords");
  const pikeLords = checkpoint.population.filter(genome => genome.population === "pike_lords");
  assert.equal(withinPopulationSimilarity(horseLords, baseline).n_pairs, 1176);
  assert.equal(betweenPopulationSimilarity(horseLords, pikeLords, baseline).n_pairs, 2401);
});

test("full R29 similarity report reproduces every frozen comparison", () => {
  const expected = JSON.parse(fs.readFileSync(
    new URL("../../fixtures/r29_genetic_similarity_expected.json", import.meta.url)
  ));
  const actual = buildSimilarityReport(checkpoint, baseline);
  assert.equal(actual.comparisons.length, 28);
  for (let index = 0; index < expected.pairStats.length; index += 1) {
    const expectedComparison = expected.pairStats[index];
    const actualComparison = actual.comparisons[index];
    assert.deepEqual(
      { ...actualComparison, min: 0, median: 0, mean: 0, max: 0 },
      { ...expectedComparison, min: 0, median: 0, mean: 0, max: 0 }
    );
    for (const field of ["min", "median", "mean", "max"]) {
      assert.ok(Math.abs(actualComparison[field] - expectedComparison[field]) < 1e-12);
    }
    assert.equal(actual.matrix[expectedComparison.A][expectedComparison.B], actualComparison.mean);
    assert.equal(actual.matrix[expectedComparison.B][expectedComparison.A], actualComparison.mean);
  }
});

test("R29 pair CSV agrees with the frozen JSON comparison fixture", () => {
  const expected = JSON.parse(fs.readFileSync(
    new URL("../../fixtures/r29_genetic_similarity_expected.json", import.meta.url)
  ));
  const [, ...lines] = fs.readFileSync(
    new URL("../../fixtures/r29_genetic_similarity_pairs.csv", import.meta.url),
    "utf8"
  ).trim().split(/\r?\n/);
  const pairs = lines.map(line => {
    const [type, A, B, nPairs, min, median, mean, max] = line.split(",");
    return {
      type,
      A,
      B,
      n_pairs: Number(nPairs),
      min: Number(min),
      median: Number(median),
      mean: Number(mean),
      max: Number(max)
    };
  });
  assert.deepEqual(pairs, expected.pairStats);
});
