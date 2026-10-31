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

from backend.app.config import Settings
from backend.app.graph.authority import AuthorityRule
from backend.app.graph.driver import Neo4jStore
from backend.app.graph.models import SourceRecordInput
from backend.app.graph.repository import GraphRepository
from backend.app.ingestion.local_json import LocalImport, normalize
from backend.app.ingestion.github_public import GitHubImport, fetch_public_pull_requests, normalize_pull_request
from backend.app.security import Principal


def principal_from_token(token: str) -> Principal | None:
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
        return None


def principal(authorization: str | None = Header(default=None)) -> Principal:
    parts = authorization.split(" ", 1) if authorization else []
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(401, "Bearer token required")
    found = principal_from_token(parts[1].strip())
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
    return GraphRepository(request.app.state.graph_store, user.tenant_id, workspace_id,
                           user.subject, "ADMIN" in user.permissions,
                           user.permits("READ_EVIDENCE"),
                           authority_rules=request.app.state.authority_rules)


@asynccontextmanager
async def lifespan(app: FastAPI):
    store = Neo4jStore(Settings.from_env())
    try:
        store.start()
        app.state.graph_store = store
        app.state.authority_rules = load_authority_rules()
        yield
    finally:
        store.close()


app = FastAPI(title="GraphHacks Graph API", version="1.1.0", lifespan=lifespan)
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


@app.get("/api/v1/workspaces/{workspace_id}/records/{source_id}/{record_id:path}")
def source_record(workspace_id: str, source_id: str, record_id: str, request: Request,
                  user: Principal = Depends(require("READ_EVIDENCE"))):
    result = repository(request, user, workspace_id).source_record(source_id, record_id)
    if result is None:
        raise HTTPException(404, "Source record not found")
    return result
