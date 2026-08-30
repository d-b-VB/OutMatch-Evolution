import { readFile } from "node:fs/promises";

const packageDocument = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const argument = process.argv.find(value => value.startsWith("--tag="));
const tag = argument?.slice("--tag=".length) ?? process.env.GITHUB_REF_NAME;
if (typeof packageDocument.version !== "string" || !/^\d+\.\d+\.\d+$/.test(packageDocument.version)) {
  throw new Error("package.json must contain a semantic release version");
}
if (tag !== undefined && tag !== `v${packageDocument.version}`) {
  throw new Error(`Release tag ${tag} does not match package version v${packageDocument.version}`);
}
const changelog = await readFile(new URL("../CHANGELOG.md", import.meta.url), "utf8");
if (!changelog.includes(`## ${packageDocument.version} —`)) {
  throw new Error(`CHANGELOG.md has no entry for ${packageDocument.version}`);
}
console.log(`Verified release version v${packageDocument.version}${tag ? ` against ${tag}` : ""}.`);
