# GraphHacks — 02 / 03 — Relationship Graph Implementation Tasks

**Task file:** `02-Relationship-Graph-Implementation.md`  
**Status:** Proposed; no task is marked complete.  
**Prerequisite:** `01-FalkorDB-Removal-and-Neo4j-Rebuild.md`, especially new Neo4j foundations M08–M14.  
**Downstream:** `03-Relationship-Effects-Implementation.md`.

## Product goal

Build an **evidence-backed company property graph** from the company's actual authorized information. Connect people, code, work, systems, decisions, operations, data and business processes through **typed and meaningful** relationships. The graph's value comes from defensible connections, not canned demos or artificial agent activity.

## Strict implementation policy

- **Architecture replacement is allowed and intended.** Do not preserve FalkorDB, legacy APIs, old GraphRAG agents, Supervisor, agent loops, or Asteria demonstration structures. No compatibility shims.
- **Neo4j Community is the selected graph store** using the official Python driver and parameterized Cypher. Do not introduce LangGraph or any LLM orchestration framework as a prerequisite.
- **No audits.** Do not create legacy-implementation audits, architecture assessments, migration reports, status files, or invented design documents. Implement the task and validate with running tests.
- Every edge must have clear source→target direction, type semantics, source evidence, temporal context where available, and tenant/visibility scope.
- Distinguish `source_asserted`, `observed`, `inferred`, and `hypothetical`; do not elevate authorship into ownership or chronology into causality.
- Read the current source records only for implementation and verification. Do not inspect or audit FalkorDB internals; the new Neo4j contracts are authoritative.
- All source-native names, IDs, endpoints, connector support, schemas and URLs must be discovered from real sources, not invented.
- **Safety and correctness:** Even in a clean-slate rewrite, avoid unauthorized source access, cross-tenant path leaks, destructive modifications to external accounts, and insertion of synthetic findings into a real tenant.

**Priorities:** P0 = usable graph and first vertical slice; P1 = depth; P2 = enterprise breadth. **Dependencies:** IDs beginning `M` refer to file 01; `R` are in this file. Feature IDs beginning `E` live in file 03.

## Neo4j-specific implementation decisions

1. **Stable IDs:** tenant-scoped canonical IDs and unique source identities; treat global external IDs as untrusted until mapped to tenant-authorized records.
2. **Model constraints:** make allowed labels, edge types and end-point combinations explicit in application code. Use supported Neo4j constraints/indexes for uniqueness and search. Prefer targeted typed relations over a universal opaque `RELATED_TO` edge.
3. **Historical truth:** store source assertions with observation times and validity windows. Do not overwrite contradictory historical claims merely to keep one `OWNS` relation.
4. **Evidence:** if one graph edge has multiple supporting observations, preserve separate evidence references and their own ACL, rather than one untraceable string property.
5. **Neo4j Community limitation:** a shared standard database requires app-enforced tenant and evidence filtering. For stricter physical isolation, provision separate instances or a licensed edition; do not assume free multiple databases or granular database RBAC.
6. **Performance:** bound path lengths and fan-out, index tenant-scoped lookups, and use parameterized Cypher. Never expose a public raw Cypher endpoint.
7. **Capability gating:** relations are queryable only if the connector actually supplies defensible evidence. Missing connector coverage means **unknown**, not false.

---

# RELATIONSHIP TASKS (R01–R38)

## A1. Data model, relationship semantics, and correctness

