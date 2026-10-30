// TraceBook shared helpers — deterministic, zero dependencies (Node built-ins only).
// Everything in this file is used by verify.mjs, report.mjs and rot-check.mjs.
// The LLM-based extractor (extract.mjs) only reuses the placeholder checks;
// verification itself never touches a model.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const VERDICTS = [
  "VERIFIED",
  "VERIFIED-SNIPPET",
  "UNVERIFIED",
  "CORRECTED",
  "NOT-APPLICABLE",
];

export const USER_AGENT =
  "tracebook/1.0 (claim source verification; https://github.com/iwyusdaz/tracebook)";

// ---------------------------------------------------------------------------
// Placeholder / secret hygiene
// ---------------------------------------------------------------------------

const PLACEHOLDER_PATTERNS = [
  /^$/,
  /^your[_-].*here$/i,
  /placeholder/i,
  /changeme/i,
  /^xxx+$/i,
  /^\$\{.*\}$/,
];

/** True if a value looks like a placeholder that must never trigger network use. */
export function isPlaceholder(value) {
  if (value === undefined || value === null) return true;
  const v = String(value).trim();
  return PLACEHOLDER_PATTERNS.some((re) => re.test(v));
}

/** Minimal .env reader (KEY=VALUE lines, # comments). Does not override real env vars. */
export function readDotEnv(envPath) {
  const out = {};
  if (!existsSync(envPath)) return out;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) out[key] = val;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fetching (deterministic; paywalled / restricted sources are labeled, never circumvented)
// ---------------------------------------------------------------------------

/**
 * Fetch a URL and return plain text suitable for quote-back matching.
 * Never retries with different identities, never strips paywalls, never
 * uses cookie jars or proxy workarounds. A 401/403/402 is reported honestly.
 *
 * @returns {Promise<{ok:boolean, status:number|null, restricted:boolean,
 *   unreachable:boolean, text:string, error:string|null, finalUrl:string|null}>}
 */
