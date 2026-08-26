import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { runGame } from "../../src/engine/board.js";

const checkpoint = JSON.parse(fs.readFileSync(
  new URL("../../seed/r29/Reach_R29_Complete_Checkpoint.json", import.meta.url)
));
const genomes = new Map(checkpoint.population.map(genome => [genome.id, genome]));
const [header, ...lines] = fs.readFileSync(
  new URL("../../fixtures/r29_golden_games.csv", import.meta.url),
  "utf8"
).trim().split("\n");
const fields = header.split(",");
const goldenGames = lines.map(line => Object.fromEntries(
  line.split(",").map((value, index) => [fields[index], value])
));

function counts(row, prefix) {
  return { P: Number(row[`${prefix}P`]), A: Number(row[`${prefix}A`]), C: Number(row[`${prefix}C`]) };
}

function assertGoldenLedger(row, ledger) {
  assert.equal(ledger.outcome, row.outcome);
  assert.equal(ledger.winner ?? "", row.winner);
  assert.equal(ledger.round, Number(row.round));
  assert.ok(Math.abs(ledger.redScore - Number(row.redScore)) < 1e-12);
  assert.ok(Math.abs(ledger.blueScore - Number(row.blueScore)) < 1e-12);
  assert.deepEqual(ledger.trained.R, counts(row, "red"));
  assert.deepEqual(ledger.trained.B, counts(row, "blue"));
  assert.deepEqual(ledger.pokes, { R: Number(row.redPokes), B: Number(row.bluePokes) });
  assert.deepEqual(ledger.killsByAttacker.R, {
    P: Number(row.redKillByP), A: Number(row.redKillByA), C: Number(row.redKillByC)
  });
  assert.deepEqual(ledger.killsByAttacker.B, {
    P: Number(row.blueKillByP), A: Number(row.blueKillByA), C: Number(row.blueKillByC)
  });
  assert.deepEqual(ledger.victimsByType.R, {
    P: Number(row.redVictimP), A: Number(row.redVictimA), C: Number(row.redVictimC)
  });
  assert.deepEqual(ledger.victimsByType.B, {
    P: Number(row.blueVictimP), A: Number(row.blueVictimA), C: Number(row.blueVictimC)
  });
}

test("first canonical R29 golden game matches every aggregate field", () => {
  const row = goldenGames[0];
  const game = runGame(genomes.get(row.redId), genomes.get(row.blueId));
  assertGoldenLedger(row, game.ledger);
});

