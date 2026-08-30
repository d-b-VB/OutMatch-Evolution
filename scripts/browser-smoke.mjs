import { mkdir, readFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";

const browser = process.env.CHROMIUM_PATH
  ?? ["chromium", "chromium-browser", "google-chrome"].find(command => spawnSync("which", [command]).status === 0);
if (!browser) throw new Error("Browser smoke checks require CHROMIUM_PATH or a Chromium executable");

const server = spawn(process.execPath, ["scripts/dev-server.mjs"], { stdio: ["ignore", "pipe", "inherit"] });
await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("Development server did not start")), 5000);
  server.stdout.once("data", () => { clearTimeout(timeout); resolve(); });
  server.once("exit", code => reject(new Error(`Development server exited with ${code}`)));
});

function chromium(args) {
  const result = spawnSync(browser, ["--headless", "--no-sandbox", "--disable-gpu", ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `Chromium exited with ${result.status}`);
  return result.stdout;
}

try {
  const html = chromium(["--dump-dom", "http://127.0.0.1:4173/"]);
  if (!html.includes("OutMatch") || !html.includes("main-content") || !html.includes("run-progress")) {
    throw new Error("Browser smoke page did not bootstrap the lab shell");
  }
  const acceptance = chromium(["--virtual-time-budget=30000", "--dump-dom", "http://127.0.0.1:4173/browser-acceptance/acceptance.html"]);
  if (!acceptance.includes('data-status="passed"')) throw new Error(`Browser acceptance failed:\n${acceptance}`);
  await mkdir("artifacts/browser", { recursive: true });
  for (const viewport of [{ name: "desktop", size: "1440,1000" }, { name: "phone", size: "390,844" }]) {
    for (const screen of [{ name: "dashboard", hash: "#overview" }, { name: "active-run", hash: "#run-progress" },
      { name: "reports", hash: "#reports" }, { name: "populations", hash: "#populations" },
      { name: "replay", hash: "#replays" }]) {
      const path = `artifacts/browser/${screen.name}-${viewport.name}.png`;
      chromium([`--window-size=${viewport.size}`, `--screenshot=${path}`, `http://127.0.0.1:4173/browser-acceptance/scenarios.html${screen.hash}`]);
      const bytes = await readFile(path);
      if (bytes.length < 1000) throw new Error(`Empty ${screen.name} ${viewport.name} screenshot`);
    }
  }
} finally {
  server.kill("SIGTERM");
}
