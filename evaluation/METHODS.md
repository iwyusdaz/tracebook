# METHODS — how TraceBook was built and evaluated

**Status:** Automated deterministic testing complete (47 assertions pass).
Extraction is agent-run and needs no API key; it has been run once, by the
build agent, on the fixture content only. No real-corpus run and no human
evaluation have occurred yet.

## 1. What TraceBook claims to do (and not do)

TraceBook surfaces factual claims in curriculum content and attaches
machine-checked evidence to each. **It does not certify content as
"fact-checked."** Every verdict is an input to human judgment; the pipeline
is designed so that uncertain cases are labeled rather than resolved.

## 2. Components and their verification status

| Component | Method | Status | Evidence |
|---|---|---|---|
| `src/verify.mjs` (deterministic verifier) | Automated fixture test | Complete | `tests/negative-test.mjs`, 47 assertions, all passing |
| `src/report.mjs` (CLAIMS.md + in-place corrections) | Automated fixture test | Complete | Test sections [5]–[6] |
| `src/rot-check.mjs` + `action/` (weekly rot check) | Automated fixture test + YAML validation | Complete (CLI), syntax-validated (workflow) | Test section [7]; `ruby -ryaml` parse check |
| `src/extract.mjs` (agent-run extractor) | Automated import tests + one agent run on fixtures | Import path complete; extraction quality not measured | Test sections [1] and [2]; section 4 below |
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

Plus: the extractor has no network code, refuses to run without a mode,
writes an agent request covering every content file, imports only claims
found verbatim in the content (a fabricated claim is rejected; an import
with no verbatim claims exits 1 and writes nothing), computes `file:line`
locally (including a claim that wraps across lines), dry-run labeling,
in-place correction rewrite with a dated note, and rot-check state diffing
(second run reports 0 new findings).

**Result (2026-11-10): 47 passed, 0 failed.** (The earlier 39-assertion
version, run 2026-10-31, tested the former API-key extractor.) Exit code 0 requires every
assertion to hold, so the test is a gate, not a smoke test.

**What this can and cannot show:** it proves the deterministic steps behave
as designed on controlled inputs, including that partial matches are flagged
rather than upgraded. It cannot show extraction recall/precision on real
curricula, behavior against real-world anti-bot systems, or that humans
actually act on the ledger.

## 4. Agent-run extraction (no API key)

Extraction is done by an AI agent the user already works with. The script
never calls a model:

1. `npm run extract -- --prepare --content <dir>` writes
   `extract-work/request.md` (instructions plus every content file).
2. The agent reads it and writes `extract-work/agent-claims.json`.
3. `npm run extract -- --claims extract-work/agent-claims.json --content <dir> --extractor "<agent and model name>"`
   imports only claims found verbatim in the content, lists rejected ones,
   computes `file:line` locally, and records `extract_method` in the ledger.
4. Complete the human gate (see `evaluation/human-protocol/`), then
   `npm run verify && npm run report`.

**What was actually run (2026-11-10):** the build agent (Kiro) ran steps 1
to 3 on the two fixture files. It returned 7 claims; 7 were accepted by the
verbatim check and 0 rejected. All 6 seeded claims were among them; the 7th
is the department's four-year accreditation cycle. Files:
`evaluation/agent-extract-fixture-run/agent-claims.json` (the agent's answer)
and `evaluation/agent-extract-fixture-run/claims.json` (the imported ledger,
human gate not done).

**What this can and cannot show:** it shows the agent-run path works end to
end without a key. It does not measure extraction quality: the agent knew
which claims were seeded, the content is fictional, and it is a single run
by a single agent. A real-corpus run with independently counted claims is
still needed for precision and recall.

## 5. Honesty rules encoded in the tool

- Verifier notes and ledger disclaimers state that a green ledger is not a
  certification.
- VERIFIED-SNIPPET is never merged into VERIFIED by the machine.
- ACCESS-RESTRICTED sources are never retried with alternate identities.
- `--dry-run` output is quarantined in `dry-run/` and labeled; it must never
  be used as results.
- Fixture content and publishers are fictional and labeled as such.
