#!/usr/bin/env node
// TraceBook, step 1: EXTRACT (agent-run, no API key, no network calls).
//
// Claim extraction is done by an AI agent you already work with (for
// example a coding agent in your editor or terminal). This script never
// calls a model and never touches the network. It has two modes:
//
//   --prepare   Writes extract-work/request.md: the extraction instructions
//               plus every content file. Hand that file to your agent and ask
//               it to write its answer to extract-work/agent-claims.json.
//
//   --claims F  Imports the agent's JSON answer. Every claim must appear
//               verbatim (whitespace-insensitive) in the content; claims that
//               do not are rejected and listed, never imported. Line
//               locations ("file:line") are computed locally, never trusted
//               from the agent. Writes ledger/claims.json for the human gate.
//
//   --dry-run   Writes labeled stubs to dry-run/ ("DRY RUN – NOT REAL
//               RESULTS") to test the plumbing only.
//
// Usage:
//   node src/extract.mjs --prepare [--content PATH] [--request PATH]
//   node src/extract.mjs --claims FILE [--content PATH] [--out PATH]
//                        [--extractor NAME] [--max-claims N] [--force]
//   node src/extract.mjs --dry-run [--content PATH]
// PATH can be a file or a directory (scanned for .md/.markdown/.html/.htm/.txt).
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join, relative, extname, dirname, isAbsolute, resolve } from "node:path";
import { htmlToText, emptyLedger, repoRoot, todayISO } from "./lib.mjs";

const CONTENT_EXTENSIONS = new Set([".md", ".markdown", ".html", ".htm", ".txt"]);
const DRY_RUN_HEADER = "DRY RUN – NOT REAL RESULTS";
const DEFAULT_REQUEST = "extract-work/request.md";
const DEFAULT_CLAIMS = "extract-work/agent-claims.json";

function parseArgs(argv) {
  const args = {
    content: "test-fixtures/content",
    out: "ledger/claims.json",
    request: DEFAULT_REQUEST,
    claims: null,
    extractor: "unnamed agent",
    maxClaims: 40,
    prepare: false,
    dryRun: false,
    force: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--content") args.content = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--request") args.request = argv[++i];
    else if (a === "--claims") args.claims = argv[++i];
    else if (a === "--extractor") args.extractor = argv[++i];
    else if (a === "--max-claims") args.maxClaims = Math.max(1, parseInt(argv[++i], 10) || 40);
    else if (a === "--prepare") args.prepare = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--force") args.force = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else { console.error(`Unknown argument: ${a}`); process.exit(2); }
  }
  if (args.help) {
    console.log(
      "Usage:\n" +
        "  node src/extract.mjs --prepare [--content PATH] [--request PATH]\n" +
        "  node src/extract.mjs --claims FILE [--content PATH] [--out PATH] [--extractor NAME] [--max-claims N] [--force]\n" +
        "  node src/extract.mjs --dry-run [--content PATH]"
    );
    process.exit(0);
  }
  return args;
}

function resolvePath(p) {
  if (isAbsolute(p)) return p;
  return p.startsWith(".") ? resolve(p) : join(repoRoot, p);
}

function collectContentFiles(target) {
  const abs = resolvePath(target);
  if (!existsSync(abs)) {
    throw new Error(`content path does not exist: ${target}`);
  }
  const files = [];
  const walk = (p) => {
    const s = statSync(p);
    if (s.isDirectory()) {
      for (const name of readdirSync(p).sort()) {
        if (name.startsWith(".")) continue;
        walk(join(p, name));
      }
    } else if (CONTENT_EXTENSIONS.has(extname(p).toLowerCase())) {
      files.push(p);
    }
  };
  walk(abs);
  return files.map((f) => ({ absPath: f, relPath: relative(repoRoot, f) || f }));
}

function readContentAsText(file) {
  const raw = readFileSync(file.absPath, "utf8");
  const isHtml = /\.(html?|htm)$/i.test(file.absPath);
  return isHtml ? htmlToText(raw) : raw;
}

/**
 * Find a claim verbatim in a file's text, ignoring case and whitespace
 * differences (claims often wrap across lines). Returns the 1-based line
 * number of the match, or null. Deterministic.
 */
function findVerbatimLine(fileText, claimText) {
  const words = claimText.trim().split(/\s+/).filter(Boolean);
  if (words.length < 3) return null;
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(escaped.join("\\s+"), "i");
  const m = re.exec(fileText);
  if (!m) return null;
  return fileText.slice(0, m.index).split(/\r?\n/).length;
}

