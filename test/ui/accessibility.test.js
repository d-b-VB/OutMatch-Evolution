import assert from "node:assert/strict";
import test from "node:test";
import { openModalWithFocusReturn } from "../../src/ui/accessibility.js";
import { renderLabShell } from "../../src/ui/render.js";
import { createLabState } from "../../src/ui/state.js";

test("modal helper focuses dialog content and returns focus exactly once", () => {
  let close;
  const events = [];
  const dialog = {
    showModal: () => events.push("open"),
    querySelector: () => ({ focus: () => events.push("dialog-focus") }),
    addEventListener: (name, callback, options) => { assert.equal(name, "close"); assert.deepEqual(options, { once: true }); close = callback; }
  };
  openModalWithFocusReturn(dialog, { focus: () => events.push("return-focus") });
  close();
  assert.deepEqual(events, ["open", "dialog-focus", "return-focus"]);
});

test("lab shell exposes skip navigation, live progress, labeled dialogs, and scrollable table focus", () => {
  const generation = {
    runId: "run", generation: "ReachR30", fingerprint: "fingerprint",
    checkpoint: { population: [{ id: "A", population: "generalists", genes: {} }] },
    reports: {}, rankings: [], migration: {}, breeding: {}
  };
  const state = createLabState({ runs: [{ runId: "run", title: "Run" }], generations: [generation] });
  const html = renderLabShell(state);
  assert.match(html, /class="skip-link" href="#main-content"/);
  assert.match(html, /<main id="main-content">/);
  assert.match(html, /aria-live="polite" aria-busy="false"/);
  assert.match(html, /population-table" tabindex="0"/);
  assert.match(html, /<caption>Generals in the selected immutable generation<\/caption>/);
  for (const id of ["new-run-title", "import-dialog-title", "delete-run-title", "intervention-title"]) {
    assert.match(html, new RegExp(`aria-labelledby="${id}"`));
    assert.match(html, new RegExp(`id="${id}"`));
  }
});
