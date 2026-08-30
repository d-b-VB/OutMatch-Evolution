import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const manifest = new URL("../fixtures/checksums.sha256", import.meta.url);
const root = new URL("../", import.meta.url);
const lines = (await readFile(manifest, "utf8")).trim().split(/\r?\n/).filter(Boolean);

for (const [index, line] of lines.entries()) {
  const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
  if (!match) throw new Error(`Invalid checksum manifest line ${index + 1}`);
  const [, expected, path] = match;
  const bytes = await readFile(new URL(path, root));
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) throw new Error(`Checksum mismatch for ${path}: expected ${expected}, received ${actual}`);
}

console.log(`Verified ${lines.length} deterministic fixture and seed checksums.`);
