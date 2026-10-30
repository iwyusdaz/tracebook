#!/usr/bin/env node
// TraceBook — step 3: VERIFY (fully deterministic, no LLM, no API keys).
//
// For every claim in the ledger:
//   1. fetch the claim's source_url (public access only; 401/402/403 sources
//      are labeled ACCESS-RESTRICTED, never circumvented)
//   2. quote-back match the stored source sentence against the fetched text
//   3. assign a verdict from the fixed vocabulary:
//        VERIFIED          — stored quote found verbatim, numbers consistent
//        VERIFIED-SNIPPET  — partial match (possible drift or paraphrase);
//                            never silently upgraded to VERIFIED
//        UNVERIFIED        — unreachable, restricted, quote not found,
//                            or numbers in the claim contradict the quote
//        CORRECTED         — human applied a correction (kept from the ledger)
//        NOT-APPLICABLE    — human marked the claim as not verifiable this way
//
// Usage: node src/verify.mjs [--ledger ledger/claims.json] [--out ledger/claims-verified.json]
//        [--concurrency 4] [--timeout-ms 20000]

import {
  fetchSourceText,
  quoteBackMatch,
  numericMismatches,
  readLedger,
  writeLedger,
  todayISO,
} from "./lib.mjs";

const SNIPPET_THRESHOLD = 0.8; // token-overlap similarity for VERIFIED-SNIPPET

