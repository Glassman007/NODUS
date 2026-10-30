# GraphHacks — 01 / 03 — Remove FalkorDB and Rebuild on Neo4j

**Task file:** `01-FalkorDB-Removal-and-Neo4j-Rebuild.md`  
**Decision:** Replace FalkorDB completely with **Neo4j Community Edition** (official Docker image, pinned compatible release), using official Neo4j drivers and parameterized Cypher.  
**Status:** Proposed; no task is marked complete.  
**Owner:** Claude Code or another implementation assistant.  
**Precedes:** `02-Relationship-Graph-Implementation.md` and `03-Relationship-Effects-Implementation.md`.

## Non-negotiable instructions

- **NO FALKORDB AUDIT.** Do not analyze, review, assess, benchmark, reverse-engineer, document, or produce any inventory/report about the current FalkorDB implementation. Do not add audit scripts, audit output, comparison matrices, or migration assessment documents.
- **REPLACE; DO NOT ADAPT.** This is a deliberate clean break. No API compatibility, old graph schema compatibility, adapter/shim, dual writes, legacy seed compatibility, old dataset support, or old agent runtime preservation is required. A temporary broken state during the rebuild is acceptable.
- **REMOVE the old runtime**, including old agents, scripted multi-agent loops, demonstration scenarios, Demo Lab, fake issue detectors, and any dependency no longer serving the new graph product. No LangGraph framework or agent harness should be introduced as part of this database replacement.
- **Do not migrate old FalkorDB contents** by default; rebuild the graph from authorized external sources and new connectors. Do not generate dumps, backups, or migration reports. Never delete files, volumes, servers, or credentials outside resources positively identifiable as belonging only to this GraphHacks development deployment.
- **No audit deliverables, status-report files, or planning reports.** This task file is an implementation checklist, not an instruction to generate additional reports. Keep final response concise: changes made, checks actually run, and blockers.
- Use necessary searches such as `rg FalkorDB`, Docker Compose references, dependency manifests, and import lookups **only to locate and remove references**. That is not permission to run an architectural audit of the legacy code.
- Use actual source-backed graph facts; never recreate the 24 Asteria canned scenarios, synthetic production findings, or simulated agent activity.
- The graph must work without any LLM, LangChain, or LangGraph dependencies. Optional language processing is a separate future product decision.

## Why Neo4j, not LangGraph

**Neo4j is the graph database.** It stores nodes, relationships and properties, and supports Cypher traversals and indexes. **LangGraph is a stateful agent/workflow orchestrator**, not a database replacement. The current decision is to build a **non-agentic, graph-first** product on Neo4j without LangGraph.

**Edition caveat:** Neo4j Community Edition provides one standard database per DBMS. Use **application-enforced tenant scoping** for the MVP and test it rigorously, but do not claim this provides physical or database-role isolation between tenants. For stronger enterprise isolation, use a separately managed instance per tenant or appropriately licensed Neo4j Enterprise/Aura capabilities; do not quietly rely on Community multi-database or enterprise-only RBAC.

### Target stack

| Layer | New implementation |
|---|---|
| Database | Pinned official Neo4j Community Docker image; persistent named volume scoped to GraphHacks |
| Backend driver | Official `neo4j` Python driver; parameterized Cypher, managed sessions and transactions |
| Application | FastAPI with new domain services and explicit read/write contracts |
| Graph model | Tenant-scoped typed entities, directed typed relationships, evidence/provenance, time and source identities |
| Query layer | Typed bounded lookup, neighborhood, reverse dependency, and path-explanation services |
| Frontend | React/TypeScript graph explorer and useful workflow pages, driven by new contracts |
| Data ingestion | New connector contracts; no old FalkorDB import path |
| Deployment | Docker Compose + environment-based configuration + readiness checks |
| AI orchestration | **None required**; no old supervisor, artificial agents or LangGraph loop |

## A. Destructive removal — do not audit old implementation

