#!/usr/bin/env node
// TraceBook test fixture server — serves simulated "primary source" pages for
// the negative test. NOT part of the shipped CLI. Fixed port 8641 so the
// committed ledger's fixture URLs are stable.
//
//   /sources/tutoring-effect.html        200  (backs C001, C002)
//   /sources/spaced-practice.html        200  (backs C002 — merged below)
//   /sources/journal-paywalled.html      403  (C003 — access restricted)
//   /sources/platform-changelog.html     200  (backs C004 — version moved on)
//   /sources/retrieval-practice.html     200  (backs C005 — wording drifted)
//   /sources/retired-guideline.html      404  (C006 — dead link)
//   anything else                        404

import { createServer } from "node:http";

const PAGES = {
  "/sources/tutoring-effect.html": `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>National Tutoring Meta-Analysis (2025) — Lakeside State University</title></head>
<!-- TraceBook fixture source page (simulated for testing). Fictional publisher. -->
<body>
<h1>National Tutoring Meta-Analysis (2025)</h1>
<p>Lakeside State University Center for Education Research, working paper 2025-04.</p>
<p>Across 96 randomized studies, high-impact tutoring improved achievement by
0.10 to 0.20 standard deviations, with the largest gains in early-grades
reading.</p>
<p>Spaced practice typically improves long-term retention by 10 to 30 percent
compared with massed practice in classroom studies, consistent with prior
meta-analyses.</p>
</body></html>`,
  "/sources/journal-paywalled.html": `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Journal of Postsecondary Persistence — subscription required</title></head>
<body><h1>403 — Subscription required</h1><p>This article is behind a paywall.</p></body></html>`,
  "/sources/platform-changelog.html": `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>CourseKit Release Notes</title></head>
<!-- TraceBook fixture source page (simulated for testing). Fictional publisher. -->
<body>
<h1>CourseKit Release Notes</h1>
<p>The current release is CourseKit 4.2.1 (March 2026). Version 4.0 removed the
legacy SCORM player; version 3.8.x entered security-only maintenance in
February 2026.</p>
</body></html>`,
  "/sources/retrieval-practice.html": `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Retrieval Practice in Classrooms — Evidence Summary</title></head>
<!-- TraceBook fixture source page (simulated for testing). Fictional publisher. -->
<body>
<h1>Retrieval Practice in Classrooms</h1>
<p>Retrieval practice strengthens memory more than restudying in 87% of
classroom experiments reviewed here, with effects concentrated in delayed
tests.</p>
</body></html>`,
};

const server = createServer((req, res) => {
  const path = new URL(req.url, "http://127.0.0.1").pathname;
  if (path === "/sources/journal-paywalled.html") {
    res.writeHead(403, { "content-type": "text/html" });
    res.end(PAGES[path]);
    return;
  }
  if (path === "/sources/retired-guideline.html") {
    res.writeHead(404, { "content-type": "text/html" });
    res.end("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>404</title></head><body><h1>404 Not Found</h1></body></html>");
    return;
  }
  if (PAGES[path]) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(PAGES[path]);
    return;
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("fixture server: not found");
});

const PORT = 8641;

export function startFixtureServer() {
  return new Promise((resolveStart, reject) => {
    server.once("error", (err) => {
      if (err.code === "EADDRINUSE") {
        reject(new Error(`port ${PORT} already in use — close the other fixture server or kill the stale process`));
      } else reject(err);
    });
    server.listen(PORT, "127.0.0.1", () => resolveStart(`http://127.0.0.1:${PORT}`));
  });
}

export function stopFixtureServer() {
  return new Promise((r) => server.close(() => r()));
}

// Allow running directly: `node tests/fixture-server.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
  startFixtureServer().then((base) => {
    console.log(`Fixture server on ${base} (Ctrl-C to stop)`);
  });
}
