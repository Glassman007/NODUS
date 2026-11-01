import type { WorkspaceRequest } from "../auth/models";
import type { SessionRun } from "./api";
export interface GraphNode {
  id: string;
  name: string | null;
  type: string | null;
  description?: string | null;
}
export interface GraphEdge {
  id: string;
  source_id: string;
  target_id: string;
  type: string;
  source_id_ref: string | null;
  record_id: string | null;
  origin: string | null;
  [key: string]: unknown;
}
export interface RunGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  missing: number;
}
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
export function parseNode(value: unknown, id: string): GraphNode {
  if (
    !record(value) ||
    value.id !== id ||
    (value.name != null && typeof value.name !== "string") ||
    (value.type != null && typeof value.type !== "string")
  )
    throw new Error("Invalid entity record");
  return {
    id,
    name: (value.name as string | null) ?? null,
    type: (value.type as string | null) ?? null,
    description:
      typeof value.description === "string" ? value.description : null,
  };
}
export function parseEdge(value: unknown, id: string): GraphEdge {
  if (
    !record(value) ||
    value.id !== id ||
    typeof value.source_id !== "string" ||
    typeof value.target_id !== "string" ||
    typeof value.type !== "string"
  )
    throw new Error("Invalid relationship record");
  return {
    ...value,
    id,
    source_id: value.source_id,
    target_id: value.target_id,
    type: value.type,
    source_id_ref:
      typeof value.source_id_ref === "string" ? value.source_id_ref : null,
    record_id: typeof value.record_id === "string" ? value.record_id : null,
    origin: typeof value.origin === "string" ? value.origin : null,
  };
}
/** Bounded parallel reads; no traversal outside identifiers observed by the run. */
export async function loadRunGraph(
  run: SessionRun,
  request: WorkspaceRequest,
  signal: AbortSignal,
): Promise<RunGraph> {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  let missing = 0;
  const entityIds = [...new Set(run.entity_ids)];
  const edgeIds = [...new Set(run.relationship_ids)];
  const jobs = [
    ...entityIds.slice(0, 250).map((id) => ({ id, kind: "entities" as const })),
    ...edgeIds
      .slice(0, 500)
      .map((id) => ({ id, kind: "relationships" as const })),
  ];
  missing = entityIds.length + edgeIds.length - jobs.length;
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(6, jobs.length) }, async () => {
      while (cursor < jobs.length) {
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");
        const job = jobs[cursor++];
        try {
          const data = await request<unknown>(
            `workspaces/${encodeURIComponent(run.workspaceId)}/${job.kind}/${encodeURIComponent(job.id)}`,
            signal,
          );
          if (job.kind === "entities") nodes.push(parseNode(data, job.id));
          else edges.push(parseEdge(data, job.id));
        } catch (error) {
          if (signal.aborted) throw error;
          missing++;
        }
      }
    }),
  );
  // Retain edges only when both authorized endpoint records were retrieved. Never synthesize placeholders.
  const ids = new Set(nodes.map((n) => n.id));
  const drawable = edges.filter(
    (e) => ids.has(e.source_id) && ids.has(e.target_id),
  );
  missing += edges.length - drawable.length;
  return {
    nodes: nodes.sort((a, b) => a.id.localeCompare(b.id)),
    edges: drawable.sort((a, b) => a.id.localeCompare(b.id)),
    missing,
  };
}
export function neighbors(
  graph: Pick<RunGraph, "edges">,
  root: string,
  hops: number,
): Set<string> {
  const ids = new Set([root]);
  for (let i = 0; i < hops; i++) {
    const before = new Set(ids);
    for (const edge of graph.edges) {
      if (before.has(edge.source_id) || before.has(edge.target_id)) {
        ids.add(edge.source_id);
        ids.add(edge.target_id);
      }
    }
  }
  return ids;
}