- [ ] **R01 · P0 — Define the company entity ontology.** Implement typed entities for `Person`, `Team`, `Role`, `Department`, `EmploymentEvent`; `Repository`, `Module`, `File`, `CodeSymbol`, `Service`, `API`, `Package`, `Build`, `Deployment`; `Project`, `Task`, `Issue`, `Requirement`, `Release`; `Document`, `Discussion`, `Claim`, `Decision`, `Runbook`; `Incident`, `Alert`, `Change`, `RuntimeObservation`; `Database`, `Table`, `Column`, `Dataset`, `Pipeline`, `Job`; `Policy`, `Permission`, `Approval`, `AccessGrant`; and `Product`, `Feature`, `Customer`, `Contract`, `BusinessProcess`, `Vendor`. Implement only types justified by a connector or feature; do not generate fake nodes to populate every category. **Done when:** entity types have schemas and validation, and unsupported types remain optional.
- [ ] **R02 · P0 — Define canonical identities and cross-source resolution.** Give every node a stable tenant-scoped canonical ID; keep source-native IDs and aliases; reconcile GitHub users, Jira assignees, and document contributors only when evidence supports a match. **Done when:** one person referenced by two sources can resolve to one identity, while similarly named different people do not merge automatically. **Depends:** R01.
- [ ] **R03 · P0 — Create an explicit relationship-type registry.** Define directed, type-safe edges for: `MEMBER_OF`, `REPORTS_TO`, `HOLDS_ROLE`, `OWNS`, `MAINTAINS`, `ON_CALL_FOR`, `ASSIGNED_TO`, `APPROVES`; `CONTAINS`, `IMPLEMENTS`, `DEPENDS_ON`, `PROVIDES_API`, `CONSUMES_API`, `CALLS`, `READS_FROM`, `WRITES_TO`, `DEPLOYED_AS`, `DERIVED_FROM`; `AUTHORED`, `REVIEWED`, `RESOLVED`, `CONTRIBUTED_TO`, `DOCUMENTED`, `PARTICIPATED_IN`, `DEMONSTRATED_EXPERTISE_IN`; `BLOCKS`, `REQUIRES`, `PART_OF`, `IMPLEMENTS_REQUIREMENT`, `HANDOFF_TO`, `SUPERSEDES`, `RELATED_TO`; `PROPOSED_BY`, `DECIDED_BY`, `SUPPORTED_BY`, `CONTRADICTED_BY`, `DOCUMENTED_IN`, `REFERENCES`, `JUSTIFIES`, `SUPERSEDES_DECISION`; `PRECEDES`, `TRIGGERED`, `CAUSED_BY`, `AFFECTED`, `REPLACED_BY`; `GRANTS_ACCESS_TO`, `GOVERNED_BY`, `REQUIRES_APPROVAL_FROM`, `VIOLATES`, `SATISFIES`, `REVOKED_BY`. Add only the relationships actually supported by data. **Done when:** each relationship has valid start/end types and documented direction, with invalid edges rejected. **Depends:** R01.
- [ ] **R04 · P0 — Attach evidence and provenance to nodes and edges.** Retain source system, source record ID/URL, connector sync, evidence excerpt or offset if permitted, ingestion timestamp, and derivation lineage. **Done when:** a user can open a relationship and inspect the records that justify it. **Depends:** R02–R03.
- [ ] **R05 · P0 — Distinguish four relationship origins.** Store `source_asserted`, `observed`, `inferred`, and `hypothetical` as separate semantics. An inferred edge must identify its evidence and rule/model version; a hypothetical edge must never enter the factual graph. **Done when:** code contribution cannot be silently promoted to formal service ownership; hypothetical results do not overwrite facts. **Depends:** R04.
- [ ] **R06 · P0 — Add temporal validity and event history.** Support `valid_from`, `valid_until`, `observed_at`, `ingested_at`, supersession, and event/graph revision where available. Treat `VALID_DURING` as temporal edge metadata or a formally modeled relation, rather than an ambiguous undirected edge. **Done when:** a query can distinguish current and former team ownership and show why it changed. **Depends:** R04.
- [ ] **R07 · P0 — Resolve contradictory source claims without erasing them.** Define field/relationship authority rules by source and scope; preserve contradictory claims and expose unresolved conflicts instead of selecting the latest text as truth. **Done when:** two contradictory owners remain inspectable, and the system does not silently invent a winner. **Depends:** R04–R06.
- [ ] **R08 · P0 — Enforce tenant and access-scoped graph reads.** Apply tenant isolation and source-level/document-level visibility before traversing or returning graph evidence. **Done when:** a user cannot reveal a restricted document through a connected node, traversal path, search snippet, cache, or derived finding. **Depends:** R01–R04.
- [ ] **R09 · P0 — Define stable graph query contracts.** Implement typed entity lookup, relationship neighborhood, bounded path search, inverse relationship lookup, evidence lookup, and filtered traversal with pagination. **Done when:** callers can ask “who owns this?”, “what depends on this?”, and “show evidence” without hardcoded tenant/entity IDs. **Depends:** R02–R08.
- [ ] **R10 · P0 — Implement incremental upserts, deletions, and retractions.** Make sync idempotent; update stale records, track removed/disabled source objects, and invalidate derived edges/findings when evidence is withdrawn. **Done when:** modifying or deleting a source relationship changes subsequent graph answers without leaving ghost edges. **Depends:** R04–R09.
- [ ] **R11 · P1 — Add a relationship semantics and coverage layer.** Record whether a connector provides authoritative ownership, inferred dependency, partial activity history, runtime observation, etc. Include unavailable/unknown scope. **Done when:** a result distinguishes “no owner recorded” from “source does not provide ownership data.” **Depends:** R04–R10.

## A2. Ingestion and system integrations

