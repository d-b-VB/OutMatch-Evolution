import { canonicalJsonBytes } from "./canonical-json.js";
import { buildOmgenEntries, parseVerifiedOmgenEntries } from "./integrity.js";
import { OMGEN_ENTRIES, validateOmgenManifest } from "./schema.js";
import { decodeZipEntries, encodeZipEntries } from "./zip.js";

export const OMGEN_ARCHIVE_ORDER = Object.freeze([
  "manifest.json", OMGEN_ENTRIES.generation, OMGEN_ENTRIES.ledger
]);

export async function exportOmgen(generation, ledger, options = {}) {
  const bundle = await buildOmgenEntries(generation, ledger, options);
  const bytesByName = { "manifest.json": canonicalJsonBytes(bundle.manifest), ...bundle.entries };
  return encodeZipEntries(OMGEN_ARCHIVE_ORDER.map(name => ({ name, bytes: bytesByName[name] })));
}

export async function importOmgen(bytes, options = {}) {
  const entries = decodeZipEntries(bytes, { expectedNames: OMGEN_ARCHIVE_ORDER, ...options });
  let manifest;
  try {
    manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(entries["manifest.json"]));
  } catch (error) {
    throw new Error("OMGEN manifest is not valid UTF-8 JSON", { cause: error });
  }
  validateOmgenManifest(manifest);
  return parseVerifiedOmgenEntries(manifest, entries, options);
}
