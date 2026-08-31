import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runGame as runReferenceGame } from "../../src/engine/board.js";
import { runGame as runFastGame } from "../../src/engine/fast-board.js";

const checkpoint = JSON.parse(readFileSync("seed/r29/Reach_R29_Complete_Checkpoint.json", "utf8"));

function compare(redIndex, blueIndex, depth, captureReplay = false) {
  const options = { depth, captureReplay };
  assert.deepEqual(runFastGame(checkpoint.population[redIndex], checkpoint.population[blueIndex], options),
    runReferenceGame(checkpoint.population[redIndex], checkpoint.population[blueIndex], options));
}

test("experimental fast engine exactly matches reference across colors and search depths", () => {
  for (let index = 0; index < 12; index += 1) {
    compare(index, 100 + index, 1);
    compare(100 + index, index, 1);
  }
  for (let index = 0; index < 3; index += 1) compare(20 + index, 180 + index, 2);
  compare(0, 100, 3, true);
});
