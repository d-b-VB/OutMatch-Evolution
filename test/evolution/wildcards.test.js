import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { flattenGenomeLoci } from "../../src/baseline/checkpoint.js";
import { validateMutationRanges } from "../../src/evolution/breeding.js";
import { nextRecruitingPopulation } from "../../src/evolution/migration.js";
import { SplitMix64 } from "../../src/evolution/prng.js";
import {
  activateWildcardSlots,
  applyWildcardsToBirthPlan,
  generateWildcardGenome
} from "../../src/evolution/wildcards.js";

test("five independent wildcard slots have frozen activation decisions", () => {
  const decisions = activateWildcardSlots(new SplitMix64("202608231656"));
  assert.deepEqual(decisions, [
    { slot: 0, active: false }, { slot: 1, active: true }, { slot: 2, active: false },
    { slot: 3, active: false }, { slot: 4, active: false }
  ]);
  assert.ok(activateWildcardSlots(new SplitMix64("1"), { slotCount: 4, probability: 0 }).every(item => !item.active));
  assert.ok(activateWildcardSlots(new SplitMix64("1"), { slotCount: 4, probability: 1 }).every(item => item.active));
});

test("wildcard genomes draw all 112 loci within fixed expanded ranges", () => {
  const baseline = JSON.parse(readFileSync("seed/genetic_similarity_baseline_r29.json", "utf8"));
  const ranges = validateMutationRanges(
    JSON.parse(readFileSync("seed/mutation_ranges.json", "utf8")),
    baseline.locusOrder
  );
  const result = generateWildcardGenome({
    id: "wildcard-0", population: "horse_lords", slot: 0,
    locusOrder: baseline.locusOrder, mutationRanges: ranges, random: new SplitMix64("202608231656")
  });
  const hash = createHash("sha256").update(JSON.stringify(result.genome.genes)).digest("hex");
  assert.equal(hash, "a5a955350b962ba40281634d8e8955338d5fbb29aff687672ae78537383c4dec");
  for (const [path, value] of flattenGenomeLoci(result.genome)) {
    assert.ok(value >= ranges.get(path).minimum && value < ranges.get(path).maximum);
  }
  assert.deepEqual(result.provenance, { origin: "wildcard", wildcardSlot: 0 });
});

test("active wildcards replace only ordinary lottery births", () => {
  const plan = [
    { kind: "guaranteed_father", father: "a" },
    { kind: "ordinary", father: "b" },
    { kind: "ordinary", father: "c" }
  ];
  const result = applyWildcardsToBirthPlan(plan, [{ slot: 0, active: true }, { slot: 1, active: false }]);
  assert.equal(result[0], plan[0]);
  assert.deepEqual(result[1], { kind: "wildcard", wildcardSlot: 0 });
  assert.equal(result[2], plan[2]);
  assert.throws(() => applyWildcardsToBirthPlan(plan, [
    { slot: 0, active: true }, { slot: 1, active: true }, { slot: 2, active: true }
  ]), /exceed ordinary/);
});

test("recruiting population rotates canonically and wraps after Generalists", () => {
  assert.equal(nextRecruitingPopulation("archer_lords"), "horse_hunters");
  assert.equal(nextRecruitingPopulation("generalists"), "horse_lords");
  assert.throws(() => nextRecruitingPopulation("unknown"), /Unknown recruiting population/);
});
