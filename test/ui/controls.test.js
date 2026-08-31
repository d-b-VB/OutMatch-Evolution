import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";
import {
  controlsFromForm,
  DEFAULT_LAB_CONTROLS,
  LAB_CONTROLS_SCHEMA,
  recommendedWorkerCount,
  reviewLabControls,
  validateLabControls
} from "../../src/ui/controls.js";

test("worker recommendation scales with hardware while respecting the safe cap", () => {
  assert.deepEqual([1, 2, 4, 6, 8, 12, 32].map(recommendedWorkerCount), [1, 1, 3, 4, 6, 10, 12]);
});

test("control form values normalize to a versioned deterministic model", () => {
  assert.deepEqual(controlsFromForm({
    workerCount: "8", migrationEnabled: "on", maximumMigrants: "3",
    wildcardProbability: "0.25", mutationProbability: "0.015", interventions: []
  }), {
    schema: LAB_CONTROLS_SCHEMA, workerCount: 8, migrationEnabled: true, maximumMigrants: 3,
    wildcardProbability: 0.25, mutationProbability: 0.015, interventions: []
  });
  assert.equal(validateLabControls({ ...DEFAULT_LAB_CONTROLS, migrationEnabled: false }).maximumMigrants, 0);
});

test("controls reject invalid workers, migration, and probabilities", () => {
  assert.throws(() => validateLabControls({ ...DEFAULT_LAB_CONTROLS, workerCount: 0 }), /Worker count/);
  assert.throws(() => validateLabControls({ ...DEFAULT_LAB_CONTROLS, maximumMigrants: 50 }), /Maximum migrants/);
  assert.throws(() => validateLabControls({ ...DEFAULT_LAB_CONTROLS, wildcardProbability: 1.1 }), /Wildcard/);
  assert.throws(() => validateLabControls({ ...DEFAULT_LAB_CONTROLS, interventions: null }), /Interventions/);
});

test("control review hashes normalized values independent of key order", async () => {
  const first = await reviewLabControls(DEFAULT_LAB_CONTROLS, { subtle: webcrypto.subtle, parentGeneration: "ReachR29" });
  const reordered = {
    interventions: [], mutationProbability: 0.02, wildcardProbability: 0.5,
    maximumMigrants: 7, migrationEnabled: true, workerCount: 4, schema: LAB_CONTROLS_SCHEMA
  };
  const second = await reviewLabControls(reordered, { subtle: webcrypto.subtle, parentGeneration: "ReachR29" });
  assert.equal(first.controlsHash, second.controlsHash);
  assert.equal(first.interventionsHash, second.interventionsHash);
  assert.match(first.controlsHash, /^sha256:[0-9a-f]{64}$/);
  assert.match(first.interventionsHash, /^sha256:[0-9a-f]{64}$/);
});
