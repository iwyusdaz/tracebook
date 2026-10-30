#!/usr/bin/env node
// TraceBook — step 1: EXTRACT (the only LLM step in the pipeline).
//
// Reads curriculum content (Markdown / HTML / plain text), asks an
// OpenAI-compatible chat endpoint to pull out atomic factual claims
// (statistics, dates, version strings, attributions, effect sizes,
// definitions), and writes a claims ledger stub for human review.
//
// House rules enforced here:
//   - Missing or placeholder MODEL_A_* values -> clear error, exit 1,
//     ZERO network calls.
//   - --dry-run writes labeled stubs to dry-run/ ("DRY RUN – NOT REAL
//     RESULTS") and makes no network calls at all.
//   - Line locations ("file:line") are computed locally by searching the
//     claim text in the file — never trusted from the model.
//
// Usage:
//   node src/extract.mjs [--content PATH] [--out ledger/claims.json]
//                        [--max-claims N] [--dry-run] [--force]
// PATH can be a file or a directory (scanned for .md/.markdown/.html/.htm/.txt).

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { readDotEnv, isPlaceholder, htmlToText, emptyLedger, repoRoot, todayISO } from "./lib.mjs";

const CONTENT_EXTENSIONS = new Set([".md", ".markdown", ".html", ".htm", ".txt"]);
const DRY_RUN_HEADER = "DRY RUN – NOT REAL RESULTS";

function parseArgs(argv) {
  const args = {
    content: "test-fixtures/content",
    out: "ledger/claims.json",
    maxClaims: 40,
    dryRun: false,
    force: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--content") args.content = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--max-claims") args.maxClaims = Math.max(1, parseInt(argv[++i], 10) || 40);
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--force") args.force = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else { console.error(`Unknown argument: ${a}`); process.exit(2); }
  }
  if (args.help) {
    console.log(`Usage: node src/extract.mjs [--content PATH] [--out PATH] [--max-claims N] [--dry-run] [--force]`);
    process.exit(0);
  }
  return args;
}

