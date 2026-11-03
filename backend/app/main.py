from __future__ import annotations

import json
import os
import re
import uuid
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from neo4j.exceptions import Neo4jError, ServiceUnavailable
from pydantic import BaseModel, Field

from backend.app.agent.discovery import run_scoped_investigation
from backend.app.agent.persistence import InvestigationStore
from backend.app.agent.contracts import InvestigationResult
from backend.app.config import Settings
from backend.app.gateway.config import GatewayConfig
from backend.app.gateway.gateway import ModelGateway
from backend.app.gateway.gemini_client import GeminiProviderClient
from backend.app.governance.access_requests import (
    approve_request, create_access_request, deny_request, get_authorization_scope,
    list_active_grants, list_pending_requests, list_requests_for_employee, revoke_grant,
)
from backend.app.governance.identity import (
    NEXUS_TENANT_ID, authorized_source_ids_for, isolated_demo_mode_enabled,
    nexus_identity_summary, principal_authorizes_action, resolve_demo_principal,
)
from backend.app.governance.identity import ROLE_PERMISSIONS
from backend.app.governance.local_demo_login import demo_user_for_token
from backend.app.governance.store import GovernanceStore
from backend.app.graph.authority import AuthorityRule
from backend.app.graph.driver import Neo4jStore
from backend.app.graph.models import SourceRecordInput
from backend.app.graph.repository import GraphRepository
from backend.app.ingestion.local_json import LocalImport, normalize
from backend.app.ingestion.github_public import GitHubImport, fetch_public_pull_requests, normalize_pull_request
from backend.app.security import Principal
from backend.app.skills.catalog import build_production_skill_registry
from backend.app.tools import register_all_tools
from backend.app.tools.executor import ToolExecutor
from backend.app.tools.registry import ToolDependencies, ToolRegistry

# NEXUS_TENANT_ID lives in backend.app.governance.identity (shared with the
# backend.app.tools/* modules). principal_from_token has no per-request
# workspace context of its own, so the workspace half of the pair is a
# deliberate, documented constant here rather than threaded through the
# whole auth dependency chain.
NEXUS_WORKSPACE_ID = "nexus-workspace"


def principal_from_token(token: str, governance_store: GovernanceStore | None = None) -> Principal | None:
    try:
        item = json.loads(os.getenv("GRAPH_HACKS_API_PRINCIPALS_JSON", "{}"))[token]
        found = Principal(
            subject=str(item["subject"]), tenant_id=str(item["tenant_id"]),
            workspaces=tuple(str(x) for x in item["workspaces"]),
            permissions=frozenset(str(x) for x in item["permissions"]),
            source_ids=tuple(str(x) for x in item.get("source_ids", [])),
        )
        return found
    except (KeyError, ValueError, TypeError):
        pass
    demo_mode = isolated_demo_mode_enabled()
    if demo_mode:
        local_user = demo_user_for_token(token)
        if local_user is not None:
            return Principal(
                subject=f"nexus:{local_user.employee_id}", tenant_id=NEXUS_TENANT_ID,
                workspaces=(NEXUS_WORKSPACE_ID,), permissions=ROLE_PERMISSIONS[local_user.role_code],
                source_ids=local_user.source_ids,
            )
    if governance_store is not None and demo_mode:
        return resolve_demo_principal(token, governance_store, tenant_id=NEXUS_TENANT_ID,
                                      workspace_id=NEXUS_WORKSPACE_ID, demo_mode_enabled=demo_mode)
    return None


def principal(request: Request, authorization: str | None = Header(default=None)) -> Principal:
    parts = authorization.split(" ", 1) if authorization else []
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(401, "Bearer token required")
    governance_store = getattr(request.app.state, "governance_store", None)
    found = principal_from_token(parts[1].strip(), governance_store)
    if found is None:
        raise HTTPException(401, "Invalid credentials")
    return found


def require(permission: str):
    def dependency(user: Principal = Depends(principal)) -> Principal:
        if not user.permits(permission):
            raise HTTPException(403, "Permission denied")
        return user
    return dependency


def load_authority_rules() -> tuple[AuthorityRule, ...]:
    """Deterministic source/scope authority rules (R07), configured the same
    way as principals: an opaque JSON env var, never a reasoning service.
    Absent or invalid configuration means no rules apply — every conflict
    stays unresolved rather than guessed."""
    try:
        raw = json.loads(os.getenv("GRAPH_HACKS_AUTHORITY_RULES_JSON", "[]"))
        return tuple(AuthorityRule(**item) for item in raw)
    except (ValueError, TypeError):
        return ()


def repository(request: Request, user: Principal, workspace_id: str) -> GraphRepository:
    if workspace_id not in user.workspaces:
        raise HTTPException(404, "Workspace not available")
    is_admin = "ADMIN" in user.permissions
    return GraphRepository(request.app.state.graph_store, user.tenant_id, workspace_id,
                           user.subject, is_admin,
                           user.permits("READ_EVIDENCE"),
                           authority_rules=request.app.state.authority_rules,
                           authorized_source_ids=authorized_source_ids_for(user))


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = Settings.from_env()
    store = Neo4jStore(settings)
    try:
        store.start()
        app.state.graph_store = store
        app.state.authority_rules = load_authority_rules()
        # Postgres/governance is optional: NEXUS demo-token resolution is
        # simply unavailable without it, exactly as before this feature
        # existed — it was never a hard requirement for the app to start.
        app.state.governance_store = None
        app.state.investigation_store = None
        if settings.postgres_dsn:
            governance_store = GovernanceStore(settings.postgres_dsn)
            governance_store.start()
            app.state.governance_store = governance_store
            investigation_store = InvestigationStore(settings.postgres_dsn)
            investigation_store.start()
            app.state.investigation_store = investigation_store

        # Stage 11 (ND-11A): the deterministic tool/skill layer needs no
        # external credential and is always wired up; the real Gemini model
        # gateway is optional (only needed to actually drive an
        # investigation) and degrades to 503 at the endpoint, never a failed
        # app startup, when no API key is configured.
        tool_registry = ToolRegistry()
        register_all_tools(tool_registry)
        app.state.tool_registry = tool_registry
        app.state.skill_registry = build_production_skill_registry(tool_registry=tool_registry)
        app.state.tool_executor = ToolExecutor(tool_registry, ToolDependencies(
            graph_store=store, authority_rules=app.state.authority_rules,
            postgres_store=app.state.governance_store, governance_store=app.state.governance_store))
        app.state.model_gateway = None
        try:
            gateway_config = GatewayConfig.from_env()
            if gateway_config.api_key:
                app.state.model_gateway = ModelGateway(
                    GeminiProviderClient(gateway_config.api_key), gateway_config.routing,
                    gateway_config.pricing, gateway_config.retry_policy)
        except Exception:
            app.state.model_gateway = None  # never block API startup over optional model configuration
        yield
    finally:
        store.close()


