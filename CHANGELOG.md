# Changelog

All notable changes to TraceBook are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-10-31

### Added
- `src/extract.mjs` — LLM claim extractor (OpenAI-compatible endpoint via
  `.env` `MODEL_A_*`). Refuses missing/placeholder configuration with a
  clear exit and zero network calls; `--dry-run` writes stubs labeled
  "DRY RUN – NOT REAL RESULTS" to `dry-run/`.
- `src/verify.mjs` — fully deterministic verifier: fetch + quote-back
  matching against stored source sentences; verdict vocabulary VERIFIED /
  VERIFIED-SNIPPET / UNVERIFIED / CORRECTED / NOT-APPLICABLE; paywalled and
  403 sources labeled ACCESS-RESTRICTED, never circumvented.
- `src/report.mjs` — emits `CLAIMS.md` (table + summary counts) and applies
  human-approved corrections in place with dated correction notes.
- `src/rot-check.mjs` — deterministic claims-rot checker: re-fetches every
  `source_url`, flags LINK-ROT / ACCESS-RESTRICTED / CONTENT-DRIFT, diffs
  findings between runs, opens one GitHub issue per new finding when a
  token is available.
- `action/` — composite GitHub Action wrapper (usable from any repo via
  `uses: iwyusdaz/tracebook/action@main`) and `.github/workflows/rot-check.yml`
  weekly schedule (Mondays 06:00 UTC) with a fixture-only guard.
- `test-fixtures/` — fictional content set with five seeded errors (wrong
  statistic, stale version string, dead link, paywalled source, drifted
  wording) plus one correct control claim, and simulated source pages served
  locally during tests.
- `tests/negative-test.mjs` — mandatory negative test: 39 assertions proving
  the pipeline catches every seeded error; also covers placeholder refusal,
  dry-run labeling, in-place correction, and rot-check state diffing.
- `docs/` — accessible static case-study site with a live demo of the
  fixture run's ledger.
- `evaluation/METHODS.md`, `evaluation/agent-review.md`,
  `evaluation/human-protocol/` — methods note, review record, and the
  human-review protocol for verdicts.
- Demo artifacts: `ledger/claims.json` (pre-verify template),
  `ledger/claims-verified.json`, and `CLAIMS.md`.
