# GraphHacks project state handoff

Snapshot: 2026-10-31 (Asia/Calcutta). This describes the **working tree**, not a released or committed state. Evidence is source inspection and the checks below; live Neo4j behavior is unverified in this environment.

## 1. Repository identity and Git state

- Branch `main` tracking `origin/main`; HEAD `eede601e6e679137e26bac3b6e6df43fdac594f1` (`Patched errors`). Recent commits: `531a17a`, `e4a0a51`, `3f8f44c`, `a93cfe2`.
- Dirty: 510 tracked deletions, 20 tracked modifications, 17 untracked files **before this handoff**. This report adds one untracked file. The working tree removes most previous FalkorDB/Verinex backend, frontend, tests, fixtures, scripts, reports, and agent runtime, replacing them with a small Neo4j implementation. No conclusion about a deployed version follows from HEAD or these uncommitted files.
- Top level: `backend/`, `frontend/`, `docs/`, `scripts/`, `evidence/`, `reports/`, three new root task files, `README.md`, `PRODUCT.md`, `DESIGN.md`, `docker-compose.yml`, `requirements.txt`, `pytest.ini`. Existing `docs/*.md` largely describe the old architecture; treat as historical until reconciled with source. No `AGENTS.md` was found.

## 2. Executive state and stack

The working tree contains a FastAPI graph API, Pydantic input/response models, official Neo4j Python driver repository, source-record ingestion and retraction, and a minimal React/TypeScript/Vite explorer. Neo4j Community 5.26.32 and PostgreSQL 16.10 are declared in Compose, but application code uses Neo4j only. `Settings.postgres_dsn` validates an optional URL; there is no PostgreSQL connection or persistence implementation. No object storage integration, Temporal runtime, Google ADK, model gateway, LLM provider/model call, runnable agent, skill loader, deterministic tool service, or workflow engine exists in the current source tree. `backend/app/contracts.py` and `backend/app/security.py` contain future-facing records, ports and tool policy validation, not adapters or a running task lifecycle.

The application cannot currently be shown to start here: importing `backend.app.main` fails because `.venv` lacks the `neo4j` package, and Docker access is denied. The source is structurally present and the frontend builds; a live graph API and browser flow remain unverified.

## 3. Subsystem inventory and actual flows