app = FastAPI(title="NODUS Graph API", version="1.1.0", lifespan=lifespan)
_REQUEST_ID = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")


@app.middleware("http")
async def request_id(request: Request, call_next):
    incoming = request.headers.get("X-Request-ID", "")
    request.state.request_id = incoming if _REQUEST_ID.fullmatch(incoming) else str(uuid.uuid4())
    response = await call_next(request)
    response.headers["X-Request-ID"] = request.state.request_id
    return response


def error_response(request: Request, status: int, code: str, message: str,
                   details=None) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {
        "code": code, "message": message,
        "request_id": getattr(request.state, "request_id", ""),
        "details": details,
    }})


@app.exception_handler(HTTPException)
async def http_error(request: Request, exc: HTTPException):
    code = {401: "UNAUTHORIZED", 403: "FORBIDDEN", 404: "NOT_FOUND", 422: "INVALID_REQUEST", 503: "DATABASE_UNAVAILABLE"}.get(exc.status_code, "REQUEST_FAILED")
    return error_response(request, exc.status_code, code, str(exc.detail))


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    details = [{"location": list(error["loc"]), "type": error["type"]} for error in exc.errors()]
    return error_response(request, 422, "INVALID_REQUEST", "Request validation failed", details)


@app.exception_handler(ServiceUnavailable)
async def unavailable(request: Request, _exc: ServiceUnavailable):
    return error_response(request, 503, "DATABASE_UNAVAILABLE", "Graph database unavailable")


@app.exception_handler(Neo4jError)
async def database_error(request: Request, exc: Neo4jError):
    if "TransactionTimedOut" in str(getattr(exc, "code", "")):
        return error_response(request, 504, "QUERY_TIMEOUT", "Graph query timed out")
    return error_response(request, 503, "DATABASE_ERROR", "Graph database query failed")


@app.exception_handler(Exception)
async def unexpected_error(request: Request, _exc: Exception):
    return error_response(request, 500, "INTERNAL_ERROR", "An unexpected server error occurred")


@app.get("/health")
def health(request: Request):
    try:
        request.app.state.graph_store.read(lambda tx: tx.run("RETURN 1 AS ok").single()["ok"])
        return {"ready": True}
    except (Neo4jError, ServiceUnavailable) as exc:
        raise HTTPException(503, "Graph database unavailable") from exc


@app.get("/api/v1/session")
def session(user: Principal = Depends(principal)):
    return {"subject": user.subject, "tenant_id": user.tenant_id,
            "permissions": sorted(user.permissions)}


@app.get("/api/v1/workspaces")
def workspaces(user: Principal = Depends(require("READ_GRAPH"))):
    return {"items": [{"id": item, "name": item} for item in user.workspaces]}


@app.post("/api/v1/workspaces/{workspace_id}/records")
def ingest(workspace_id: str, record: SourceRecordInput, request: Request,
           user: Principal = Depends(require("MANAGE_INGESTION"))):
    repo = repository(request, user, workspace_id)
    if not user.permits_source(record.source_id):
        raise HTTPException(403, "Source is not authorized")
    try:
        return repo.ingest(record)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post("/api/v1/workspaces/{workspace_id}/imports/json")
def import_json(workspace_id: str, document: LocalImport, request: Request,
                user: Principal = Depends(require("MANAGE_INGESTION"))):
    repo = repository(request, user, workspace_id)
    if not user.permits_source(document.source_id):
        raise HTTPException(403, "Source is not authorized")
    results = [repo.ingest(normalize(document.source_id, record)) for record in document.records]
    retracted = [
        record_id for record_id in document.deleted_record_ids
        if repo.retract_record(document.source_id, record_id)
    ]
    return {"source_id": document.source_id, "imported": results, "retracted": retracted}


@app.post("/api/v1/workspaces/{workspace_id}/imports/github")
def import_github(workspace_id: str, source: GitHubImport, request: Request,
                  user: Principal = Depends(require("MANAGE_INGESTION"))):
    repo = repository(request, user, workspace_id)
    if not user.permits_source(source.source_id):
        raise HTTPException(403, "Source is not authorized")
    try:
        records = [normalize_pull_request(source.source_id, item)
                   for item in fetch_public_pull_requests(source)]
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except (RuntimeError, KeyError, TypeError) as exc:
        raise HTTPException(502, "GitHub source unavailable") from exc
    return {"source_id": source.source_id, "imported": [repo.ingest(record) for record in records]}


@app.delete("/api/v1/workspaces/{workspace_id}/records/{source_id}/{record_id:path}")
def retract(workspace_id: str, source_id: str, record_id: str, request: Request,
            user: Principal = Depends(require("MANAGE_INGESTION"))):
    repo = repository(request, user, workspace_id)
    if not user.permits_source(source_id):
        raise HTTPException(403, "Source is not authorized")
    if not repo.retract_record(source_id, record_id):
        raise HTTPException(404, "Source record not found")
    return {"retracted": True}


@app.get("/api/v1/workspaces/{workspace_id}/search")
def search(workspace_id: str, request: Request,
           q: str = Query(min_length=1, max_length=200),
           limit: int = Query(25, ge=1, le=100),
           offset: int = Query(0, ge=0, le=10000),
           user: Principal = Depends(require("READ_GRAPH"))):
    return repository(request, user, workspace_id).search(q, limit, offset)


@app.get("/api/v1/workspaces/{workspace_id}/entities/{entity_id}")
def entity(workspace_id: str, entity_id: str, request: Request,
           user: Principal = Depends(require("READ_GRAPH"))):
    result = repository(request, user, workspace_id).get_entity(entity_id)
    if result is None:
        raise HTTPException(404, "Entity not found")
    return result


