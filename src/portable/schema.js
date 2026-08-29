import {
  assertDurableData,
  validateCompletedGenerationRecord,
  validateLedgerRecord
} from "../persistence/schema.js";

export const OMGEN_FORMAT = "outmatch-generation";
export const OMGEN_VERSION = 1;
export const OMGEN_MANIFEST_SCHEMA = "outmatch-omgen-manifest-v1";
export const OMGEN_ENTRIES = Object.freeze({
  generation: "generation.json",
  ledger: "ledger.json"
});

function validateIntegrity(integrity) {
  if (Object.keys(integrity ?? {}).length !== Object.keys(OMGEN_ENTRIES).length) {
    throw new Error("OMGEN manifest must contain integrity for every canonical entry");
  }
  for (const name of Object.keys(OMGEN_ENTRIES)) {
    const entry = integrity[name];
    if (!Number.isSafeInteger(entry?.bytes) || entry.bytes < 0) {
      throw new Error(`OMGEN manifest has an invalid ${name} byte length`);
    }
    if (typeof entry.sha256 !== "string" || !/^sha256:[0-9a-f]{64}$/.test(entry.sha256)) {
      throw new Error(`OMGEN manifest has an invalid ${name} SHA-256 digest`);
    }
  }
}

function requiredString(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string`);
}

/** Validate the versioned manifest before reading any referenced archive entry. */
export function validateOmgenManifest(manifest) {
  assertDurableData(manifest, "OMGEN manifest");
  if (manifest?.schema !== OMGEN_MANIFEST_SCHEMA) throw new Error("OMGEN manifest has an unsupported schema");
  if (manifest.format !== OMGEN_FORMAT) throw new Error("OMGEN manifest has an unsupported format");
  if (manifest.version !== OMGEN_VERSION) throw new Error(`Unsupported OMGEN version ${manifest.version}`);
  requiredString(manifest.createdAt, "OMGEN manifest.createdAt");
  if (!Number.isFinite(Date.parse(manifest.createdAt))) throw new Error("OMGEN manifest.createdAt must be an ISO date");
  for (const field of ["runId", "generation", "fingerprint"]) {
    requiredString(manifest.generation?.[field], `OMGEN manifest.generation.${field}`);
  }
  if (Object.keys(manifest.entries ?? {}).length !== Object.keys(OMGEN_ENTRIES).length) {
    throw new Error("OMGEN manifest must contain exactly the canonical entries");
  }
  for (const [name, path] of Object.entries(OMGEN_ENTRIES)) {
    if (manifest.entries[name] !== path) throw new Error(`OMGEN manifest has an invalid ${name} entry`);
  }
  validateIntegrity(manifest.integrity);
  return manifest;
}

export function createOmgenManifest(generation, { createdAt = new Date().toISOString(), integrity } = {}) {
  validateCompletedGenerationRecord(generation);
  return validateOmgenManifest({
    schema: OMGEN_MANIFEST_SCHEMA,
    format: OMGEN_FORMAT,
    version: OMGEN_VERSION,
    createdAt,
    generation: {
      runId: generation.runId,
      generation: generation.generation,
      fingerprint: generation.fingerprint
    },
    entries: { ...OMGEN_ENTRIES },
    integrity
  });
}

/** Validate all identity and reference links across the portable record set. */
export function validateOmgenRecords(manifest, generation, ledger) {
  validateOmgenManifest(manifest);
  validateCompletedGenerationRecord(generation);
  validateLedgerRecord(ledger);
  const identityMatches = manifest.generation.runId === generation.runId
    && manifest.generation.generation === generation.generation
    && manifest.generation.fingerprint === generation.fingerprint
    && ledger.runId === generation.runId
    && ledger.generation === generation.generation
    && generation.ledgerRef === ledger.ledgerId;
  if (!identityMatches) throw new Error("OMGEN generation and ledger references do not match the manifest");
  return { manifest, generation, ledger };
}