- [ ] **M01 · P0 — Establish new clean-break target.** Set Neo4j as the only future graph backend in implementation configuration and engineering tasks. Do not create a compatibility architecture. **Done when:** new source files, configs and task links consistently target Neo4j only.
- [ ] **M02 · P0 — Remove FalkorDB from local deployment.** Delete project-specific FalkorDB image/service declarations, old ports, Falkor-specific environment variables, health checks and local scripts. Add Neo4j service, persistent volume, resource limits and ready/health handling in the active Compose setup. **Done when:** a fresh Compose deployment starts Neo4j without starting FalkorDB. **Depends:** M01.
- [ ] **M03 · P0 — Remove old graph clients and packages.** Use narrow import/config text searches exclusively to locate references for deletion. Remove FalkorDB/RedisGraph-specific Python packages, JS packages, client factories, Cypher dialect helpers, and dependency declarations. **Done when:** application dependency trees and tracked source contain no active FalkorDB graph-client usage. **Depends:** M01.
- [ ] **M04 · P0 — Delete legacy graph runtime instead of porting it.** Delete outdated services, graph query implementations, FalkorDB-backed models, old agent/supervisor/handoff/loop modules, scenario-specific tools and dead route handlers when incompatible with the new design. Reintroduce only new feature code required by files 02 and 03. Do not rewrite old modules line-by-line. **Done when:** the application boots using new services without importing legacy graph or agent modules. **Depends:** M03.
- [ ] **M05 · P0 — Remove legacy demos, seeds and test assumptions.** Delete old Asteria scenario packs, Demo Lab, hand-scripted findings, canned acceptance tests, and initialization paths that auto-seed a fake company into production. **Done when:** clean startup has an empty graph, and there are no hardcoded scenario IDs in production paths. **Depends:** M04.
- [ ] **M06 · P0 — Retire old API/frontend dependencies.** Remove obsolete graph endpoints, views, imports, buttons, state stores and test fixtures that depend exclusively on the retired database or agent runtime. Breaking old clients is acceptable. **Done when:** the built frontend calls only the new graph APIs, with no stubbed success paths. **Depends:** M04–M05.
- [ ] **M07 · P0 — Remove unused packages, configuration and artifacts.** Drop dead Redis/Falkor-specific settings and dependencies, stale Docker volumes *defined within the project*, redundant graph export archives, demo-only asset files and deprecated scripts. Do not destroy an unrelated service or shared volume. **Done when:** the repo has one clear graph backend and no redundant migration bridge. **Depends:** M02–M06.

## B. New Neo4j deployment and infrastructure

- [ ] **M08 · P0 — Pin and configure Neo4j Community.** Use a fixed, supported official Neo4j image tag rather than `latest`, named volume, credentials via environment/secrets, and Docker health/readiness checks. Do not embed credentials in source control. **Done when:** clean setup and restart preserve project graph data and `RETURN 1` works through the Bolt driver. **Depends:** M02.
- [ ] **M09 · P0 — Add Neo4j backend driver and lifecycle.** Implement an application-level driver/session provider with startup connectivity validation, transaction-scoped units of work, explicit database selection when relevant, close-on-shutdown, reasonable timeouts, and typed error handling. **Done when:** app startup, query, and shutdown succeed without leaking driver sessions. **Depends:** M08.
- [ ] **M10 · P0 — Create a schema bootstrap mechanism.** Idempotently create supported node uniqueness constraints and lookup indexes for tenant/canonical identity, source identity, relationship lookup, and relevant temporal filters. Treat relationship type/endpoint validation as application logic where Community schema constraints cannot express it. **Done when:** schema setup reruns safely, and duplicate canonical IDs cannot be inserted as separate nodes for the same tenant. **Depends:** M09.
- [ ] **M11 · P0 — Implement a new graph persistence contract.** Add typed repository interfaces for entity upsert/retraction, source facts, directed edges, provenance, bounded traversal, and path explanation. Use parameterized Cypher and safe allowlisted labels/types; never concatenate untrusted labels or Cypher fragments. **Done when:** new code performs core reads/writes exclusively via Neo4j and validates every tenant and relationship type. **Depends:** M09–M10.
- [ ] **M12 · P0 — Implement app-layer tenant and source authorization.** Require validated tenant context for every query/transaction, enforce tenant checks at every node/path hop and result projection, filter evidence by source/document ACL, and protect caches. No user-supplied arbitrary Cypher execution. **Done when:** adversarial cross-tenant and restricted-document tests cannot leak nodes, edges, path existence or evidence. **Depends:** M11.
- [ ] **M13 · P0 — Implement deterministic ingestion entry points.** Accept authorized connector records, canonicalize IDs, validate relation types, write provenance atomically, and support replayable idempotent upserts/retractions. Old FalkorDB data is not the source of truth. **Done when:** syncing an unchanged record twice produces one logical entity/relationship without duplicate evidence. **Depends:** M11–M12.
- [ ] **M14 · P0 — Implement graph query endpoints.** Provide new versioned FastAPI endpoints for search, entity detail, neighborhood, reverse dependencies, bounded paths, evidence and history. Return typed responses, coverage/unknown indicators, pagination/truncation and actionable errors. **Done when:** API clients can query newly ingested, unfamiliar organizations without scripted IDs. **Depends:** M11–M13.
- [ ] **M15 · P0 — Build a minimal real-graph UI.** Add graph search, typed relationships, evidence details, current versus historical edges, and meaningful empty/loading/error states. Do not restore Demo Lab or agent simulation UI. **Done when:** connected records appear through the UI after ingestion; a fresh empty database shows an honest empty state. **Depends:** M14.

