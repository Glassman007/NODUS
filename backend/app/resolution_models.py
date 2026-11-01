"""Evidence-backed remediation contracts, using the application's frozen Record base."""
from enum import StrEnum
from pydantic import Field
from backend.app.contracts import Record


class TaskStatus(StrEnum):
    OPEN = "OPEN"
    ASSIGNED = "ASSIGNED"
    IN_PROGRESS = "IN_PROGRESS"
    BLOCKED = "BLOCKED"
    RESOLVED = "RESOLVED"
    VERIFIED = "VERIFIED"
    CLOSED = "CLOSED"


class OwnershipDecision(Record):
    service_id: str
    service_name: str
    primary_team_id: str | None = None
    primary_team_name: str | None = None
    candidate_team_ids: tuple[str, ...] = ()
    supporting_team_ids: tuple[str, ...] = ()
    project_ids: tuple[str, ...] = ()
    owner_ids: tuple[str, ...] = ()
    evidence_ids: tuple[str, ...] = ()
    status: str = "REVIEW_REQUIRED"
    explanation: str = "No unique, directly evidenced service owner was found in the selected sources."


class ActionableProblem(Record):
    problem_id: str
    category: str
    title: str
    description: str
    severity: str = "MEDIUM"
    service_id: str
    affected_system_ids: tuple[str, ...] = ()
    impact: str
    recommended_action: str
    acceptance_criteria: tuple[str, ...]
    evidence_ids: tuple[str, ...]
    verification_status: str
    ownership: OwnershipDecision
    check: dict = Field(default_factory=dict)
    task_id: str | None = None


class RemediationTask(Record):
    task_id: str
    title: str
    description: str
    required_action: str
    priority: str
    status: TaskStatus
    service_id: str
    project_id: str | None = None
    primary_team_id: str | None = None
    primary_team_name: str | None = None
    supporting_team_ids: tuple[str, ...] = ()
    assigned_subject: str | None = None
    investigation_id: str
    finding: ActionableProblem
    evidence_ids: tuple[str, ...]
    acceptance_criteria: tuple[str, ...]
    assignment_version: int = 1
    assignment_reason: str = "Source-backed service ownership"
    resolution_verification: str = "NOT_CHECKED"


TRANSITIONS = {
    TaskStatus.OPEN: (TaskStatus.ASSIGNED, TaskStatus.BLOCKED),
    TaskStatus.ASSIGNED: (TaskStatus.IN_PROGRESS, TaskStatus.BLOCKED),
    TaskStatus.IN_PROGRESS: (TaskStatus.BLOCKED, TaskStatus.RESOLVED),
    TaskStatus.BLOCKED: (TaskStatus.IN_PROGRESS, TaskStatus.RESOLVED),
    TaskStatus.RESOLVED: (TaskStatus.IN_PROGRESS, TaskStatus.VERIFIED),
    TaskStatus.VERIFIED: (TaskStatus.CLOSED, TaskStatus.IN_PROGRESS),
    TaskStatus.CLOSED: (),
}
