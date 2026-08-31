# Experimental fast combat engine

`src/engine/board.js` remains the production/reference Reach engine. `src/engine/fast-board.js`
is an experimental behavior-identical implementation that replaces search-state
`structuredClone` calls with a purpose-built copier and avoids temporary archer states.

Run the reproducible benchmark with:

```sh
node scripts/benchmark-fast-board.mjs 100 1
node scripts/benchmark-fast-board.mjs 100 3
```

On the development container, the 100-game depth-1 representative R29 benchmark measured
258.26 ms/game for the reference implementation and 51.97 ms/game for the optimized
implementation (4.97x) after compact integer-cell occupancy and precomputed geometry were added.

A 10-game depth-3 sample measured 1,512.59 ms/game for the reference and 351.55 ms/game
for the optimized engine (4.30x). This clears the production-switch gate, so initialized
tournament Workers use `fast-board.js`; `board.js` remains the reference implementation.

Timing diagnostics are deliberately nondeterministic and never enter ledgers, generation
records, or fingerprints.

The 1,000-game depth-1 representative run measured 193.20 ms/game for reference and
30.43 ms/game for fast execution (6.35x). The benchmark now retains and exactly compares every
complete result/state object, so a timing run fails if the implementations diverge.