| Subsystem and files | Present behavior and dependencies | Incomplete / verification |
|---|---|---|
| Configuration and deployment: `backend/app/config.py`, `backend/app/graph/driver.py`, `docker-compose.yml`, `.env.example`, `requirements.txt` | Validates Neo4j URI and password, creates driver, verifies connectivity, initializes constraints/indexes on startup. Compose declares Neo4j and PostgreSQL. | No validated live startup here. PostgreSQL is declared but unused. No Temporal, object-store or application deployment manifests. Driver package absent from current `.venv`. |
| Auth and API: `backend/app/main.py:23-60,125-298`, `backend/app/security.py` | Static bearer-token-to-principal JSON from environment; tenant/workspace/source permission gates; session, workspace, record/import, graph query and evidence routes; structured errors/request IDs. | No external identity provider or durable permission store. Tool delegation/approval policy is a model only. Token is persisted by UI in browser `localStorage` (`frontend/src/App.tsx:20,89`), a security consideration for production. Auth and tenant integration tests could not run. |
| Graph model/storage: `backend/app/graph/models.py`, `driver.py`, `repository.py` | Limited entity/edge enums, source assertions, evidence metadata, source-scoped or explicit canonical IDs, conflicting claim display, temporal fields, retraction, scoped bounded search/neighborhood/reverse dependency/path queries. Writes use Neo4j transactions per source record. | No endpoint-type registry, authority rules, inference provenance, graph revision, capability-driven ontology or full R01-R38 model. `paths` traverses by repeated neighborhood reads (`repository.py:331`); no live scale result. Neo4j integration tests exist but are blocked. |
| Ingestion: `backend/app/ingestion/local_json.py`, `github_public.py`, `scripts/import_json.py` | Local JSON validation/normalization, direct normalized-record POST, and public GitHub PR list fetch (up to 20) with PR/repository/author graph facts. API supports retraction. | No scheduled/incremental connector sync, cursor, transactional outbox, projector, reconciliation or persistent ingestion run. JSON batch loops over per-record transactions (`main.py:157-168`), so a batch is not atomic. Live GitHub test is opt-in and not run. |
| Frontend: `frontend/src/App.tsx`, `api/graphClient.ts`, `main.tsx`, `styles.css` | Token connection, workspace selection, search, entity detail, neighborhood, evidence/assertions/sources, history toggle and async response invalidation. React 18/Vite 5. | No relationship-effect workflows or general agent UI. Type check, unit test and build pass; browser E2E not run. |
| Foundation contracts: `backend/app/contracts.py`, `security.py`, `backend/tests/test_foundation_contracts.py` | Pydantic identity, budget, task, checkpoint/handoff fence, outbox event, watermark and port definitions; permission narrowing/approval validation. Six unit tests pass. | No implementations of `WorkflowPort`, `AgentPort`, `ToolPort`, `OutboxPort` or `ProjectorPort`; no persistent fencing, outbox or watermark. Prose claiming Temporal/PostgreSQL ownership describes intended design only. |
| Tests: `backend/tests/test_neo4j_graph.py`, `frontend/src/test/neo4jClient.test.ts`, `frontend/e2e/neo4j.spec.ts`, `scripts/run_neo4j_e2e.py` | Neo4j suite covers source lifecycle, scope, ACL, pagination, replay/concurrency, temporal claims, timeout and recovery; Playwright script prepares isolated Neo4j/backend/UI. | Neo4j suite cannot collect in current `.venv`; Docker pipe denied. Frontend unit tests cover API client only. Public GitHub live test requires explicit flag. |

Flow classification (source paths above are the trace):

| Flow | State | Evidence / limit |
|---|---|---|
| A. Source → normalization → graph | **PARTIAL** | `local_json.normalize` / `github_public.normalize_pull_request` → `main.ingest/import_*` → `GraphRepository.ingest`; per-record transaction exists, but live DB and incremental sync unverified/absent. |
| B. Graph query → authorization → API → frontend | **PARTIAL** | `main.principal/require/repository` → scoped repository queries → `graphClient` / `App`; frontend builds, but live tenant/ACL and E2E checks blocked. |
| C. Agent request → model → tools → result | **NOT IMPLEMENTED** | No active agent/model/tool execution modules; only `AgentPort`, `ToolPort`, `ToolPolicy` interfaces. |
| D. Workflow start → persisted state → retry/recovery | **NOT IMPLEMENTED** | `WorkflowPort`, checkpoint and outbox types only; no Temporal adapter or durable state. |
| E. Evidence → relationship verification → findings | **PARTIAL** | Source assertions and evidence lookup in `repository.py`; no verification operations or findings service. |
| F. Company config → ontology/capability selection | **NOT IMPLEMENTED** | Fixed enums in `models.py`; no company config or capability mapping. |

## 4. Requirements and document authority

- `01-FalkorDB-Removal-and-Neo4j-Rebuild.md` — **GraphHacks — 01 / 03 — Remove FalkorDB and Rebuild on Neo4j**; untracked proposed checklist, M01–M20, no tasks marked complete. Decides Neo4j Community and a non-agentic graph product.
- `02-Relationship-Graph-Implementation.md` — **GraphHacks — 02 / 03 — Relationship Graph Implementation Tasks**; untracked proposed checklist, R01–R38, no tasks marked complete.
- `03-Relationship-Effects-Implementation.md` — **GraphHacks — 03 / 03 — Relationship Effects and Product Features**; untracked proposed checklist, E01–E24, no tasks marked complete.
- `PRODUCT.md` — **Product**; tracked, broad product description, no numbered requirement set. `DESIGN.md` — **Design System: GraphHacks — Read the Rain** (heading at line 132); tracked visual guidance, appears tied to older UI. Existing `docs/ontology.md`, `docs/ingestion_architecture.md`, `docs/relationships.md`, `docs/api_authentication.md`, etc. are tracked legacy design/reference documents and do not establish current implementation. No versioned authoritative 51-requirement document or repository copy of the external 11-stage roadmap was found.

