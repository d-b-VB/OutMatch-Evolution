import assert from "node:assert/strict";
import test from "node:test";
import { ResumableExecutionError } from "../../src/persistence/executor.js";
import { createRunOperation, runControlState, RunOperationController } from "../../src/ui/run-operation.js";

const base = { run: {}, generation: {}, reviewed: {}, progress: null };

test("button states cover idle, running, pause-requested, paused, finalizing, and failed", () => {
  const idle = runControlState({ ...base, operation: createRunOperation() });
  assert.deepEqual(idle, {
    runNextDisabled: false, runManyDisabled: false, pauseDisabled: true, resumeDisabled: true,
    stopDisabled: true, countDisabled: false, active: false, paused: false
  });
  for (const status of ["running", "pause_requested", "finalizing"]) {
    const state = runControlState({ ...base, operation: createRunOperation({ status }) });
    assert.equal(state.runNextDisabled, true, status);
    assert.equal(state.stopDisabled, false, status);
    assert.equal(state.pauseDisabled, status !== "running", status);
  }
  const paused = runControlState({ ...base, progress: {}, operation: createRunOperation({ status: "paused" }) });
  assert.equal(paused.resumeDisabled, false);
  assert.equal(paused.runNextDisabled, true);
  const failed = runControlState({ ...base, progress: {}, operation: createRunOperation({ status: "failed" }) });
  assert.equal(failed.resumeDisabled, false);
});

test("start remains disabled without selection, review, storage checkpoint freedom", () => {
  for (const values of [
    { ...base, run: null }, { ...base, generation: null }, { ...base, reviewed: null }, { ...base, progress: {} }
  ]) assert.equal(runControlState({ ...values, operation: createRunOperation() }).runNextDisabled, true);
});

test("controller exposes pause and stop requests and publishes only durable results", async () => {
  const calls = [];
  const changes = [];
  const durable = [];
  const service = {
    requestPause: () => calls.push("pause"),
    stopAfterGeneration: () => calls.push("stop"),
    start: async () => ({ status: "paused", checkpoint: { cursor: 3 } }),
    resume: async () => ({ status: "complete" })
  };
  const controller = new RunOperationController({
    service, onChange: value => changes.push(value), onDurableProgress: value => durable.push(value)
  });
  const pending = controller.start({});
  assert.equal(controller.requestPause(), true);
  assert.equal(controller.stopAfterGeneration(), true);
  await pending;
  assert.deepEqual(calls, ["pause", "stop"]);
  assert.deepEqual(durable, [{ cursor: 3 }]);
  assert.equal(changes.at(-1).status, "paused");
});

test("execution and persistence failures retain distinct kinds and safe cursors", async () => {
  for (const [kind, expected] of [["execution", "execution"], ["checkpoint", "persistence"]]) {
    const changes = [];
    const service = {
      requestPause() {}, stopAfterGeneration() {},
      start: async () => { throw new ResumableExecutionError(kind, `${kind} failed`, 7, new Error("cause")); },
      resume() {}
    };
    const controller = new RunOperationController({ service, onChange: value => changes.push(value) });
    await assert.rejects(controller.start({}), new RegExp(`${kind} failed`));
    assert.equal(changes.at(-1).status, "failed");
    assert.equal(changes.at(-1).errorKind, expected);
    assert.equal(changes.at(-1).safeCursor, 7);
  }
});
