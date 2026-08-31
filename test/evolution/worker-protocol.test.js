import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createScheduledGame } from "../../src/evolution/schedule.js";
import {
  createGenerationInitialization,
  createGameRequest,
  createInitializedGameRequest,
  handleInitializedGameRequest,
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

test("initialized worker jobs contain IDs only and resolve immutable generation genomes", () => {
  const context = {};
  const initialization = createGenerationInitialization({ genomes: [redGenome, blueGenome], engineOptions: { depth: 1 } });
  handleInitializedGameRequest(initialization, context);
  const request = createInitializedGameRequest({ jobId: "initialized-7", game });
  assert.equal(request.redGenome, undefined);
  assert.equal(request.blueGenome, undefined);
  const calls = [];
  const result = handleInitializedGameRequest(request, context, (red, blue, options) => {
    calls.push([red.id, blue.id, options.depth]);
    return { ledger: { outcome: "draw", winner: "", round: 20, redScore: 0, blueScore: 0,
      trained: { R: { P: 0, A: 0, C: 0 }, B: { P: 0, A: 0, C: 0 } }, pokes: { R: 0, B: 0 },
      killsByAttacker: { R: { P: 0, A: 0, C: 0 }, B: { P: 0, A: 0, C: 0 } },
      victimsByType: { R: { P: 0, A: 0, C: 0 }, B: { P: 0, A: 0, C: 0 } }, engineRulesVersion: "reach-v1" } };
  });
  assert.deepEqual(calls, [[redGenome.id, blueGenome.id, 1]]);
  assert.equal(validateGameResult(result, request), result);
  assert.throws(() => handleInitializedGameRequest(createInitializedGameRequest({
    jobId: "unknown", game: { ...game, redId: "missing" }
  }), context), /Unknown initialized genome/);
});