- [ ] **R12 · P0 — Build a connector contract and sync framework.** Standardize authentication, permissions, pagination, source-native IDs, incremental checkpoints, rate limits, retry behavior, evidence recording, and per-tenant configuration. **Done when:** two connectors can ingest without source-specific logic in the graph core. **Depends:** R02, R04, R08, R10.
- [ ] **R13 · P0 — Integrate GitHub engineering activity.** Ingest authorized org/repo metadata, contributors, commits, PRs, reviews, files changed, issues, CODEOWNERS and relevant references. Preserve distinctions between contributor, reviewer, and designated maintainer. **Done when:** a PR → modified file → repository → author/reviewer path has source links. **Depends:** R12.
- [ ] **R14 · P0 — Integrate Jira (or equivalent task tracker).** Ingest projects, issues, assignees, status/history, blockers, requirements, milestones, releases and issue links. **Done when:** person → assigned task → affected project/service can be traversed, with task blockers retaining direction. **Depends:** R12.
- [ ] **R15 · P0 — Integrate documentation/knowledge sources.** Ingest authorized Confluence/Notion-like pages, ADRs, runbooks, authors, updates, citations, and references to repos/issues/services; retain document-level access restrictions. **Done when:** a relevant code change or task links to its source-backed document or decision, without exposing private pages. **Depends:** R12.
- [ ] **R16 · P1 — Integrate Slack/discussion records only within approved scopes.** Capture permitted threads, participants, references, timestamps, and links to decision discussions. Treat informal discussion as discussion, not approval. **Done when:** a decision's supporting thread is traceable and inaccessible conversations never appear in results. **Depends:** R12, R08.
- [ ] **R17 · P1 — Integrate an authoritative service catalog / ownership registry.** Ingest services, teams, service owners, APIs, lifecycle, and declared dependencies. **Done when:** official service ownership is distinguishable from code activity. **Depends:** R12.
- [ ] **R18 · P1 — Integrate CI/CD and release systems.** Ingest builds, test executions, artifacts, deployments, changed versions, release status, and their source commit/PR links. **Done when:** deployed service → artifact → build → commit → PR is traversable. **Depends:** R12–R13.
- [ ] **R19 · P1 — Integrate relational schema metadata.** Ingest database/schema/table/column identities, foreign keys, views, indexes when relevant, and schema-version histories. **Done when:** structural database dependencies are queryable but not misrepresented as observed runtime data flows. **Depends:** R12.
- [ ] **R20 · P1 — Integrate data pipelines and lineage.** Ingest job inputs/outputs and verified dataset/column transformations from lineage-compatible systems or existing pipeline metadata. **Done when:** upstream dataset → transformation → downstream dataset/column path includes supporting lineage evidence. **Depends:** R12, R19.
- [ ] **R21 · P1 — Integrate operational monitoring and incidents.** Ingest authorized incidents, alerts, service telemetry associations, deployment changes, on-call assignments, and runtime service-call relationships where observed. **Done when:** incident → affected service → observed runtime dependency → recent deployment can be traversed with timestamps. **Depends:** R12, R17–R18.
- [ ] **R22 · P2 — Integrate HR/directory structure and employment lifecycle.** Ingest approved employee identifiers, team membership, role, reporting structure, employment state and planned departure dates, minimizing sensitive data. **Done when:** current vs historical membership and upcoming handoff eligibility can be queried with proper authorization. **Depends:** R12, R08.
- [ ] **R23 · P2 — Integrate IAM and authorization records.** Ingest real users, roles, groups, grants, revocations, approval authorities and protected resources where supported. **Done when:** actual grants can be compared with policy-defined access, without granting permissions from inferred graph ties. **Depends:** R12, R08.
- [ ] **R24 · P2 — Integrate customer/business/vendor systems.** Ingest authorized products, features, service-to-feature mappings, customer entitlements, contracts, business processes, vendors, and dependency links. **Done when:** service disruption can map to potentially affected products/customers with explicit data-coverage caveats. **Depends:** R12, R17.

## A3. Turn connected records into meaningful relationships

