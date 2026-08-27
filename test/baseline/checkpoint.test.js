import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  flattenGenomeLoci,
  indexR29Population,
  R29_POPULATIONS,
  validateR29Checkpoint
} from "../../src/baseline/checkpoint.js";

const checkpoint = JSON.parse(fs.readFileSync(
  new URL("../../seed/r29/Reach_R29_Complete_Checkpoint.json", import.meta.url)
));

test("R29 checkpoint indexes all genomes and their populations", () => {
  const { genomes, populationByGenome } = indexR29Population(checkpoint);
  assert.equal(genomes.size, 343);
  assert.equal(populationByGenome.size, 343);
  const first = checkpoint.population[0];
  assert.equal(genomes.get(first.id), first);
  assert.equal(populationByGenome.get(first.id), first.population);
});

test("R29 genome flattening returns 112 finite loci in stable name order", () => {
  const genome = checkpoint.population[0];
  const loci = flattenGenomeLoci(genome);
  assert.equal(loci.length, 112);
  assert.ok(loci.every(([, value]) => Number.isFinite(value)));
  assert.deepEqual(loci.map(([name]) => name), loci.map(([name]) => name).toSorted());
});

test("supplied R29 checkpoint satisfies transfer-boundary population invariants", () => {
  const result = validateR29Checkpoint(checkpoint);
  assert.deepEqual(result.counts, Object.fromEntries(R29_POPULATIONS.map(population => [population, 49])));
});

test("R29 checkpoint validation rejects duplicate IDs and malformed loci", () => {
  const duplicate = structuredClone(checkpoint);
  duplicate.population[1].id = duplicate.population[0].id;
  assert.throws(() => validateR29Checkpoint(duplicate), /Duplicate R29 genome ID/);

  const malformed = structuredClone(checkpoint);
  malformed.population[0].genes.action.center = "not numeric";
  assert.throws(() => validateR29Checkpoint(malformed), /non-numeric locus action.center/);
});
