import { canonicalJsonBytes } from "./canonical-json.js";
import { createOmgenManifest, OMGEN_ENTRIES, validateOmgenRecords } from "./schema.js";

function requireBytes(value, label) {
  if (!(value instanceof Uint8Array)) throw new Error(`${label} must be a Uint8Array`);
  return value;
}

export async function sha256Digest(bytes, { subtle = globalThis.crypto?.subtle } = {}) {
  requireBytes(bytes, "SHA-256 input");
  if (!subtle || typeof subtle.digest !== "function") throw new Error("Web Crypto SHA-256 is unavailable");
  const digest = new Uint8Array(await subtle.digest("SHA-256", bytes));
  return `sha256:${[...digest].map(byte => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function entryIntegrity(bytes, options) {
  return { bytes: bytes.byteLength, sha256: await sha256Digest(bytes, options) };
}

/** Build canonical entry bytes and their integrity-bearing manifest. */
export async function buildOmgenEntries(generation, ledger, {
  createdAt = new Date().toISOString(), subtle
} = {}) {
  const generationBytes = canonicalJsonBytes(generation);
  const ledgerBytes = canonicalJsonBytes(ledger);
  const integrity = {
    generation: await entryIntegrity(generationBytes, { subtle }),
    ledger: await entryIntegrity(ledgerBytes, { subtle })
  };
  const manifest = createOmgenManifest(generation, { createdAt, integrity });
  validateOmgenRecords(manifest, generation, ledger);
  return {
    manifest,
    entries: {
      [OMGEN_ENTRIES.generation]: generationBytes,
      [OMGEN_ENTRIES.ledger]: ledgerBytes
    }
  };
}

/** Verify length before hashing so truncated entries fail cheaply. */
export async function verifyOmgenEntry(manifest, name, bytes, options = {}) {
  requireBytes(bytes, `OMGEN ${name} entry`);
  const expected = manifest.integrity?.[name];
  if (!expected) throw new Error(`OMGEN manifest has no integrity metadata for ${name}`);
  if (bytes.byteLength !== expected.bytes) throw new Error(`OMGEN ${name} entry has an invalid byte length`);
  const actual = await sha256Digest(bytes, options);
  if (actual !== expected.sha256) throw new Error(`OMGEN ${name} entry failed SHA-256 verification`);
  return bytes;
}

export async function parseVerifiedOmgenEntries(manifest, entries, options = {}) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const parsed = {};
  for (const [name, path] of Object.entries(OMGEN_ENTRIES)) {
    const bytes = entries?.[path];
    await verifyOmgenEntry(manifest, name, bytes, options);
    try {
      parsed[name] = JSON.parse(decoder.decode(bytes));
    } catch (error) {
      throw new Error(`OMGEN ${name} entry is not valid UTF-8 JSON`, { cause: error });
    }
  }
  return validateOmgenRecords(manifest, parsed.generation, parsed.ledger);
}