@app.get("/api/v1/workspaces/{workspace_id}/entities/{entity_id}/neighborhood")
def neighborhood(workspace_id: str, entity_id: str, request: Request,
                 limit: int = Query(50, ge=1, le=100), history: bool = False,
                 user: Principal = Depends(require("READ_GRAPH"))):
    repo = repository(request, user, workspace_id)
    if repo.get_entity(entity_id) is None:
        raise HTTPException(404, "Entity not found")
    return repo.neighborhood(entity_id, limit, history)


@app.get("/api/v1/workspaces/{workspace_id}/entities/{entity_id}/reverse-dependencies")
def reverse_dependencies(workspace_id: str, entity_id: str, request: Request,
                         limit: int = Query(50, ge=1, le=100),
                         user: Principal = Depends(require("READ_GRAPH"))):
    repo = repository(request, user, workspace_id)
    if repo.get_entity(entity_id) is None:
        raise HTTPException(404, "Entity not found")
    return repo.reverse_dependencies(entity_id, limit)


@app.get("/api/v1/workspaces/{workspace_id}/relationships/{relation_id}")
def relationship(workspace_id: str, relation_id: str, request: Request,
                 user: Principal = Depends(require("READ_GRAPH"))):
    result = repository(request, user, workspace_id).relationship(relation_id)
    if result is None:
        raise HTTPException(404, "Relationship not found")
    return result


@app.get("/api/v1/workspaces/{workspace_id}/paths")
def paths(workspace_id: str, request: Request, source_id: str, target_id: str,
          max_depth: int = Query(3, ge=1, le=4), limit: int = Query(10, ge=1, le=20),
          user: Principal = Depends(require("READ_GRAPH"))):
    repo = repository(request, user, workspace_id)
    if repo.get_entity(source_id) is None or repo.get_entity(target_id) is None:
        raise HTTPException(404, "Entity not found")
    return repo.paths(source_id, target_id, max_depth, limit)


@app.get("/api/v1/workspaces/{workspace_id}/entities/{entity_id}/evidence")
def evidence(workspace_id: str, entity_id: str, request: Request,
             limit: int = Query(50, ge=1, le=100),
             user: Principal = Depends(require("READ_EVIDENCE"))):
    repo = repository(request, user, workspace_id)
    if repo.get_entity(entity_id) is None:
        raise HTTPException(404, "Entity not found")
    return repo.evidence(entity_id, limit)


@app.get("/api/v1/workspaces/{workspace_id}/entities/{entity_id}/history")
def history(workspace_id: str, entity_id: str, request: Request,
            limit: int = Query(50, ge=1, le=100),
            user: Principal = Depends(require("READ_GRAPH"))):
    repo = repository(request, user, workspace_id)
    if repo.get_entity_history(entity_id) is None:
        raise HTTPException(404, "Entity not found")
    return repo.neighborhood(entity_id, limit, True)


@app.get("/api/v1/workspaces/{workspace_id}/entities/{entity_id}/assertions")
def assertions(workspace_id: str, entity_id: str, request: Request,
               limit: int = Query(50, ge=1, le=100),
               user: Principal = Depends(require("READ_EVIDENCE"))):
    repo = repository(request, user, workspace_id)
    if repo.get_entity_history(entity_id) is None:
        raise HTTPException(404, "Entity not found")
    return repo.assertions(entity_id, limit)


@app.get("/api/v1/workspaces/{workspace_id}/graph-revision")
def graph_revision(workspace_id: str, request: Request,
                   user: Principal = Depends(require("READ_GRAPH"))):
    return {"revision": repository(request, user, workspace_id).graph_revision()}


@app.get("/api/v1/workspaces/{workspace_id}/sources")
def sources(workspace_id: str, request: Request, limit: int = Query(50, ge=1, le=100),
            user: Principal = Depends(require("READ_EVIDENCE"))):
    return repository(request, user, workspace_id).sources(limit)


class InvestigationRequestBody(BaseModel):
    objective: str
    selected_source_ids: list[str] = []
    entity_id: str | None = None
    project_id: str | None = None


@app.post("/api/v1/workspaces/{workspace_id}/investigations")
async def investigate(workspace_id: str, body: InvestigationRequestBody, request: Request,
                      user: Principal = Depends(require("EXECUTE_TOOL"))):
    """Stage 11 (ND-11A) scoped entry point: ``objective`` (free text) and
    ``selected_source_ids`` come from the request body, but the acting
    principal is always the server-derived, already-authenticated ``user``
    from ``Depends(require(...))`` — never a caller-supplied identity. The
    effective run scope (selected ∩ authorized) is computed by
    ``run_scoped_investigation`` itself; an empty scope comes back as a
    ``BLOCKED`` result rather than running unscoped."""
    if workspace_id not in user.workspaces:
        raise HTTPException(404, "Workspace not available")
    if body.project_id and user.tenant_id == NEXUS_TENANT_ID:
        summary = nexus_session(request, user)
        if body.project_id not in summary["project_ids"]:
            raise HTTPException(404, "Project not available")
    model_gateway = getattr(request.app.state, "model_gateway", None)
    if model_gateway is None:
        raise HTTPException(503, "Model gateway is not configured for this deployment")
    result = await run_scoped_investigation(
        objective=body.objective, selected_source_ids=tuple(body.selected_source_ids), principal=user,
        workspace_id=workspace_id, run_id=str(uuid.uuid4()), graph_store=request.app.state.graph_store,
        model_gateway=model_gateway, tool_registry=request.app.state.tool_registry,
        tool_executor=request.app.state.tool_executor, skill_registry=request.app.state.skill_registry,
        authority_rules=request.app.state.authority_rules, entity_id=body.entity_id,
        project_id=body.project_id,
    )
    if result.selected_source_ids and result.status.value != "BLOCKED":
        from backend.app.resolution import enrich_resolution
        from backend.app.security import AuthorizationContext
        from backend.app.agent.tool_bridge import refresh_authorization
        from backend.app.tools.graph_tools import _repository
        auth = AuthorizationContext(principal=user,tenant_id=user.tenant_id,workspace_id=workspace_id,
            task_id=result.run_id,permissions=user.permissions,selected_source_ids=result.selected_source_ids,
            project_id=body.project_id)
        auth = refresh_authorization(auth,request.app.state.tool_executor)
        try:
            result = enrich_resolution(result, _repository(auth,request.app.state.tool_executor.dependencies))
        except Exception:
            result = result.model_copy(update={"resolution_status":"UNAVAILABLE",
                "source_coverage_limitations":(*result.source_coverage_limitations,
                                               "Problem and ownership evaluation was unavailable; no automatic task was created.")})
    if user.permits("READ_EVIDENCE"):
        try:
            result = _authorized_report({"selected_source_ids": result.selected_source_ids,
                                         "result_json": result.model_dump(mode="json")}, request, user, workspace_id)
        except HTTPException as exc:
            if exc.status_code != 404:
                raise
            from backend.app.agent.contracts import InvestigationStatus
            result = InvestigationResult(run_id=result.run_id, status=InvestigationStatus.BLOCKED,
                summary="Investigation access changed; report content is unavailable.",
                verification_status="SOURCE_RESTRICTED", model_usage=result.model_usage)
    report_store = getattr(request.app.state, "investigation_store", None)
    if report_store is not None:
        result = result.model_copy(update={"persistence_status": "PERSISTED"})
        try:
            report_store.save_report(result=result, tenant_id=user.tenant_id, workspace_id=workspace_id,
                                     principal_subject=user.subject, objective=body.objective,
                                     selected_source_ids=result.selected_source_ids)
        except Exception:
            result = result.model_copy(update={"persistence_status": "FAILED",
                "source_coverage_limitations": (*result.source_coverage_limitations,
                                                "Report persistence failed; this result is session-only.")})
        else:
            try:
                from backend.app.task_service import create_tasks
                result = create_tasks(result,user,workspace_id,report_store,request.app.state.graph_store,
                                      getattr(request.app.state,"governance_store",None))
            except Exception:
                result = result.model_copy(update={"resolution_status":"UNAVAILABLE",
                    "source_coverage_limitations":(*result.source_coverage_limitations,
                        "The report was saved, but task creation did not finish. Review Tasks for completed assignments before retrying.")})
    return result.model_dump(mode="json")


