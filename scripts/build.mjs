import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";

execFileSync(process.execPath, ["scripts/materialize-r29-runtime.mjs"], { stdio: "inherit" });

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");
cpSync("index.html", "dist/index.html");
cpSync("src", "dist/src", { recursive: true });
cpSync("seed", "dist/seed", { recursive: true });
cpSync(".generated", "dist/.generated", { recursive: true });
cpSync("browser-acceptance", "dist/browser-acceptance", { recursive: true });