## C. Correctness, scale, and clean-break acceptance

- [ ] **M16 · P0 — Implement deterministic test fixtures ONLY in tests.** Use small isolated Neo4j graphs with two distinct tenant IDs and source records; no testing data may auto-load into production. **Done when:** test fixtures can be set up and torn down without touching real tenant data. **Depends:** M10–M13.
- [ ] **M17 · P0 — Verify source→graph→API→UI.** Ingest source-shaped records representing a person, PR, file, task and document; validate evidence-backed traversals in Neo4j and UI navigation. Change source data and verify updated query results. **Done when:** entire workflow responds correctly to ingestion and retraction. **Depends:** M13–M16.
- [ ] **M18 · P0 — Verify tenant isolation and access constraints.** Test direct lookup, fuzzy search, path expansion, API responses and cached results against forbidden tenants and restricted evidence. **Done when:** no isolation bypass is possible in tested flows; block release if this fails. **Depends:** M12, M16.
- [ ] **M19 · P1 — Add bounded graph operations and query tuning.** Configure traversal depth, fan-out, row limits, timeouts, pagination, retry budgets, batching, and indexes justified by the new workloads. Optimize based on new Neo4j query tests only; do not benchmark FalkorDB. **Done when:** high-degree and cyclic test graphs return bounded responses with explicit truncation. **Depends:** M14, M16.
- [ ] **M20 · P0 — Remove final legacy references and run clean start.** Delete lingering FalkorDB/RedisGraph/demo/agent references only where obsolete; run new dependency install, Docker startup, backend startup, frontend typecheck/build and relevant end-to-end tests. Do not keep old code just to make old tests green. **Done when:** the application works exclusively on Neo4j and fresh setup does not require the old database. **Depends:** M01–M19 except M19 can be completed at P1.

## Execution order and gates

1. **Replace infrastructure:** M01–M03, M08–M10.
2. **Remove old runtime and demos:** M04–M07.
3. **Build new graph contracts:** M11–M15, then implement relationship tasks R01–R15 and R25–R26 as required by the first connector slice.
4. **Prove live behavior:** M16–M18, M20; then complete remaining R/E tasks in their own files.
5. **Improve performance:** M19 alongside R34/R38 when real workload supports it.

**Important:** There is no data migration gate, backward-compatibility gate, legacy architecture assessment, or FalkorDB audit gate. Failure of the old implementation is irrelevant; the new implementation is judged on **new graph correctness, isolation and real usage**.

### New architecture at a glance

```text
GitHub / Jira / Documentation / other authorized connectors
                  │
          Normalize + validate
                  │
      Identities + provenance + ACL
                  │
     Neo4j Community (typed property graph)
                  │
    Authorized Cypher query services
                  │
         FastAPI graph APIs
                  │
     React graph + product features
```

## Official technical references

- Neo4j Docker: https://neo4j.com/docs/operations-manual/current/docker/introduction/
- Neo4j Python driver: https://neo4j.com/docs/python-manual/current/
- Neo4j database-edition limits: https://neo4j.com/docs/operations-manual/current/database-administration/
- LangGraph framework scope (not chosen): https://langchain-ai.github.io/langgraph/reference/
