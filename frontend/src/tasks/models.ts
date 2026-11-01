import type { EvidenceSnapshot } from "../investigations/api";
export interface OwnershipDecision {
  service_id: string; service_name: string; primary_team_id: string | null; primary_team_name: string | null;
  candidate_team_ids: string[]; supporting_team_ids: string[]; project_ids: string[]; owner_ids: string[];
  evidence_ids: string[]; status: string; explanation: string;
}
export interface ActionableProblem {
  problem_id: string; category: string; title: string; description: string; severity: string;
  service_id: string; affected_system_ids: string[]; impact: string; recommended_action: string;
  acceptance_criteria: string[]; evidence_ids: string[]; verification_status: string;
  ownership: OwnershipDecision; task_id: string | null;
}
export interface RemediationTask {
  task_id: string; title: string; description: string; required_action: string; priority: string; status: string;
  service_id: string; project_id: string | null; primary_team_id: string | null; primary_team_name: string | null;
  supporting_team_ids: string[]; assigned_subject: string | null; investigation_id: string; finding: ActionableProblem;
  evidence_ids: string[]; acceptance_criteria: string[]; assignment_reason: string; resolution_verification: string;
}
export interface TaskDetail {
  assignment_candidates?: {team_id:string;team_name:string}[];
  assignee_candidates?: {subject:string;name:string;team_id:string}[];
  task: RemediationTask; evidence: EvidenceSnapshot[]; allowed_transitions: string[]; can_assign: boolean;
  history: {actor: string; event: string; occurred_at: string; details: {reason?: string; from_status?: string; to_status?: string}}[];
}
export interface TaskNotification {
  notification_id: string; task_id: string; title: string; team_name: string | null; priority: string;
  project_id: string | null; read_at: string | null; created_at: string;
}
