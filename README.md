# TraceBook

Course content in, evidence ledger out. A CLI + GitHub Action that extracts
factual claims from curriculum content, verifies each against its cited
primary source with deterministic quote-back matching, and emits a versioned
claims ledger — then re-checks every source weekly so citations can't rot
silently.

**[Live demo](https://iwyusdaz.github.io/tracebook/) · [Fixture ledger](https://iwyusdaz.github.io/tracebook/demo.html) · Role: Sole designer & developer**

> **Evaluation status:** The fixture negative test (47 assertions) passes and
> all seeded errors are caught. The extract step is agent-run and needs no API
> key; it has been run once, by the build agent, on the fixture content only.
> No real-world curriculum corpus has been run through the full pipeline yet
> (see [Honest limits](#honest-limits)). See `evaluation/METHODS.md`.

---

## The problem

Every curriculum artifact makes factual claims — an effect size, a legal
effective date, a platform version string. Verification is done by hand,
once, and then silently rots: sources move, versions bump, claims drift from
their citations, and nobody notices until a learner does.

The workflow this tool automates — claim → source → URL → access date →
verdict → correction note — is the one that was previously done manually,
claim by claim, across a seven-repo portfolio. TraceBook productizes it.

## Audience and context

Curriculum developers, instructional designers, education researchers, and
L&D content teams who maintain course material over months or years and need
citations that stay honest.

## How it works

```
curriculum content (md / html / txt)
  │
  ├─ 1. EXTRACT      src/extract.mjs: your AI agent pulls atomic factual
  │                  claims; the script imports only verbatim claims and
  │                  computes file:line locations (no API key, no network)
  ├─ 2. LEDGER       ledger/claims.json — the HUMAN GATE: you read each source
  │                  and record the exact source sentence (stored_quote)
  ├─ 3. VERIFY       src/verify.mjs — deterministic fetch + quote-back match;
  │                  verdicts: VERIFIED / VERIFIED-SNIPPET / UNVERIFIED /
  │                  CORRECTED / NOT-APPLICABLE
  ├─ 4. REPORT       src/report.mjs — CLAIMS.md table + summary counts;
  │                  human-approved corrections rewrite content in place
  │                  with a dated correction note
  └─ 5. ROT CHECK    src/rot-check.mjs + action/ — weekly GitHub Action
                     re-fetches every source_url, flags link rot, access
                     restrictions and content drift, opens an issue per
                     NEW finding
```

The differentiator is **quote-back matching**: the ledger stores the exact
sentence the claim relies on, so verification is a string comparison —
deterministic, repeatable, and cheap enough to run weekly. A working link is
not evidence; the stored quote is what makes drift detectable.

Only step 1 involves AI, and it runs through an agent you already use (for
example a coding agent in your editor or terminal), not through an API key.
The script itself never calls a model. Steps 3 to 5 are plain Node scripts
with zero dependencies.

## Quick start

```bash
git clone https://github.com/iwyusdaz/tracebook.git
cd tracebook
npm test                        # negative test: all seeded errors caught
npm run extract -- --prepare --content <dir>   # 1a. write extract-work/request.md
#    give request.md to your AI agent; it writes extract-work/agent-claims.json
npm run extract -- --claims extract-work/agent-claims.json --content <dir> \
  --extractor "<agent and model name>"         # 1b. import verbatim claims only
#    human gate: read sources, fill stored_quote in ledger/claims.json
npm run verify                  # 3. deterministic verification
npm run report                  # 4. CLAIMS.md + summary counts
npm run report -- --correct     #    apply human-approved corrections in place
npm run rot-check               # 5. one-off rot check (also runs weekly in CI)
```

Requirements: Node 20+. No `npm install` (there are no dependencies) and no
API key. `npm run extract -- --dry-run` writes labeled stubs to test the
plumbing only.

### Using the GitHub Action in your own repo

Commit a ledger at `ledger/claims-verified.json`, then:

```yaml
- uses: iwyusdaz/tracebook/action@main
  with:
    ledger-path: ledger/claims-verified.json
    open-issues: 'true'
```

The repo's own [weekly workflow](.github/workflows/rot-check.yml) runs the
same action every Monday 06:00 UTC and opens one issue per new finding
(link rot, access restriction, content drift). It skips the scheduled run
while the ledger only references local fixture sources.

## Evidence and evaluation

**What was measured:** the negative test (`npm test`) runs the full pipeline
against a fixture content set containing five seeded errors and one correct
control claim, and asserts the exact verdict for each:

| Fixture | Seeded error | Result |
|---|---|---|
| C001 | Wrong statistic (0.41 SD; source says 0.10–0.20 SD) | UNVERIFIED — `NUMERIC-MISMATCH` |
| C002 | Control: correct claim | VERIFIED — `QUOTE-FOUND` |
| C003 | Paywalled source (HTTP 403) | UNVERIFIED — `ACCESS-RESTRICTED`, not circumvented |
| C004 | Stale version string (3.8.5 vs live 4.2.1) | UNVERIFIED — `QUOTE-NOT-FOUND` |
| C005 | Drifted wording ("rereading" vs "restudying") | VERIFIED-SNIPPET — flagged, never silently upgraded |
| C006 | Dead link (HTTP 404) | UNVERIFIED — `SOURCE-UNREACHABLE` |

**Result: 47/47 assertions pass; the pipeline refuses to green-light every
seeded error.** The test also proves: the extractor contains no network
code; it imports only claims found verbatim in the content, rejects the
rest, and computes `file:line` itself; `--dry-run` writes stubs labeled
"DRY RUN – NOT REAL RESULTS"; `report --correct` rewrites the wrong
statistic in place with a dated correction note; and the rot-check flags the
dead link, the paywall, and both changed sources, with no duplicate findings
on the second run.

**Agent-run extraction on the fixtures:** the build agent (Kiro) followed
`npm run extract -- --prepare` on the two fixture files and returned 7
claims; all 7 passed the verbatim import check, and all 6 seeded claims were
among them (the 7th is the department's four-year accreditation cycle). This
shows the agent-run path works end to end. It is not a measure of
extraction quality: the agent knew which claims were seeded, and it is one
run by one agent. Output: `evaluation/agent-extract-fixture-run/`.

**What this evidence can and cannot show:** it proves the deterministic
pipeline behaves as designed on controlled fixtures. It cannot show how well
agent-run extraction performs on real curricula, nor that real-world
sources stay reachable. No real corpus has been run through the full
pipeline yet.

**What it led to:** the fixture run's live ledger is published as the demo
([docs/demo.html](https://iwyusdaz.github.io/tracebook/demo.html)), and the
verdict threshold for partial matches (0.8 similarity) was chosen so drifted
wording is flagged VERIFIED-SNIPPET while fully changed sources fall through
to UNVERIFIED.

See `evaluation/METHODS.md` for the full methods note.

## Key design decisions

1. **Quote-back matching over trust-the-link** — a stored exact sentence
   makes verification a deterministic string comparison; alternatives
   considered (LLM judging, embedding similarity) are non-deterministic and
   would hide drift behind a model's opinion.
2. **Corrections rewrite content, not just reports** — with a human's
   `apply_correction: true` flag, the wrong sentence is replaced in place and
   a dated note is left in the file; nothing is corrected automatically.
3. **Honest labeling of restricted sources** — 401/402/403 sources are
   labeled `ACCESS-RESTRICTED`; the tool never retries with other identities
   or circumvents paywalls.
4. **Extraction is agent-run and checked on import.** No API key and no
   network calls: your agent writes a JSON answer, and the script imports
   only claims that appear verbatim in the content. `--dry-run` stubs are
   labeled and quarantined in `dry-run/`.
5. **Machine-verifiable honesty** — partial matches are a separate verdict
   (`VERIFIED-SNIPPET`), so nothing is ever silently upgraded to verified.

## Honest limits

- A green ledger is **not** "fact-checked content". TraceBook surfaces
  claims and evidence for human judgment; it does not certify anything.
- Verification quality depends on source accessibility; paywalled sources
  stay honestly labeled UNVERIFIED until a human with legitimate access
  checks them.
- Quote-back matching can false-positive on heavily paraphrased sources —
  those land in VERIFIED-SNIPPET and require human review.
- Claim extraction is done by an AI agent and is imperfect: it can miss
  claims or propose wrong sources. The verbatim import check catches
  invented claim text, not missed claims. The human gate exists for this
  reason.
- Content formats today: Markdown, HTML, plain text. Convert DOCX first.
- The GitHub Action's issue-opening path is validated for YAML syntax and
  API usage but has not run against a live repository trigger yet.

## Accessibility

The [case-study site](https://iwyusdaz.github.io/tracebook/) is plain HTML/CSS
with no JavaScript dependencies. It follows the project's accessibility
baseline: `lang` attribute, one `<h1>` per page in a logical heading order,
a skip link, visible focus outlines, informative `alt`/`title`/`desc` text on
the SVG diagram (no decorative images), link text that makes sense out of
context, text contrast ≥ 4.5:1 (checked for every color pair in
`docs/styles.css`), and reflow at 320 px width. Known issue: the ledger
tables are wide; on small screens they scroll horizontally within the page
(the `<pre>`/table containers scroll rather than breaking layout). The site
has not yet been manually tested with a screen reader — that is a stated
limitation, not a claim of conformance.

## Tools used

- Node.js (built-ins only — zero runtime dependencies)
- GitHub Actions (weekly rot check), GitHub REST API for issue creation
- PyYAML/ruby for workflow YAML syntax validation
- gitleaks (secret scanning before publication)
- AI assistance for authoring, disclosed above and reviewed by the owner

## What I'd do differently / next steps

- Dogfood agent-run extraction on a real curriculum corpus and report
  precision and recall of extracted claims (currently the fixture ledger is
  hand-authored to isolate the deterministic steps).
- Add DOCX support via an optional converter.
- Track per-claim verdict history so drift can be shown over time, not just
  flagged once.

## License and attribution

Code: [MIT](LICENSE). Documentation and fixture content: CC BY 4.0.
Inspirations and adopted patterns (not code) are credited in
[ATTRIBUTION.md](ATTRIBUTION.md).

## AI-disclosure

This repository was authored with AI assistance and reviewed by the
repository owner, who takes responsibility for its content. The fixture
content, sources, and publisher names are fictional and labeled as such.
No model produced the committed fixture ledger: its claims are
hand-authored, and its verdicts come from the deterministic verifier against
local fixture pages. The separate agent-run extraction in
`evaluation/agent-extract-fixture-run/` was done by the build agent (Kiro)
and is labeled as such.
