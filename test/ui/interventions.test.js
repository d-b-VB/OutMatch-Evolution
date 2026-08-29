import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";
import {
  interventionFromForm, INTERVENTIONS_SCHEMA, reviewInterventions,
  validateIntervention, validateInterventionQueue
} from "../../src/ui/interventions.js";

const move = {
  type: "manual-move", generalId: "REACHR29_PL_L12", from: "pike_lords", to: "horse_hunters",
  note: "Test a different ecological niche."
};
const copy = {
  type: "copy-entrant", sourceGeneralId: "REACHR29_PL_L12", to: "generalists",
  newId: "MANUAL_R30_001", newName: "Manual Copy 001", note: "Preserve the source while testing a copy."
};

test("manual moves and copy entrants normalize from audited form values", () => {
  assert.deepEqual(validateIntervention(move), move);
  assert.deepEqual(interventionFromForm({
    type: "copy-entrant", generalId: copy.sourceGeneralId, to: copy.to,
    newId: copy.newId, newName: copy.newName, note: copy.note
  }), copy);
});

test("intervention queues reject invalid populations and conflicting identities", () => {
  assert.throws(() => validateIntervention({ ...move, to: move.from }), /change populations/);
  assert.throws(() => validateIntervention({ ...copy, to: "Unknown" }), /Reach population/);
  assert.throws(() => validateInterventionQueue([move, move]), /moved more than once/);
  assert.throws(() => validateInterventionQueue([copy, copy]), /Duplicate copied/);
  assert.throws(() => validateIntervention({ ...move, note: "" }), /note/);
});

test("intervention reviews use a separate canonical deterministic hash", async () => {
  const review = await reviewInterventions([move, copy], { subtle: webcrypto.subtle, parentGeneration: "ReachR29" });
  assert.equal(review.interventions.schema, INTERVENTIONS_SCHEMA);
  assert.equal(review.interventions.parentGeneration, "ReachR29");
  assert.deepEqual(review.interventions.operations, [move, copy]);
  assert.match(review.interventionsHash, /^sha256:[0-9a-f]{64}$/);
  const repeated = await reviewInterventions([move, copy], { subtle: webcrypto.subtle, parentGeneration: "ReachR29" });
  assert.equal(review.interventionsHash, repeated.interventionsHash);
});
