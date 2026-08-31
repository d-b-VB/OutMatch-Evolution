import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const archive = "OutMatch_Reach_Codex_Bootstrap.zip";
const member = "OutMatch_Reach_Codex_Bootstrap/seed/r29/Reach_R29_Full_Staged_Ledger.csv";
const output = ".generated/r29/Reach_R29_Full_Staged_Ledger.csv";

mkdirSync(".generated/r29", { recursive: true });
writeFileSync(output, execFileSync("unzip", ["-p", archive, member], { maxBuffer: 20_000_000 }));