The available task files contain **82 distinct checklist IDs: M01–M20 (20), R01–R38 (38), E01–E24 (24)**. Only R01–R38 are relationship requirements here; these are not proof of the user's referenced 51 requirements. The authoritative 51-item requirement source and any statements/identifiers beyond the available R01–R38 are missing. Do not infer meanings for R39–R51 (including R48–R51), or claim 51-item coverage. The external 11-stage sequence supplied with this discovery request is a mapping reference, not evidence of completion. It also conflicts in direction with the new proposed files' explicit non-agentic product decision; architectural authority needs reconciliation before agent stages are implemented. This handoff is explicitly requested by the user despite the proposed task files' general prohibition on extra audit/status documents.

Available evidence maps only to a subset: M01–M15 have corresponding code/config in varying degree; M16–M20 lack verified live acceptance. R01–R04/R06/R08/R09 and R13 (GitHub PR data) have partial source evidence, not their full done criteria. R05, R07, R10–R12, R14–R38 and E01–E24 have no verified completion; individual future components may be sketched in contracts or test intentions. No E feature is implemented. All checklist boxes remain unchecked; use tests and stated done criteria rather than checkmarks alone.

## 5. External 11-stage status matrix

| Stage | Available evidence and verified component | Incomplete / blocker | Status |
|---|---|---|---|
| 01 Repository & Architecture Foundations | `contracts.py`, `security.py`; six contract tests pass; Neo4j/Compose/config source exists. | No runtime cross-store consistency, outbox, workflow ownership, persistent security or idempotency contract. Live startup blocked. | **PARTIAL** |
| 02 Graph & Evidence Engine | Neo4j repository/models, source assertions, scoped queries and evidence API. | Live DB tests blocked; ontology, authority, ACL exhaustiveness, revisions and provenance depth incomplete. | **PARTIAL** |
| 03 Connectors & Real-Data Pipeline | Local JSON and public GitHub PR importer source. | Incremental sync, retractions from source sync, outbox/projectors/reconciliation absent; GitHub live check not run. | **PARTIAL** |
| 04 Deterministic Tools | `ToolPort`/`ToolPolicy` declarations and one policy unit test. | No callable graph/evidence/verification tool service or policy registry. | **NOT STARTED** |
| 05 Skills & Model Gateway | No implementation. | Gemini/model gateway and skill lifecycle absent. | **NOT STARTED** |
| 06 Agent Runtime & Harness | `AgentPort` declaration only. | No Google ADK, investigator or executable harness. | **NOT STARTED** |
| 07 Durable Workflow Engine | `WorkflowPort`, task/checkpoint types only. | No Temporal worker, persisted workflow, retries/approvals. | **NOT STARTED** |
| 08 Handoff & Multi-Agent Coordination | `Handoff` validation and fence unit test. | No atomic owner transition, worker pool, duplicate prevention or persistent handoff. | **NOT STARTED** |
| 09 Relationship Intelligence | Basic graph paths and `DEPENDS_ON` reverse lookup. | No change detection, findings, counterfactuals, verification/invalidation. | **NOT STARTED** |
| 10 Adaptive Company Intelligence | Fixed entity/relationship enums only. | No company capability discovery or controlled ontology evolution. | **NOT STARTED** |
| 11 Optimization & Deployment | Docker Compose, bounded query parameters, type/build tests and E2E harness source. | Live E2E, failure/performance/security validation and deployment unverified; TigerData/MongoDB evaluation not present. | **PARTIAL** |

## 6. Critical architecture conditions and immediate blockers

