import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";
import {
  buildOmgenEntries,
  parseVerifiedOmgenEntries,
  sha256Digest,
  verifyOmgenEntry
} from "../../src/portable/integrity.js";
import { OMGEN_ENTRIES } from "../../src/portable/schema.js";
import { PERSISTENCE_SCHEMAS } from "../../src/persistence/schema.js";

const options = { subtle: webcrypto.subtle };

function records(suffix = "") {
  const ledger = {
    schema: PERSISTENCE_SCHEMAS.ledger, runId: `run${suffix}`, generation: "ReachR30",
    ledgerId: `ledger${suffix}`, rows: []
  };
  const generation = {
    schema: PERSISTENCE_SCHEMAS.generation, runId: `run${suffix}`, generation: "ReachR30",
    parentGeneration: "ReachR29", completedAt: "2026-01-03T00:00:00.000Z",
    fingerprint: `fingerprint${suffix}`, ledgerRef: ledger.ledgerId,
    checkpoint: { population: [] }, rankings: [], interventions: [],
    manifest: {}, controls: {}, migration: {}, breeding: {}, reports: {}
  };
  return { generation, ledger };
}

test("SHA-256 uses a stable lowercase prefixed digest", async () => {
  const digest = await sha256Digest(new TextEncoder().encode("abc"), options);
  assert.equal(digest, "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("canonical entries include exact byte lengths and SHA-256 digests", async () => {
  const { generation, ledger } = records();
  const bundle = await buildOmgenEntries(generation, ledger, {
    createdAt: "2026-01-04T00:00:00.000Z", ...options
  });
  for (const [name, path] of Object.entries(OMGEN_ENTRIES)) {
    assert.equal(bundle.manifest.integrity[name].bytes, bundle.entries[path].byteLength);
    assert.equal(bundle.manifest.integrity[name].sha256, await sha256Digest(bundle.entries[path], options));
  }
});

test("verified entries parse and reproduce the portable records", async () => {
  const expected = records();
  const bundle = await buildOmgenEntries(expected.generation, expected.ledger, options);
  const parsed = await parseVerifiedOmgenEntries(bundle.manifest, bundle.entries, options);
  assert.deepEqual(parsed.generation, expected.generation);
  assert.deepEqual(parsed.ledger, expected.ledger);
});

test("entry verification rejects truncation before digest comparison", async () => {
  const expected = records();
  const bundle = await buildOmgenEntries(expected.generation, expected.ledger, options);
  const bytes = bundle.entries[OMGEN_ENTRIES.generation].slice(0, -1);
  await assert.rejects(verifyOmgenEntry(bundle.manifest, "generation", bytes, options), /byte length/);
});

test("entry corruption and same-shaped archive substitution fail digest verification", async () => {
  const first = await buildOmgenEntries(records("-one").generation, records("-one").ledger, options);
  const secondRecords = records("-two");
  const second = await buildOmgenEntries(secondRecords.generation, secondRecords.ledger, options);
  const corrupted = structuredClone(first.entries);
  corrupted[OMGEN_ENTRIES.ledger][0] ^= 1;
  await assert.rejects(parseVerifiedOmgenEntries(first.manifest, corrupted, options), /SHA-256/);
  await assert.rejects(parseVerifiedOmgenEntries(first.manifest, second.entries, options), /(byte length|SHA-256)/);
});
