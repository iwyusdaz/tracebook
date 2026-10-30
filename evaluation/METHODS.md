# METHODS — how TraceBook was built and evaluated

**Status:** Automated deterministic testing complete. Real-corpus extraction
pending API key. No human evaluation has occurred yet.

## 1. What TraceBook claims to do (and not do)

TraceBook surfaces factual claims in curriculum content and attaches
machine-checked evidence to each. **It does not certify content as
"fact-checked."** Every verdict is an input to human judgment; the pipeline
is designed so that uncertain cases are labeled rather than resolved.

## 2. Components and their verification status

| Component | Method | Status | Evidence |
|---|---|---|---|
| `src/verify.mjs` (deterministic verifier) | Automated fixture test | Complete | `tests/negative-test.mjs`, 39 assertions, all passing |
| `src/report.mjs` (CLAIMS.md + in-place corrections) | Automated fixture test | Complete | Test sections [5]–[6] |
| `src/rot-check.mjs` + `action/` (weekly rot check) | Automated fixture test + YAML validation | Complete (CLI), syntax-validated (workflow) | Test section [7]; `ruby -ryaml` parse check |
| `src/extract.mjs` (LLM extractor) | Placeholder-refusal + dry-run tests | **PENDING real-model run** | Test sections [1]–[2] prove the gates; a real run needs `MODEL_A_*` keys in `.env` |
| `docs/` site | Manual accessibility checklist against WCAG 2.1 AA basics | Complete (automated-claim level) | See `README.md` § Accessibility; no screen-reader session yet |

## 3. The negative test (house pattern)

`tests/negative-test.mjs` starts a local fixture server
(`tests/fixture-server.mjs`, 127.0.0.1:8641) serving simulated source pages,
then runs the shipped CLI end to end. The fixture content
(`test-fixtures/content/`) contains five seeded errors and one correct
control claim. The test asserts the exact verdict and reason for each:

| Claim | Seeded fault | Expected | Asserted reason |
|---|---|---|---|
| C001 | wrong statistic | UNVERIFIED | `NUMERIC-MISMATCH` |
| C002 | (control, correct) | VERIFIED | `QUOTE-FOUND` |
| C003 | paywalled source | UNVERIFIED | `ACCESS-RESTRICTED` |
| C004 | stale version | UNVERIFIED | `QUOTE-NOT-FOUND` |
| C005 | drifted wording | VERIFIED-SNIPPET | `PARTIAL-MATCH` |
| C006 | dead link | UNVERIFIED | `SOURCE-UNREACHABLE` |

Plus: placeholder refusal (exit 1, no network), dry-run labeling, in-place
correction rewrite with a dated note, and rot-check state diffing (second
run reports 0 new findings).

**Result (2026-10-31): 39 passed, 0 failed.** Exit code 0 requires every
assertion to hold, so the test is a gate, not a smoke test.

**What this can and cannot show:** it proves the deterministic steps behave
as designed on controlled inputs, including that partial matches are flagged
rather than upgraded. It cannot show extractor recall/precision on real
curricula, behavior against real-world anti-bot systems, or that humans
actually act on the ledger.

## 4. Pending: real extraction run (owner task)

1. Copy `.env.example` to `.env`; fill `MODEL_A_BASE_URL`, `MODEL_A_API_KEY`,
   `MODEL_A_NAME` (any OpenAI-compatible chat endpoint).
2. `npm run extract -- --content <your-content-dir>`
3. Complete the human gate (see `evaluation/human-protocol/`).
4. `npm run verify && npm run report`.
5. Update this file and the README evaluation status with the real run's
   counts (keep the fixture demo as-is).

## 5. Honesty rules encoded in the tool

- Verifier notes and ledger disclaimers state that a green ledger is not a
  certification.
- VERIFIED-SNIPPET is never merged into VERIFIED by the machine.
- ACCESS-RESTRICTED sources are never retried with alternate identities.
- `--dry-run` output is quarantined in `dry-run/` and labeled; it must never
  be used as results.
- Fixture content and publishers are fictional and labeled as such.
