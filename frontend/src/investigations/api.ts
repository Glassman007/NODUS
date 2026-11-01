import type { WorkspaceRequest } from "../auth/models";
import type {ActionableProblem,OwnershipDecision} from "../tasks/models";
export const INVESTIGATION_TIMEOUT_MS = 660_000; // Backend RuntimeLimits allows 600 seconds, plus HTTP overhead.
export type InvestigationStatus =
  "COMPLETE" | "PARTIAL" | "INCOMPLETE" | "BLOCKED";
export interface SkillUsage {
  skill_id: string;
  version: string;
  content_digest: string;
  trust_status: string;
}
export interface ModelUsage {
  llm_calls: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number | null;
  tool_calls: number;
  model_used: string | null;
}
export interface ToolCall {
  tool_id: string;
  version: string;
  status: string;
  evidence_refs: string[];
  graph_revision: number | null;
}
export interface InvestigationResult {
  actionable_findings?: ActionableProblem[];
  ownership_decisions?: OwnershipDecision[];
  resolution_status?: string;
  starting_entity_id?: string | null;
  evidence_registry?: EvidenceSnapshot[];
  structured_findings?: StructuredFinding[];
  verification_status?: string;
  persistence_status?: string;
  selected_source_ids?: string[];
  requested_source_ids?: string[];
  source_usage?: Record<string, number>;
  verification_summary?: Record<string, number>;
  run_id: string;
  status: InvestigationStatus;
  summary: string;
  full_analysis?: string | null;
  analysis_character_count?: number | null;
  analysis_truncated?: boolean;
  findings: string[];
  entity_ids: string[];
  relationship_ids: string[];
  evidence_refs: string[];
  graph_revision: number | null;
  unresolved_conflicts: string[];
  source_coverage_limitations: string[];
  rejected_unverified_claims: string[];
  newly_discovered_relationship_ids: string[];
  reused_relationship_ids: string[];
  skill_used: SkillUsage | null;
  model_usage: ModelUsage;
  tool_calls: ToolCall[];
  error_message: string | null;
}
export interface InvestigationInput {
  project_id?: string;
  objective: string;
  selected_source_ids: string[];
  entity_id?: string;
}
export interface EvidenceSnapshot {
  evidence_id: string;
  run_id: string;
  source_id: string;
  record_id: string;
  kind: string;
  locator: string;
  excerpt: string;
  content_hash: string;
  retrieved_at: string;
  tool_id: string;
}
export interface StructuredFinding {
  finding_id: string;
  claim: string;
  claim_type: string;
  verification_status: string;
  evidence_ids: string[];
  entity_ids: string[];
  relationship_ids: string[];
  explanation: string;
}
export interface SessionRun extends InvestigationResult {
  objective: string;
  created: string;
  workspaceId: string;
  projectId: string;
  selectedSourceIds: string[];
  entityId?: string;
}
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
function invalid(): never {
  throw new Error(
    "The investigation service returned an invalid response. No result has been accepted.",
  );
}
function text(value: unknown): string {
  if (typeof value !== "string") return invalid();
  return value;
}
function nullableText(value: unknown): string | null {
  return value === undefined || value === null ? null : text(value);
}
function number(value: unknown, fallback: number | null = null): number | null {
  if (value == null) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    return invalid();
  return value;
}
function strings(value: unknown): string[] {
  if (value == null) return [];
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string"))
    return invalid();
  return [...value];
}
export function parseInvestigationResult(value: unknown): InvestigationResult {
  if (
    !object(value) ||
    !["COMPLETE", "PARTIAL", "INCOMPLETE", "BLOCKED"].includes(
      String(value.status),
    )
  )
    return invalid();
  if (!text(value.run_id).trim() || !text(value.summary).trim())
    return invalid();
  if (
    value.analysis_truncated != null &&
    typeof value.analysis_truncated !== "boolean"
  )
    return invalid();
  if (
    typeof value.full_analysis === "string" &&
    value.full_analysis.length > 1_000_000
  )
    return invalid();
  const result: InvestigationResult = {
    actionable_findings: [], ownership_decisions: [], resolution_status: nullableText(value.resolution_status)??"NOT_EVALUATED",
    starting_entity_id: nullableText(value.starting_entity_id),
    verification_status: nullableText(value.verification_status) ?? "UNVERIFIED",
    persistence_status: nullableText(value.persistence_status) ?? "UNAVAILABLE",
    evidence_registry: [],
    structured_findings: [],
    selected_source_ids: strings(value.selected_source_ids),
    requested_source_ids: strings(value.requested_source_ids),
    source_usage: {},
    verification_summary: {},
    run_id: text(value.run_id),
    status: value.status as InvestigationStatus,
    summary: text(value.summary),
    full_analysis: nullableText(value.full_analysis),
    analysis_character_count: number(value.analysis_character_count),
    analysis_truncated: value.analysis_truncated === true,
    findings: strings(value.findings),
    entity_ids: strings(value.entity_ids),
    relationship_ids: strings(value.relationship_ids),
    evidence_refs: strings(value.evidence_refs),
    graph_revision: number(value.graph_revision),
    unresolved_conflicts: strings(value.unresolved_conflicts),
    source_coverage_limitations: strings(value.source_coverage_limitations),
    rejected_unverified_claims: strings(value.rejected_unverified_claims),
    newly_discovered_relationship_ids: strings(
      value.newly_discovered_relationship_ids,
    ),
    reused_relationship_ids: strings(value.reused_relationship_ids),
    skill_used: null,
    model_usage: {
      llm_calls: 0,
      total_input_tokens: 0,
      total_output_tokens: 0,
      total_tokens: 0,
      tool_calls: 0,
      estimated_cost_usd: null,
      model_used: null,
    },
    tool_calls: [],
    error_message: nullableText(value.error_message),
  };
  if(value.actionable_findings!=null){
    if(!Array.isArray(value.actionable_findings)||!value.actionable_findings.every(item=>object(item)&&typeof item.problem_id==="string"&&object(item.ownership)&&Array.isArray(item.evidence_ids)))return invalid();
    result.actionable_findings=value.actionable_findings as ActionableProblem[];
  }
  if(value.ownership_decisions!=null){
    if(!Array.isArray(value.ownership_decisions)||!value.ownership_decisions.every(item=>object(item)&&typeof item.service_id==="string"&&typeof item.explanation==="string"))return invalid();
    result.ownership_decisions=value.ownership_decisions as OwnershipDecision[];
  }
  if (value.evidence_registry != null) {
    if (!Array.isArray(value.evidence_registry)) return invalid();
    result.evidence_registry = value.evidence_registry.map((item) => {
      if (!object(item) || item.run_id !== result.run_id) return invalid();
      return { evidence_id: text(item.evidence_id), run_id: text(item.run_id),
        source_id: text(item.source_id), record_id: text(item.record_id), kind: text(item.kind),
        locator: text(item.locator), excerpt: text(item.excerpt), content_hash: text(item.content_hash),
        retrieved_at: text(item.retrieved_at), tool_id: text(item.tool_id) };
    });
  }
  for (const key of ["source_usage", "verification_summary"] as const) {
    if (value[key] != null) {
      if (!object(value[key])) return invalid();
      result[key] = Object.fromEntries(Object.entries(value[key]).map(([name, count]) => [name, number(count, 0)!]));
    }
  }
  if (value.structured_findings != null) {
    if (!Array.isArray(value.structured_findings)) return invalid();
    result.structured_findings = value.structured_findings.map((item) => {
      if (!object(item)) return invalid();
      return { finding_id: text(item.finding_id), claim: text(item.claim),
        claim_type: text(item.claim_type), verification_status: text(item.verification_status),
        evidence_ids: strings(item.evidence_ids), entity_ids: strings(item.entity_ids),
        relationship_ids: strings(item.relationship_ids), explanation: text(item.explanation) };
    });
  }
  if (value.skill_used != null) {
    if (!object(value.skill_used)) return invalid();
    const skill = value.skill_used;
    result.skill_used = {
      skill_id: text(skill.skill_id),
      version: text(skill.version),
      content_digest: text(skill.content_digest),
      trust_status: text(skill.trust_status),
    };
  }
  if (value.model_usage != null) {
    if (!object(value.model_usage)) return invalid();
    const usage = value.model_usage;
    result.model_usage = {
      llm_calls: number(usage.llm_calls, 0)!,
      total_input_tokens: number(usage.total_input_tokens, 0)!,
      total_output_tokens: number(usage.total_output_tokens, 0)!,
      total_tokens: number(usage.total_tokens, 0)!,
      tool_calls: number(usage.tool_calls, 0)!,
      estimated_cost_usd: number(usage.estimated_cost_usd),
      model_used: nullableText(usage.model_used),
    };
  }
  if (value.tool_calls != null) {
    if (!Array.isArray(value.tool_calls)) return invalid();
    result.tool_calls = value.tool_calls.map((call) => {
      if (!object(call)) return invalid();
      return {
        tool_id: text(call.tool_id),
        version: text(call.version),
        status: text(call.status),
        evidence_refs: strings(call.evidence_refs),
        graph_revision: number(call.graph_revision),
      };
    });
  }
  return result;
}
export async function submitInvestigation(
  request: WorkspaceRequest,
  workspaceId: string,
  input: InvestigationInput,
  signal: AbortSignal,
): Promise<InvestigationResult> {
  const body: InvestigationInput = {
    ...(input.project_id ? {project_id: input.project_id} : {}),
    objective: input.objective.trim(),
    selected_source_ids: [...input.selected_source_ids],
    ...(input.entity_id?.trim() ? { entity_id: input.entity_id.trim() } : {}),
  };
  return parseInvestigationResult(
    await request<unknown>(
      `workspaces/${encodeURIComponent(workspaceId)}/investigations`,
      signal,
      body,
    ),
  );
}
export interface EvidenceReference {
  sourceId: string;
  recordId: string;
}
export function parseEvidenceReference(
  reference: string,
  sourceIds: readonly string[],
): EvidenceReference | null {
  const sourceId = [...sourceIds]
    .sort((a, b) => b.length - a.length)
    .find((id) => reference.startsWith(id + ":"));
  if (sourceId)
    return reference.length > sourceId.length + 1
      ? { sourceId, recordId: reference.slice(sourceId.length + 1) }
      : null;
  const split = reference.indexOf(":");
  return split > 0 && split < reference.length - 1
    ? {
        sourceId: reference.slice(0, split),
        recordId: reference.slice(split + 1),
      }
    : null;
}
export function evidenceRecordPath(
  workspaceId: string,
  ref: EvidenceReference,
): string {
  return `workspaces/${encodeURIComponent(workspaceId)}/records/${encodeURIComponent(ref.sourceId)}/${encodeURIComponent(ref.recordId)}`;
}
export function scopeMismatches(run: SessionRun): string[] {
  return [
    ...new Set(
      [
        ...run.evidence_refs,
        ...run.tool_calls.flatMap((call) => call.evidence_refs),
      ].filter((ref) => {
        const parsed = parseEvidenceReference(ref, run.selectedSourceIds);
        return parsed && !run.selectedSourceIds.includes(parsed.sourceId);
      }),
    ),
  ];
}
