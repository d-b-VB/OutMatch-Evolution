import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  interventionFromForm, INTERVENTIONS_SCHEMA, INTERVENTIONS_SCHEMA_V1, replacementGenomeFromFile, reviewInterventions,
  validateIntervention, validateInterventionDocument, validateInterventionQueue
} from "../../src/ui/interventions.js";

const move = {
  type: "manual-move", generalId: "REACHR29_PL_L12", from: "pike_lords", to: "horse_hunters",
  note: "Test a different ecological niche."
};
const copy = {
  type: "copy-entrant", sourceGeneralId: "REACHR29_PL_L12", to: "generalists",
  newId: "MANUAL_R30_001", newName: "Manual Copy 001", note: "Preserve the source while testing a copy."
};
const uploadedGenome = {
  ...JSON.parse(readFileSync(new URL("../../seed/r29/Reach_R29_Complete_Checkpoint.json", import.meta.url))).population[0],
  id: "UPLOADED_R30_001", name: "Uploaded Replacement"
};

test("manual moves and copy entrants normalize from audited form values", () => {
  assert.deepEqual(validateIntervention(move), move);
  assert.deepEqual(interventionFromForm({
    type: "copy-entrant", generalId: copy.sourceGeneralId, to: copy.to,
    newId: copy.newId, newName: copy.newName, note: copy.note
  }), copy);
});

test("replacement uploads validate a complete genome and bind its destination", () => {
  const replacement = interventionFromForm({
    type: "replacement-upload", generalId: "REACHR29_HL_L01", to: "horse_lords",
    genomeJson: JSON.stringify(uploadedGenome), note: "Audited external candidate."
  });
  assert.equal(replacement.replacesGeneralId, "REACHR29_HL_L01");
  assert.equal(replacement.genome.population, "horse_lords");
  assert.equal(replacement.genome.id, uploadedGenome.id);
  assert.throws(() => validateIntervention({ ...replacement, genome: { ...uploadedGenome, genes: {} } }), /112 loci/);
  assert.throws(() => validateInterventionQueue([replacement, replacement]), /replaced more than once/);
  assert.throws(() => validateInterventionQueue([{
    type: "manual-move", generalId: replacement.replacesGeneralId, from: "horse_lords",
    to: "pike_lords", note: "move"
  }, replacement]), /conflicting interventions/);
});

test("replacement genome files are bounded and parsed without weakening genome validation", async () => {
  const parsed = await replacementGenomeFromFile({
    size: 100, text: async () => JSON.stringify(uploadedGenome)
  });
  assert.deepEqual(parsed, uploadedGenome);
  assert.deepEqual(interventionFromForm({
    type: "replacement-upload", generalId: "REACHR29_HL_L01", to: "horse_lords",
    genome: parsed, genomeJson: "", note: "file upload"
  }).genome, { ...uploadedGenome, population: "horse_lords" });
  await assert.rejects(replacementGenomeFromFile({ size: 1_000_001, text: async () => "{}" }), /too large/);
  await assert.rejects(replacementGenomeFromFile({ size: 1, text: async () => "12345" }, { maximumBytes: 4 }), /too large/);
  await assert.rejects(replacementGenomeFromFile({ size: 4, text: async () => "nope" }), /valid JSON/);
  await assert.rejects(replacementGenomeFromFile(null), /Choose/);
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

test("stored v1 documents remain readable but cannot contain replacement uploads", () => {
  assert.deepEqual(validateInterventionDocument({
    schema: INTERVENTIONS_SCHEMA_V1, parentGeneration: "ReachR29", operations: [move, copy]
  }), { schema: INTERVENTIONS_SCHEMA_V1, parentGeneration: "ReachR29", operations: [move, copy] });
  assert.throws(() => validateInterventionDocument({
    schema: INTERVENTIONS_SCHEMA_V1, parentGeneration: "ReachR29", operations: [{
      type: "replacement-upload", replacesGeneralId: "REACHR29_HL_L01", to: "horse_lords",
      genome: uploadedGenome, note: "replacement"
    }]
  }), /require intervention schema v2/);
});

test("v2 replacement hashes are stable and include uploaded genome content", async () => {
  const operation = validateIntervention({
    type: "replacement-upload", replacesGeneralId: "REACHR29_HL_L01", to: "horse_lords",
    genome: uploadedGenome, note: "replacement"
  });
  const first = await reviewInterventions([operation], { subtle: webcrypto.subtle, parentGeneration: "ReachR29" });
  const repeated = await reviewInterventions([operation], { subtle: webcrypto.subtle, parentGeneration: "ReachR29" });
  const changed = await reviewInterventions([{ ...operation, genome: {
    ...operation.genome, genes: { ...operation.genome.genes, recruitBase: {
      ...operation.genome.genes.recruitBase, P: operation.genome.genes.recruitBase.P + 1
    } }
  } }], { subtle: webcrypto.subtle, parentGeneration: "ReachR29" });
  assert.equal(first.interventions.schema, INTERVENTIONS_SCHEMA);
  assert.equal(first.interventionsHash, repeated.interventionsHash);
  assert.notEqual(first.interventionsHash, changed.interventionsHash);
});
