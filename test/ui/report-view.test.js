import assert from "node:assert/strict";
import test from "node:test";
import { buildReportView, reportDownload } from "../../src/ui/report-view.js";

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
  assert.throws(() => reportDownload(buildReportView(generation, "fitness"), "csv"), /matrix reports/);
  assert.throws(() => reportDownload(buildReportView(null), "json"), /Choose/);
});
