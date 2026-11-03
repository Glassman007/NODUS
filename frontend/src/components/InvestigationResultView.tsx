import { projectLabel } from "../workspace/projectNames";
import {
  lazy,
  Suspense,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
  type Ref,
} from "react";
import { ArrowDownToLine, ArrowRight, Copy, Network, Plus } from "lucide-react";
import type { ProjectScope, WorkspaceRequest } from "../auth/models";
import {
  parseEvidenceReference,
  scopeMismatches,
  type SessionRun,
} from "../investigations/api";
import { loadRunGraph, type RunGraph } from "../investigations/graph";
import {
  downloadFile,
  claimStatus,
  verificationCounts,
  exportMarkdown,
  reportTitle,
  type ReportTab,
} from "../investigations/report";
import { SourceCatalog } from "../workspace/sourceCatalog";
import { SourceLabel } from "./SourceLabel";
import { WorkspaceData } from "./WorkspaceData";
import { ReportMarkdown } from "./ReportMarkdown";
const RelationshipGraph = lazy(() =>
  import("./RelationshipGraph").then((module) => ({
    default: module.RelationshipGraph,
  })),
);
import { ExecutiveOverview } from "./ExecutiveOverview";
import { ServicesBrowser } from "./ServicesBrowser";
import { availableAnalysis } from "../investigations/presentation";
import { EvidenceInspector } from "./EvidenceInspector";
import {OwnershipActions} from "./OwnershipActions";
export interface ReportActions {
  exportReport: () => void;
}
interface Props {
  openTask?: (id:string)=>void;
  actions?: Ref<ReportActions>;
  run: SessionRun;
  scope: ProjectScope;
  request: WorkspaceRequest;
  canReadEvidence: boolean;
  canReadGraph: boolean;
  authorizedSourceIds: string[];
  overview: () => void;
  tab: ReportTab;
  setTab: (tab: ReportTab) => void;
}
const tabs: { id: ReportTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "graph", label: "Relationship Graph" },
  { id: "services", label: "Services & Interfaces" },
  { id: "evidence", label: "Evidence" },
  { id: "risks", label: "Risks & Gaps" },
  { id: "ownership", label: "Ownership & Actions" },
  { id: "technical", label: "Technical Details" },
];
export function InvestigationResultView({
  openTask,
  run,
  scope,
  request,
  canReadEvidence,
  canReadGraph,
  authorizedSourceIds,
  overview,
  tab,
  setTab,
  actions,
}: Props) {
  const catalog = useContext(SourceCatalog);
  const counts = verificationCounts(run);
  const [graph, setGraph] = useState<RunGraph | null>(null);
  const [graphError, setGraphError] = useState("");
  const [retry, setRetry] = useState(0);
  const [focus, setFocus] = useState<string | undefined>(run.entityId);
  const [focusEdge, setFocusEdge] = useState<string>();
  const [reference, setReference] = useState<string | null>(null);
  const [recordVersion, setRecordVersion] = useState(0);
  const [feedback, setFeedback] = useState("");
  const sourceIds = useMemo(
    () => [...new Set([...run.selectedSourceIds, ...authorizedSourceIds])],
    [run.selectedSourceIds, authorizedSourceIds],
  );
  const needsGraph =
    tab === "graph" || tab === "services" || tab === "overview";
  useEffect(() => {
    if (!needsGraph || !canReadGraph || graph) return;
    const controller = new AbortController();
    const abort = () => controller.abort();
    scope.signal.addEventListener("abort", abort);
    if (scope.signal.aborted) controller.abort();
    loadRunGraph(run, request, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setGraph(value);
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setGraphError(
            reason instanceof Error
              ? reason.message
              : "Graph records unavailable.",
          );
      });
    return () => {
      controller.abort();
      scope.signal.removeEventListener("abort", abort);
    };
  }, [needsGraph, canReadGraph, graph, run, request, scope, retry]);
  const inspect = (ref: string) => {
    setReference(ref);
    setRecordVersion((value) => value + 1);
    setTab("evidence");
  };
  const exportReport = () =>
    downloadFile(exportMarkdown(run, graph, catalog), "nodus-investigation.md");
  useImperativeHandle(actions, () => ({ exportReport }));
  const outside = scopeMismatches(run);
  const narrative = [availableAnalysis(run), ...run.findings].join("\n");
  const mentions = [
    ...new Set([
      ...authorizedSourceIds,
      ...(narrative.match(/NEX-SRC-[A-Z0-9_-]+/g) ?? []),
    ]),
  ].filter(
    (id) => !run.selectedSourceIds.includes(id) && narrative.includes(id),
  );
  const toolRefs = [
    ...new Set(run.tool_calls.flatMap((call) => call.evidence_refs)),
  ];
  const toolSources = [
    ...new Set(
      toolRefs
        .map((ref) => parseEvidenceReference(ref, sourceIds)?.sourceId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const openGraph = (id?: string, edgeId?: string) => {
    setFocus(id);
    setFocusEdge(edgeId);
    setTab("graph");
  };
  const retryGraph = () => {
    setGraph(null);
    setGraphError("");
    setRetry((value) => value + 1);
  };
  return (
    <section
      className="panel result-panel investigation-report"
      aria-label="Investigation result"
    >
      <header className="report-header">
        <p className="section-kicker">INVESTIGATION REPORT · SESSION RESULT</p>
        <h2>{reportTitle(run)}</h2>
        <p className="report-subtitle">
          {projectLabel(run.projectId)} · {new Date(run.created).toLocaleString()} ·{" "}
          {run.selectedSourceIds.length} selected sources
        </p>
        <div className="report-badges">
          <span className={`run-status ${run.status.toLowerCase()}`}>
            Execution: {run.status}
          </span>

        </div>
        <div className="report-actions">
          <button className="quiet-button" onClick={() => openGraph()}>
            <Network size={14} />
            View relationship graph
          </button>
          <button className="quiet-button" onClick={exportReport}>
            <ArrowDownToLine size={14} />
            Export report
          </button>
          <button
            className="quiet-button"
            onClick={() => {
              if (navigator.clipboard)
                void navigator.clipboard
                  .writeText(run.run_id)
                  .then(() => setFeedback("Run ID copied."))
                  .catch(() =>
                    setFeedback(
                      "Copy unavailable. The run ID is in Technical Details.",
                    ),
                  );
              else
                setFeedback(
                  "Copy unavailable. The run ID is in Technical Details.",
                );
            }}
          >
            <Copy size={14} />
            Copy run ID
          </button>
          <button className="quiet-button" onClick={overview}>
            <Plus size={14} />
            New investigation
          </button>
        </div>
        <details className="original-objective">
          <summary>View original objective</summary>
          <p>{run.objective}</p>
        </details>
        {feedback && <p role="status">{feedback}</p>}
      </header>
      {tab === "overview" ? (
        <details className="compact-observed-context">
          <summary>
            Observed context · {run.entity_ids.length} entities ·{" "}
            {run.relationship_ids.length} relationships ·{" "}
            {run.evidence_refs.length} evidence references
          </summary>
          <div className="report-metrics">
            {[
              [run.entity_ids.length, "Entities observed"],
              [run.relationship_ids.length, "Relationships observed"],
              [run.selectedSourceIds.length, "Selected sources"],
              [run.evidence_refs.length, "Evidence references"],
            ].map(([value, label]) => (
              <div key={label}>
                <strong>{value}</strong>
                <span>{label}</span>
              </div>
            ))}
          </div>
        </details>
      ) : (
        <div className="report-metrics">
          {[
            [run.entity_ids.length, "Entities observed"],
            [run.relationship_ids.length, "Relationships observed"],
            [run.selectedSourceIds.length, "Selected sources"],
            [run.evidence_refs.length, "Evidence references"],
          ].map(([value, label]) => (
            <div key={label}>
              <strong>{value}</strong>
              <span>{label}</span>
            </div>
          ))}
        </div>
      )}
      {run.status !== "COMPLETE" && (
        <div className="notice result-condition" role="status">
          {run.status === "BLOCKED"
            ? "Investigation blocked. Review the restriction and source coverage."
            : run.status === "INCOMPLETE"
              ? "Investigation incomplete. Review execution errors and available evidence."
              : "Partial result. Review source coverage limitations and unresolved conflicts."}
        </div>
      )}
      {run.error_message && (
        <div className="notice error" role="alert">
          {run.error_message}
        </div>
      )}
      {(outside.length > 0 || mentions.length > 0) && (
        <div className="source-review-note">
          <button className="quiet-button" onClick={() => setTab("risks")}>
            Review source usage
          </button>
          <span>
            {outside.length
              ? "Some structured references fall outside the submitted source selection."
              : "The narrative mentions other sources. Tool access to those sources has not been established."}
          </span>
        </div>
      )}
      <div className="report-tabs" role="tablist" aria-label="Report sections">
        {tabs.map((item) => (
          <button
            key={item.id}
            id={`report-tab-${item.id}`}
            role="tab"
            aria-selected={tab === item.id}
            aria-controls={`report-panel-${item.id}`}
            tabIndex={tab === item.id ? 0 : -1}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                event.preventDefault();
                const index = tabs.findIndex((t) => t.id === tab);
                const next =
                  tabs[
                    (index +
                      (event.key === "ArrowRight" ? 1 : tabs.length - 1)) %
                      tabs.length
                  ];
                setTab(next.id);
                document.getElementById(`report-tab-${next.id}`)?.focus();
              }
            }}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div
        className="report-content"
        role="tabpanel"
        id={`report-panel-${tab}`}
        aria-labelledby={`report-tab-${tab}`}
      >
        {tab === "overview" && (
          <ExecutiveOverview
            run={run}
            nodes={graph?.nodes ?? []}
            setTab={setTab}
          />
        )}
        {(tab === "graph" || tab === "services") && (
          <>
            {!canReadGraph ? (
              <p className="notice">
                Your session does not grant access to graph records.
              </p>
            ) : !graph && !graphError ? (
              <p className="loading-state" role="status">
                Loading authorized details for {run.entity_ids.length} entities
                and {run.relationship_ids.length} observed relationships…
              </p>
            ) : graphError ? (
              <div className="notice error" role="alert">
                {graphError}
                <button onClick={retryGraph}>Retry graph records</button>
              </div>
            ) : (
              graph && (
                <>
                  {graph.missing > 0 && (
                    <p className="notice">
                      {graph.missing} observed records could not be loaded or
                      exceeded the loading limits. Displayed details are a
                      partial view.
                      <button className="quiet-button" onClick={retryGraph}>
                        Retry graph records
                      </button>
                    </p>
                  )}
                  {!graph.nodes.length ? (
                    <div className="empty-state">
                      <h3>Detailed graph records unavailable</h3>
                      <p>
                        {run.relationship_ids.length} relationships were
                        observed, but no authorized node details could be
                        loaded.
                      </p>
                      <button className="quiet-button" onClick={retryGraph}>
                        Retry graph records
                      </button>
                    </div>
                  ) : tab === "graph" ? (
                    <Suspense
                      fallback={
                        <p className="loading-state" role="status">
                          Loading relationship canvas…
                        </p>
                      }
                    >
                      <RelationshipGraph
                        key={`${focus ?? run.run_id}:${focusEdge ?? ""}`}
                        graph={graph}
                        selectedSources={run.selectedSourceIds}
                        focusId={focus}
                        focusEdgeId={focusEdge}
                        inspect={inspect}
                        canReadEvidence={canReadEvidence}
                      />
                    </Suspense>
                  ) : (
                    <ServicesBrowser
                      graph={graph}
                      sourceIds={run.selectedSourceIds}
                      canReadEvidence={canReadEvidence}
                      showGraph={openGraph}
                      inspect={inspect}
                    />
                  )}
                </>
              )
            )}
          </>
        )}
        {tab === "ownership" && <OwnershipActions run={run} scope={scope} request={request} openTask={openTask}/>}
        {tab === "evidence" && (
          <>
            <p>{run.evidence_refs.length} evidence references | {counts.facts} verified facts | {counts.actionable} verified actionable findings</p>
            {!run.structured_findings?.length && <p className="inline-note">This report has no recorded claim verification. Existing references remain available below. Run a new investigation to capture claim-to-evidence verification records.</p>}
            {!!run.actionable_findings?.length&&<section><h3>Evidence for actionable findings</h3>{run.actionable_findings.map(problem=><article className="resolution-finding" key={problem.problem_id}>
              <h4>{problem.title}</h4><p>{problem.verification_status} · {problem.evidence_ids.length} problem evidence snapshots</p>
              {problem.evidence_ids.map(id=>{const item=run.evidence_registry?.find(snapshot=>snapshot.evidence_id===id);return item?<details key={id}><summary><SourceLabel id={item.source_id}/> · {item.record_id}</summary><pre className="raw-data">{item.excerpt}</pre></details>:<p key={id}>Evidence is unavailable.</p>;})}
            </article>)}</section>}
            {!!run.structured_findings?.length && <section>
              <h3>Claim verification</h3>

              <p className="inline-note">{Object.entries(run.verification_summary ?? {}).map(([status, count]) => `${status.replaceAll("_", " ")}: ${count}`).join(" · ")}</p>
              <p className="inline-note">Requested sources: {run.requested_source_ids?.length ?? run.selectedSourceIds.length} · Effective sources: {run.selected_source_ids?.length ?? run.selectedSourceIds.length} · Evidence sources: {Object.keys(run.source_usage ?? {}).length}</p>
              {run.structured_findings.map((finding) => <article className="evidence-drilldown" key={finding.finding_id}>
                <span className={`evidence-badge verification-${finding.verification_status.toLowerCase()}`}>{claimStatus(finding.verification_status)}</span>
                <p>{finding.claim}</p><p className="inline-note">{finding.explanation}</p>
                <p className="inline-note">Supporting evidence: {finding.evidence_ids.length} · {finding.verification_status === "INFERRED" ? "Derived relationship" : finding.claim_type === "GRAPH_RELATIONSHIP" ? "Direct observation" : finding.claim_type === "GRAPH_PATH" ? "Recorded connection path" : "Generated analysis"}</p>
                <p className="inline-note">Entities: {finding.entity_ids.join(", ") || "None linked"} | Relationships: {finding.relationship_ids.join(", ") || "None linked"} | Recorded status: {finding.verification_status}</p>
                {!!finding.relationship_ids.length && canReadGraph && <button className="quiet-button" onClick={() => openGraph(finding.entity_ids[0], finding.relationship_ids[0])}>View related graph · {finding.entity_ids.join(" → ")}</button>}
                {canReadEvidence && finding.evidence_ids.map((id) => {
                  const snapshot = run.evidence_registry?.find((item) => item.evidence_id === id);
                  return snapshot ? <details key={id}><summary>Inspect evidence · <SourceLabel id={snapshot.source_id} /></summary>
                    <p>{snapshot.kind} · {snapshot.record_id} · {snapshot.locator}</p>
                    <p className="inline-note">Retrieved {snapshot.retrieved_at} using {snapshot.tool_id}</p>
                    <pre className="raw-data">{snapshot.excerpt}</pre>
                    <p className="inline-note">SHA-256: {snapshot.content_hash}</p>
                  </details> : <p key={id} className="notice error">Unresolved citation: {id}</p>;
                })}
              </article>)}
            </section>}
            {canReadEvidence && !!run.evidence_registry?.length && <section><h3>Retrieved evidence snapshots</h3>
              {run.evidence_registry.map((snapshot) => <details key={snapshot.evidence_id}>
                <summary><SourceLabel id={snapshot.source_id} /> · {snapshot.record_id} · {snapshot.kind}</summary>
                <p className="inline-note">{snapshot.locator} · {snapshot.retrieved_at}</p>
                <pre className="raw-data">{snapshot.excerpt}</pre>
              </details>)}
            </section>}
            <h3>Evidence references returned by tools</h3>
            {run.evidence_refs.length ? (
              <ul className="reference-list">
                {run.evidence_refs.map((ref) => (
                  <li key={ref}>
                    {canReadEvidence &&
                    parseEvidenceReference(ref, sourceIds) ? (
                      <button
                        className="quiet-button"
                        onClick={() => inspect(ref)}
                      >
                        <SourceLabel id={ref} reference />
                      </button>
                    ) : (
                      <SourceLabel id={ref} reference />
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="inline-note">
                No supporting evidence references returned. This result cannot
                be labelled independently verified.
              </p>
            )}
            {!canReadEvidence && (
              <p className="inline-note">
                Source-record inspection requires READ_EVIDENCE permission.
              </p>
            )}
            {reference && canReadEvidence && (
              <>
                <button
                  className="quiet-button"
                  onClick={() => setRecordVersion((value) => value + 1)}
                >
                  Refresh record access
                </button>
                <EvidenceInspector
                  key={`${reference}:${recordVersion}`}
                  reference={reference}
                  workspaceId={run.workspaceId}
                  sourceIds={sourceIds}
                  request={request}
                  scope={scope}
                />
              </>
            )}
          </>
        )}
        {tab === "risks" && (
          <>
            {!!run.actionable_findings?.length&&<section><h3>Verified findings &amp; risks</h3>{run.actionable_findings.map(problem=><article className="resolution-finding" key={problem.problem_id}><span className={`priority-badge priority-${problem.severity.toLowerCase()}`}>{problem.severity}</span><h4>{problem.title}</h4><p>{problem.impact}</p><button className="quiet-button" onClick={()=>setTab("ownership")}>Review ownership and action</button></article>)}</section>}
            <h3>Source usage & verification gaps</h3>
            <div className="source-usage-grid">
              <section>
                <h4>Sources you selected</h4>
                <ul>
                  {run.selectedSourceIds.map((id) => (
                    <li key={id}>
                      <SourceLabel id={id} />
                    </li>
                  ))}
                </ul>
              </section>
              <section>
                <h4>Sources supported by tool references</h4>
                {toolSources.length ? (
                  <ul>
                    {toolSources.map((id) => (
                      <li key={id}>
                        <SourceLabel id={id} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>
                    Actual tool source access cannot be determined from the
                    returned records. No tool-level evidence references were
                    supplied.
                  </p>
                )}
              </section>
              <section>
                <h4>Other sources mentioned in narrative</h4>
                {mentions.length ? (
                  <ul>
                    {mentions.map((id) => (
                      <li key={id}>
                        <SourceLabel id={id} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>
                    No additional source identifiers detected in the narrative.
                  </p>
                )}
                <p>
                  A text mention does not establish that tools accessed that
                  source or that access was unauthorized.
                </p>
              </section>
            </div>
            {outside.length > 0 && (
              <div className="result-warning" role="alert">
                <h3>Structured provenance outside source selection</h3>
                <p>
                  Returned evidence references point outside the submitted
                  selection. This requires review; references alone do not
                  establish unauthorized access.
                </p>
                <ul>
                  {outside.map((ref) => (
                    <li key={ref}>
                      <SourceLabel id={ref} reference />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(
              [
                "source_coverage_limitations",
                "unresolved_conflicts",
                "rejected_unverified_claims",
              ] as const
            ).map((key) => (
              <section className="risk-section" key={key}>
                <h3>{key.replaceAll("_", " ")}</h3>
                {run[key].length ? (
                  <ul>
                    {run[key].map((entry, i) => (
                      <li key={i}>
                        <ReportMarkdown text={entry} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="inline-note">
                    None reported by the backend. This does not establish
                    complete coverage.
                  </p>
                )}
              </section>
            ))}
          </>
        )}
        {tab === "technical" && (
          <>
            <section className="complete-analysis">
              <h3>Complete technical analysis</h3>
              <p className="inline-note">
                Original model-generated output, not independent evidence
                verification.
              </p>
              {run.full_analysis == null && (
                <p className="analysis-availability">
                  This result uses the legacy summary field. The backend may
                  have returned only a 4,000-character preview; omitted text
                  cannot be recovered from this response.
                </p>
              )}
              {run.analysis_truncated && (
                <p className="notice" role="status">
                  The backend returned the first{" "}
                  {run.full_analysis?.length.toLocaleString()} of{" "}
                  {run.analysis_character_count?.toLocaleString()} analysis
                  characters due to its explicit response limit.
                </p>
              )}
              <ReportMarkdown
                text={availableAnalysis(run)}
                references={run.evidence_refs}
                inspect={canReadEvidence ? inspect : undefined}
              />
            </section>
            <details open className="execution-details">
              <summary>Technical information</summary>
              <WorkspaceData
                value={{
                  run_id: run.run_id,
                  workspace: run.workspaceId,
                  graph_revision: run.graph_revision,
                  entity_ids: run.entity_ids,
                  relationship_ids: run.relationship_ids,
                  newly_discovered_relationship_ids:
                    run.newly_discovered_relationship_ids,
                  reused_relationship_ids: run.reused_relationship_ids,
                }}
              />
            </details>
            <details className="execution-details">
              <summary>Execution details</summary>
              <WorkspaceData
                value={{
                  model_usage: run.model_usage,
                  skill_used: run.skill_used,
                  tool_calls: run.tool_calls,
                  error_message: run.error_message,
                }}
              />
            </details>
            <details className="execution-details">
              <summary>Raw response & session context</summary>
              <pre>{JSON.stringify(run, null, 2)}</pre>
              <button
                className="quiet-button"
                onClick={() =>
                  downloadFile(
                    JSON.stringify(run, null, 2),
                    "nodus-investigation.json",
                    "application/json",
                  )
                }
              >
                Download JSON
              </button>
            </details>
          </>
        )}
      </div>
      <footer className="report-footer">
        <span>
          {run.persistence_status === "PERSISTED" ? "Saved report" : "Session-only report"} · Generated analysis is not independently verified.
        </span>
        <button className="quiet-button" onClick={overview}>
          Return to Overview
          <ArrowRight size={14} />
        </button>
      </footer>
    </section>
  );
}
