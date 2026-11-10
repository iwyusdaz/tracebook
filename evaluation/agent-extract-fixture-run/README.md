# Agent-run extraction on the fixture content

- **What:** step 1 (EXTRACT) run the documented agent way, no API key.
- **Who ran it:** the build agent (Kiro), 2026-11-10. Not a human, not a
  real curriculum.
- **Input:** `test-fixtures/content/` (two fictional modules with seeded
  errors).
- **Commands:** `npm run extract -- --prepare`, then the agent wrote
  `agent-claims.json`, then
  `npm run extract -- --claims evaluation/agent-extract-fixture-run/agent-claims.json --out evaluation/agent-extract-fixture-run/claims.json --extractor "..."`.
- **Result:** 7 claims returned, 7 accepted by the verbatim check, 0
  rejected. All 6 seeded claims are present; the 7th is the four-year
  accreditation cycle. Locations were computed by the script.
- **Not done:** the human gate (`stored_quote` is empty), so these claims
  were not verified.
- **Limitation:** the agent knew which claims were seeded, so this shows
  the path works; it does not measure extraction quality.
