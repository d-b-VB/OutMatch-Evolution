# Step 3: deterministic evolution pipeline

The Step 3 core implementation provides:

- deterministic Stage 1, Stage 2, and iterative challenger schedules;
- population-normalized ranking and complete-exposure checks;
- bounded browser Worker execution with schedule-ordered results;
- versioned SplitMix64 breeding randomness isolated from game execution;
- automatic migration and insertion-cycle breeding restrictions;
- guaranteed-father and weighted ordinary parent selection;
- fixed-range mutation, ordinary/self-cross inheritance, and wildcards;
- seven-population child assembly, provenance, validation, and fingerprints.

Run the focused acceptance suite with:

```sh
npm run verify:step3
```

## Determinism contract

Tournament schedules and ledger results are ordered by schedule index, never Worker completion order. Breeding consumes only an explicitly constructed `splitmix64-v1` stream. A child generation stores the breeding seed and PRNG version, and its canonical data receives an `fnv1a64:` fingerprint.

## External R30 fixture boundary

The supplied bootstrap archive contains R29 tournament and report fixtures, but no authoritative R29-to-R30 offspring fixture. The code includes `verifyR30BreedingFixture` for that future artifact. Until one is supplied, the suite freezes full-size and reduced deterministic generation fingerprints without representing either as an externally certified historical R30 roster. The external fixture comparison belongs in the later validation gate. Until that comparison and browser integration pass, Step 3 should be treated as core-complete rather than externally certified.