const INSTRUCTIONS = `You are extracting atomic factual claims from curriculum content for an evidence-verification ledger.
Rules:
- Only report claims that ASSERT a checkable fact: statistics/effect sizes, dates, version numbers, quotas, named findings with numbers, attributions ("X found Y"), definitions attributed to a body, or requirements attributed to a law/standard.
- Do NOT report pedagogical advice, opinions, or learning objectives.
- Quote the claim text VERBATIM from the provided content (same wording, same numbers). Claims that are not verbatim are rejected on import.
- For each claim, propose source_url ONLY if you are confident about the canonical primary source; otherwise set source_url to null and a human fills it in.
- Set source_publisher to the publisher you expect at that URL, or null.
- Set confidence to "high", "medium" or "low" (how sure you are that this is a checkable claim, not the truth of the claim).
- Do not browse or invent sources. Do not fill in stored_quote: a human does that after reading the source.
- Write STRICT JSON only, to the answer file named below:
  {"claims":[{"claim":"...","source_url":"...|null","source_publisher":"...|null","confidence":"high|medium|low"}]}`;

function prepare(args, files) {
  const requestPath = resolvePath(args.request);
  const blocks = files
    .map((f) => `FILE: ${f.relPath}\n<<<CONTENT\n${readContentAsText(f).slice(0, 40000)}\nCONTENT>>>`)
    .join("\n\n");
  const body =
    `# TraceBook extraction request\n\n` +
    `Generated ${new Date().toISOString()} by \`npm run extract -- --prepare\` for ${files.length} content file(s).\n\n` +
    `## Instructions for the agent\n\n${INSTRUCTIONS}\n\n` +
    `Answer file: \`${DEFAULT_CLAIMS}\`\n\n` +
    `## Content\n\n${blocks}\n`;
  mkdirSync(dirname(requestPath), { recursive: true });
  writeFileSync(requestPath, body);
  console.log(`Wrote extraction request for ${files.length} content file(s) -> ${relative(repoRoot, requestPath) || requestPath}`);
  console.log(
    "NEXT: give that file to your AI agent and ask it to follow the instructions,\n" +
      `writing its answer to ${DEFAULT_CLAIMS}. Then run:\n` +
      `  npm run extract -- --claims ${DEFAULT_CLAIMS} --extractor "<agent and model name>"`
  );
}

function parseAgentJson(raw) {
  let text = String(raw).trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.claims)) return parsed.claims;
  throw new Error('expected {"claims":[...]} or a JSON array');
}

function importClaims(args, files) {
  const claimsPath = resolvePath(args.claims);
  if (!existsSync(claimsPath)) {
    console.error(`ERROR: agent claims file not found: ${args.claims}\nRun \`npm run extract -- --prepare\` first and have your agent write its answer there.`);
    process.exit(1);
  }
  let agentClaims;
  try {
    agentClaims = parseAgentJson(readFileSync(claimsPath, "utf8"));
  } catch (err) {
    console.error(`ERROR: ${args.claims} is not valid agent output: ${err.message}\nNothing was written.`);
    process.exit(1);
  }
  const outPath = resolvePath(args.out);
  if (existsSync(outPath) && !args.force) {
    const existing = readFileSync(outPath, "utf8");
    if (existing.trim() && JSON.parse(existing).claims?.length > 0) {
      console.error(
        `ERROR: ${args.out} already contains claims. Review and merge them first, ` +
          `or pass --force to overwrite (existing file will be copied to ${args.out}.bak).`
      );
      process.exit(1);
    }
  }
  const texts = files.map((f) => ({ file: f, text: readContentAsText(f) }));
  const accepted = [];
  const rejected = [];
  for (const mc of agentClaims) {
    const claimText = String(mc?.claim || "").trim();
    let location = null;
    for (const { file, text } of texts) {
      const line = findVerbatimLine(text, claimText);
      if (line !== null) { location = `${file.relPath}:${line}`; break; }
    }
    if (location) accepted.push({ mc, claimText, location });
    else rejected.push(claimText || "(empty claim)");
  }
  if (rejected.length > 0) {
    console.error(`Rejected ${rejected.length} claim(s) not found verbatim in the content:`);
    for (const r of rejected) console.error(`  - ${r.slice(0, 160)}`);
  }
  if (accepted.length === 0) {
    console.error("ERROR: no verbatim claims to import. Nothing was written.");
    process.exit(1);
  }
  const ledger = emptyLedger();
  ledger.generated = new Date().toISOString();
  ledger.extract_method = {
    type: "agent-run",
    extractor: args.extractor,
    claims_file: relative(repoRoot, claimsPath) || claimsPath,
    accepted: Math.min(accepted.length, args.maxClaims),
    rejected_not_verbatim: rejected.length,
  };
  ledger.claims = accepted.slice(0, args.maxClaims).map(({ mc, claimText, location }, i) => ({
    id: `C${String(i + 1).padStart(3, "0")}`,
    claim: claimText,
    location,
    source_url: mc.source_url || null,
    source_publisher: mc.source_publisher || null,
    access_date: todayISO(),
    stored_quote: "", // human fills after reading the source (the GATE)
    verdict: null,
    correction_note: "",
    confidence: ["high", "medium", "low"].includes(mc.confidence) ? mc.confidence : "medium",
  }));
  mkdirSync(dirname(outPath), { recursive: true });
  if (existsSync(outPath) && args.force) {
    writeFileSync(`${outPath}.bak`, readFileSync(outPath, "utf8"));
  }
  writeFileSync(outPath, JSON.stringify(ledger, null, 2) + "\n");
  console.log(`Imported ${ledger.claims.length} agent-extracted claim(s) -> ${args.out}`);
  console.log(
    "NEXT (the human GATE): for each claim, read the source, record the exact source\n" +
      "sentence in stored_quote, then run: npm run verify && npm run report"
  );
}

