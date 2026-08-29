import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";
import { exportOmgen, importOmgen, OMGEN_ARCHIVE_ORDER } from "../../src/portable/archive.js";
import { encodeZipEntries, decodeZipEntries } from "../../src/portable/zip.js";
import { PERSISTENCE_SCHEMAS } from "../../src/persistence/schema.js";

const options = { subtle: webcrypto.subtle, createdAt: "2026-01-04T00:00:00.000Z" };

function records() {
  const ledger = { schema: PERSISTENCE_SCHEMAS.ledger, runId: "run", generation: "ReachR30", ledgerId: "ledger", rows: [] };
  const generation = {
    schema: PERSISTENCE_SCHEMAS.generation, runId: "run", generation: "ReachR30",
    parentGeneration: "ReachR29", completedAt: "2026-01-03T00:00:00.000Z",
    fingerprint: "fingerprint", ledgerRef: "ledger", checkpoint: { population: [] },
    rankings: [], interventions: [], manifest: {}, controls: {}, migration: {}, breeding: {}, reports: {}
  };
  return { generation, ledger };
}

test("OMGEN export is a byte-identical ZIP with frozen entry order and metadata", async () => {
  const { generation, ledger } = records();
  const first = await exportOmgen(generation, ledger, options);
  const second = await exportOmgen(structuredClone(generation), structuredClone(ledger), options);
  assert.deepEqual(first, second);
  assert.deepEqual([...first.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  assert.deepEqual(Object.keys(decodeZipEntries(first, { expectedNames: OMGEN_ARCHIVE_ORDER })), OMGEN_ARCHIVE_ORDER);
});

test("OMGEN archive round trip reproduces generation and ledger", async () => {
  const expected = records();
  const bytes = await exportOmgen(expected.generation, expected.ledger, options);
  const actual = await importOmgen(bytes, options);
  assert.deepEqual(actual.generation, expected.generation);
  assert.deepEqual(actual.ledger, expected.ledger);
});

test("ZIP decoding enforces archive and entry size limits", async () => {
  const bytes = encodeZipEntries([{ name: "one", bytes: new Uint8Array(20) }]);
  assert.throws(() => decodeZipEntries(bytes, { maxArchiveBytes: bytes.byteLength - 1 }), /archive exceeds/);
  assert.throws(() => decodeZipEntries(bytes, { maxEntryBytes: 19 }), /entry one exceeds/);
});

test("ZIP decoding rejects missing, unexpected, and duplicate entries", () => {
  const one = new Uint8Array([1]);
  const missing = encodeZipEntries([{ name: "manifest.json", bytes: one }]);
  assert.throws(() => decodeZipEntries(missing, { expectedNames: OMGEN_ARCHIVE_ORDER }), /missing required/);
  const unexpected = encodeZipEntries(OMGEN_ARCHIVE_ORDER.map(name => ({ name, bytes: one })).concat({ name: "extra", bytes: one }));
  assert.throws(() => decodeZipEntries(unexpected, { expectedNames: OMGEN_ARCHIVE_ORDER }), /unexpected/);
  const duplicate = encodeZipEntries([{ name: "same", bytes: one }, { name: "same", bytes: one }]);
  assert.throws(() => decodeZipEntries(duplicate), /duplicate/);
});

test("ZIP CRC catches container corruption before OMGEN parsing", async () => {
  const expected = records();
  const bytes = await exportOmgen(expected.generation, expected.ledger, options);
  const corrupted = bytes.slice();
  const nameLength = new DataView(corrupted.buffer).getUint16(26, true);
  corrupted[30 + nameLength] ^= 1;
  await assert.rejects(importOmgen(corrupted, options), /CRC-32/);
});