def _owned_report_rows(request: Request, user: Principal, workspace_id: str, run_id: str | None = None):
    if workspace_id not in user.workspaces:
        raise HTTPException(404, "Investigation not available")
    store = getattr(request.app.state, "investigation_store", None)
    if store is None:
        raise HTTPException(503, "Investigation persistence is unavailable")
    return store.owned_reports(tenant_id=user.tenant_id, workspace_id=workspace_id,
                               principal_subject=user.subject, run_id=run_id)


def _authorized_report(row, request: Request, user: Principal, workspace_id: str):
    from backend.app.governance.identity import refresh_principal_source_ids
    governance = getattr(request.app.state, "governance_store", None)
    current = refresh_principal_source_ids(user, governance) if governance is not None else user
    scope = authorized_source_ids_for(current)
    if not current.permits("READ_GRAPH") or not current.permits("READ_EVIDENCE"):
        raise HTTPException(404, "Investigation not available")
    selection = frozenset(row["selected_source_ids"])
    if scope is not None and not selection <= scope:
        raise HTTPException(404, "Investigation not available")
    if current.source_ids and not selection <= frozenset(current.source_ids):
        raise HTTPException(404, "Investigation not available")
    result = InvestigationResult.model_validate(row["result_json"])
    if governance is not None:
        from backend.app.governance.identity import investigation_read_principal
        readable = investigation_read_principal(current, tuple(selection), result.project_id, governance)
        if not readable.permits("READ_GRAPH") or not selection <= frozenset(readable.source_ids):
            raise HTTPException(404, "Investigation not available")
    if not result.evidence_registry:
        return result
    repo = repository(request, current, workspace_id)
    for evidence in result.evidence_registry:
        _require_nexus_action(request, current, evidence.source_id, "READ")
        if evidence.run_id != result.run_id or evidence.source_id not in selection or (
                repo.source_record(evidence.source_id, evidence.record_id, include_history=evidence.include_history) is None):
            raise HTTPException(404, "Investigation not available")
        if evidence.kind == "GRAPH_RELATIONSHIP":
            edge = json.loads(evidence.excerpt)
            if repo.relationship(edge["id"], include_history=evidence.include_history) is None:
                # Missing and no-longer-authorized edges are deliberately indistinguishable.
                raise HTTPException(404, "Investigation not available")
    from backend.app.agent.verifier import verify_snapshots, snapshots_accessible
    if not snapshots_accessible({item.evidence_id: item for item in result.evidence_registry}, repo):
        raise HTTPException(404, "Investigation not available")
    paths = tuple({"nodes": finding.entity_ids, "relationships": finding.relationship_ids}
                  for finding in result.structured_findings if finding.claim_type == "GRAPH_PATH")
    rechecked = verify_snapshots({item.evidence_id: item for item in result.evidence_registry}, repo, paths)
    findings = (*rechecked, *(finding for finding in result.structured_findings
                              if finding.claim_type not in ("GRAPH_RELATIONSHIP", "GRAPH_PATH")))
    counts = {}
    for finding in findings:
        counts[finding.verification_status] = counts.get(finding.verification_status, 0) + 1
    entities = set(result.entity_ids) | {entity for finding in rechecked for entity in finding.entity_ids}
    return result.model_copy(update={"structured_findings": findings, "verification_summary": counts,
        "entity_ids": tuple(sorted(entities)),
        "verification_status": "PARTIALLY_VERIFIED" if counts.get("SUPPORTED") else "UNVERIFIED"})


@app.get("/api/v1/workspaces/{workspace_id}/investigations")
def list_investigations(workspace_id: str, request: Request,
                       user: Principal = Depends(require("READ_GRAPH"))):
    items = []
    for row in _owned_report_rows(request, user, workspace_id):
        try:
            result = _authorized_report(row, request, user, workspace_id)
        except HTTPException as exc:
            if exc.status_code == 404:
                continue
            raise
        items.append({"run_id": result.run_id, "objective": row["objective"],
                      "status": result.status, "created_at": row["created_at"],
                      "project_id": result.project_id})
    return {"items": items}


