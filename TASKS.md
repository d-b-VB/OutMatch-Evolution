# OutMatch Reach Evolution: Task Outline

1. **Establish the deterministic game engine — complete**
   - Port the canonical evaluator, apply the Reach pike-poke rule, add ledger instrumentation, and pass the golden-game fixtures.
2. **Reproduce the R29 baseline — complete**
   - Load the supplied R29 state and exactly match its elimination, similarity, unit-rate, and fitness fixtures.
3. **Build the evolution pipeline — complete**
   - Implement the three-stage tournament in Web Workers, followed by deterministic migration, breeding, mutation, and wildcard selection.
4. **Add durable generation management — core complete**
   - Checkpoint in-progress work, preserve immutable completed generations in IndexedDB, and support pause/resume without losing progress.
5. **Implement portable data files — complete**
   - Export and validate self-contained `.omgen` archives, then verify that imported generations can continue evolving.
6. **Create the lab interface — complete**
   - Durable production controls, accessible navigation, populations, interventions, graphical replays, and Chromium acceptance/screenshot automation are implemented and covered by the reported CI browser run.
7. **Validate and deploy — release automation complete**
   - Consolidated verification and project-subpath GitHub Pages delivery are implemented; repository owners only need to keep GitHub Actions selected as the Pages source.

Work through these tasks in order: each fixture or acceptance gate should pass before relying on the corresponding subsystem in later phases.

The core engine, R29 reproduction, evolution, persistence, and portable-file acceptance gates are now implemented. Continue with the bounded batches and acceptance criteria in [`docs/CONTINUATION_PLAN.md`](docs/CONTINUATION_PLAN.md); do not bypass the durable coordinator from UI code.