function buildStubClaim(relPath, idx) {
  return {
    id: `DRYRUN-${String(idx + 1).padStart(3, "0")}`,
    claim: `[${DRY_RUN_HEADER}] Stub claim placeholder. Extracted claims appear here after a real run.`,
    location: relPath,
    source_url: null,
    source_publisher: null,
    access_date: todayISO(),
    stored_quote: "",
    verdict: null,
    correction_note: "",
    confidence: "stub",
  };
}

function dryRun(files) {
  const dir = join(repoRoot, "dry-run");
  mkdirSync(dir, { recursive: true });
  const ledger = emptyLedger();
  ledger.dry_run = true;
  ledger.note = `${DRY_RUN_HEADER}. ${ledger.note}`;
  ledger.generated = new Date().toISOString();
  ledger.claims = files.flatMap((f, i) => {
    const words = readContentAsText(f).split(/\s+/).length;
    const nStubs = Math.max(1, Math.min(3, Math.ceil(words / 600)));
    return Array.from({ length: nStubs }, (_, k) => buildStubClaim(f.relPath, i * 3 + k));
  });
  writeFileSync(join(dir, "claims-dry-run.json"), JSON.stringify(ledger, null, 2) + "\n");
  writeFileSync(
    join(dir, "README.md"),
    `# ${DRY_RUN_HEADER}\n\n` +
      `These files are structural stubs produced by \`npm run extract -- --dry-run\`.\n` +
      `They test the pipeline plumbing only. They are NOT extraction results and\n` +
      `must never be used, cited, or committed as results.\n`
  );
  console.log(`${DRY_RUN_HEADER}`);
  console.log(`Wrote ${ledger.claims.length} stub claim(s) for ${files.length} content file(s) to dry-run/.`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const modes = [args.prepare, args.dryRun, Boolean(args.claims)].filter(Boolean).length;
  if (modes !== 1) {
    console.error(
      "ERROR: choose exactly one mode.\n\n" +
        "  npm run extract -- --prepare           write extract-work/request.md for your AI agent\n" +
        `  npm run extract -- --claims ${DEFAULT_CLAIMS}   import the agent's answer into the ledger\n` +
        "  npm run extract -- --dry-run           labeled stubs, plumbing test only\n\n" +
        "Extraction is agent-run: no API key is needed and this script makes no network calls."
    );
    process.exit(1);
  }
  const files = collectContentFiles(args.content);
  if (files.length === 0) {
    console.error(`No content files found under ${args.content} (looked for .md/.html/.txt).`);
    process.exit(1);
  }
  if (args.dryRun) return dryRun(files);
  if (args.prepare) return prepare(args, files);
  return importClaims(args, files);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