function collectContentFiles(target) {
  const abs = target.startsWith("/") || target.startsWith(".")
    ? target
    : join(repoRoot, target);
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

/** Find "file:line" for a claim by locating its text in the file. Deterministic. */
function locateInFile(fileText, relPath, claimText) {
  const needle = claimText.trim().toLowerCase().slice(0, 120);
  if (needle.length < 12) return relPath;
  const hay = fileText.toLowerCase();
  const idx = hay.indexOf(needle);
  if (idx === -1) return relPath;
  const line = fileText.slice(0, idx).split(/\r?\n/).length;
  return `${relPath}:${line}`;
}

const SYSTEM_PROMPT = `You extract atomic factual claims from educational/curriculum content for an evidence-verification ledger.

Rules:
- Only report claims that ASSERT a checkable fact: statistics/effect sizes, dates, version numbers, quotas, named findings with numbers, attributions ("X found Y"), definitions attributed to a body, or requirements attributed to a law/standard.
- Do NOT report pedagogical advice, opinions, or learning objectives.
- Quote the claim text VERBATIM from the provided content (same wording, same numbers).
- For each claim, propose source_url ONLY if you are confident about the canonical primary source; otherwise set source_url to null — a human fills it in.
- Set source_publisher to the publisher you expect at that URL, or null.
- Set confidence to "high", "medium" or "low" (how sure you are that this is a checkable claim, not the truth of the claim).
- Respond with STRICT JSON only: {"claims":[{"claim":"...","source_url":"...|null","source_publisher":"...|null","confidence":"high|medium|low"}]}`;

function parseModelJson(raw) {
  let text = String(raw).trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf("{");
  const startArr = text.indexOf("[");
  if (startArr !== -1 && (start === -1 || startArr < start)) {
    const end = text.lastIndexOf("]");
    return { claims: JSON.parse(text.slice(startArr, end + 1)) };
  }
  const end = text.lastIndexOf("}");
  return JSON.parse(text.slice(start, end + 1));
}

async function callModel({ baseUrl, apiKey, model, timeoutMs }, contentBlocks) {
  const url = baseUrl.replace(/\/+$/, "") + "/chat/completions";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content:
              "Extract atomic factual claims from this curriculum content. " +
              "Respond with strict JSON per the system instructions.\n\n" +
              contentBlocks,
          },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`model endpoint returned HTTP ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error("model response had no message content");
    return parseModelJson(content);
  } finally {
    clearTimeout(timer);
  }
}

function buildStubClaim(file, relPath, idx) {
  return {
    id: `DRYRUN-${String(idx + 1).padStart(3, "0")}`,
    claim: `[${DRY_RUN_HEADER}] Stub claim placeholder — extracted claims appear here after a real run.`,
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

function main() {
  const args = parseArgs(process.argv.slice(2));

  // ---- placeholder gate: resolved BEFORE any network call can exist ----
  let env = readDotEnv(join(repoRoot, ".env"));
  env = { ...env, ...process.env }; // real env wins; .env fills the rest
  const cfg = {
    baseUrl: env.MODEL_A_BASE_URL,
    apiKey: env.MODEL_A_API_KEY,
    model: env.MODEL_A_NAME,
    timeoutMs: parseInt(env.MODEL_A_TIMEOUT_MS, 10) || 120000,
  };

  const files = collectContentFiles(args.content);
  if (files.length === 0) {
    console.error(`No content files found under ${args.content} (looked for .md/.html/.txt).`);
    process.exit(1);
  }

  if (args.dryRun) {
    // Dry run: stubs only, zero network calls, zero key requirements.
    const dir = join(repoRoot, "dry-run");
    mkdirSync(dir, { recursive: true });
    const ledger = emptyLedger();
    ledger.dry_run = true;
    ledger.note = `${DRY_RUN_HEADER}. ${ledger.note}`;
    ledger.generated = new Date().toISOString();
    ledger.claims = files.flatMap((f, i) => {
      const text = readContentAsText(f);
      // One stub per file, plus one per ~600 words so the stub shape is realistic.
      const words = text.split(/\s+/).length;
      const nStubs = Math.max(1, Math.min(3, Math.ceil(words / 600)));
      return Array.from({ length: nStubs }, (_, k) => buildStubClaim(f, f.relPath, i * 3 + k));
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
    console.log("No network calls were made. Add real MODEL_A_* values in .env and run `npm run extract` for real results.");
    return;
  }

  // Real run: hard gate on configuration.
  const missing = [];
  for (const [k, v] of [
    ["MODEL_A_BASE_URL", cfg.baseUrl],
    ["MODEL_A_API_KEY", cfg.apiKey],
    ["MODEL_A_NAME", cfg.model],
  ]) {
    if (isPlaceholder(v)) missing.push(k);
  }
  if (missing.length > 0) {
    console.error(
      `ERROR: refusing to run the extractor.\n\n` +
        `These required settings are missing or still placeholders:\n` +
        missing.map((k) => `  - ${k}`).join("\n") +
        `\n\nCopy .env.example to .env and fill in real values. NO network calls were made.\n` +
        `(To test the pipeline without a key, use: npm run extract -- --dry-run)`
    );
    process.exit(1);
  }

  if (existsSync(args.out) && !args.force) {
    const existing = readFileSync(args.out, "utf8");
    if (existing.trim() && JSON.parse(existing).claims?.length > 0) {
      console.error(
        `ERROR: ${args.out} already contains claims. Review and merge them first, ` +
          `or pass --force to overwrite (existing file will be copied to ${args.out}.bak).`
      );
      process.exit(1);
    }
  }

  // Build one content block per file (cap each file at ~40k chars for context safety).
  const contentBlocks = files
    .map((f) => {
      const text = readContentAsText(f);
      return `FILE: ${f.relPath}\n<<<CONTENT\n${text.slice(0, 40000)}\nCONTENT>>>`;
    })
    .join("\n\n");

  console.error(`TraceBook extract — ${files.length} content file(s), model: ${cfg.model}`);
  callModel(cfg, contentBlocks)
    .then((parsed) => {
      const modelClaims = Array.isArray(parsed?.claims) ? parsed.claims : [];
      if (modelClaims.length === 0) {
        console.error("Model returned no claims. Nothing written. (If this seems wrong, check the model name / endpoint.)");
        process.exit(1);
      }
      const ledger = emptyLedger();
      ledger.generated = new Date().toISOString();
      ledger.extract_model = { name: cfg.model, base_url_set: true, api_key_set: true };
      ledger.claims = modelClaims.slice(0, args.maxClaims).map((mc, i) => {
        const claimText = String(mc.claim || "").trim();
        const file = files.find((f) => {
          const t = readContentAsText(f).toLowerCase();
          return claimText.length >= 12 && t.includes(claimText.toLowerCase().slice(0, 120));
        });
        const location = file
          ? locateInFile(readContentAsText(file), file.relPath, claimText)
          : "";
        return {
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
        };
      });
      mkdirSync(join(repoRoot, args.out, ".."), { recursive: true });
      if (existsSync(args.out) && args.force) {
        writeFileSync(`${args.out}.bak`, readFileSync(args.out, "utf8"));
      }
      writeFileSync(args.out, JSON.stringify(ledger, null, 2) + "\n");
      console.log(`Extracted ${ledger.claims.length} claim(s) -> ${args.out}`);
      console.log(
        "NEXT (the human GATE): for each claim, read the source, record the exact source\n" +
          "sentence in stored_quote, then run: npm run verify && npm run report"
      );
    })
    .catch((err) => {
      console.error(`extract failed: ${err.message}`);
      console.error("NO results were written.");
      process.exit(1);
    });
}

if (import.meta.url === `file://${process.argv[1]}`) main();
