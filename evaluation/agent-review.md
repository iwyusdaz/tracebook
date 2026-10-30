# Agent review (independent)

## Review setup

- **Method:** fresh-context agent review, conducted after the build was
  complete by an agent that did not participate in the build.
- **Date:** 2026-10-31
- **Disclosed limitation (same-model risk):** the reviewer agent may run on
  the same underlying model family as the builder agent. A model reviewing
  a model's work shares blind spots and biases; this review is therefore
  *independent of the build process* but **not independent of the model**.
  It is a gap-finding pass, not expert endorsement, and not a substitute
  for human review.
- **Basis:** local repository files at commit `504a57b` (plus the fixes
  listed below), `npm test` executed by this reviewer, `gitleaks detect`
  executed by this reviewer, and small empirical probes written against
  `src/lib.mjs` / `src/verify.mjs` to exercise edge cases the fixture test
  does not cover. The prior `evaluation/agent-review.md` was discovered to
  be the builder's own mid-build notes; it has been renamed
  `evaluation/build-notes.md` and relabeled. Its four findings were
  spot-checked by this reviewer (all four are real and are now covered by
  the negative test).

## Test result (run by this reviewer)

`npm test`: **39 passed, 0 failed** — all six fixture verdicts and reasons
assert, placeholder refusal, dry-run labeling, in-place correction, and
rot-check state diffing all hold. `gitleaks detect` (working tree and full
git history): **no leaks found**.

## (a) Honesty audit

- **Green ledger vs "fact-checked":** no text found that equates them. The
  disclaimer appears in `README.md` (§ Honest limits), `CLAIMS.md` (header
  block), `docs/index.html` (notice), both ledger `note` fields, and the
  verifier's CLI output. PASS.
- **Fixture/dry-run artifact labeling:** dry-run stubs are labeled
  "DRY RUN – NOT REAL RESULTS", quarantined in `dry-run/`, and
  gitignored. Fixture content and publishers are labeled fictional.
  PASS.
- **Fixture ledger provenance:** **finding (fixed during this review).**
  The committed fixture ledgers carried
  `"generator": "tracebook demo ledger (fixture run)"`, and `docs/demo.html`
  said "actual output of `npm run verify` and `npm run report`" without
  saying that the *input* claims and stored quotes were hand-authored (the
  LLM extract step has never been run — it needs an API key). The README
  did disclose hand-authoring, but a reader of the ledger JSON or the demo
  page alone could wrongly conclude the extract step produced the claims.
  **Fixed:** `generator` fields in `ledger/claims.json` and
  `ledger/claims-verified.json` and the demo page now state hand-authoring
  explicitly.

## (b) `npm test` (run by this reviewer)

PASS — 39/39 assertions, exit code 0. Details above.

## (c) Correctness spot-checks (probes beyond the negative test)

Probes were run as throwaway scripts in `/tmp` against the real modules;
nothing in the repo was modified by them. Findings:

| # | Finding | Severity | Status |
|---|---|---|---|
| C1 | `htmlToText` (`src/lib.mjs`) does not decode numeric/hex character references (`&#8217;`, `&#x27;`); only a fixed list of named entities plus the catch-all `&[a-z]+;` are handled. A source page that entity-encodes an apostrophe inside the stored sentence fails quote-back: probe measured similarity 0.6 for a quote that a reader sees verbatim on the page → false `QUOTE-NOT-FOUND` / false `CONTENT-DRIFT` in rot-check. Failure direction is honest (never a false VERIFIED), but it creates false alarms. | Medium | **Open** — needs an entity-decoding pass in `htmlToText` plus a test fixture. |
| C2 | Non-UTF-8 source pages: `fetchSourceText` uses `res.text()`, which always decodes UTF-8 and ignores the `charset` header. A Latin-1 or GBK page garbles; probe on a Latin-1 page gave similarity 0.875 for a quote that is verbatim in the real page → lands as VERIFIED-SNIPPET (or UNVERIFIED) instead of VERIFIED. Weekly rot-checks against non-English sources will raise false CONTENT-DRIFT. | Medium | **Open** — should decode per the `content-type` charset before matching, or label pages whose charset is not UTF-8. |
| C3 | Duplicate claim IDs: `runVerify` writes results by array index, so duplicates do not corrupt each other (probe: two `C001` rows verified independently, order preserved). However `rot-check` dedupes on `id|url`, so two claims sharing an ID and URL collapse to one state key — resolving one masks the other in the diff. No uniqueness check exists anywhere. | Low | **Open** — an ID-uniqueness warning in `readLedger` would close it. |
| C4 | `report --correct` writes the in-memory `_source_file` convenience field back into the ledger JSON (probe: `_source_file` appears in the written file). Cosmetic pollution of a versioned file. | Low | **Open** — serialize a copy without `_source_file`. |
| C5 | Redirect chains are followed (`redirect: "follow"`) and the final URL is captured in `finalUrl`, but it is never persisted to the ledger or report; verification records only the original `source_url`. An audit trail cannot show where a fetch actually landed. | Low | **Open** — persist `final_url` into `verification`. |
| C6 | `action/action.yml` interpolates `inputs.*` directly into double-quoted shell (`ARGS=(--ledger "${{ inputs.ledger-path }}" ...)`) and into `node -e` strings. Double quotes do not stop bash command substitution, so a caller passing hostile input to this reusable action can execute script in the runner. Realistic risk is low (inputs are usually repo-owned), but the pattern should not ship in a reusable action. | Low | **Open** — route inputs through env vars, not string interpolation. |
| C7 | `quoteBackMatch` windows the source with step = window/4; the best-scoring window can be missed, so similarity is a lower bound. This makes the 0.8 threshold boundary-sensitive in both directions. Deterministic and acceptable, but worth documenting as a known approximation. | Info | **Open** (document) |
| C8 | `extract.mjs` computes the output directory as `join(repoRoot, args.out, "..")`, which produces a wrong path for absolute `--out` values (write then fails if the parent dir is absent). Default/relative paths work. | Info | **Open** |

Also checked and found sound: missing-field handling in
`checkAgainstSource` (`NO-STORED-QUOTE`, `NO-SOURCE-URL`), the multiset
overlap math in `quoteBackMatch`, `mapLimit`'s shared-counter concurrency
(index-based, race-free), locked/NOT-APPLICABLE/CORRECTED verdict handling,
and the fixture-only guard's regex in the weekly workflow.

## (d) Repo hygiene

- LICENSE (MIT), ATTRIBUTION.md (explicit "no code copied"), .gitignore
  (covers `.env*` except `.env.example`, `dry-run/`, `tests/.tmp/`),
  `.env.example` with placeholders the code actually refuses. PASS.
- `gitleaks detect` on the working tree and over all 6 commits: no leaks. PASS.
- Minor: nothing. Hygiene is clean.

## (e) Docs site accessibility spot-check (view-source)

`docs/index.html` and `docs/demo.html`: `lang="en"`, exactly one `<h1>` per
page with logical h1→h2→h3 order, skip link targeting `#main`, tables with
`<caption>` and `th scope="col"`, the pipeline SVG has `role="img"` +
`aria-labelledby` pointing to `<title>`/`<desc>`, no `<img>` elements at
all, links have out-of-context-sensible text, and `styles.css` documents a
contrast ratio for each foreground/background pair (claimed 6.9:1–13.9:1;
spot-arithmetic on `--muted` #4a5568 vs white ≈ 7.5:1 supports the claim).
Not done by this reviewer (needs a browser/AT session): actual focus
behavior, 320 px reflow, and screen-reader output. The README already
states those limits. PASS at source level.

## (f) README accuracy vs the CLI

Every documented command and flag exists and behaves as described:
`npm test`; `npm run extract -- --dry-run` (and `--content/--out/
--max-claims/--force`); `npm run verify` (`--ledger/--out/--concurrency/
--timeout-ms`); `npm run report -- --correct`; `npm run rot-check`
(`--ledger/--state/--report/--concurrency/--open-issues/--dry-run`);
`.env` variables match `.env.example` and the code (`MODEL_A_*`); the
action usage block matches `action/action.yml` inputs; the "39 assertions"
and per-claim verdict table match the actual test. PASS — no inaccuracies
found.

## Summary of review actions

- **Fixed during review:** builder notes relabeled (`agent-review.md` →
  `build-notes.md`); hand-authored provenance added to both committed
  ledgers and the demo page; CHANGELOG pointer updated.
- **Open findings for the owner:** C1 (numeric entity decoding, medium),
  C2 (non-UTF-8 pages, medium), C3 (duplicate IDs), C4 (`_source_file`
  pollution), C5 (`final_url` not persisted), C6 (action input
  interpolation), C7/C8 (info).
- **Cannot verify from here:** real-model extraction quality, the
  workflow's live issue-opening path on GitHub, screen-reader behavior.
