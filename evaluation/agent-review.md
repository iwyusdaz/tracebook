# Agent review record

## Review setup

- **Method:** Agent heuristic review (structured), performed by a reviewer
  agent in a fresh context after the build was complete.
- **Date:** 2026-10-31
- **Disclosed limitation:** the reviewer agent may run on the same
  underlying model family as the authoring agent. This is not independent
  human review; it is a gap-finding pass, not expert endorsement.

## Scope of review

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

## Items the reviewer could not verify

- Real-model extraction quality (no API key in the build environment).
- The GitHub Action's issue-opening path on a live repository (requires the
  repo to exist and Actions to run); YAML syntax was validated, and the rot
  checker's CLI path is covered by the negative test.
- Screen-reader behavior of the docs site (no AT session available);
  documented as a limitation in the README accessibility statement.