1. **Temporal ownership:** asserted in `contracts.py` docstring and `WorkflowPort`; no Temporal dependency or implementation. **Not satisfied.**
2. **Skills versus deterministic enforcement:** no skill system or executable tools. `ToolPolicy` checks permission/approval in isolation. **Not satisfied.**
3. **Cross-store consistency:** `OutboxEvent`, `ProjectionWatermark`, `OutboxPort`, `ProjectorPort` are declarations; no PostgreSQL adapter, outbox table, projector or recovery. **Not satisfied.**
4. **Atomic handoff:** `Handoff` model validates expected revision/fence, but no transactional ownership update or duplicate prevention. **Not satisfied.**
5. **Tool permission classes/delegation/approval:** `Permission`, `AuthorizationContext.delegate`, `ToolPolicy.authorize` are unit tested, but no task-scoped tool runtime or enforcement at invocation. **Partial contract only.**

Immediate blockers: missing `neo4j` package in the current `.venv`; Docker API denied, preventing isolated DB and E2E checks; authoritative 51-item requirements and roadmap completion criteria unavailable; conflicting proposed non-agentic Neo4j direction versus external agent stages. Existing functionality to preserve during any next work: scoped source-record import/retract, conflict-preserving assertions, bounded graph reads, evidence permission split, and the minimal explorer, subject to live verification.

## 7. Verification performed

| Command | Result |
|---|---|
| `.\.venv\Scripts\python.exe -m pytest backend/tests/test_foundation_contracts.py -q` | **PASS:** 6 tests. Pytest cache write warning (access denied) did not fail tests. |
| `.\.venv\Scripts\python.exe -m pytest backend/tests/test_neo4j_graph.py --collect-only -q` | **BLOCKED at collection:** `ModuleNotFoundError: neo4j`; no graph tests executed. |
| `.\.venv\Scripts\python.exe -c "from backend.app.main import app; ..."` | **BLOCKED:** same missing `neo4j` dependency; backend startup not demonstrated. |
| `node node_modules/typescript/bin/tsc -b --pretty false` (in `frontend`) | **PASS.** Direct Node path used. |
| `node node_modules/vitest/vitest.mjs run --config vitest.config.ts` (in `frontend`) | **PASS:** 4 API-client tests. |
| `node node_modules/vite/bin/vite.js build` (in `frontend`) | **PASS:** 32 modules transformed; production bundle generated. |
| `npm test -- --run`; `npm run build` | **ENVIRONMENT BLOCKED:** npm launcher hit `EPERM` on `C:\Users\Aditya`; direct Node equivalents passed. |
| `docker info --format '{{.ServerVersion}}'` | **BLOCKED:** Docker config/engine pipe permission denied. No Neo4j container, backend integration, connector integration or browser E2E was run. |

No dependencies were installed, no paid LLM API was called, and no application source was changed for this handoff. Previous `evidence/` and legacy `reports/` files were not accepted as current test results because the application has changed extensively.

## 8. Next implementation priority and source index

**Next smallest task:** make the declared Neo4j dependency available in an authorized test environment, run the existing isolated `backend/tests/test_neo4j_graph.py` suite and `scripts/run_neo4j_e2e.py`, and fix only failures demonstrated by those runs. This is the prerequisite for claiming even the current source→graph→API→UI slice works; it does not begin an agent stage. Resolve the authoritative roadmap/requirements conflict before building stages 04–10.

Source index for follow-up: startup/API `backend/app/main.py`; settings `backend/app/config.py`; Neo4j schema/driver `backend/app/graph/driver.py`; graph input/output types `backend/app/graph/models.py`; graph persistence/query `backend/app/graph/repository.py`; auth contracts `backend/app/security.py`; future architecture ports `backend/app/contracts.py`; ingestion `backend/app/ingestion/local_json.py`, `github_public.py`; explorer `frontend/src/App.tsx`, HTTP client `frontend/src/api/graphClient.ts`; tests `backend/tests/test_foundation_contracts.py`, `backend/tests/test_neo4j_graph.py`, `frontend/src/test/neo4jClient.test.ts`, `frontend/e2e/neo4j.spec.ts`; E2E runner `scripts/run_neo4j_e2e.py`; root proposed task files 01, 02 and 03.
