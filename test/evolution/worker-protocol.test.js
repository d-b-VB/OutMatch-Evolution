import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createScheduledGame } from "../../src/evolution/schedule.js";
import {
  createGameRequest,
  handleGameRequest,
  validateGameRequest,
  validateGameResult,
  WORKER_PROTOCOL_VERSION
} from "../../src/evolution/worker-protocol.js";

const checkpoint = JSON.parse(readFileSync("seed/r29/Reach_R29_Complete_Checkpoint.json", "utf8"));
const [redGenome, blueGenome] = checkpoint.population;
const game = createScheduledGame({ stage: "stage1_core", scheduleIndex: 7, redId: redGenome.id, blueId: blueGenome.id });

test("worker requests validate protocol, schedule, genomes, and engine options", () => {
  const request = createGameRequest({ jobId: "job-7", game, redGenome, blueGenome, engineOptions: { depth: 1 } });
  assert.equal(request.protocol, WORKER_PROTOCOL_VERSION);
  assert.equal(validateGameRequest(request).game.scheduleIndex, 7);
  assert.throws(() => validateGameRequest({ ...request, protocol: "future" }), /Unsupported/);
  assert.throws(() => createGameRequest({ jobId: "job", game, redGenome: blueGenome, blueGenome }), /Red worker genome/);
});

test("single-game handler returns a canonical, request-correlated ledger result", () => {
  const request = createGameRequest({ jobId: "job-7", game, redGenome, blueGenome, engineOptions: { depth: 1 } });
  const result = handleGameRequest(request);
  assert.equal(result.scheduleIndex, 7);
  assert.equal(result.ledgerRow.redId, redGenome.id);
  assert.equal(result.ledgerRow.blueId, blueGenome.id);
  assert.equal(result.ledgerRow.stage, "stage1_core");
  assert.equal(typeof result.ledgerRow.redP, "number");
  assert.equal(validateGameResult(result, request), result);
  assert.throws(() => validateGameResult({ ...result, jobId: "wrong" }, request), /does not match/);
});
