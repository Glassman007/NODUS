"""Task visibility and assignment use the existing graph, evidence and identity gates."""
from uuid import uuid4

from backend.app.agent.provenance import EvidenceSnapshot
from backend.app.agent.verifier import snapshots_accessible
from backend.app.governance.identity import (NEXUS_TENANT_ID, refresh_principal_source_ids,
    investigation_read_principal)
from backend.app.resolution_models import RemediationTask, TaskStatus, TRANSITIONS
from backend.app.security import Permission, Principal
from backend.app.graph.repository import GraphRepository


def live_principal(user, governance):
    return refresh_principal_source_ids(user, governance) if governance is not None else user


def task_repository(user, workspace_id, source_ids, graph_store, governance):
    if workspace_id not in user.workspaces or not user.permits(Permission.READ_GRAPH) or not user.permits(Permission.READ_EVIDENCE):
        raise PermissionError("Task not available")
    current = live_principal(user, governance)
    if not current.permits(Permission.READ_GRAPH) or not current.permits(Permission.READ_EVIDENCE):
        raise PermissionError("Task not available")
    if governance is not None:
        readable = investigation_read_principal(current, tuple(source_ids), None, governance)
        if not set(source_ids) <= set(readable.source_ids) and current.tenant_id == NEXUS_TENANT_ID:
            raise PermissionError("Task not available")
        current = readable
    if current.source_ids and not set(source_ids) <= set(current.source_ids):
        raise PermissionError("Task not available")
    return current, GraphRepository(graph_store, current.tenant_id, workspace_id, current.subject,
        allow_all=Permission.ADMIN in current.permissions, can_evidence=True,
        authorized_source_ids=frozenset(source_ids))


def member_of(user, team_id, repo, governance=None):
    if not team_id:
        return False
    person = user.subject.removeprefix("nexus:")
    if governance is not None and user.tenant_id == NEXUS_TENANT_ID:
        from datetime import datetime, timezone
        rows = governance.read("""SELECT data FROM nexus_team_memberships
            WHERE tenant_id=%s AND employee_id=%s AND team_id=%s""", (user.tenant_id,person,team_id))
        now = datetime.now(timezone.utc)
        for row in rows:
            data = row.get("data") or {}
            try:
                start = datetime.fromisoformat(data["valid_from"].replace("Z","+00:00")) if data.get("valid_from") else None
                end = datetime.fromisoformat(data["valid_to"].replace("Z","+00:00")) if data.get("valid_to") else None
                if (start is None or start<=now) and (end is None or now<end):
                    return True
            except (ValueError,TypeError):
                continue
        return False
    if repo.get_entity(person) is None:
        return False
    page = repo.neighborhood(person, limit=100)
    return any(edge.type == "BELONGS_TO" and edge.source_id == person and edge.target_id == team_id
               and edge.origin in ("source_asserted", "observed") for edge in page.relationships)


def visible_task(row, user, graph_store, governance):
    task = RemediationTask.model_validate(row["task_json"])
    evidence = tuple(EvidenceSnapshot.model_validate(item) for item in row["evidence_json"])
    if not evidence or any(item.evidence_id not in task.evidence_ids for item in evidence):
        raise PermissionError("Task not available")
    current, repo = task_repository(user, row["workspace_id"], {item.source_id for item in evidence}, graph_store, governance)
    if not snapshots_accessible({item.evidence_id: item for item in evidence}, repo, include_history=True):
        raise PermissionError("Task not available")
    for item in evidence:
        if item.kind == "GRAPH_RELATIONSHIP":
            import json
            if repo.relationship(json.loads(item.excerpt)["id"], include_history=True) is None:
                raise PermissionError("Task not available")
    manager = Permission.MANAGE_TASKS in current.permissions
    team_access = any(member_of(current, team, repo, governance) for team in (task.primary_team_id, *task.supporting_team_ids))
    if not manager and current.permits(Permission.EXECUTE_TOOL) and not team_access:
        raise PermissionError("Task not available")
    # Interns see only tasks explicitly assigned to them, even when team membership exists.
    if not manager and not current.permits(Permission.EXECUTE_TOOL) and task.assigned_subject != current.subject:
        raise PermissionError("Task not available")
    return task, evidence, current, repo


