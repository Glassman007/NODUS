# Agent instructions for this repository

This file directs Codex/agent tasks working in GraphHacks (NODUS). Read in
this order before starting work:

1. **`docs/IMPLEMENTATION_ROADMAP.md`** — the finalized 11-stage order and the
   Stage 01 completion gates. Do not begin a stage's work until the prior
   stage's gates are satisfied, and do not mark a stage COMPLETE without
   verifying its gates against running code/tests, not documentation.
2. **The three root task files** — `01-FalkorDB-Removal-and-Neo4j-Rebuild.md`,
   `02-Relationship-Graph-Implementation.md`,
   `03-Relationship-Effects-Implementation.md` — are the only authoritative
   in-repo requirements (IDs M01–M20, R01–R38, E01–E24). Preserve their IDs
   and wording exactly. Do not fabricate additional requirement IDs (there is
   no R39–R51) or claim a requirement is met without the evidence its own
   stated "done" criteria call for.
3. **The checklist files' own `[x]`/`[ ]` state and inline verification notes**
   are the current implementation-state record — there is no separate status
   document. Each checked item carries an inline note (file/test it was
   verified against); trust that over any memory of a prior session, and
   re-run the cited test before relying on an older checkmark if the
   underlying code has since changed.

## Requirement progress tracking

For every implementation task touching `01-FalkorDB-Removal-and-Neo4j-Rebuild.md`,
`02-Relationship-Graph-Implementation.md` or `03-Relationship-Effects-Implementation.md`:

1. Identify the affected requirement IDs before implementation.
2. Preserve the original requirement IDs and acceptance criteria — never
   reinterpret or rewrite a requirement's wording.
3. After implementation, verify each requirement against its exact "Done
   when" condition, not against a stage being declared complete.
4. Change `[ ]` to `[x]` only when the entire requirement is implemented and
   appropriately tested; add a short inline note citing the file/test that
   verifies it.
5. Keep partially implemented or unverified requirements unchecked — do not
   check an item because a dependency or a later item in the same group is
   done.
6. If previously completed behavior regresses, reopen (`[x]` → `[ ]`) the
   affected requirement.
7. Update checklist status in the same change as the implementation and
   verification, not as a separate follow-up.
8. In the final response for that task, report requirement IDs completed,
   remaining gaps, and tests performed.

Never fabricate missing requirements (there is no R39–R51 or any ID beyond
M01–M20/R01–R38/E01–E24) and never create a separate progress-report, audit
file, or duplicate requirement tracker — the three checklist files are the
single source of truth for requirement status.

## Stage 04 conflict — resolved 2026-10-31

The three root task files mandate a non-agentic, LangGraph-free Neo4j product
for the core graph, ingestion, evidence, and deterministic execution layers.
`docs/IMPLEMENTATION_ROADMAP.md`'s Stages 04–08 call for Gemini/Google
ADK/Temporal agent infrastructure. The maintainer has resolved this conflict:
the finalized 11-stage roadmap is authoritative. The non-agentic restriction
applies only to the core graph, ingestion, evidence, and deterministic
execution layers, which must operate independently of LLMs and agent
frameworks. The complete NODUS product will include Gemini, Google ADK,
reusable skills, Temporal workflows, and multi-agent coordination in their
designated future stages (05–08). Instructions prohibiting all agentic
capabilities globally are superseded by this decision. See the roadmap doc's
"Roadmap/requirements conflict" section for the historical record of the
conflict and its resolution. Stage 04 work (deterministic tools) may proceed
provided it introduces no LLM, agent, ADK, skill-loader, or Temporal
dependency — those remain scoped to Stages 05+.

## Repository conventions (current state, not aspiration)

- Single FastAPI app in `backend/app/main.py` — no `api/` router package yet;
  new HTTP routes go there until a split is explicitly planned.
- Typed cross-component contracts live in `backend/app/contracts.py`
  (`Identity`, `Checkpoint`, `Handoff`, `OutboxEvent`, `ProjectionWatermark`,
  `BaselineMetrics`, `StorageAdoptionCriteria`, and the `*Port` Protocols) and
  `backend/app/security.py` (`Permission`, `Principal`, `AuthorizationContext`,
  `ToolPolicy`). These are frozen Pydantic `Record` models with
  `model_validator`s enforcing invariants (fencing, expiry, scope-narrowing) —
  follow this pattern for new contracts rather than inventing a new style.
- Tests live under `backend/tests/`. `test_foundation_contracts.py` is pure
  unit tests (no I/O). `test_neo4j_graph.py` is marked `integration` in
  `pytest.ini` and spins up its own isolated Neo4j Docker container unless
  `GRAPH_HACKS_TEST_NEO4J_URI`/`GRAPH_HACKS_TEST_NEO4J_PASSWORD` are set.
- Dependencies: root `requirements.txt` only (no `backend/requirements.txt`,
  no `pyproject.toml`). Frontend deps are in `frontend/package.json`.
- `.env` is local-only (gitignored) and must define `NEO4J_PASSWORD` /
  `POSTGRES_PASSWORD` or `docker compose config` fails to parse — see
  `.env.example` for the full variable set.
- `PRODUCT.md` and `DESIGN.md` describe the pre-rebuild FalkorDB-era product
  and UI; treat them as historical, not authoritative, until reconciled with
  the current Neo4j implementation. Same for `docs/*.md` other than this file
  and `docs/IMPLEMENTATION_ROADMAP.md`.
- The frontend persists the bearer token in browser `localStorage`
  (`frontend/src/App.tsx`) — acceptable for the current dev explorer, but a
  security consideration to address before any production exposure.
