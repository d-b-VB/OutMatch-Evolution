import fs from "node:fs";
import os from "node:os";
import { isMainThread, parentPort, workerData, Worker } from "node:worker_threads";
import { runGame } from "../src/engine/board.js";
import { runGame as runFastGame } from "../src/engine/fast-board.js";

const root = new URL("../", import.meta.url);

function readRows() {
  const [header, ...lines] = fs.readFileSync(new URL("fixtures/r29_golden_games.csv", root), "utf8")
    .trim()
    .split("\n");
  const fields = header.split(",");
  return lines.map(line => Object.fromEntries(
    line.split(",").map((value, index) => [fields[index], value])
  ));
}

function unitCounts(row, prefix) {
  return { P: Number(row[`${prefix}P`]), A: Number(row[`${prefix}A`]), C: Number(row[`${prefix}C`]) };
}

function expectedLedger(row) {
  return {
    outcome: row.outcome,
    winner: row.winner || null,
    round: Number(row.round),
    trained: { R: unitCounts(row, "red"), B: unitCounts(row, "blue") },
    pokes: { R: Number(row.redPokes), B: Number(row.bluePokes) },
    killsByAttacker: {
      R: { P: Number(row.redKillByP), A: Number(row.redKillByA), C: Number(row.redKillByC) },
      B: { P: Number(row.blueKillByP), A: Number(row.blueKillByA), C: Number(row.blueKillByC) }
    },
    victimsByType: {
      R: { P: Number(row.redVictimP), A: Number(row.redVictimA), C: Number(row.redVictimC) },
      B: { P: Number(row.blueVictimP), A: Number(row.blueVictimA), C: Number(row.blueVictimC) }
    }
  };
}

function comparableLedger(ledger) {
  return Object.fromEntries(Object.entries(ledger).filter(([key]) => [
    "outcome", "winner", "round", "trained", "pokes", "killsByAttacker", "victimsByType"
  ].includes(key)));
}

function parseOption(name, fallback) {
  const argument = process.argv.find(value => value.startsWith(`--${name}=`));
  return argument ? Number(argument.split("=")[1]) : fallback;
}

if (!isMainThread) {
  const checkpoint = JSON.parse(fs.readFileSync(new URL("seed/r29/Reach_R29_Complete_Checkpoint.json", root)));
  const genomes = new Map(checkpoint.population.map(genome => [genome.id, genome]));
  const failures = [];
  for (const row of workerData.rows) {
    const engine = workerData.engine === "fast" ? runFastGame : runGame;
    const game = engine(genomes.get(row.redId), genomes.get(row.blueId));
    const expected = expectedLedger(row);
    const actual = comparableLedger(game.ledger);
    const aggregateMatches = JSON.stringify(actual) === JSON.stringify(expected);
    const scoresMatch = Math.abs(game.ledger.redScore - Number(row.redScore)) < 1e-12
      && Math.abs(game.ledger.blueScore - Number(row.blueScore)) < 1e-12;
    if (!aggregateMatches || !scoresMatch) {
      failures.push({ gameIndex: row.gameIndex, redId: row.redId, blueId: row.blueId, expected, actual });
    }
  }
  parentPort.postMessage({ checked: workerData.rows.length, failures });
} else {
  const allRows = readRows();
  const engine = process.argv.includes("--engine=fast") ? "fast" : "reference";
  const limit = Math.max(1, Math.min(allRows.length, parseOption("limit", allRows.length)));
  const rows = allRows.slice(0, limit);
  const workerCount = Math.max(1, Math.min(rows.length, parseOption("workers", Math.min(4, os.availableParallelism()))));
  const groups = Array.from({ length: workerCount }, () => []);
  rows.forEach((row, index) => groups[index % workerCount].push(row));
  const started = Date.now();
  const results = await Promise.all(groups.map(group => new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: { rows: group, engine } });
    worker.once("message", resolve);
    worker.once("error", reject);
    worker.once("exit", code => {
      if (code !== 0) reject(new Error(`Golden worker exited with code ${code}`));
    });
  })));
  const failures = results.flatMap(result => result.failures);
  const checked = results.reduce((total, result) => total + result.checked, 0);
  if (failures.length > 0) {
    console.error(JSON.stringify({ checked, failures }, null, 2));
    process.exitCode = 1;
  } else {
    console.log(`${engine} matched ${checked}/${allRows.length} golden games in ${((Date.now() - started) / 1000).toFixed(1)}s using ${workerCount} workers.`);
  }
}
