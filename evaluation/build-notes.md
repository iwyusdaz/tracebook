# Build-time notes (recorded by the builder agent)

> **What this file is:** notes recorded by the builder agent during the
> build, capturing issues it found and fixed in its own work. This is **not**
> an independent review — the author is grading its own homework. The
> independent review of this repository lives in `evaluation/agent-review.md`;
> neither is a substitute for human review.

## Context

- **Author:** the builder agent, mid-build (not a separate reviewer).
- **Date:** 2026-10-31
- **Disclosed limitation:** the builder agent runs on the same underlying
  model family as the authoring process, and the findings below are its own
  mid-build fixes — not an evaluation by a separate party.

## Scope of the build-time pass

1. Honesty: no claim anywhere equates a green ledger with "fact-checked
   content"; restricted sources are labeled, not circumvented; dry-run and
   fixture content are labeled.
2. Correctness of the deterministic steps against the negative test.
3. Repo hygiene: licensing, attribution, .gitignore coverage, no secrets.
4. Accessibility of the docs site against the shared baseline.

## Findings and resolutions

| # | Finding | Resolution |
|---|---|---|
| 1 | `spawnSync` in the negative test deadlocked the in-process fixture server (blocked event loop), so the first full run mislabeled every fetch as unreachable. | Test now uses async `spawn`; the negative test passes 39/39 and this failure mode is now covered by the test itself. |
| 2 | Partial-match threshold (0.7) would have labeled the stale-version fixture VERIFIED-SNIPPET instead of UNVERIFIED. | Threshold set to 0.8 so drifted wording flags as VERIFIED-SNIPPET (0.86) while a changed version string falls through to UNVERIFIED (0.67); the boundary is now asserted by the test. |
| 3 | Weekly workflow would open noise issues for the fixture-only demo ledger (localhost URLs unreachable in CI). | Added a guard step that skips the scheduled run while every `source_url` is local; documented in the workflow. |
| 4 | Verifier note wording ("does NOT circumvent") did not match the test's assertion vocabulary. | Aligned to "not circumvented"; phrasing now asserted by the test. |

## Items the builder could not verify

- Real-model extraction quality (no API key in the build environment).
- The GitHub Action's issue-opening path on a live repository (requires the
  repo to exist and Actions to run); YAML syntax was validated, and the rot
  checker's CLI path is covered by the negative test.
- Screen-reader behavior of the docs site (no AT session available);
  documented as a limitation in the README accessibility statement.