- [ ] **R25 · P0 — Build code → work → people edges.** Resolve PR/commit/file references, Jira issue keys, reviewers, assignments, and documentation mentions; preserve direct links separately from inferred matches. **Done when:** a changed file can be followed to the relevant task, actor, and supporting sources; ambiguous references remain unresolved. **Depends:** R13–R15.
- [ ] **R26 · P0 — Build work/requirement/decision connections.** Link tasks to projects, requirements and explicit blockers; link documentation and ADRs to impacted services/code where evidence exists. **Done when:** a task dependency chain and relevant decision rationale can be followed without a scripted scenario. **Depends:** R14–R15, R25.
- [ ] **R27 · P1 — Build people → responsibility → expertise signals.** Combine formal ownership, assigned work, contribution, reviews, resolved incidents and documentation; avoid converting activity into authoritative ownership. **Done when:** each expertise suggestion has concrete positive evidence and an explanation of what is unknown. **Depends:** R13, R17, R21–R22.
- [ ] **R28 · P1 — Build service/API/code/deployment dependency paths.** Combine source imports/calls, declared APIs, runtime traces, service catalog and deployed artifacts; mark each path segment as declared, static, observed or inferred. **Done when:** blast-radius paths indicate which links are verified versus tentative and their relevant version. **Depends:** R13, R17–R18, R21.
- [ ] **R29 · P1 — Build data flow/lineage paths.** Separate schema-level foreign-key dependencies from actual read/write and transformation flows. **Done when:** data-change impact uses verified lineage rather than treating every foreign key as a data export. **Depends:** R19–R20.
- [ ] **R30 · P1 — Build knowledge claims and decision lifecycle.** Extract/store source-attributed claims, accepted decisions, alternatives, rationale, and supersession with context, dates, and status; never equate discussion with approval. **Done when:** a decision can be reconstructed with linked evidence and a later superseding decision. **Depends:** R15–R16, R26.
- [ ] **R31 · P1 — Model incidents, symptoms, changes, and causal uncertainty.** Represent correlation/temporal order separately from established causation; never create `CAUSED_BY` solely because a change preceded an incident. **Done when:** incident investigation can return multiple ranked hypotheses without labeling an unverified cause as confirmed. **Depends:** R18, R21, R28.
- [ ] **R32 · P2 — Connect policies, permissions, and compliance evidence.** Model policy scope, actual grants, approval requirements and violations only when supported by authoritative records. **Done when:** an access mismatch contains the exact policy and grant records that disagree. **Depends:** R23, R24 where applicable.

## A4. Graph reasoning, interfaces, and operational quality

- [ ] **R33 · P0 — Ship a graph-first relationship explorer.** Provide entity search, neighborhood expansion, typed/filtered edges, path explanation, evidence drawer, source visibility, and current/historical relationship views. **Done when:** users can answer “who worked on this?”, “who owns this?”, and “why are these connected?” on non-demo data. **Depends:** R09, R13–R15, R25–R26.
- [ ] **R34 · P1 — Implement bounded impact/path algorithms.** Provide reverse dependency traversal, reachable-node analysis, bottleneck/cut-point discovery where meaningful, and paths ranked by verified evidence, freshness and business criticality. **Done when:** the tool explains exactly which edges propagate an impact and stops safely at configured limits. **Depends:** R09, R28–R29.
- [ ] **R35 · P1 — Implement isolated counterfactual graph overlays.** Support temporary removal/reassignment/replacement of employees, service dependencies or owners without changing factual graph state. **Done when:** an impact comparison clearly shows baseline versus proposed graph and leaves canonical state untouched. **Depends:** R06, R09, R34.
- [ ] **R36 · P1 — Add relationship change detection and finding invalidation.** React to connector sync changes, source retractions, ownership moves and revised documentation; recompute only affected derived relationships when possible. **Done when:** a resolved dependency or updated ownership stops triggering the previous finding. **Depends:** R10–R11, R27–R35.
- [ ] **R37 · P0 — Add focused integration tests for relationship truth.** Test identity collisions, directed edges, provenance, temporal validity, tenant access, stale-source retraction, missing data, and two connected systems. **Done when:** realistic end-to-end queries return source-backed paths and prohibited paths never leak data. **Depends:** R01–R15, R25–R26.
- [ ] **R38 · P1 — Add performance, scale, and cost limits.** Bound traversal depth/fan-out, source retrieval volume, query time, memory use, ingestion batch size, retries, and optional extraction costs. **Done when:** a high-degree graph completes or safely truncates with an explicit explanation rather than hanging or silently omitting evidence. **Depends:** R09, R12, R34.

---

## Relationship build slices

| Slice | Implementation | Concrete end-to-end outcome |
|---|---|---|
| **R-S1 — First connected graph** | M08–M14, R01–R10, R12–R15, R25–R26, R33, R37 | Connect one permitted GitHub project, associated Jira work and docs; browse source-backed paths from person → PR/file → task → decision. |
| **R-S2 — Engineering depth** | R11, R17–R18, R27–R28, R34–R36, R38 | Real service ownership, code/API/deploy paths, verified graph change effects. |
| **R-S3 — Operations/data** | R16, R19–R21, R29–R31 | Temporal incident, documentation and lineage relationships. |
| **R-S4 — Enterprise context** | R22–R24, R32 | Approved HR/IAM/business relationships with source permissions and limitations. |

## Non-negotiable acceptance

- Never pass a task solely because an isolated unit function returns a result. Test connector input → Neo4j → authenticated API → user-facing graph path.
- Include two different tenant graphs, ambiguous identities, withdrawn evidence, conflicting claims, cycles, high-degree vertices and unavailable data.
- No demo-scene registry or hardcoded expected organizational discovery may be used as runtime behavior.
- A real graph with no relevant connections must return an accurate **unknown / not found / incomplete data** result rather than a fabricated relationship.
- Do not count migration from FalkorDB as a requirement or a successful relationship feature.
