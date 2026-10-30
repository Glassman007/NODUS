# GraphHacks — 03 / 03 — Relationship Effects and Product Features

**Task file:** `03-Relationship-Effects-Implementation.md`  
**Status:** Proposed; no task is marked complete.  
**Prerequisites:** `01-FalkorDB-Removal-and-Neo4j-Rebuild.md` plus the specific `R` dependencies in `02-Relationship-Graph-Implementation.md`.

## Product goal

Turn the relationship graph into **real, useful organizational capabilities**—not named demo scenarios and not an agent swarm. Accept a real employee, change, repository, service, incident, task, decision, policy, customer or question; traverse accessible Neo4j relationships; produce source-backed results that **change when the underlying relationships change**.

## Strict implementation policy

- Use **Neo4j** as the relationship store. Do not use FalkorDB, its old APIs, the Asteria scenario catalog, Demo Lab, a Supervisor, a multi-agent loop, or LangGraph as a feature prerequisite.
- You have permission to delete and replace old code and UI. Do not preserve legacy behavior just for backwards compatibility.
- **NO AUDITS OR REPORT DOCUMENTS.** Do not produce architecture audits, feature reviews, cleanup reports, migration reports, acceptance ledgers or extra planning files. User-facing outputs **inside the product**, such as an actual employee handoff package or incident explanation, are required product features and are not prohibited audit documents.
- All outputs must state the evidence supporting findings and distinguish **confirmed**, **inferred**, **potential**, and **unknown** outcomes. No hardcoded expected answers or fake discoveries.
- Prefer deterministic graph analysis, explicit domain rules and user-driven workflows; language-model text synthesis is optional only when justified later and must not replace source truth.
- Maintain tenant scope and source permissions through every traversal, export, sharing or generated product artifact.

**Task IDs:** `E01–E24`; references `Rxx` are to relationship tasks in file 02, while `Mxx` are to replacement tasks in file 01. **Priorities:** P0 first practical feature, P1 expansion, P2 enterprise breadth.

## Standard implementation contract for EVERY effect

1. **User entry point:** select a real connected entity or event; never choose from a fake scenario list.
2. **Graph computation:** bounded, deterministic or verifiable traversal/analysis of evidence-backed relationships from the current tenant.
3. **Output:** human-readable explanation, concrete paths, source links, effective dates and visibility restrictions; indicate observed vs inferred facts.
4. **Next action:** where appropriate, provide an editable checklist or proposed action, not an unauthorized automatic external-system change.
5. **Change sensitivity:** modify or retract input relationships and prove output changes accordingly.
6. **Empty state:** unsupported connector coverage and missing evidence must yield an honest limitation, never a canned result.
7. **Acceptance:** API plus frontend integration and realistic end-to-end tests, with two unrelated test organizations and no known Asteria IDs.

---

# RELATIONSHIP EFFECT TASKS (E01–E24)

**Implementation pattern for every feature:** accept a real entity/event/question → traverse authorized, relevant relationships → calculate or assemble an outcome → show evidence, assumptions, missing information, and permitted next steps. No fixed scenario IDs or guaranteed prewritten answers. A product feature must show a useful result **or a correct no-data/unknown result**.

## B1. Knowledge continuity & people intelligence

