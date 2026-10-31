# GraphHacks (NODUS) implementation roadmap

This is the finalized stage order for the project. It is a planning reference,
not a status report — for current implementation state, see
`docs/PROJECT_STATE_HANDOFF.md` (re-run/re-verify that doc per stage; it decays
as the working tree changes, this file does not track live state).

01. Repository & Architecture Foundations
02. Graph & Evidence Engine
03. Connectors & Real-Data Pipeline
04. Deterministic Tools
05. Skills & Model Gateway
06. Agent Runtime & Harness
07. Durable Workflow Engine
08. Handoff & Multi-Agent Coordination
09. Relationship Intelligence
10. Adaptive Company Intelligence
11. Optimization & Deployment

## Stage 01 completion gates

Stage 01 is COMPLETE only when all six gates below hold. Gates 1–5 are
satisfied today by code in `backend/app/contracts.py` and
`backend/app/security.py`, verified by `backend/tests/test_foundation_contracts.py`
(7 tests, passing). Gate 6 is the one Stage 01 item that previously had no
representation anywhere in the repo; it is now covered by the same two files.

1. **Component ownership and typed interfaces.** Each store/engine has exactly
   one owning module, declared as a `Protocol` port: `GraphPort`,
   `EvidencePort`, `ConnectorPort`, `WorkflowPort`, `AgentPort`, `ToolPort`,
   `OutboxPort`, `ProjectorPort` (`backend/app/contracts.py`). No code outside
   a port's eventual adapter may write to that port's store.
2. **Temporal as sole future durable-workflow authority.** Stated in the
   `contracts.py` module docstring and the `WorkflowPort` docstring: Temporal
   alone owns durable workflow state, retries and completion; any future
   PostgreSQL task rows are projections only, never a second scheduler. No
   Temporal dependency or adapter exists yet, and none should until Stage 07.
3. **Cross-store consistency, outbox and projector contracts.** `OutboxEvent`
   (dedup by `(tenant_id, idempotency_key)`) and `ProjectionWatermark`
   (`accepts()` / `needs_replay()` by revision) define the consistency
   contract; `OutboxPort` / `ProjectorPort` declare the adapter shape. No
   Postgres table, projector or adapter is implemented yet — that is
   explicitly out of scope until gate 6's criteria are met (see below).
4. **Agent/tool permission and approval boundaries.** `Permission`,
   `Principal`, `AuthorizationContext` (scope-narrowing `delegate()`), and
   `ToolPolicy.authorize()` (`backend/app/security.py`) are implemented and
   unit-tested. Enforced today at the HTTP layer via `main.py`'s `require()`
   dependency and `Principal.permits_source()`; no tool-execution runtime
   exists yet to enforce this at invocation time (that is Stage 04+).
5. **Checkpoint, handoff, fencing and idempotency contracts.** `Checkpoint`
   (owner fence, idempotency scope, expiry validated against budget deadline)
   and `Handoff` (compare-and-swap on `owner_fence` and `task_revision`) are
   implemented and unit-tested, along with idempotency keys on `Completion`
   and `OutboxEvent`. No persistent store performs the compare-and-swap yet —
   that requires Stage 07's Temporal/Postgres adapters.
6. **Baseline measurement and conditional storage-adoption criteria.**
   `BaselineMetrics` records the Stage 01 reference measurements observable
   from the current Neo4j-only slice (ingest/query P95 latency, connector
   count, cross-store conflicts observed). `StorageAdoptionCriteria.should_adopt()`
   defines the explicit condition for moving the Postgres outbox/projector
   from contract to implementation (more than one connector, or any observed
   cross-store conflict) — this exists to prevent building outbox/projector
   infrastructure before it is actually needed.

Required infrastructure configuration for gates above to be exercisable:
`docker-compose.yml` declares Neo4j 5.26 and PostgreSQL 16 services; `.env`
must supply `NEO4J_PASSWORD` and `POSTGRES_PASSWORD` (see `.env.example`) or
`docker compose config` fails to parse. PostgreSQL is declared for future use
only — no application code connects to it today, matching gate 3's "contract,
not implementation" status.

## Roadmap/requirements conflict — resolved 2026-10-31

The three root task files that currently define GraphHacks' actual
requirements explicitly forbid introducing an agent framework as part of the
Neo4j rebuild:

- `01-FalkorDB-Removal-and-Neo4j-Rebuild.md`: "No LangGraph framework or agent
  harness should be introduced as part of this database replacement" and "The
  current decision is to build a **non-agentic, graph-first** product on Neo4j
  without LangGraph."
- `02-Relationship-Graph-Implementation.md`: "Do not introduce LangGraph or
  any LLM orchestration framework as a prerequisite."
- `03-Relationship-Effects-Implementation.md`: "Do not use ... a Supervisor, a
  multi-agent loop, or LangGraph as a feature prerequisite" and, in its
  definition of done, "No autonomous agent or legacy database must be
  involved."

This roadmap's own Stages 04–08 (Deterministic Tools, Skills & Model Gateway,
Agent Runtime & Harness, Durable Workflow Engine, Handoff & Multi-Agent
Coordination) call for Gemini, Google ADK and Temporal agent infrastructure.

**Resolution (maintainer decision, 2026-10-31):** the finalized 11-stage
roadmap in this document is authoritative. The non-agentic restriction in the
three root task files applies only to the core graph, ingestion, evidence,
and deterministic execution layers — those must continue to operate
independently of LLMs and agent frameworks, and their requirement IDs and
acceptance criteria are unchanged. The complete NODUS product will include
Gemini, Google ADK, reusable skills, Temporal workflows, and multi-agent
coordination in Stages 05–08 as originally planned. Stage 04 (Deterministic
Tools) proceeds now, scoped strictly to deterministic, non-agentic tool
infrastructure with no LLM, agent, ADK, skill-loader, or Temporal dependency;
those remain reserved for Stages 05+.

## Requirements sources

The only authoritative in-repo requirement IDs are the 82 checklist items in
the three root task files, all currently unchecked:

- `01-FalkorDB-Removal-and-Neo4j-Rebuild.md` — M01–M20 (20 items)
- `02-Relationship-Graph-Implementation.md` — R01–R38 (38 items)
- `03-Relationship-Effects-Implementation.md` — E01–E24 (24 items)

No versioned 51-requirement document exists anywhere in this repository. Do
not infer meanings for IDs beyond R01–R38 (there is no R39–R51), and do not
claim 51-item coverage — that source is external to this repo and must be
supplied before it can be used as a completion criterion.
