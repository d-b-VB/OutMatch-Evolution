# OutMatch Reach Evolution: Task Outline

1. **Establish the deterministic game engine**
   - Port the canonical evaluator, apply the Reach pike-poke rule, add ledger instrumentation, and pass the golden-game fixtures.
2. **Reproduce the R29 baseline**
   - Load the supplied R29 state and exactly match its elimination, similarity, unit-rate, and fitness fixtures.
3. **Build the evolution pipeline**
   - Implement the three-stage tournament in Web Workers, followed by deterministic migration, breeding, mutation, and wildcard selection.
4. **Add durable generation management**
   - Checkpoint in-progress work, preserve immutable completed generations in IndexedDB, and support pause/resume without losing progress.
5. **Implement portable data files**
   - Export and validate self-contained `.omgen` archives, then verify that imported generations can continue evolving.
6. **Create the lab interface**
   - Provide run controls, ecological levers, audited population interventions, progress feedback, required reports, and deterministic game replay.
7. **Validate and deploy**
   - Automate the acceptance suite, confirm responsive browser behavior, document development and deployment, and publish a GitHub Pages-compatible build.

Work through these tasks in order: each fixture or acceptance gate should pass before relying on the corresponding subsystem in later phases.