def permitted_transitions(task, user):
    values = TRANSITIONS[task.status]
    if Permission.MANAGE_TASKS in user.permissions:
        return values
    if not user.permits(Permission.EXECUTE_TOOL) and task.assigned_subject != user.subject:
        return ()
    return tuple(status for status in values if status not in (TaskStatus.VERIFIED, TaskStatus.CLOSED, TaskStatus.ASSIGNED))


def recipients_for(task, evidence, actor, workspace_id, graph_store, governance):
    """Materialize notifications only for members who can currently read the task."""
    if governance is None:
        return ()
    rows = governance.read("""SELECT employee_id, data FROM nexus_team_memberships
        WHERE tenant_id=%s AND team_id = ANY(%s)""", (actor.tenant_id, [task.primary_team_id, *task.supporting_team_ids]))
    recipients = set()
    people = {f"nexus:{row['employee_id']}" for row in rows}
    if task.status == TaskStatus.OPEN:
        managers = governance.read("""SELECT i.employee_id FROM nexus_demo_identities i
            JOIN nexus_roles r ON i.role_id=r.role_id AND i.tenant_id=r.tenant_id
            WHERE i.tenant_id=%s AND r.role_code='ADMIN'""", (actor.tenant_id,))
        people.update(f"nexus:{row['employee_id']}" for row in managers)
    if task.assigned_subject:
        people.add(task.assigned_subject)
    for subject in people:
        employee = subject.removeprefix("nexus:")
        candidate = Principal(subject=f"nexus:{employee}", tenant_id=actor.tenant_id,
            workspaces=(workspace_id,), permissions=frozenset())
        candidate = live_principal(candidate, governance)
        fake_row = {"workspace_id":workspace_id, "task_json":task.model_dump(mode="json"),
                    "evidence_json":[item.model_dump(mode="json") for item in evidence]}
        try:
            visible_task(fake_row, candidate, graph_store, governance)
        except (PermissionError, ValueError):
            continue
        recipients.add(candidate.subject)
    return tuple(sorted(recipients))


def create_tasks(result, user, workspace_id, store, graph_store, governance):
    if result.resolution_status in ("UNAVAILABLE","NOT_EVALUATED"):
        return result
    current = live_principal(user, governance)
    if Permission.MANAGE_TASKS not in current.permissions:
        return result.model_copy(update={"resolution_status":"REVIEW_REQUIRED" if result.actionable_findings else "NO_VERIFIED_PROBLEM"})
    attached = []
    registry = {item.evidence_id:item for item in result.evidence_registry}
    for finding in result.actionable_findings:
        if finding.verification_status != "SUPPORTED":
            attached.append(finding)
            continue
        ids = tuple(dict.fromkeys((*finding.evidence_ids, *finding.ownership.evidence_ids)))
        if not ids or not all(identifier in registry for identifier in ids):
            raise ValueError("Actionable finding lacks retrieved evidence")
        evidence = tuple(registry[identifier] for identifier in ids)
        owner = finding.ownership
        task = RemediationTask(task_id=str(uuid4()),title=finding.title,description=finding.description,
            required_action=finding.recommended_action,priority=finding.severity,
            status=TaskStatus.ASSIGNED if owner.status == "VERIFIED" else TaskStatus.OPEN,
            service_id=finding.service_id,project_id=owner.project_ids[0] if len(owner.project_ids)==1 else result.project_id,
            primary_team_id=owner.primary_team_id,primary_team_name=owner.primary_team_name,
            supporting_team_ids=owner.supporting_team_ids,investigation_id=result.run_id,
            finding=finding,evidence_ids=ids,acceptance_criteria=finding.acceptance_criteria,
            assignment_reason="Source-backed direct service ownership" if owner.status=="VERIFIED"
                else "Ownership unresolved; administrator assignment review required")
        recipients = recipients_for(task,evidence,current,workspace_id,graph_store,governance)
        saved = store.create_resolution_task(task=task,evidence=evidence,tenant_id=current.tenant_id,
            workspace_id=workspace_id,actor=current.subject,fingerprint=finding.problem_id,recipients=recipients,
            selected_source_ids=result.selected_source_ids)
        attached.append(finding.model_copy(update={"task_id":saved.task_id}))
    return result.model_copy(update={"actionable_findings":tuple(attached),
        "resolution_status":"TASKS_CREATED" if any(finding.task_id for finding in attached) else "NO_VERIFIED_PROBLEM"})
