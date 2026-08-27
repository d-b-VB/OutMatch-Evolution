import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseR29Ledger, summarizeR29Ledger } from "../../src/baseline/ledger.js";

const header = "gameIndex,stage,redId,outcome,blueId,winner,round,redScore";

test("R29 ledger parser preserves categorical fields and converts numeric fields", () => {
  const [row] = parseR29Ledger([
    header,
    "0,stage1_core,RED,elimination,BLUE,B,17,-0.0789473684210526"
  ].join("\r\n"));

  assert.deepEqual(row, {
    gameIndex: 0,
    stage: "stage1_core",
    redId: "RED",
    outcome: "elimination",
    blueId: "BLUE",
    winner: "B",
    round: 17,
    redScore: -0.0789473684210526
  });
});

test("R29 ledger parser preserves an empty winner for a draw", () => {
  const [row] = parseR29Ledger(`${header}\n1,stage2_elite,RED,draw,BLUE,,20,0.5`);
  assert.equal(row.winner, "");
});

test("R29 ledger parser rejects malformed rows and numeric values", () => {
  assert.throws(() => parseR29Ledger(`${header}\n0,stage1_core,RED,draw`), /has 4 fields/);
  assert.throws(
    () => parseR29Ledger(`${header}\nnope,stage1_core,RED,draw,BLUE,,20,0.5`),
    /invalid numeric gameIndex/
  );
});

test("R29 ledger parser reads every supplied golden ledger row", () => {
  const csv = fs.readFileSync(
    new URL("../../fixtures/r29_golden_games.csv", import.meta.url),
    "utf8"
  );
  const rows = parseR29Ledger(csv);
  assert.equal(rows.length, 107);
  assert.equal(rows[0].gameIndex, 0);
  assert.equal(typeof rows[0].redKillByP, "number");
});

test("R29 ledger summary counts every supplied golden row by tournament stage", () => {
  const csv = fs.readFileSync(
    new URL("../../fixtures/r29_golden_games.csv", import.meta.url),
    "utf8"
  );
  assert.deepEqual(summarizeR29Ledger(parseR29Ledger(csv)), {
    totalGames: 107,
    stages: { stage1_core: 62, stage2_elite: 25, challenger: 20 }
  });
});

test("R29 ledger summary rejects an unknown tournament stage", () => {
  assert.throws(() => summarizeR29Ledger([{ stage: "exhibition" }]), /unknown stage exhibition/);
});
