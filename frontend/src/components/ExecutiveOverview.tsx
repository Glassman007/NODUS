import { useContext } from "react";
import { SourceCatalog } from "../workspace/sourceCatalog";
import { sourceLabel } from "../workspace/sourceNames";
import type { GraphNode } from "../investigations/graph";
import type { SessionRun } from "../investigations/api";
import {
  entityName,
  excerpt,
  overviewPassages,
} from "../investigations/presentation";
import type { ReportTab } from "../investigations/report";
export function ReadableExcerpt({
  text,
  nodes,
}: {
  text: string;
  nodes: readonly GraphNode[];
}) {
  const sources = useContext(SourceCatalog);
  const names = new Map(nodes.map((node) => [node.id, entityName(node)]));
  return (
    <>
      {text.split(/(NEX-[A-Z0-9_-]+)/g).map((part, index) =>
        names.has(part) || part.startsWith("NEX-SRC-") ? (
          <span key={index} title={part}>
            {names.get(part) ?? sourceLabel(part, sources)}
          </span>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}
export function ExecutiveOverview({
  run,
  nodes,
  setTab,
}: {
  run: SessionRun;
  nodes: readonly GraphNode[];
  setTab: (tab: ReportTab) => void;
}) {
  const extracted = overviewPassages(run);
  const relevant = nodes
    .filter((node) => node.type === "SERVICE" || node.type === "CONTRACT")
    .sort((a, b) => {
      if (a.id === run.entityId) return -1;
      if (b.id === run.entityId) return 1;
      return Number(b.type === "SERVICE") - Number(a.type === "SERVICE") || entityName(a).localeCompare(entityName(b));
    })
    .slice(0, 6);
  const displayNodes = nodes.length
    ? nodes
    : run.entity_ids.map((id) => ({ id, name: null, type: null }));
  return (
    <div className="executive-overview">
      {run.resolution_status&&run.resolution_status!=="NOT_EVALUATED"&&<section className="resolution-finding">
        <p className="reader-label">VERIFIED FINDINGS &amp; NEXT STEPS</p>
        <h3>{run.actionable_findings?.length??0} verified actionable problems</h3>
        <p>{run.actionable_findings?.length?"Source-backed problems require the actions below. Review the responsible team and supporting evidence before acting.":"The investigation did not establish a verified defect. Proposed changes and graph dependencies alone do not justify automatic assignments."}</p>
        {run.actionable_findings?.map(problem=><p key={problem.problem_id}><span className={`priority-badge priority-${problem.severity.toLowerCase()}`}>{problem.severity}</span> <strong>{problem.title}</strong> · {problem.ownership.primary_team_name??"Administrator review"}</p>)}
        <button className="quiet-button" onClick={()=>setTab("ownership")}>Review ownership and actions →</button>
      </section>}
      <div className="report-section-heading">
        <h3>Investigation at a glance</h3>
        <span className="interpretation-label">
          AI-generated interpretation
        </span>
      </div>
      <section className="takeaway-card">
        <p className="reader-label">KEY TAKEAWAY</p>
        {extracted.conclusion ? (
          <p className="key-takeaway">
            <ReadableExcerpt
              text={excerpt(extracted.conclusion.text, 450)}
              nodes={displayNodes}
            />
          </p>
        ) : (
          <>
            <h4>No clear conclusion was returned</h4>
            <p>
              The available response contains technical context but no
              standalone conclusion. Review the complete analysis and observed
              connections before drawing one.
            </p>
          </>
        )}
        <p className="excerpt-disclosure">
          Selected from the existing model response. It has not been
          independently verified.
        </p>
      </section>
      <section className="reader-purpose">
        <h4>What NODUS examined</h4>
        <p>
          <ReadableExcerpt
            text={excerpt(run.objective.split(/\n|(?<=[.!?])\s/)[0], 220)}
            nodes={displayNodes}
          />
        </p>
      </section>
      <section className="reader-section">
        <h3>Important observations</h3>
        {extracted.observations.length ? (
          <div className="observation-list">
            {extracted.observations.map((observation, index) => (
              <article key={index}>
                <span className="observation-number">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <h4>{observation.heading}</h4>
                  <span className="interpretation-label">
                    Model interpretation
                  </span>
                  <p>
                    <ReadableExcerpt
                      text={excerpt(observation.text)}
                      nodes={displayNodes}
                    />
                  </p>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p>
            No separate substantive observations were returned. The technical
            analysis remains available below.
          </p>
        )}
      </section>
      <section className="reader-section">
        <h3>Relevant systems</h3>
        {relevant.length ? (
          <div className="relevant-systems">
            {relevant.map((node) => (
              <button
                key={node.id}
                onClick={() => setTab("services")}
                title={node.id}
              >
                {entityName(node)}
                <small>Observed graph entity</small>
              </button>
            ))}
          </div>
        ) : (
          <p>
            Open Services &amp; Interfaces to load the authorized component
            details. Entity identifiers alone do not establish implementation
            behavior.
          </p>
        )}
      </section>
      <section className="reader-section">
        <h3>Potential impact</h3>
        {extracted.impact ? (
          <p>
            <ReadableExcerpt
              text={excerpt(extracted.impact.text)}
              nodes={displayNodes}
            />
          </p>
        ) : (
          <p>
            The response does not provide a separate operational-impact
            conclusion. Inspect the documented connections before assuming an
            outage, vulnerability or financial effect.
          </p>
        )}
        <span className="interpretation-label">
          {extracted.impact
            ? "Model interpretation · not a proven outcome"
            : "Impact not established"}
        </span>
      </section>
      <section className="reader-limitations">
        <h3>Evidence and limitations</h3>
        <p>
          {run.evidence_refs.length
            ? `${run.evidence_refs.length} source references were returned and can be inspected. Their presence does not independently verify the model's claims.`
            : "No independently verifiable evidence references were returned. The analysis describes graph observations and model interpretations, not proven implementation behavior."}
        </p>
        {run.source_coverage_limitations.length > 0 && (
          <ul>
            {run.source_coverage_limitations.slice(0, 3).map((text, index) => (
              <li key={index}>
                <ReadableExcerpt text={excerpt(text)} nodes={displayNodes} />
              </li>
            ))}
          </ul>
        )}
        <p>
          Claim-to-evidence mappings are not supplied by this investigation API.
        </p>
      </section>
      <section className="reader-section explore-further">
        <h3>Explore further</h3>
        <div>
          <button className="report-action" onClick={() => setTab("graph")}>
            Explore relationship graph
          </button>
          <button className="report-action" onClick={() => setTab("services")}>
            Browse services
          </button>
          <button className="report-action" onClick={() => setTab("evidence")}>
            Review available evidence
          </button>
          <button className="report-action" onClick={() => setTab("technical")}>
            Read complete technical analysis
          </button>
        </div>
      </section>
    </div>
  );
}
