import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson, canonicalJsonBytes } from "../../src/portable/canonical-json.js";
import {
  createOmgenManifest,
  OMGEN_ENTRIES,
  OMGEN_FORMAT,
  OMGEN_MANIFEST_SCHEMA,
  OMGEN_VERSION,
  validateOmgenManifest,
  validateOmgenRecords
} from "../../src/portable/schema.js";
import { PERSISTENCE_SCHEMAS } from "../../src/persistence/schema.js";

const integrity = {
  generation: { bytes: 10, sha256: `sha256:${"1".repeat(64)}` },
  ledger: { bytes: 20, sha256: `sha256:${"2".repeat(64)}` }
};

function records() {
  const ledger = {
    schema: PERSISTENCE_SCHEMAS.ledger,
    runId: "run-one",
    generation: "ReachR30",
    ledgerId: "ledger-r30",
    rows: [{ stage: "stage1", scheduleIndex: 0, redId: "red", blueId: "blue" }]
  };
  const generation = {
    schema: PERSISTENCE_SCHEMAS.generation,
    runId: "run-one",
    generation: "ReachR30",
    parentGeneration: "ReachR29",
    completedAt: "2026-01-03T00:00:00.000Z",
    fingerprint: "fnv1a64:1234",
    ledgerRef: ledger.ledgerId,
    checkpoint: { population: [] },
    rankings: [], interventions: [], manifest: {}, controls: {}, migration: {}, breeding: {}, reports: {}
  };
  return { generation, ledger };
}

test("manifest builder freezes canonical format, version, and entry names", () => {
  const { generation } = records();
  const manifest = createOmgenManifest(generation, { createdAt: "2026-01-04T00:00:00.000Z", integrity });
  assert.equal(manifest.schema, OMGEN_MANIFEST_SCHEMA);
  assert.equal(manifest.format, OMGEN_FORMAT);
  assert.equal(manifest.version, OMGEN_VERSION);
  assert.deepEqual(manifest.entries, OMGEN_ENTRIES);
  assert.deepEqual(manifest.generation, {
    runId: "run-one", generation: "ReachR30", fingerprint: "fnv1a64:1234"
  });
});

test("manifest validation rejects malformed and unsupported archives", () => {
  const manifest = createOmgenManifest(records().generation, { integrity });
  assert.throws(() => validateOmgenManifest({ ...manifest, schema: "other" }), /unsupported schema/);
  assert.throws(() => validateOmgenManifest({ ...manifest, version: 2 }), /Unsupported OMGEN version/);
  assert.throws(() => validateOmgenManifest({ ...manifest, entries: { ...manifest.entries, extra: "extra.json" } }), /exactly/);
  assert.throws(() => validateOmgenManifest({ ...manifest, entries: { ...manifest.entries, ledger: "../ledger.json" } }), /invalid ledger/);
});

test("portable records require matching run, generation, fingerprint, and ledger reference", () => {
  const { generation, ledger } = records();
  const manifest = createOmgenManifest(generation, { integrity });
  assert.deepEqual(validateOmgenRecords(manifest, generation, ledger), { manifest, generation, ledger });
  assert.throws(() => validateOmgenRecords(manifest, { ...generation, fingerprint: "changed" }, ledger), /do not match/);
  assert.throws(() => validateOmgenRecords(manifest, generation, { ...ledger, ledgerId: "other" }), /do not match/);
});

test("canonical JSON recursively sorts keys without reordering arrays", () => {
  const left = { z: 1, nested: { b: 2, a: 1 }, array: [{ d: 4, c: 3 }, 2] };
  const right = { array: [{ c: 3, d: 4 }, 2], nested: { a: 1, b: 2 }, z: 1 };
  assert.equal(canonicalJson(left), canonicalJson(right));
  assert.equal(canonicalJson(left), '{"array":[{"c":3,"d":4},2],"nested":{"a":1,"b":2},"z":1}');
  assert.deepEqual(canonicalJsonBytes(left), new TextEncoder().encode(canonicalJson(left)));
});

test("canonical JSON rejects lossy or unsupported values", () => {
  assert.throws(() => canonicalJson({ missing: undefined }), /undefined/);
  assert.throws(() => canonicalJson({ invalid: Number.NaN }), /non-finite/);
  assert.throws(() => canonicalJson(new Map()), /unsupported/);
});
