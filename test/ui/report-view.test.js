import assert from "node:assert/strict";
import test from "node:test";
import { buildGenerationComparison, buildReportView, reportDownload } from "../../src/ui/report-view.js";

const generation = {
  reports: {
    elimination: { matrix: { alpha: { alpha: null, beta: 0.25 }, beta: { alpha: 0.75, beta: null } } },
    fitness: { leader: "A-1", score: 1.5 }
  },
  rankings: [{ id: "A-1", rank: 1 }], migration: { selected: [] }, breeding: { births: 245 }
};

test("report views expose archived summaries and select a requested report", () => {
  const view = buildReportView(generation, "elimination");
  assert.equal(view.reports.length, 5);
  assert.equal(view.selected.label, "Elimination matrix");
  assert.deepEqual(view.matrix.columns, ["alpha", "beta"]);
  assert.deepEqual(view.matrix.rows[0], { row: "alpha", values: [null, 0.25] });
  assert.equal(buildReportView(null).selected, null);
});

test("report JSON downloads are readable and retain archived values", () => {
  const download = reportDownload(buildReportView(generation, "fitness"), "json");
  assert.equal(download.extension, "json");
  assert.deepEqual(JSON.parse(download.text), generation.reports.fitness);
});

test("matrix CSV downloads preserve headers, nulls, and numeric rates", () => {
  const download = reportDownload(buildReportView(generation, "elimination"), "csv");
  assert.equal(download.type, "text/csv");
  assert.equal(download.text, '"population","alpha","beta"\n"alpha","","0.25"\n"beta","0.75",""\n');
  assert.match(reportDownload(buildReportView(generation, "fitness"), "csv").text, /"key","value"/);
  assert.throws(() => reportDownload(buildReportView(null), "json"), /Choose/);
});

test("report-specific tables serialize rankings, unit rates, migration, and breeding", () => {
  const detailed = {
    reports: {
      unitRates: { individual: [{ id: "A,1", population: "alpha", games: 2, pokesPerGame: null }] },
      similarity: { comparisons: [{ type: "within", A: "alpha", B: "alpha", mean: 0.5 }] }
    },
    rankings: { alpha: [{ id: "A,1", rank: 1, fitness: 4 }] },
    migration: { selected: [{ id: "A,1", source: "alpha", destination: "beta", improvement: 2 }] },
    breeding: { births: [{ id: "B\"2", father: "A,1", mother: null }] }
  };
  for (const id of ["unitRates", "similarity", "rankings", "migration", "breeding"]) {
    const view = buildReportView(detailed, id);
    assert.ok(view.table, id);
    const csv = reportDownload(view, "csv").text;
    assert.ok(csv.endsWith("\n"), id);
  }
  assert.match(reportDownload(buildReportView(detailed, "unitRates"), "csv").text, /"A,1"/);
  assert.match(reportDownload(buildReportView(detailed, "breeding"), "csv").text, /"B""2"/);
  assert.match(reportDownload(buildReportView(detailed, "breeding"), "csv").text, /,""\n/);
});

test("generation comparison uses archived numeric values in stable metric order", () => {
  const previous = { generation: "ReachR29", reports: { fitness: { mean: 2 }, elimination: { games: 10 } }, migration: {}, breeding: {} };
  const current = { generation: "ReachR30", reports: { fitness: { mean: 3.5 }, elimination: { games: 12 } }, migration: {}, breeding: {} };
  const comparison = buildGenerationComparison(current, previous);
  assert.deepEqual(comparison.rows, [
    { metric: "reports.elimination.games", previous: 10, current: 12, delta: 2 },
    { metric: "reports.fitness.mean", previous: 2, current: 3.5, delta: 1.5 }
  ]);
  const view = buildReportView(current, "comparison", previous);
  assert.equal(view.selected.label, "Generation comparison");
  assert.match(reportDownload(view, "csv").text, /"metric","previous","current","delta"/);
});
