#!/usr/bin/env node
// TraceBook — step 4: REPORT (deterministic).
//
// Emits CLAIMS.md (a human-readable evidence ledger table + summary counts)
// from a verified ledger, and can apply human-approved corrections in place:
//
//   node src/report.mjs [--ledger ledger/claims-verified.json] [--out CLAIMS.md]
//   node src/report.mjs --correct   # apply human-approved corrections to content files
//
// Correction model: a human marks a ledger entry with
//   "apply_correction": true,
//   "suggested_correction": { "find": "...", "replace": "..." }
// (file comes from the claim's "location"). --correct rewrites that file,
// adds a correction note, sets verdict to CORRECTED and locks the claim.
// Corrections are never applied automatically without that human flag.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { readLedger, writeLedger, todayISO } from "./lib.mjs";

function parseArgs(argv) {
  const args = { ledger: "ledger/claims-verified.json", out: "CLAIMS.md", correct: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--ledger") args.ledger = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--correct") args.correct = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else { console.error(`Unknown argument: ${a}`); process.exit(2); }
  }
  if (args.help) {
    console.log("Usage: node src/report.mjs [--ledger PATH] [--out PATH] [--correct]");
    process.exit(0);
  }
  return args;
}

const VERDICT_BADGE = {
  VERIFIED: "VERIFIED",
  "VERIFIED-SNIPPET": "VERIFIED-SNIPPET",
  UNVERIFIED: "UNVERIFIED",
  CORRECTED: "CORRECTED",
  "NOT-APPLICABLE": "NOT-APPLICABLE",
};

function cell(text) {
  return String(text ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .trim();
}

function locationFile(location) {
  // "path/to/file.md:12" -> "path/to/file.md"
  const m = String(location || "").match(/^(.*?)(?::\d+)?$/);
  return m ? m[1] : location;
}

export function buildClaimsMarkdown(ledger, { generatedNote = "" } = {}) {
  const claims = ledger.claims || [];
  const counts = {};
  for (const v of Object.keys(VERDICT_BADGE)) counts[v] = 0;
  for (const c of claims) counts[c.verdict] = (counts[c.verdict] || 0) + 1;
  const total = claims.length;

  const lines = [];
  lines.push("# Claims Ledger");
  lines.push("");
  lines.push(
    "> **What this is:** an evidence ledger of factual claims extracted from the content, " +
      "each checked against its cited source by deterministic quote-back matching. " +
      "**What this is not:** a certification that the content is 'fact-checked'. " +
      "Verdicts surface claims for human judgment — a green ledger does not replace a human reviewer."
  );
  lines.push("");
  if (generatedNote) lines.push(`_${generatedNote}_`, "");
  lines.push(
    `**Summary:** ${total} claim(s) · ` +
      `${counts["VERIFIED"]} verified · ${counts["VERIFIED-SNIPPET"]} snippet-verified · ` +
      `${counts["UNVERIFIED"]} unverified · ${counts["CORRECTED"]} corrected · ` +
      `${counts["NOT-APPLICABLE"]} not-applicable`
  );
  lines.push("");
  lines.push(
    "Verdict vocabulary: **VERIFIED** (stored source quote found verbatim, numbers consistent) · " +
      "**VERIFIED-SNIPPET** (partial match — possible drift or paraphrase; needs human eyes) · " +
      "**UNVERIFIED** (source unreachable / access-restricted / quote not found / numbers contradict the source) · " +
      "**CORRECTED** (content fixed in place with a correction note) · " +
      "**NOT-APPLICABLE** (not checkable this way, human-labeled)."
  );
  lines.push("");
  lines.push("| ID | Claim | Location | Source | Verdict | Verification note |");
  lines.push("|----|-------|----------|--------|---------|-------------------|");
  for (const c of claims) {
    const src = c.source_url
      ? `[${cell(c.source_publisher || "source")}](${c.source_url})`
      : cell(c.source_publisher || "—");
    const noteBits = [];
    if (c.verification?.reason) noteBits.push(`\`${c.verification.reason}\``);
    if (c.verification?.similarity != null) noteBits.push(`similarity ${c.verification.similarity}`);
    if (c.correction_note) noteBits.push(`Correction: ${cell(c.correction_note)}`);
    if (c.verification?.note) noteBits.push(cell(c.verification.note));
    lines.push(
      `| ${cell(c.id)} | ${cell(c.claim)} | ${cell(c.location)} | ${src} | ` +
        `${VERDICT_BADGE[c.verdict] || cell(c.verdict)} | ${noteBits.join(" — ")} |`
    );
  }
  lines.push("");
  lines.push(`_Access dates and per-claim provenance live in the machine-readable ledger (${cell(ledger._source_file || "ledger/claims-verified.json")})._`);
  return lines.join("\n") + "\n";
}

export function applyCorrections(ledger) {
  const applied = [];
  for (const c of ledger.claims) {
    if (!c.apply_correction || c.locked === true) continue;
    const sc = c.suggested_correction;
    const file = locationFile(c.location);
    if (!sc || !sc.find || !sc.replace || !file || !existsSync(file)) {
      console.error(`  SKIP ${c.id}: incomplete or missing correction target (${file || "no file"})`);
      continue;
    }
    const content = readFileSync(file, "utf8");
    if (!content.includes(sc.find)) {
      console.error(`  SKIP ${c.id}: find-text not present in ${file} (content may have changed)`);
      continue;
    }
    const note = `<!-- tracebook correction ${todayISO()}: ${c.correction_note || "corrected against cited source"} (claim ${c.id}) -->`;
    const updated = content.replace(sc.find, `${sc.replace}\n\n${note}`);
    writeFileSync(file, updated);
    c.verdict = "CORRECTED";
    c.locked = true;
    c.correction_note =
      c.correction_note ||
      "Content corrected in place against the cited source; see the correction note in the file.";
    applied.push(c.id);
    console.log(`  APPLIED ${c.id}: corrected ${file}`);
  }
  return applied;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const ledger = readLedger(args.ledger);
  ledger._source_file = args.ledger;

  if (args.correct) {
    console.error(`TraceBook report --correct — applying human-approved corrections from ${args.ledger}`);
    const applied = applyCorrections(ledger);
    if (applied.length > 0) {
      // Persist the CORRECTED verdicts back to the ledger.
      writeLedger(args.ledger, ledger);
      console.log(`\n${applied.length} correction(s) applied. Re-run report to refresh ${args.out}.`);
    } else {
      console.log("\nNo corrections applied (none approved, or all already locked).");
    }
  }

  const md = buildClaimsMarkdown(ledger, {
    generatedNote: `Generated ${todayISO()} by TraceBook from \`${args.ledger}\`.`,
  });
  writeFileSync(args.out, md);
  const counts = {};
  for (const c of ledger.claims) counts[c.verdict] = (counts[c.verdict] || 0) + 1;
  console.log(`Wrote ${args.out} (${ledger.claims.length} claims): ` +
    Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(", "));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
