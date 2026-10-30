#!/usr/bin/env node
// TraceBook negative test — the mandatory house-pattern test.
//
// Proves the pipeline CATCHES every seeded error in test-fixtures/:
//   C001 wrong statistic   -> UNVERIFIED (NUMERIC-MISMATCH)
//   C002 correct claim     -> VERIFIED          (control: good claims pass)
//   C003 paywalled source  -> UNVERIFIED (ACCESS-RESTRICTED), never circumvented
//   C004 stale version     -> UNVERIFIED (QUOTE-NOT-FOUND)
//   C005 drifted wording   -> VERIFIED-SNIPPET  (flagged, never silently upgraded)
//   C006 dead link         -> UNVERIFIED (SOURCE-UNREACHABLE)
//
// Also proves:
//   - extract refuses placeholder MODEL_A_* with exit 1 and no network calls
//   - extract --dry-run writes "DRY RUN – NOT REAL RESULTS" stubs, no network
//   - report --correct rewrites content in place with a correction note
//   - rot-check re-flags drift/rot and diffs findings between runs
//
// Exit code 0 only if EVERY seeded error is caught and every assertion holds.

import { spawn } from "node:child_process";
import { mkdirSync, rmSync, existsSync, readFileSync, cpSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startFixtureServer, stopFixtureServer } from "./fixture-server.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TMP = join(ROOT, "tests", ".tmp");
const NODE = process.execPath;

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// Async spawn: keeps this process's event loop free so the in-process fixture
// server can answer requests from the spawned child (spawnSync would deadlock).
function run(script, args, env = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(NODE, [join(ROOT, "src", script), ...args], {
      cwd: ROOT,
      env: { ...process.env, ...env },
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolveRun({ code, out }));
    child.on("error", (err) => resolveRun({ code: 1, out: String(err) }));
  });
}

// ---------------------------------------------------------------------------
console.log("TraceBook negative test\n=======================");
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

// --- 1. Placeholder refusal: must exit 1 BEFORE any network call -----------
console.log("\n[1] extract refuses placeholder MODEL_A_* config");
const refusal = await run("extract.mjs", ["--content", "test-fixtures/content"], {
  MODEL_A_BASE_URL: "", MODEL_A_API_KEY: "", MODEL_A_NAME: "",
});
check("exit code is 1", refusal.code === 1, `got ${refusal.code}`);
check("message names the missing settings", /MODEL_A_(BASE_URL|API_KEY|NAME)/.test(refusal.out), refusal.out.slice(0, 200));
check("message states no network calls were made", /NO network calls/i.test(refusal.out));

// --- 2. Dry run: labeled stubs, no network ---------------------------------
console.log("\n[2] extract --dry-run writes labeled stubs");
const dry = await run("extract.mjs", ["--dry-run", "--content", "test-fixtures/content"]);
check("exit code is 0", dry.code === 0, dry.out.slice(0, 200));
const dryLedgerPath = join(ROOT, "dry-run", "claims-dry-run.json");
check("dry-run/claims-dry-run.json exists", existsSync(dryLedgerPath));
if (existsSync(dryLedgerPath)) {
  const dryLedger = JSON.parse(readFileSync(dryLedgerPath, "utf8"));
  check("stub ledger carries DRY RUN header", String(dryLedger.note || "").includes("DRY RUN – NOT REAL RESULTS"));
  check("stub ledger has claims", Array.isArray(dryLedger.claims) && dryLedger.claims.length > 0);
}
const dryReadme = join(ROOT, "dry-run", "README.md");
check("dry-run/README.md exists and is labeled", existsSync(dryReadme) && readFileSync(dryReadme, "utf8").includes("DRY RUN – NOT REAL RESULTS"));

// --- 3. Fixture server ------------------------------------------------------
console.log("\n[3] starting fixture source server on 127.0.0.1:8641");
const base = await startFixtureServer();
console.log(`  fixture server up: ${base}`);