@app.get("/api/v1/workspaces/{workspace_id}/investigations/{run_id}")
def get_investigation(workspace_id: str, run_id: str, request: Request,
                      user: Principal = Depends(require("READ_GRAPH"))):
    rows = _owned_report_rows(request, user, workspace_id, run_id)
    if not rows:
        store = request.app.state.investigation_store
        from backend.app.task_service import live_principal
        current = live_principal(user,getattr(request.app.state,"governance_store",None))
        if "MANAGE_TASKS" in current.permissions:
            row = store.task_report(user.tenant_id,workspace_id,run_id)
            if row:
                rows = [row]
        for task_row in store.tasks_for_investigation(user.tenant_id,workspace_id,run_id):
            try:
                from backend.app.task_service import visible_task
                visible_task(task_row,user,request.app.state.graph_store,getattr(request.app.state,"governance_store",None))
            except PermissionError:
                continue
            row = store.task_report(user.tenant_id,workspace_id,run_id)
            if row:
                rows = [row]
            break
        if not rows:
            raise HTTPException(404, "Investigation not available")
    result = _authorized_report(rows[0], request, user, workspace_id)
    tasks = request.app.state.investigation_store.tasks_for_investigation(user.tenant_id,workspace_id,run_id)
    linked = {row["task_json"]["finding"]["problem_id"]:row["task_id"] for row in tasks}
    result = result.model_copy(update={"actionable_findings":tuple(problem.model_copy(
        update={"task_id":linked.get(problem.problem_id)}) for problem in result.actionable_findings),
        "resolution_status":"TASKS_CREATED" if linked else "REVIEW_REQUIRED" if result.actionable_findings else
            result.resolution_status if result.resolution_status in ("NOT_EVALUATED","UNAVAILABLE") else "NO_VERIFIED_PROBLEM"})
    return {**result.model_dump(mode="json"),"objective":rows[0]["objective"],"created_at":rows[0]["created_at"]}


@app.get("/api/v1/workspaces/{workspace_id}/investigations/{run_id}/evidence/{evidence_id}")
def investigation_evidence(workspace_id: str, run_id: str, evidence_id: str, request: Request,
                           user: Principal = Depends(require("READ_EVIDENCE"))):
    result = get_investigation(workspace_id, run_id, request, user)
    for evidence in result["evidence_registry"]:
        if evidence["evidence_id"] == evidence_id:
            return evidence
    raise HTTPException(404, "Evidence not available")


def _task_store(request, user, workspace_id):
    if workspace_id not in user.workspaces:
        raise HTTPException(404,"Workspace not available")
    store = getattr(request.app.state,"investigation_store",None)
    if store is None:
        raise HTTPException(503,"Task persistence is not configured")
    return store


def _visible_task(request, user, row):
    from backend.app.task_service import visible_task
    try:
        return visible_task(row,user,request.app.state.graph_store,getattr(request.app.state,"governance_store",None))
    except (PermissionError,ValueError):
        raise HTTPException(404,"Task not available")


@app.get("/api/v1/workspaces/{workspace_id}/tasks")
def list_tasks(workspace_id: str, request: Request, project_id: str | None = None,
               team_id: str | None = None, status: str | None = None,
               user: Principal = Depends(require("READ_GRAPH"))):
    store = _task_store(request,user,workspace_id)
    items = []
    for row in store.resolution_tasks(user.tenant_id,workspace_id):
        try:
            task,_,current,_ = _visible_task(request,user,row)
        except HTTPException:
            continue
        if project_id and task.project_id != project_id or team_id and team_id != task.primary_team_id or status and status != task.status:
            continue
        items.append(task.model_dump(mode="json"))
    return {"items":items}


@app.get("/api/v1/workspaces/{workspace_id}/tasks/{task_id}")
def get_task(workspace_id: str, task_id: str, request: Request,
             user: Principal = Depends(require("READ_GRAPH"))):
    store = _task_store(request,user,workspace_id)
    rows = store.resolution_tasks(user.tenant_id,workspace_id,task_id)
    if not rows:
        raise HTTPException(404,"Task not available")
    task,evidence,current,repo = _visible_task(request,user,rows[0])
    from backend.app.task_service import permitted_transitions,task_repository
    candidates = []
    assignees = []
    if "MANAGE_TASKS" in current.permissions:
        scope = rows[0].get("scope_json") or sorted({item.source_id for item in evidence})
        try:
            _,owner_repo = task_repository(current,workspace_id,scope,request.app.state.graph_store,
                                           getattr(request.app.state,"governance_store",None))
        except PermissionError:
            owner_repo = repo
        page = owner_repo.neighborhood(task.service_id,limit=100)
        names = {node.id:node.name or node.id for node in page.nodes if node.type=="TEAM"}
        candidates = [{"team_id":identifier,"team_name":names[identifier]} for identifier in sorted({
            edge.source_id for edge in page.relationships if edge.type=="OWNS" and edge.target_id==task.service_id
            and edge.source_id in names and edge.origin in ("source_asserted","observed")})]
        governance = getattr(request.app.state,"governance_store",None)
        if governance is not None:
            from backend.app.task_service import recipients_for
            for candidate in candidates:
                proposed = task.model_copy(update={"primary_team_id":candidate["team_id"]})
                members = governance.read("""SELECT m.employee_id,e.display_name FROM nexus_team_memberships m
                    JOIN nexus_employees e ON e.employee_id=m.employee_id AND e.tenant_id=m.tenant_id
                    WHERE m.tenant_id=%s AND m.team_id=%s""", (current.tenant_id,candidate["team_id"]))
                for member in members:
                    subject = f"nexus:{member['employee_id']}"
                    eligible = recipients_for(proposed.model_copy(update={"assigned_subject":subject}),evidence,current,
                        workspace_id,request.app.state.graph_store,governance)
                    if subject in eligible:
                        assignees.append({"subject":subject,"name":member["display_name"],"team_id":candidate["team_id"]})
    return {"task":task.model_dump(mode="json"),"evidence":[item.model_dump(mode="json") for item in evidence],
            "history":store.resolution_history(task_id),"allowed_transitions":permitted_transitions(task,current),
            "can_assign":"MANAGE_TASKS" in current.permissions,"assignment_candidates":candidates,
            "assignee_candidates":assignees}