export async function fetchSourceText(url, { timeoutMs = 20000 } = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return fail(`not a valid URL: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return fail(`unsupported protocol ${parsed.protocol} — only http/https sources can be verified`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(parsed, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
      },
    });
    const status = res.status;
    // Paywalled or access-restricted: label honestly, return no body text.
    if (status === 401 || status === 402 || status === 403) {
      return {
        ok: false,
        status,
        restricted: true,
        unreachable: false,
        text: "",
        error: `access restricted (HTTP ${status}) — source is paywalled or blocks automated access; not circumvented`,
        finalUrl: res.url || url,
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        status,
        restricted: false,
        unreachable: true,
        text: "",
        error: `source unreachable (HTTP ${status})`,
        finalUrl: res.url || url,
      };
    }
    const raw = await res.text();
    const contentType = res.headers.get("content-type") || "";
    const text = /html/i.test(contentType) || /^\s*<(!doctype|html)/i.test(raw)
      ? htmlToText(raw)
      : raw;
    return {
      ok: true,
      status,
      restricted: false,
      unreachable: false,
      text,
      error: null,
      finalUrl: res.url || url,
    };
  } catch (err) {
    const reason =
      err && err.name === "AbortError"
        ? `timed out after ${timeoutMs}ms`
        : (err && err.message) || String(err);
    return { ok: false, status: null, restricted: false, unreachable: true, text: "", error: `fetch failed: ${reason}`, finalUrl: null };
  } finally {
    clearTimeout(timer);
  }
}

function fail(message) {
  return { ok: false, status: null, restricted: false, unreachable: true, text: "", error: message, finalUrl: null };
}

/** Strip HTML down to readable text (no external parser; good enough for quote-back). */
export function htmlToText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|head)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|blockquote|figcaption)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;|&rsquo;/gi, "'")
    .replace(/&mdash;/gi, "\u2014")
    .replace(/&ndash;/gi, "\u2013")
    .replace(/&[a-z]+;/gi, " ");
}

// ---------------------------------------------------------------------------
// Normalization and quote-back matching
// ---------------------------------------------------------------------------

/** Normalize text for matching: lowercase, unify punctuation, collapse whitespace. */
export function normalize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\u00a0/g, " ")
    .replace(/[^a-z0-9%$.\-'"+:/ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(text) {
  return normalize(text).split(" ").filter(Boolean);
}

/**
 * Quote-back match of `quote` inside `text`.
 * - verbatim: the normalized quote appears as an exact substring
 * - similarity: best windowed token overlap in [0,1] (order-insensitive),
 *   used to detect partial matches / possible content drift, which are
 *   labeled VERIFIED-SNIPPET and never silently upgraded to VERIFIED.
 */
export function quoteBackMatch(quote, text) {
  const qTokens = tokens(quote);
  const tTokens = tokens(text);
  if (qTokens.length === 0) {
    return { verbatim: false, similarity: 0, reason: "empty stored quote" };
  }
  const normalizedQuote = normalize(quote);
  const normalizedText = normalize(text);
  const verbatim = normalizedQuote.length > 0 && normalizedText.includes(normalizedQuote);
  if (verbatim) {
    return { verbatim: true, similarity: 1, reason: "exact quote-back match" };
  }
  if (tTokens.length === 0) {
    return { verbatim: false, similarity: 0, reason: "source text is empty" };
  }
  // Windowed multiset overlap: fraction of quote tokens present in each window.
  const window = Math.max(qTokens.length, 1);
  const qBag = new Map();
  for (const t of qTokens) qBag.set(t, (qBag.get(t) || 0) + 1);
  let best = 0;
  const step = Math.max(1, Math.floor(window / 4));
  for (let i = 0; i + window <= tTokens.length || (i === 0 && tTokens.length < window); i += step) {
    const slice = tTokens.slice(i, i + window);
    if (slice.length === 0) break;
    const bag = new Map();
    for (const t of slice) bag.set(t, (bag.get(t) || 0) + 1);
    let hits = 0;
    for (const [t, n] of qBag) hits += Math.min(n, bag.get(t) || 0);
    const score = hits / qTokens.length;
    if (score > best) best = score;
    if (best === 1) break;
  }
  return { verbatim: false, similarity: Number(best.toFixed(4)), reason: "no verbatim match" };
}

/** Extract load-bearing numbers (stats, versions, dates) from a string. */
export function extractNumbers(text) {
  const matches = String(text).match(/\d+(?:[.,]\d+)?/g) || [];
  return matches.map((m) => m.replace(/,/g, ".")).filter((m) => m !== ".");
}

/**
 * Numbers stated in the claim but absent from the source quote.
 * Returns [] when consistent. Only meaningful when the quote matched.
 */
export function numericMismatches(claim, quote) {
  const claimNums = extractNumbers(claim);
  if (claimNums.length === 0) return [];
  const quoteNums = new Set(extractNumbers(quote));
  return claimNums.filter((n) => !quoteNums.has(n));
}

// ---------------------------------------------------------------------------
// Ledger I/O
// ---------------------------------------------------------------------------

export const LEDGER_VERSION = "1.0";

export function emptyLedger() {
  return {
    ledger_version: LEDGER_VERSION,
    generated: null,
    generator: "tracebook",
    note:
      "A claims ledger surfaces factual claims and evidence for HUMAN JUDGMENT. " +
      "A green ledger does NOT mean the content is 'fact-checked' or certified.",
    claims: [],
  };
}

export function readLedger(path) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (!raw || !Array.isArray(raw.claims)) {
    throw new Error(`${path} is not a valid claims ledger (missing claims[])`);
  }
  return raw;
}

export function writeLedger(path, ledger) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(ledger, null, 2) + "\n");
}

export function readJsonIfExists(path, fallback) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback;
}

export function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
