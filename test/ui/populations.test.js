import assert from "node:assert/strict";
import test from "node:test";
import { R29_POPULATIONS } from "../../src/baseline/checkpoint.js";
import { buildPopulationView, interventionForGeneral } from "../../src/ui/populations.js";

function completeGeneration() {
  const population = R29_POPULATIONS.flatMap((name, populationIndex) => Array.from({ length: 49 }, (_, index) => ({
    id: `${name}-${String(index + 1).padStart(2, "0")}`,
    name: index === 0 ? `<${name}>` : `${name} ${index + 1}`,
    population: name,
    genes: { score: populationIndex * 100 + index }
  })));
  return {
    checkpoint: {
      population,
      provenance: Object.fromEntries(population.map((genome, index) => [genome.id, {
        origin: index % 2 ? "cross" : "survivor", sourceId: `source-${index}`
      }]))
    },
    rankings: population.map((genome, index) => ({
      id: genome.id, rank: (index % 49) + 1, fitness: 1000 - index,
      training: index, kills: index / 2, pokes: index / 3
    }))
  };
}

test("complete generation summaries contain seven populations of 49", () => {
  const view = buildPopulationView(completeGeneration());
  assert.equal(view.rows.length, 343);
  assert.deepEqual(view.summaries.map(summary => summary.count), [49, 49, 49, 49, 49, 49, 49]);
});

test("population filtering and every supported sort leave archived data untouched", () => {
  const generation = completeGeneration();
  const snapshot = structuredClone(generation);
  for (const sort of ["rank", "id", "name", "origin", "fitness", "training", "kills", "pokes", "parentage"]) {
    const view = buildPopulationView(generation, {
      population: "pike_lords", query: "survivor", sort, direction: "desc"
    });
    assert.ok(view.rows.length > 0);
    assert.ok(view.rows.every(row => row.population === "pike_lords" && row.origin === "survivor"));
  }
  assert.deepEqual(generation, snapshot);
});

test("detail returns independent genome and provenance objects", () => {
  const generation = completeGeneration();
  const id = generation.checkpoint.population[0].id;
  const view = buildPopulationView(generation, { selectedId: id });
  view.detail.genome.genes.score = -1;
  view.detail.provenance.origin = "changed";
  view.detail.fitness.fitness = -1;
  assert.notEqual(generation.checkpoint.population[0].genes.score, -1);
  assert.notEqual(generation.checkpoint.provenance[id].origin, "changed");
  assert.notEqual(generation.rankings[0].fitness, -1);
});

test("selected-general interventions retain the audited validator", () => {
  assert.deepEqual(interventionForGeneral(
    { id: "PL-01", population: "pike_lords" }, "generalists", "Broaden the ecology"
  ), {
    type: "manual-move", generalId: "PL-01", from: "pike_lords",
    to: "generalists", note: "Broaden the ecology"
  });
  assert.throws(() => interventionForGeneral(
    { id: "PL-01", population: "pike_lords" }, "pike_lords", "No move"
  ), /must change populations/);
});