class TaskUpdateBody(BaseModel):
    status: str | None = None
    primary_team_id: str | None = None
    assigned_subject: str | None = None
    reason: str = Field(min_length=3,max_length=2000)


@app.get("/api/v1/workspaces/{workspace_id}/tasks/{task_id}/evidence/{evidence_id}")
def task_evidence(workspace_id: str, task_id: str, evidence_id: str, request: Request,
                  user: Principal = Depends(require("READ_EVIDENCE"))):
    store = _task_store(request,user,workspace_id)
    rows = store.resolution_tasks(user.tenant_id,workspace_id,task_id)
    if not rows:
        raise HTTPException(404,"Evidence not available")
    _,evidence,_,_ = _visible_task(request,user,rows[0])
    for item in evidence:
        if item.evidence_id==evidence_id:
            return item.model_dump(mode="json")
    raise HTTPException(404,"Evidence not available")


@app.post("/api/v1/workspaces/{workspace_id}/tasks/{task_id}/updates")
def update_task(workspace_id: str, task_id: str, body: TaskUpdateBody, request: Request,
                user: Principal = Depends(require("READ_GRAPH"))):
    from backend.app.resolution_models import TaskStatus
    from backend.app.task_service import permitted_transitions, recipients_for, task_repository
    from backend.app.resolution import problem_resolved
    from backend.app.security import Permission
    store = _task_store(request,user,workspace_id)
    def change(old,row):
        _,evidence,current,repo = _visible_task(request,user,row)
        update,recipients = {},()
        manager = Permission.MANAGE_TASKS in current.permissions
        if body.primary_team_id is not None or body.assigned_subject is not None:
            if not manager:
                raise HTTPException(403,"Task assignment permission required")
            if old.status in (TaskStatus.VERIFIED,TaskStatus.CLOSED):
                raise HTTPException(409,"Verified or closed tasks cannot be reassigned without reopening the work")
            team = body.primary_team_id or old.primary_team_id
            if not team:
                raise HTTPException(409,"Choose a current source-backed responsible team first")
            scope = row.get("scope_json") or sorted({item.source_id for item in evidence})
            try:
                _,repo = task_repository(current,workspace_id,scope,request.app.state.graph_store,
                                        getattr(request.app.state,"governance_store",None))
            except PermissionError:
                raise HTTPException(403,"Current access to the assignment evidence is required")
            entity = repo.get_entity(team)
            if entity is None or entity.type != "TEAM":
                raise HTTPException(409,"Responsible team is no longer available")
            current_ownership = repo.neighborhood(old.service_id,limit=100)
            if not any(edge.type=="OWNS" and edge.source_id==team and edge.target_id==old.service_id
                       and edge.origin in ("source_asserted","observed") for edge in current_ownership.relationships):
                raise HTTPException(409,"This team no longer has current service ownership evidence")
            owner_source = next(edge.source_id_ref for edge in current_ownership.relationships
                if edge.type=="OWNS" and edge.source_id==team and edge.target_id==old.service_id
                and edge.origin in ("source_asserted","observed"))
            context = next((context for context in store.assignment_contexts(user.tenant_id,workspace_id,task_id)
                            if owner_source in context["selected_source_ids"]),None)
            if context is None:
                raise HTTPException(409,"Ownership evidence needs a linked investigation with that source selected")
            scope = context["selected_source_ids"]
            current,repo = task_repository(current,workspace_id,scope,request.app.state.graph_store,
                                          getattr(request.app.state,"governance_store",None))
            if Permission.MANAGE_TASKS not in current.permissions:
                raise HTTPException(403,"Task assignment permission is no longer available")
            entity = repo.get_entity(team)
            current_ownership = repo.neighborhood(old.service_id,limit=100)
            from backend.app.agent.provenance import capture
            registry = {item.evidence_id:item for item in evidence}
            direct = [edge for edge in current_ownership.relationships if edge.type=="OWNS"
                      and edge.source_id==team and edge.target_id==old.service_id
                      and edge.origin in ("source_asserted","observed")]
            if entity is None or not direct:
                raise HTTPException(409,"Current ownership could not be revalidated in the linked investigation scope")
            refs = capture(context["run_id"],"resolution.assignment",
                {"entity":entity.model_dump(mode="json"),"relationships":[edge.model_dump(mode="json") for edge in direct]},
                repo.graph_revision(),frozenset(scope),registry)
            decision = old.finding.ownership.model_copy(update={"primary_team_id":team,
                "primary_team_name":entity.name or team,"candidate_team_ids":tuple(sorted(set((*old.finding.ownership.candidate_team_ids,team)))),
                "evidence_ids":tuple(dict.fromkeys((*old.finding.ownership.evidence_ids,*refs))),
                "status":"VERIFIED","explanation":"Administrator selected a current directly evidenced service owner."})
            evidence = tuple(registry.values())
            row["evidence_json"] = [item.model_dump(mode="json") for item in evidence]
            update.update(primary_team_id=team,primary_team_name=entity.name or team,
                assignment_reason=body.reason,assignment_version=old.assignment_version+1,
                assigned_subject=(body.assigned_subject or None) if body.assigned_subject is not None else old.assigned_subject,
                evidence_ids=tuple(registry),finding=old.finding.model_copy(update={"ownership":decision}))
            if team==old.primary_team_id and update["assigned_subject"]==old.assigned_subject and old.status!=TaskStatus.OPEN:
                if body.status is None:
                    raise HTTPException(409,"This assignment is unchanged; no duplicate notification was created")
                update = {"evidence_ids":tuple(registry),"finding":old.finding.model_copy(update={"ownership":decision})}
            if old.status == TaskStatus.OPEN:
                update["status"] = TaskStatus.ASSIGNED
        if body.status is not None:
            try:
                desired = TaskStatus(body.status)
            except ValueError:
                raise HTTPException(422,"Unknown task status")
            if desired not in permitted_transitions(old,current):
                raise HTTPException(409,"This task transition is not permitted")
            if desired == TaskStatus.ASSIGNED and not update.get("primary_team_id",old.primary_team_id):
                raise HTTPException(409,"Choose an evidenced responsible team first")
            if desired == TaskStatus.VERIFIED:
                scope = row.get("scope_json") or sorted({item.source_id for item in evidence})
                try:
                    current,repo = task_repository(current,workspace_id,scope,request.app.state.graph_store,
                                                  getattr(request.app.state,"governance_store",None))
                except PermissionError:
                    raise HTTPException(409,"Independent verification needs access to all selected investigation sources")
                manager = Permission.MANAGE_TASKS in current.permissions
                if not manager or not problem_resolved(old,repo):
                    raise HTTPException(409,"Independent verification still finds the problem or lacks current evidence")
                update["resolution_verification"] = "VERIFIED"
            elif desired == TaskStatus.IN_PROGRESS:
                update["resolution_verification"] = "NOT_CHECKED"
            update["status"] = desired
        if not update:
            raise HTTPException(422,"Choose a status or assignment change")
        task = old.model_copy(update=update)
        if "assignment_version" in update:
            recipients = recipients_for(task,evidence,current,workspace_id,request.app.state.graph_store,
                                        getattr(request.app.state,"governance_store",None))
            if task.assigned_subject and task.assigned_subject not in recipients:
                raise HTTPException(409,"The selected person lacks current access to this task")
        return task,{"from_status":old.status.value,"to_status":task.status.value,
                     "team_id":task.primary_team_id,"reason":body.reason,
                     "assigned_subject":task.assigned_subject,
                     "assignment_evidence_ids":list(set(task.evidence_ids)-set(old.evidence_ids)),
                     "resolution_verification":task.resolution_verification},recipients
    try:
        task = store.change_resolution_task(tenant_id=user.tenant_id,workspace_id=workspace_id,
                                           task_id=task_id,actor=user.subject,change=change)
    except LookupError:
        raise HTTPException(404,"Task not available")
    return task.model_dump(mode="json")