- [ ] **E01 · P0 — Employee departure / knowledge inheritance package.** **Problem:** departing staff leave undocumented work and context. **Build:** given an authorized departing employee, identify formal responsibilities, open tasks/PRs, affected code/services, decisions, incidents, runbooks, dependencies, unresolved questions and potential successors; assemble a navigable, editable handoff package with source links and an approval/acknowledgment checklist. **Depends:** R13–R15, R25–R27, R33; R22 for verified resignation status. **Done when:** changing the employee or underlying graph produces a different package, and missing knowledge is identified rather than invented.
- [ ] **E02 · P0 — Evidence-based expert finder.** **Problem:** colleagues cannot locate people experienced with a specific subsystem or failure. **Build:** find contributors, reviewers, incident resolvers and current maintainers for a user-selected service/topic, with evidence and freshness. **Depends:** R13, R17 if available, R25, R27, R33. **Done when:** every recommended person has verifiable source links and formal ownership is not confused with expertise.
- [ ] **E03 · P1 — Single-point-of-knowledge risk.** **Problem:** critical work depends on a single knowledgeable person. **Build:** identify services with one known maintainer, weak backup coverage, unresolved runbook gaps and high dependency criticality; distinguish no known backup from proven no backup. **Depends:** R17, R21, R27–R28, R34. **Done when:** adding a verified backup owner or documentation changes the result.
- [ ] **E04 · P1 — Role-specific onboarding map.** **Problem:** new hires receive generic document dumps. **Build:** connect verified role/team/tasks to relevant code, services, decisions, incidents, docs and mentors; present prioritized guided reading and initial context. **Depends:** R13–R15, R25–R27, R30, R33; R22 if role comes from HR. **Done when:** two employees with different actual responsibilities receive different evidence-backed paths.

## B2. Engineering change & blast-radius intelligence

- [ ] **E05 · P0 — Pull-request change-impact explorer.** **Problem:** code changes affect teams/services beyond the repository. **Build:** given a PR, trace changed files/code → service/API → dependent services → owners → tests/releases; distinguish confirmed edges from static or inferred ones. **Depends:** R13, R17–R18 when available, R25, R28, R33–R34. **Done when:** a PR's changed files produce an explainable impact path and an empty path is never described as proof of safety.
- [ ] **E06 · P1 — Database migration/column impact.** **Problem:** schema changes break downstream jobs and dashboards. **Build:** take table/column migration intent and traverse structural dependencies and verified column-level lineage to consumers and owners. **Depends:** R19–R20, R29, R34–R35. **Done when:** the result differentiates confirmed consumers from possible consumers and survives a table/column rename test.
- [ ] **E07 · P1 — API deprecation migration planner.** **Problem:** teams cannot identify consumers of an API being removed. **Build:** show declared and observed consumers, teams, affected releases and a migration checklist with unresolved coverage caveats. **Depends:** R17–R18, R21, R28, R34–R35. **Done when:** removing an observed consumer or changing an API version updates the proposed migration scope.
- [ ] **E08 · P1 — Dependency-aware test gap finder.** **Problem:** critical dependent behavior lacks evidence of test coverage after changes. **Build:** join changed code/contracts with mapped tests, CI outcomes and dependent services; propose areas needing tests, not fictitious test cases. **Depends:** R13, R17–R18, R25, R28, R34. **Done when:** a newly associated passing contract test removes or qualifies the gap.
- [ ] **E09 · P1 — Vulnerable dependency exposure explorer.** **Problem:** known vulnerable package versions exist in deployed systems. **Build:** map advisory/package version → artifact → deployment → service → owner/business function; explain runtime exploitability as unknown unless separate proof exists. **Depends:** R17–R18, R24 where relevant, R28, R34. **Done when:** the result identifies actual deployed affected versions and does not call package presence a confirmed exploit.

## B3. Operations & incident intelligence

