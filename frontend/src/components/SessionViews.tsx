import { reportTitle } from "../investigations/report";
import { Activity, ArrowUpRight, FileCheck2 } from "lucide-react";
import type { Run } from "./AuthorizedWorkspace";
import { SourceLabel } from "./SourceLabel";
interface Props {
  runs: readonly Run[];
  openRun: (run: Run) => void;
}
export function SessionActivity({
  runs,
  projectId,
  openRun,
}: Props & { projectId: string }) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Recent session activity</h2>
        <Activity size={18} />
      </div>
      {runs.length ? (
        <ol className="session-activity">
          {runs.map((run) => (
            <li key={run.run_id}>
              <span className="activity-marker" />
              <div>
                <button className="row-link" onClick={() => openRun(run)}>
                  {reportTitle(run)}
                </button>
                <p>
                  <span className={`run-status ${run.status.toLowerCase()}`}>
                    {run.status}
                  </span>{" "}
                  {projectId} · {run.selectedSourceIds.length} selected sources{" "}
                  <time dateTime={run.created}>
                    {new Date(run.created).toLocaleString()}
                  </time>
                </p>
              </div>
              <button
                className="icon-button"
                aria-label={`Open activity: ${reportTitle(run)}`}
                onClick={() => openRun(run)}
              >
                <ArrowUpRight size={16} />
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <div className="empty-state">
          <Activity size={25} />
          <h3>No investigation activity in this session</h3>
          <p>
            Run an investigation from Overview to see its result and timestamp
            here.
          </p>
        </div>
      )}
      <div className="panel-footnote">
        Session results only. No historical event feed is exposed by the
        backend.
      </div>
    </section>
  );
}
export function SessionVerification({ runs, openRun }: Props) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Evidence coverage & verification</h2>
        <FileCheck2 size={18} />
      </div>
      <p className="inline-note panel-body">
        Evidence references indicate tool-observed sources. They do not
        independently verify the model narrative. No claim-verification endpoint
        is available for these runs.
      </p>
      {runs.length ? (
        runs.map((run) => (
          <article className="verification-entry" key={run.run_id}>
            <div className="panel-heading">
              <button className="row-link" onClick={() => openRun(run)}>
                {reportTitle(run)}
              </button>
              <span className={`run-status ${run.status.toLowerCase()}`}>
                {run.status}
              </span>
            </div>
            <div className="panel-body">
              <span className="subtle-badge">NOT INDEPENDENTLY VERIFIED</span>
              <h3>Tool-returned evidence references</h3>
              {run.evidence_refs?.length ? (
                <ul className="reference-list">
                  {run.evidence_refs.map((ref) => (
                    <li key={ref}>
                      <SourceLabel id={ref} reference />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="inline-note">No evidence references returned.</p>
              )}
              {(
                [
                  "source_coverage_limitations",
                  "unresolved_conflicts",
                  "rejected_unverified_claims",
                ] as const
              ).map((key) => (
                <div key={key}>
                  <h3>{key.replaceAll("_", " ")}</h3>
                  {run[key]?.length ? (
                    <ul>
                      {run[key].map((entry, i) => (
                        <li key={i}>{entry}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="inline-note">None reported by the run.</p>
                  )}
                </div>
              ))}
              <button className="quiet-button" onClick={() => openRun(run)}>
                Open investigation result
                <ArrowUpRight size={14} />
              </button>
            </div>
          </article>
        ))
      ) : (
        <div className="empty-state">
          <FileCheck2 size={25} />
          <h3>No session results to inspect</h3>
          <p>
            Run an investigation to review the evidence and limitations it
            actually returns.
          </p>
        </div>
      )}
    </section>
  );
}