@app.get("/api/v1/workspaces/{workspace_id}/notifications")
def task_notifications(workspace_id: str, request: Request,
                       user: Principal = Depends(require("READ_GRAPH"))):
    store = _task_store(request,user,workspace_id)
    items = []
    for notification in store.resolution_notifications(user.tenant_id,workspace_id,user.subject):
        rows = store.resolution_tasks(user.tenant_id,workspace_id,notification["task_id"])
        if not rows:
            continue
        try:
            task,_,_,_ = _visible_task(request,user,rows[0])
        except HTTPException:
            continue
        items.append({**notification,"title":task.title,"team_id":task.primary_team_id,
                      "team_name":task.primary_team_name,"priority":task.priority,"project_id":task.project_id})
    return {"items":items,"unread":sum(item["read_at"] is None for item in items)}


@app.post("/api/v1/workspaces/{workspace_id}/notifications/{notification_id}/read")
def read_task_notification(workspace_id: str, notification_id: str, request: Request,
                           user: Principal = Depends(require("READ_GRAPH"))):
    store = _task_store(request,user,workspace_id)
    permitted = task_notifications(workspace_id,request,user)["items"]
    if not any(item["notification_id"]==notification_id for item in permitted):
        raise HTTPException(404,"Notification not available")
    store.read_resolution_notification(user.tenant_id,workspace_id,user.subject,notification_id)
    return {"status":"READ"}


@app.post("/api/v1/workspaces/{workspace_id}/investigations/{run_id}/tasks")
def generate_tasks(workspace_id: str, run_id: str, request: Request,
                   user: Principal = Depends(require("MANAGE_TASKS"))):
    from backend.app.task_service import create_tasks
    store = _task_store(request,user,workspace_id)
    result = InvestigationResult.model_validate(get_investigation(workspace_id,run_id,request,user))
    updated = create_tasks(result,user,workspace_id,store,request.app.state.graph_store,
                           getattr(request.app.state,"governance_store",None))
    return updated.model_dump(mode="json")


@app.get("/api/v1/nexus/session")
def nexus_session(request: Request, user: Principal = Depends(principal)):
    # Static local-demo session. No governance/PostgreSQL query needed.
    if isolated_demo_mode_enabled():
        local_auth = request.headers.get("authorization", "")
        local_token = local_auth.split(" ", 1)[1].strip() if " " in local_auth else ""
        local_user = demo_user_for_token(local_token)
        if local_user is not None and user.subject == f"nexus:{local_user.employee_id}" and user.tenant_id == NEXUS_TENANT_ID:
            return local_user.session_summary()
    governance_store = getattr(request.app.state, "governance_store", None)
    if governance_store is None or not user.subject.startswith("nexus:"):
        raise HTTPException(404, "Not a NEXUS demo identity")
    # Re-deriving from the bearer token (not trusting `user.subject` as a
    # lookup key) keeps this endpoint honest about what actually
    # authenticated the caller.
    authorization = request.headers.get("authorization", "")
    token = authorization.split(" ", 1)[1].strip() if " " in authorization else ""
    summary = nexus_identity_summary(token, governance_store, demo_mode_enabled=isolated_demo_mode_enabled())
    if summary is None:
        raise HTTPException(404, "Not a NEXUS demo identity")
    return summary


@app.get("/api/v1/nexus/demo-identities")
def nexus_demo_identities():
    """Public, demo-mode-gated listing of the fixed judge-facing demo
    identities (name/role/project), derived live from
    ``demo_user_for_token`` so it can never drift from the actual backend
    configuration. Deliberately unauthenticated -- it must render on the
    login screen before any token is entered -- and returns nothing unless
    GRAPH_HACKS_NEXUS_DEMO_MODE is enabled."""
    if not isolated_demo_mode_enabled():
        raise HTTPException(404, "Demo mode not enabled")

    def card(token: str, project_id: str | None):
        local_user = demo_user_for_token(token)
        if local_user is None:
            return None
        return {
            "token": token,
            "display_name": local_user.display_name,
            "role_code": local_user.role_code,
            "project_id": project_id,
        }

    items = [card("4", None), card("dev-02-pay", "NEX-PRJ-PAY"), card("intern-10-com", "NEX-PRJ-COM")]
    return {"items": [item for item in items if item is not None]}


@app.get("/api/v1/nexus/sources")
def nexus_sources(request: Request, user: Principal = Depends(principal)):
    governance_store = getattr(request.app.state, "governance_store", None)
    if governance_store is None:
        return {"items": []}
    if not user.source_ids:
        return {"items": []}
    rows = governance_store.read("""
        SELECT source_id, stage, classification, owner_project_id FROM nexus_sources
        WHERE source_id = ANY(%s)
        ORDER BY source_id
        """, (list(user.source_ids),))
    return {"items": rows}


