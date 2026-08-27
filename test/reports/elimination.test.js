import test from "node:test";
import assert from "node:assert/strict";
import { buildEliminationMatrix } from "../../src/reports/elimination.js";

const populations = ["lords", "hunters"];
const populationByGenome = new Map([
  ["lord-1", "lords"],
  ["hunter-1", "hunters"]
]);

test("elimination matrix is directional, color-independent, and keeps draws in the denominator", () => {
  const rows = [
    { redId: "lord-1", blueId: "hunter-1", outcome: "elimination", winner: "R" },
    { redId: "hunter-1", blueId: "lord-1", outcome: "elimination", winner: "R" },
    { redId: "lord-1", blueId: "hunter-1", outcome: "draw", winner: "" }
  ];

  const report = buildEliminationMatrix(rows, populationByGenome, populations);

  assert.deepEqual(report.matrix, {
    lords: { lords: null, hunters: 1 / 3 },
    hunters: { lords: 1 / 3, hunters: null }
  });
  assert.deepEqual(report.counts, [
    { rowPopulation: "lords", colPopulation: "hunters", games: 3, rowEliminations: 1, rate: 1 / 3 },
    { rowPopulation: "hunters", colPopulation: "lords", games: 3, rowEliminations: 1, rate: 1 / 3 }
  ]);
});

test("elimination matrix rejects ledger genomes without a population", () => {
  assert.throws(
    () => buildEliminationMatrix([
      { redId: "lord-1", blueId: "missing", outcome: "draw", winner: "" }
    ], populationByGenome, populations),
    /Unknown genome in ledger row/
  );
});

test("elimination matrix rejects inconsistent outcomes and winners", () => {
  for (const row of [
    { redId: "lord-1", blueId: "hunter-1", outcome: "elimination", winner: "" },
    { redId: "lord-1", blueId: "hunter-1", outcome: "draw", winner: "R" },
    { redId: "lord-1", blueId: "hunter-1", outcome: "timeout", winner: "" }
  ]) {
    assert.throws(
      () => buildEliminationMatrix([row], populationByGenome, populations),
      /Invalid ledger result/
    );
  }
});

test("elimination matrix rejects within-population ecology games", () => {
  assert.throws(
    () => buildEliminationMatrix([
      { redId: "lord-1", blueId: "lord-2", outcome: "draw", winner: "" }
    ], new Map([...populationByGenome, ["lord-2", "lords"]]), populations),
    /Within-population ecology game/
  );
});