- [ ] **E10 · P1 — Evidence-grounded incident investigation.** **Problem:** alerts show symptoms but not probable causes. **Build:** connect incident timeline, affected services, recent deployments, dependency paths and observations; present hypotheses, competing explanations, and evidence strength rather than a fabricated root cause. **Depends:** R18, R21, R28, R31, R33–R34. **Done when:** a different incident produces a different, source-backed explanation and temporal coincidence alone cannot establish causation.
- [ ] **E11 · P1 — Recurring incident pattern discovery.** **Problem:** repeated failures share hidden dependencies and unresolved remediation. **Build:** cluster/link incidents by service, dependency, symptom, change and associated tasks; surface recurrence with source references. **Depends:** R14, R21, R26, R28, R31. **Done when:** removing a shared dependency or resolving remediation changes the pattern summary.
- [ ] **E12 · P1 — Stale runbook detector.** **Problem:** operational instructions reference obsolete systems. **Build:** map runbook references to actual services, endpoints, commands/deployments where verifiable, flag changed or retired targets for human validation. **Depends:** R15, R17–R18, R21, R30. **Done when:** an obsolete referenced service is flagged with the specific stale reference, not a blanket claim the runbook is wrong.
- [ ] **E13 · P1 — Incident owner and escalation resolver.** **Problem:** incident escalation goes to an outdated or undefined owner. **Build:** resolve affected service → current authoritative owner → on-call/escalation record; surface gaps and historical mismatches. **Depends:** R17, R21–R22, R06–R07, R27. **Done when:** a team ownership change updates the escalation destination and missing on-call data remains unknown.

## B4. Decisions, tasks & organizational coordination

- [ ] **E14 · P0 — Decision genealogy / “why does this exist?”.** **Problem:** rationale is scattered across PRs, discussion, and ADRs. **Build:** given a service, feature or code area, show decision timeline, participants, alternatives, source documents, implementation changes and superseding decisions. **Depends:** R13–R16, R25–R26, R30, R33. **Done when:** the UI reconstructs a decision from real linked records and distinguishes an approved decision from unapproved discussion.
- [ ] **E15 · P1 — Contradictory decision or requirement finder.** **Problem:** two active decisions impose incompatible constraints. **Build:** compare context-matched claims concerning the same service/requirement/time; flag contradictions for review with references and uncertainty. **Depends:** R15–R16, R26, R30. **Done when:** an actual conflict is highlighted, but statements applying to different environments or dates are not automatically marked contradictory.
- [ ] **E16 · P0 — Cross-team blocker chain / release bottleneck.** **Problem:** an apparently complete task is still blocked by another team's prerequisite. **Build:** trace project/task/release requirements and `BLOCKS` edges to unresolved upstream work, assignees and critical path candidates. **Depends:** R14, R17 where available, R26, R33–R34. **Done when:** resolving an upstream blocker changes the displayed chain and direction of `BLOCKS` is respected.
- [ ] **E17 · P2 — Organizational restructure dependency mapping.** **Problem:** teams merge but ownership and approval paths remain stale. **Build:** compare current organization against an isolated proposed reassignment; identify impacted services, tasks, approval rights, on-call and knowledge coverage. **Depends:** R17, R22–R23, R27, R32, R35. **Done when:** a team transfer shows missing responsibilities without changing canonical ownership automatically.

## B5. Governance, security & information lineage

- [ ] **E18 · P2 — Sensitive-data propagation map.** **Problem:** an organization cannot trace where personal/sensitive data flows. **Build:** connect classified columns/datasets to actual transformations, jobs, services and external destinations, with policy scope and lineage limitations. **Depends:** R19–R20, R23–R24 where relevant, R29, R32–R34. **Done when:** a verified downstream path is shown with evidence; a foreign key alone cannot become a claim of data export.
- [ ] **E19 · P2 — Policy/access inconsistency finder.** **Problem:** existing grants conflict with current policies. **Build:** compare authoritative access grants with applicable policy rules, resource scope and approval requirements; present evidence-backed mismatches. **Depends:** R23, R32, R08. **Done when:** changing/revoking a grant changes the finding, and inferred organizational relationships never grant permissions.
- [ ] **E20 · P2 — Offboarding security closure.** **Problem:** access grants and operational duties remain active after departure. **Build:** separate knowledge handoff from formal access/security handoff; identify current grants, service-account ownership, approver status, open PRs, on-call duties and required revocations. **Depends:** E01, R17, R21–R23, R27, R32. **Done when:** the checklist distinguishes verified completed revocations from suggested actions; it never automatically revokes access without authorization.

## B6. Business & external dependency effects

