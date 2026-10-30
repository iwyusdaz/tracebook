# Human review protocol — TraceBook verdicts

This folder holds the protocol and templates for the human step of the
pipeline (the "GATE") and for periodic human re-review of the ledger.
Nothing here is automated; that is the point.

## 1. The human gate (per extraction)

After `npm run extract`, for every claim in `ledger/claims.json`:

1. Open `source_url`. If the URL is wrong, fix it or clear it — do not
   verify against a source you did not read.
2. Copy the **exact sentence** from the source that the claim relies on into
   `stored_quote`. One sentence; no paraphrase.
3. Record `source_publisher` and today's date in `access_date`.
4. If the claim misstates the source, prepare a correction:
   - set `correction_note` (what was wrong and what the source says),
   - add `suggested_correction: { find, replace }` with the exact text to
     replace in the file named by `location`,
   - leave `apply_correction: false` until you are ready to approve it.
5. Set `confidence` (how sure you are this claim is checkable — not that it
   is true). Mark claims that cannot be checked this way as
   `verdict: "NOT-APPLICABLE"` with an `na_reason`.

Then run `npm run verify && npm run report`.

## 2. Acting on verdicts

| Verdict | Required human action |
|---|---|
| VERIFIED | Optional spot-check. Numbers were matched automatically. |
| VERIFIED-SNIPPET | **Required.** Compare `stored_quote` with the live source; decide drift vs. paraphrase; update `stored_quote` if the source legitimately changed. |
| UNVERIFIED (ACCESS-RESTRICTED) | Verify by hand with legitimate access, or remove/re-source the claim. |
| UNVERIFIED (SOURCE-UNREACHABLE) | Find the new location of the source or re-source the claim. |
| UNVERIFIED (NUMERIC-MISMATCH) | Fix the content (see corrections) or fix the claim. |
| UNVERIFIED (QUOTE-NOT-FOUND) | Treat as possible drift or fabricated quote; resolve by hand. |
| CORRECTED | Nothing; content was fixed with a note. Spot-check the note. |
| NOT-APPLICABLE | Nothing. |

To approve a prepared correction, set `apply_correction: true` on the claim
and run `npm run report -- --correct`. The tool rewrites the file, leaves a
dated note, and locks the claim.

## 3. Weekly rot findings (from the GitHub Action)

The weekly check opens one issue per new finding. For each issue:

1. Open the source URL in a browser.
2. If the source moved: update `source_url`, re-read it, update
   `stored_quote`, re-run verify.
3. If the content changed: decide whether the claim still holds. Update the
   claim or prepare a correction as above.
4. Close the issue only when the ledger has been updated.

## 4. Reviewer log template

Keep a dated log (e.g., `evaluation/human-review-log.md`) with one entry per
review session:

```
## YYYY-MM-DD — reviewer name — ledger commit hash
- Claims reviewed: <ids>
- Verdicts changed by hand: <ids + reason>
- Corrections approved: <ids>
- Claims re-sourced: <ids>
- Open questions: ...
```

## 5. Consent / data notes

No human participants are involved in running TraceBook. If you later pilot
TraceBook with real curriculum teams, collect informed consent before any
observation and do not commit content you do not have rights to publish.
