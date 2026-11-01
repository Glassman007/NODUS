import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import type { ProjectScope, WorkspaceRequest } from "../auth/models";
import {
  evidenceRecordPath,
  parseEvidenceReference,
} from "../investigations/api";
import { SourceLabel } from "./SourceLabel";
import { WorkspaceData } from "./WorkspaceData";
export function EvidenceInspector({
  reference,
  workspaceId,
  sourceIds,
  request,
  scope,
}: {
  reference: string;
  workspaceId: string;
  sourceIds: readonly string[];
  request: WorkspaceRequest;
  scope: ProjectScope;
}) {
  const [data, setData] = useState<unknown>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const parsed = parseEvidenceReference(reference, sourceIds);
    const controller = new AbortController();
    const abort = () => controller.abort();
    scope.signal.addEventListener("abort", abort);
    if (scope.signal.aborted) controller.abort();
    const task = parsed
      ? request<unknown>(
          evidenceRecordPath(workspaceId, parsed),
          controller.signal,
        )
      : Promise.reject(
          new Error(
            "Reference has no resolvable source and record identifier.",
          ),
        );
    task
      .then((value) => {
        if (controller.signal.aborted) return;
        if (
          !value ||
          typeof value !== "object" ||
          !("source_id" in value) ||
          !("record_id" in value) ||
          value.source_id !== parsed?.sourceId ||
          value.record_id !== parsed?.recordId
        )
          throw new Error(
            "The evidence service returned inconsistent record metadata.",
          );
        setData(value);
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error ? reason.message : "Evidence unavailable.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      scope.signal.removeEventListener("abort", abort);
    };
  }, [reference, workspaceId, sourceIds, request, scope]);
  return (
    <div className="evidence-drilldown">
      <h3>
        Source record · <SourceLabel id={reference} reference />
      </h3>
      {loading && (
        <p className="loading-state" role="status">
          <LoaderCircle size={16} className="spin" />
          Loading authorized evidence…
        </p>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {data !== null && <WorkspaceData value={data} />}
    </div>
  );
}