- [ ] **E21 · P2 — Service failure → product/customer impact.** **Problem:** engineering sees a broken component but cannot explain which business services or customers might be affected. **Build:** map service → product feature → customer entitlements/usage → contract obligations; differentiate potential from observed customer impact. **Depends:** R17, R21, R24, R28, R34. **Done when:** the result names the supporting entitlement/usage evidence and never treats entitlement alone as confirmed disruption.
- [ ] **E22 · P2 — Third-party provider discontinuation exposure.** **Problem:** vendor/API shutdowns surprise downstream teams. **Build:** map vendor/service → external API/package → consuming systems → owners → deadlines and migration tasks; support what-if replacement. **Depends:** R17–R18, R24, R28, R34–R35. **Done when:** a selected provider/version yields a source-backed list of affected internal services and owners, with unknown consumers called out.

## B7. Cross-cutting product experience

- [ ] **E23 · P0 — Unified graph-question experience.** **Problem:** connected data is technically present but users cannot turn it into useful answers. **Build:** a graph-grounded interface for **Who knows this? Who owns this? Why does this exist? What depends on this? What is blocking this? What is missing? What changes if X disappears?** Route to graph queries and the relevant feature screens, show traversed paths, provenance, restrictions and unknowns; no scenario launcher or scripted agent loop. **Depends:** R33; add feature-specific questions as E01–E22 ship. **Done when:** every supported answer links to concrete graph evidence and unsupported questions produce a truthful limitation.
- [ ] **E24 · P0 — Feature-level end-to-end acceptance and safe empty states.** **Problem:** convincing demo data can disguise broken general-purpose logic. **Build:** integration tests using **two independent isolated companies**, unfamiliar IDs, modifications/deletions, restricted evidence, partial integrations and contradictory sources. Exercise the full path from connector → graph → query → user-visible effect. **Depends:** R37, E01/E05/E14/E16/E23 initially, then extend for each feature. **Done when:** findings change as relationships change, no canned Asteria result is required, and an empty/unknown result is displayed honestly.

---

## Release slices (feature delivery order)

| Slice | Feature tasks | Minimum relationship prerequisites | User-visible proof |
|---|---|---|---|
| **E-S1 — Understand the company** | E02, E14, E16, E23, E24 | First graph slice R01–R15, R25–R26, R33, R37 | Ask who knows a code area, why a decision exists, and what blocks a release, with actual paths/evidence. |
| **E-S2 — Protect continuity and change** | E01, E03, E05 | R17, R27–R28, R34–R36 | Generate a real employee transition package and show real PR impact paths that change with the graph. |
| **E-S3 — Engineering and operations depth** | E04, E06–E13, E15 | Corresponding R16, R18–R21, R29–R31 | Database/API/test/dependency and incident explanations grounded in ingested systems. |
| **E-S4 — Enterprise governance and business** | E17–E22 | R22–R24, R32 | Impact of HR/team changes, real access evidence, data propagation and potential customer effects. |

## Product validation scenarios (tests only, never demo catalog)

- One developer leaves; compare actual responsibilities and changed ownership against a proposed transfer. Ensure knowledge gaps remain explicitly unresolved when evidence is missing.
- Modify one PR's files and observe its service/consumer/owner impact list change.
- Revoke a database column's verified lineage edge and confirm that downstream impact recalculates, without asserting a data flow from schema-only relationships.
- Add a blocker upstream of a release; verify blocker chains expand; resolve it and confirm the chain collapses.
- Place contradictory decisions in different time periods; verify no false current conflict; overlap their validity and verify an evidence-linked conflict appears.
- Restrict one document; verify it cannot leak through an effect's summary, evidence links, downloaded product package, or API.
- Run every P0 feature against two distinct tenant graphs with different names and IDs.

**Definition of done:** The feature solves the named problem for newly connected data, can point to defensible graph evidence, updates when relevant relationships change, and returns accurate unknowns where data is insufficient. No autonomous agent or legacy database must be involved.