function parseArgs(argv) {
  const args = { ledger: "ledger/claims.json", out: "ledger/claims-verified.json", concurrency: 4, timeoutMs: 20000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--ledger") args.ledger = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--concurrency") args.concurrency = Math.max(1, parseInt(argv[++i], 10) || 4);
    else if (a === "--timeout-ms") args.timeoutMs = parseInt(argv[++i], 10) || 20000;
    else if (a === "--help" || a === "-h") args.help = true;
    else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  if (args.help) {
    console.log("Usage: node src/verify.mjs [--ledger PATH] [--out PATH] [--concurrency N] [--timeout-ms MS]");
    process.exit(0);
  }
  return args;
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

function verifyOne(claim, { timeoutMs }) {
  // Human-locked verdicts are never overwritten by the machine.
  if (claim.locked === true && claim.verdict) {
    return { claim, check: { machine_verdict: claim.verdict, reason: "HUMAN-LOCKED (not re-checked)" } };
  }
  if (claim.verdict === "NOT-APPLICABLE") {
    return { claim, check: { machine_verdict: "NOT-APPLICABLE", reason: claim.na_reason || "human marked not applicable" } };
  }
  if (claim.verdict === "CORRECTED") {
    // A corrected claim is re-checked like any other: does the (corrected)
    // stored quote still back it? The human keeps the CORRECTED label unless
    // they re-lock the claim.
    return { claim, check: null, refetch: true };
  }
  return { claim, check: null, refetch: true };
}

async function checkAgainstSource(claim, { timeoutMs }) {
  if (!claim.stored_quote || !String(claim.stored_quote).trim()) {
    return {
      machine_verdict: "UNVERIFIED",
      reason: "NO-STORED-QUOTE",
      note:
        "Quote-back verification requires the exact source sentence in stored_quote. " +
        "Add it after reading the source, then re-run verify.",
    };
  }
  if (!claim.source_url) {
    return { machine_verdict: "UNVERIFIED", reason: "NO-SOURCE-URL", note: "No source_url recorded for this claim." };
  }

  const fetched = await fetchSourceText(claim.source_url, { timeoutMs });

  if (fetched.restricted) {
    return {
      machine_verdict: "UNVERIFIED",
      reason: "ACCESS-RESTRICTED",
      http_status: fetched.status,
      note:
        `Source returned HTTP ${fetched.status} (paywalled or blocks automated access). ` +
        "TraceBook labels this honestly and the source was not circumvented. " +
        "Verify by hand with legitimate access.",
    };
  }
  if (!fetched.ok) {
    return {
      machine_verdict: "UNVERIFIED",
      reason: "SOURCE-UNREACHABLE",
      http_status: fetched.status,
      note: fetched.error,
    };
  }

  const match = quoteBackMatch(claim.stored_quote, fetched.text);

  if (match.verbatim) {
    const mismatches = numericMismatches(claim.claim, claim.stored_quote);
    if (mismatches.length > 0) {
      return {
        machine_verdict: "UNVERIFIED",
        reason: "NUMERIC-MISMATCH",
        note:
          `The stored quote was found in the source, but the claim states number(s) ` +
          `[${mismatches.join(", ")}] that do not appear in the quote. The claim likely ` +
          `misstates the source. Quote says: "${String(claim.stored_quote).slice(0, 300)}"`,
      };
    }
    return { machine_verdict: "VERIFIED", reason: "QUOTE-FOUND", note: "Stored quote found verbatim in the live source; numbers consistent." };
  }

  if (match.similarity >= SNIPPET_THRESHOLD) {
    return {
      machine_verdict: "VERIFIED-SNIPPET",
      reason: "PARTIAL-MATCH",
      similarity: match.similarity,
      note:
        `Partial quote-back match (similarity ${match.similarity}). The source text differs ` +
        "from the stored quote — possible content drift or a paraphrase. Human judgment required; " +
        "never treated as fully verified.",
    };
  }

  return {
    machine_verdict: "UNVERIFIED",
    reason: "QUOTE-NOT-FOUND",
    similarity: match.similarity,
    note:
      `Stored quote not found in the live source (similarity ${match.similarity}). ` +
      "Either the source changed (content drift), the quote was mis-transcribed, or the " +
      "source never contained it. Human judgment required.",
  };
}

export async function runVerify({ ledger: ledgerPath, out: outPath, concurrency = 4, timeoutMs = 20000 }) {
  const ledger = readLedger(ledgerPath);
  const claims = ledger.claims;
  let done = 0;

  await mapLimit(claims, concurrency, async (claim, idx) => {
    const pre = verifyOne(claim, { timeoutMs });
    let check;
    if (pre.refetch) {
      check = await checkAgainstSource(claim, { timeoutMs });
    } else {
      check = pre.check;
    }
    const out = { ...claim };
    out.verdict = check.machine_verdict;
    out.verification = {
      checked_at: todayISO(),
      reason: check.reason || null,
      similarity: check.similarity ?? null,
      http_status: check.http_status ?? null,
      note: check.note || null,
      method: "deterministic quote-back (tracebook verify.mjs)",
    };
    // Keep any existing human correction_note; verifier notes are separate.
    claims[idx] = out;
    done++;
    process.stderr.write(`  [${done}/${claims.length}] ${claim.id || "(no id)"} -> ${out.verdict}${check.reason ? ` (${check.reason})` : ""}\n`);
  });

  const verifiedLedger = {
    ...ledger,
    generated: new Date().toISOString(),
    verified_at: todayISO(),
    claims,
  };
  writeLedger(outPath, verifiedLedger);

  const counts = {};
  for (const v of ["VERIFIED", "VERIFIED-SNIPPET", "UNVERIFIED", "CORRECTED", "NOT-APPLICABLE"]) {
    counts[v] = claims.filter((c) => c.verdict === v).length;
  }
  return { ledger: verifiedLedger, counts };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  console.error(`TraceBook verify — ledger: ${args.ledger} -> ${args.out}`);
  runVerify(args)
    .then(({ counts }) => {
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      console.log("\nVerification summary:");
      for (const [v, n] of Object.entries(counts)) console.log(`  ${v.padEnd(18)} ${n}`);
      console.log(`  ${"TOTAL".padEnd(18)} ${total}`);
      console.log(
        "\nNOTE: a green ledger surfaces claims for human judgment; it does NOT certify content as fact-checked."
      );
      const blocked = counts["UNVERIFIED"];
      process.exitCode = 0; // verification is a report, not a gate: humans decide
      if (blocked > 0) console.log(`\n${blocked} claim(s) UNVERIFIED — review them in ${args.out} before publishing.`);
    })
    .catch((err) => {
      console.error(`verify failed: ${err.message}`);
      process.exit(1);
    });
}

if (import.meta.url === `file://${process.argv[1]}`) main();