try {
  // Fresh copies so the test never mutates committed fixtures.
  cpSync(join(ROOT, "ledger", "claims.json"), join(TMP, "claims.json"));
  cpSync(join(ROOT, "test-fixtures", "content"), join(TMP, "content"), { recursive: true });

  // --- 4. Verify ------------------------------------------------------------
  console.log("\n[4] verify.mjs against fixture sources");
  const verify = await run("verify.mjs", ["--ledger", join(TMP, "claims.json"), "--out", join(TMP, "claims-verified.json")]);
  check("exit code is 0", verify.code === 0, verify.out.slice(0, 300));
  const verified = JSON.parse(readFileSync(join(TMP, "claims-verified.json"), "utf8"));
  const byId = Object.fromEntries(verified.claims.map((c) => [c.id, c]));

  const expectations = [
    ["C001", "UNVERIFIED", "NUMERIC-MISMATCH", "wrong statistic (0.41 SD vs source 0.10-0.20 SD)"],
    ["C002", "VERIFIED", "QUOTE-FOUND", "correct claim (control)"],
    ["C003", "UNVERIFIED", "ACCESS-RESTRICTED", "paywalled source (403)"],
    ["C004", "UNVERIFIED", "QUOTE-NOT-FOUND", "stale version string"],
    ["C005", "VERIFIED-SNIPPET", "PARTIAL-MATCH", "drifted wording, not silently upgraded"],
    ["C006", "UNVERIFIED", "SOURCE-UNREACHABLE", "dead link (404)"],
  ];
  for (const [id, verdict, reason, label] of expectations) {
    const c = byId[id];
    check(`${id} (${label}) -> ${verdict}`, c && c.verdict === verdict, `got ${c && c.verdict}`);
    if (reason && c) {
      check(`${id} reason is ${reason}`, c.verification?.reason === reason, `got ${c.verification?.reason}`);
    }
  }
  check(
    "C003 note says paywall was not circumvented",
    /not circumvented/i.test(byId.C003?.verification?.note || "")
  );

  // --- 5. Report --------------------------------------------------------------
  console.log("\n[5] report.mjs emits CLAIMS.md");
  const report = await run("report.mjs", ["--ledger", join(TMP, "claims-verified.json"), "--out", join(TMP, "CLAIMS.md")]);
  check("exit code is 0", report.code === 0, report.out.slice(0, 200));
  const claimsMd = existsSync(join(TMP, "CLAIMS.md")) ? readFileSync(join(TMP, "CLAIMS.md"), "utf8") : "";
  check("CLAIMS.md written", claimsMd.length > 0);
  check(
    "summary counts match verify output",
    claimsMd.includes("1 verified") && claimsMd.includes("1 snippet-verified") && claimsMd.includes("4 unverified"),
    claimsMd.match(/\*\*Summary:\*\*.*$/m)?.[0] || "summary line not found"
  );
  check(
    "CLAIMS.md carries the honesty disclaimer",
    claimsMd.includes("does not replace a human reviewer") || claimsMd.includes("HUMAN JUDGMENT")
  );

  // --- 6. In-place correction (human-approved only) ---------------------------
  console.log("\n[6] report --correct rewrites content in place");
  const tmpLedgerPath = join(TMP, "claims-verified.json");
  const ledgerForCorrection = JSON.parse(readFileSync(tmpLedgerPath, "utf8"));
  const c001 = ledgerForCorrection.claims.find((c) => c.id === "C001");
  c001.apply_correction = true; // simulates the human approving the fix
  c001.location = "tests/.tmp/content/module-1-tutoring.md:13"; // point at the temp copy
  writeFileSync(tmpLedgerPath, JSON.stringify(ledgerForCorrection, null, 2) + "\n");

  const correct = await run("report.mjs", ["--correct", "--ledger", tmpLedgerPath, "--out", join(TMP, "CLAIMS.md")]);
  check("exit code is 0", correct.code === 0, correct.out.slice(0, 200));
  const correctedFile = readFileSync(join(TMP, "content", "module-1-tutoring.md"), "utf8");
  check("wrong statistic replaced with source-backed numbers", correctedFile.includes("0.10 to 0.20 standard deviations"));
  check("wrong number (0.41) removed", !correctedFile.includes("0.41"));
  check("correction note appended in place", /tracebook correction \d{4}-\d{2}-\d{2}.*C001/.test(correctedFile));
  const ledgerAfterCorrection = JSON.parse(readFileSync(tmpLedgerPath, "utf8"));
  const c001After = ledgerAfterCorrection.claims.find((c) => c.id === "C001");
  check("C001 verdict becomes CORRECTED and locked", c001After.verdict === "CORRECTED" && c001After.locked === true);
  check("CLAIMS.md now reports 1 corrected", readFileSync(join(TMP, "CLAIMS.md"), "utf8").includes("1 corrected"));

  // --- 7. Rot check ------------------------------------------------------------
  console.log("\n[7] rot-check.mjs re-fetches sources and diffs findings");
  const rot1 = await run("rot-check.mjs", [
    "--ledger", tmpLedgerPath,
    "--state", join(TMP, "rot-state.json"),
    "--report", join(TMP, "rot-report.json"),
  ]);
  const rotReport1 = existsSync(join(TMP, "rot-report.json"))
    ? JSON.parse(readFileSync(join(TMP, "rot-report.json"), "utf8"))
    : null;
  check("first run exits with findings signal (2) or 0", rot1.code === 2 || rot1.code === 0, `got ${rot1.code}`);
  const types1 = new Set(rotReport1?.findings?.map((f) => f.type));
  check("flags dead link as LINK-ROT", types1.has("LINK-ROT"));
  check("flags paywall as ACCESS-RESTRICTED", types1.has("ACCESS-RESTRICTED"));
  check("flags changed sources as CONTENT-DRIFT", types1.has("CONTENT-DRIFT"));
  check("first run: 4 findings (C003, C004, C005, C006)", rotReport1?.findings_total === 4, `got ${rotReport1?.findings_total}`);
  check("no issues opened locally (no GITHUB_TOKEN)", !/opened https:\/\//.test(rot1.out));

  const rot2 = await run("rot-check.mjs", [
    "--ledger", tmpLedgerPath,
    "--state", join(TMP, "rot-state.json"),
    "--report", join(TMP, "rot-report.json"),
  ]);
  const rotReport2 = JSON.parse(readFileSync(join(TMP, "rot-report.json"), "utf8"));
  check("second run: same findings, 0 NEW (state diff works)", rotReport2.findings_total === 4 && rotReport2.findings_new === 0,
    `total=${rotReport2.findings_total} new=${rotReport2.findings_new}`);
} finally {
  await stopFixtureServer();
}

// --- Scorecard ----------------------------------------------------------------
console.log("\n=======================");
console.log(`Negative test: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("ALL SEEDED ERRORS CAUGHT. The pipeline refuses to green-light any of them.");
