# Attribution

TraceBook adopts ideas and patterns from the projects below. **No source
code was copied from them** — the patterns below informed the design; all
implementation in this repository is original.

## K-Dense-AI/scientific-agent-skills

- **What it is:** a collection of agent skills for scientific work, including
  evidence-traceable writing and citation-management conventions.
- **License:** MIT (https://github.com/K-Dense-AI/scientific-agent-skills)
- **What TraceBook adopts:** the methodology of *evidence-bounded claims* —
  every factual assertion carries a source, an access date, and a traceable
  verdict — and the general pattern of skill/composable checklists for
  research rigor. TraceBook's ledger schema (claim → source → URL → access
  date → verdict → correction note) follows this evidence-traceability
  convention.
- **Changes made:** reworked from agent-skill prose into a deterministic,
  machine-checkable ledger format and CLI pipeline.

## Panniantong/Agent-Reach

- **What it is:** a tool providing agents with fetch/reach capabilities for
  public web sources.
- **License:** MIT (https://github.com/Panniantong/Agent-Reach)
- **What TraceBook adopts:** the fetch pattern for public sources — and,
  importantly, the *boundary*: only public/legitimate access. TraceBook
  follows the same rule that paywalled or access-restricted sources are
  honestly labeled (`ACCESS-RESTRICTED`) and never circumvented.
- **Changes made:** implemented as a minimal, dependency-free Node fetch
  helper (`src/lib.mjs`) with explicit handling for 401/402/403, timeouts,
  and content-type detection — no code from Agent-Reach.

## Portfolio process (this workspace)

- The claims-ledger format, the verdict vocabulary (VERIFIED /
  VERIFIED-SNIPPET / UNVERIFIED / CORRECTED / NOT-APPLICABLE), access-date
  discipline, and the honesty rules were developed through a manual
  claim-by-claim verification pass across a seven-repo learning-design
  portfolio, then productized here.

## Fixture content

All content under `test-fixtures/` (including the fictional "Lakeside State
University", "CourseKit", and the fictional journals) is original fictional
material written for testing, labeled as fictional in the files themselves.
It must not be cited as real evidence.