_NEXUS_COMPANY_ID = "nexus"


class AccessRequestBody(BaseModel):
    resource_id: str
    requested_actions: list[str] = []
    justification: str
    requested_project_id: str | None = None
    requested_duration_hours: float | None = None


class ApproveAccessRequestBody(BaseModel):
    approved_resource_id: str | None = None
    approved_actions: list[str] | None = None
    approved_project_id: str | None = None
    approved_duration_hours: float | None = None


class DenyAccessRequestBody(BaseModel):
    reason: str | None = None


class RevokeGrantBody(BaseModel):
    reason: str | None = None


def _nexus_employee_id(user: Principal) -> str:
    return user.subject.removeprefix("nexus:")


@app.post("/api/v1/nexus/access-requests")
def nexus_create_access_request(body: AccessRequestBody, request: Request,
                                user: Principal = Depends(principal)):
    governance_store = getattr(request.app.state, "governance_store", None)
    if governance_store is None:
        raise HTTPException(404, "NEXUS governance store not available")
    try:
        return create_access_request(
            governance_store, requester_employee_id=_nexus_employee_id(user),
            company_id=_NEXUS_COMPANY_ID, resource_id=body.resource_id,
            requested_actions=body.requested_actions, justification=body.justification,
            requested_project_id=body.requested_project_id,
            requested_duration_hours=body.requested_duration_hours)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.get("/api/v1/nexus/access-requests/mine")
def nexus_my_access_requests(request: Request, user: Principal = Depends(principal)):
    governance_store = getattr(request.app.state, "governance_store", None)
    if governance_store is None:
        return {"items": []}
    items = list_requests_for_employee(
        governance_store, employee_id=_nexus_employee_id(user), company_id=_NEXUS_COMPANY_ID)
    return {"items": items}


@app.get("/api/v1/nexus/access-requests/pending")
def nexus_pending_access_requests(request: Request, user: Principal = Depends(require("ADMIN"))):
    governance_store = getattr(request.app.state, "governance_store", None)
    if governance_store is None:
        return {"items": []}
    items = list_pending_requests(governance_store, company_id=_NEXUS_COMPANY_ID)
    return {"items": items}


@app.post("/api/v1/nexus/access-requests/{request_id}/approve")
def nexus_approve_access_request(request_id: str, body: ApproveAccessRequestBody, request: Request,
                                 user: Principal = Depends(require("ADMIN"))):
    governance_store = getattr(request.app.state, "governance_store", None)
    if governance_store is None:
        raise HTTPException(404, "NEXUS governance store not available")
    try:
        return approve_request(
            governance_store, request_id=request_id, company_id=_NEXUS_COMPANY_ID,
            approver_employee_id=_nexus_employee_id(user),
            approved_resource_id=body.approved_resource_id, approved_actions=body.approved_actions,
            approved_project_id=body.approved_project_id,
            approved_duration_hours=body.approved_duration_hours)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/v1/nexus/access-requests/{request_id}/deny")
def nexus_deny_access_request(request_id: str, body: DenyAccessRequestBody, request: Request,
                              user: Principal = Depends(require("ADMIN"))):
    governance_store = getattr(request.app.state, "governance_store", None)
    if governance_store is None:
        raise HTTPException(404, "NEXUS governance store not available")
    try:
        return deny_request(
            governance_store, request_id=request_id, company_id=_NEXUS_COMPANY_ID,
            approver_employee_id=_nexus_employee_id(user), reason=body.reason)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/v1/nexus/grants/{grant_id}/revoke")
def nexus_revoke_grant(grant_id: str, body: RevokeGrantBody, request: Request,
                       user: Principal = Depends(require("ADMIN"))):
    governance_store = getattr(request.app.state, "governance_store", None)
    if governance_store is None:
        raise HTTPException(404, "NEXUS governance store not available")
    try:
        return revoke_grant(
            governance_store, grant_id=grant_id, company_id=_NEXUS_COMPANY_ID,
            approver_employee_id=_nexus_employee_id(user), reason=body.reason)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.get("/api/v1/nexus/grants/active")
def nexus_active_grants(request: Request, user: Principal = Depends(require("ADMIN"))):
    governance_store = getattr(request.app.state, "governance_store", None)
    if governance_store is None:
        return {"items": []}
    return {"items": list_active_grants(governance_store, company_id=_NEXUS_COMPANY_ID)}


@app.get("/api/v1/nexus/authorization-scope")
def nexus_authorization_scope(request: Request, user: Principal = Depends(principal)):
    governance_store = getattr(request.app.state, "governance_store", None)
    if governance_store is None:
        raise HTTPException(404, "NEXUS governance store not available")
    return get_authorization_scope(
        governance_store, employee_id=_nexus_employee_id(user), company_id=_NEXUS_COMPANY_ID)


def _require_nexus_action(request: Request, user: Principal, resource_id: str, action: str) -> None:
    """Action-level authorization boundary (Stage 09 gap-fix), shared with the
    agent-tool execution path's equivalent decision
    (``backend.app.governance.identity.authorized_actions_for``). A source-id
    level grant (``permits_source``) is necessary but no longer sufficient: a
    grant approved for a narrower action set than ``action`` (e.g. READ-only)
    must not authorize this call. No-op for non-NEXUS principals or when no
    governance store is configured, preserving prior behavior exactly for
    every caller this change was never meant to affect."""
    if user.tenant_id != NEXUS_TENANT_ID or not user.subject.startswith("nexus:"):
        return
    governance_store = getattr(request.app.state, "governance_store", None)
    if governance_store is None:
        return
    if not principal_authorizes_action(user, resource_id, action, governance_store):
        raise HTTPException(403, "Action not authorized for this resource")


@app.get("/api/v1/workspaces/{workspace_id}/records/{source_id}/{record_id:path}")
def source_record(workspace_id: str, source_id: str, record_id: str, request: Request,
                  user: Principal = Depends(require("READ_EVIDENCE"))):
    _require_nexus_action(request, user, source_id, "READ")
    result = repository(request, user, workspace_id).source_record(source_id, record_id)
    if result is None:
        raise HTTPException(404, "Source record not found")
    return result
