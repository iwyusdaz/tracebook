#!/usr/bin/env node
// TraceBook — step 5: ROT CHECK (deterministic; designed to run weekly in CI).
//
// Re-fetches every source_url in the ledger and flags:
//   LINK-ROT         — source now unreachable (4xx/5xx, DNS failure, timeout)
//   ACCESS-RESTRICTED — source now returns 401/402/403 (labeled, never circumvented)
//   CONTENT-DRIFT    — page still reachable, but the stored quote no longer
//                      appears verbatim (the source text changed)
//
// Findings are diffed against ledger/rot-state.json (last run's results);
// only NEW findings become issues. Issue creation uses the GitHub REST API
// with GITHUB_TOKEN + GITHUB_REPOSITORY (as provided in GitHub Actions).
// Locally (no token), findings are written to ledger/rot-report.json only.
//
// Usage: node src/rot-check.mjs [--ledger ledger/claims-verified.json]
//        [--state ledger/rot-state.json] [--report ledger/rot-report.json]
//        [--concurrency 4] [--open-issues] [--dry-run]

import {
  fetchSourceText,
  quoteBackMatch,
  readLedger,
  readJsonIfExists,
  writeJson,
  todayISO,
} from "./lib.mjs";

function parseArgs(argv) {
  const args = {
    ledger: "ledger/claims-verified.json",
    state: "ledger/rot-state.json",
    report: "ledger/rot-report.json",
    concurrency: 4,
    openIssues: false,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--ledger") args.ledger = argv[++i];
    else if (a === "--state") args.state = argv[++i];
    else if (a === "--report") args.report = argv[++i];
    else if (a === "--concurrency") args.concurrency = Math.max(1, parseInt(argv[++i], 10) || 4);
    else if (a === "--open-issues") args.openIssues = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else { console.error(`Unknown argument: ${a}`); process.exit(2); }
  }
  if (args.help) {
    console.log("Usage: node src/rot-check.mjs [--ledger PATH] [--state PATH] [--report PATH] [--open-issues] [--dry-run]");
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

/** Check a single claim's source. Returns null when everything is fine. */
function checkClaim(claim) {
  const url = claim.source_url;
  if (!url) return null; // nothing to re-fetch

  const key = `${claim.id || "no-id"}|${url}`;
  if (claim.locked === true && claim.verdict === "NOT-APPLICABLE") return null;

  return fetchSourceText(url).then((fetched) => {
    if (fetched.restricted) {
      return {
        key,
        claim_id: claim.id,
        claim: claim.claim,
        url,
        type: "ACCESS-RESTRICTED",
        detail: `HTTP ${fetched.status} — source now restricts automated access (paywall or bot-blocking). Labeled honestly; not circumvented. Previously this source was fetchable.`,
      };
    }
    if (!fetched.ok) {
      return {
        key,
        claim_id: claim.id,
        claim: claim.claim,
        url,
        type: "LINK-ROT",
        detail: fetched.error || "source unreachable",
      };
    }
    if (!claim.stored_quote || !String(claim.stored_quote).trim()) return null;
    const match = quoteBackMatch(claim.stored_quote, fetched.text);
    if (!match.verbatim) {
      return {
        key,
        claim_id: claim.id,
        claim: claim.claim,
        url,
        type: "CONTENT-DRIFT",
        detail:
          `The stored quote no longer appears verbatim in the source (similarity ${match.similarity}). ` +
          "The source text changed since the ledger was made. Compare the stored quote with the live page.",
        stored_quote: claim.stored_quote,
      };
    }
    return null;
  });
}

async function createGitHubIssue(finding, { repo, token, dryRun }) {
  const title = `[claims-rot] ${finding.type}: ${finding.claim_id || finding.url}`;
  const body =
    `TraceBook weekly claims-rot check found a **new** issue.\n\n` +
    `- **Type:** ${finding.type}\n` +
    `- **Claim:** ${finding.claim_id || "(no id)"} — ${finding.claim || ""}\n` +
    `- **Source URL:** ${finding.url}\n\n` +
    `**Detail:** ${finding.detail}\n\n` +
    (finding.stored_quote ? `**Stored quote:**\n> ${finding.stored_quote}\n\n` : "") +
    `_This issue was opened automatically by the tracebook rot-check action. ` +
    `A flagged source is not proof the claim is wrong — a human must compare the ` +
    `stored quote with the live source and update the ledger._`;
  if (dryRun || !token || !repo) {
    return { created: false, reason: !token || !repo ? "no GITHUB_TOKEN/GITHUB_REPOSITORY (local run)" : "dry-run", title, body };
  }
  const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "user-agent": "tracebook-rot-check",
    },
    body: JSON.stringify({ title, body, labels: ["claims-rot"] }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { created: false, reason: `GitHub API ${res.status}: ${text.slice(0, 200)}`, title, body };
  }
  const data = await res.json();
  return { created: true, url: data.html_url, title, body };
}

export async function runRotCheck(args) {
  const ledger = readLedger(args.ledger);
  const state = readJsonIfExists(args.state, { checked_at: null, findings: {} });
  const claims = ledger.claims.filter((c) => c.source_url);

  process.stderr.write(`TraceBook rot-check — re-fetching ${claims.length} source URL(s)...\n`);
  const findings = (await mapLimit(claims, args.concurrency, checkClaim)).filter(Boolean);

  // Diff against last run: only NEW findings (not seen at the same key last time).
  const previous = state.findings || {};
  const newFindings = findings.filter((f) => !previous[f.key]);
  const resolved = Object.keys(previous).filter((k) => !findings.some((f) => f.key === k));

  const report = {
    checked_at: new Date().toISOString(),
    ledger: args.ledger,
    urls_checked: claims.length,
    findings_total: findings.length,
    findings_new: newFindings.length,
    findings_resolved_since_last_run: resolved.length,
    findings,
    note:
      "Findings are prompts for human review, not verdicts. Content drift means the " +
      "source changed, not necessarily that the claim became wrong.",
  };
  writeJson(args.report, report);

  // Persist current state for next run's diff.
  const newState = { checked_at: report.checked_at, findings: {} };
  for (const f of findings) {
    newState.findings[f.key] = { type: f.type, seen_at: report.checked_at };
  }
  writeJson(args.state, newState);

  let issuesOpened = 0;
  if (args.openIssues && newFindings.length > 0) {
    const repo = process.env.GITHUB_REPOSITORY;
    const token = process.env.GITHUB_TOKEN;
    for (const f of newFindings) {
      const res = await createGitHubIssue(f, { repo, token, dryRun: args.dryRun });
      process.stderr.write(`  issue: ${res.created ? "opened " + res.url : `NOT opened (${res.reason})`} — ${res.title}\n`);
      if (res.created) issuesOpened++;
    }
  }

  return { report, newFindings, issuesOpened };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  runRotCheck(args)
    .then(({ report, newFindings }) => {
      console.log(`\nRot check summary: ${report.urls_checked} URL(s) checked, ` +
        `${report.findings_total} finding(s), ${report.findings_new} new, ` +
        `${report.findings_resolved_since_last_run} resolved since last run.`);
      for (const f of findingsSorted(newFindings)) {
        console.log(`  NEW ${f.type.padEnd(18)} ${f.claim_id || "-"} ${f.url}`);
      }
      console.log(`Report: ${args.report}`);
      if (!process.env.GITHUB_TOKEN) {
        console.log("Local mode: no GITHUB_TOKEN set, so no issues were opened. In GitHub Actions the weekly workflow opens one issue per new finding.");
      }
      if (newFindings.length > 0) process.exitCode = 2; // signal findings to CI without failing the run's purpose
    })
    .catch((err) => {
      console.error(`rot-check failed: ${err.message}`);
      process.exit(1);
    });
}

function findingsSorted(fs) {
  return [...fs].sort((a, b) => a.type.localeCompare(b.type) || (a.claim_id || "").localeCompare(b.claim_id || ""));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
