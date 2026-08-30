import { spawnSync } from "node:child_process";

const checks = [
  ["Fixture integrity", "verify:fixtures"],
  ["Full Node suite", "test"],
  ["Golden games", "verify:golden"],
  ["Evolution (Step 3)", "verify:step3"],
  ["Persistence (Step 4)", "verify:step4"],
  ["Portable archives (Step 5)", "verify:step5"],
  ["Lab UI models (Step 6)", "verify:step6"],
  ["Static build", "build"],
  ["Native browser acceptance", "verify:browser"]
];

const suiteStarted = Date.now();
for (const [label, script] of checks) {
  const started = Date.now();
  console.log(`\n=== ${label}: npm run ${script} ===`);
  const result = spawnSync("npm", ["run", script], { stdio: "inherit", shell: process.platform === "win32" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  console.log(`=== ${label} passed in ${((Date.now() - started) / 1000).toFixed(1)}s ===`);
}

console.log(`\nConsolidated acceptance passed in ${((Date.now() - suiteStarted) / 1000).toFixed(1)}s.`);
