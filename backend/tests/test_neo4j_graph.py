from __future__ import annotations

import os
import secrets
import socket
import subprocess
import time
import uuid
from datetime import datetime, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from neo4j.exceptions import Neo4jError
from neo4j.exceptions import ServiceUnavailable
from neo4j import GraphDatabase

from backend.app.main import app
from backend.app.config import Settings
from backend.app.graph.driver import Neo4jStore


def _name() -> str:
    return uuid.uuid4().hex


@pytest.fixture
def graph(monkeypatch, isolated_neo4j):
    uri, password = isolated_neo4j
    tenant, workspace, other = _name(), _name(), _name()
    monkeypatch.setenv("NEO4J_URI", uri)
    monkeypatch.setenv("NEO4J_USER", "neo4j")
    monkeypatch.setenv("NEO4J_PASSWORD", password)
    monkeypatch.setenv("GRAPH_HACKS_API_PRINCIPALS_JSON", __import__("json").dumps({
        "writer": {"subject": "writer", "tenant_id": tenant, "workspaces": [workspace, other],
                   "source_ids": ["one", "two", "github"], "permissions": ["READ_GRAPH", "READ_EVIDENCE", "MANAGE_INGESTION"]},
        "reader": {"subject": "reader", "tenant_id": tenant, "workspaces": [workspace],
                   "permissions": ["READ_GRAPH", "READ_EVIDENCE"]},
        "graph": {"subject": "graph", "tenant_id": tenant, "workspaces": [workspace],
                  "permissions": ["READ_GRAPH"]},
        "elsewhere": {"subject": "elsewhere", "tenant_id": _name(), "workspaces": [workspace],
                      "permissions": ["READ_GRAPH"]},
    }))
    with TestClient(app) as client:
        yield client, workspace, other


@pytest.fixture(scope="session")
def isolated_neo4j():
    uri = os.getenv("GRAPH_HACKS_TEST_NEO4J_URI")
    password = os.getenv("GRAPH_HACKS_TEST_NEO4J_PASSWORD")
    if uri and password:
        yield uri, password
        return
    suffix = _name()[:12]
    container = f"gh-neo4j-test-{suffix}"
    volume = f"gh-neo4j-test-data-{suffix}"
    password = secrets.token_urlsafe(24)
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    uri = f"bolt://127.0.0.1:{port}"
    try:
        subprocess.run(["docker", "run", "-d", "--name", container,
                        "-p", f"127.0.0.1:{port}:7687",
                        "-e", f"NEO4J_AUTH=neo4j/{password}",
                        "-v", f"{volume}:/data", "neo4j:5.26.32-community"],
                       check=True, stdout=subprocess.DEVNULL)
        driver = GraphDatabase.driver(uri, auth=("neo4j", password))
        for _ in range(60):
            try:
                driver.verify_connectivity()
                break
            except Exception:
                time.sleep(1)
        else:
            pytest.fail("Isolated Neo4j did not become ready")
        driver.close()
        yield uri, password
    finally:
        subprocess.run(["docker", "rm", "-f", container],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(["docker", "volume", "rm", volume],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def call(client, token: str, method: str, path: str, **kwargs):
    return client.request(method, path, headers={"Authorization": f"Bearer {token}"}, **kwargs)


def record(source: str, record_id: str, entity_id: str, name: str,
           *, canonical_id: str | None = None, acl: list[str] | None = None):
    return {"source_id": source, "record_id": record_id, "title": record_id,
            "acl_subjects": acl or [], "entities": [
                {"external_id": entity_id, "canonical_id": canonical_id,
                 "type": "PERSON", "name": name}
            ], "relationships": []}


def test_source_assertion_lifecycle_and_permissions(graph):
    client, workspace, _ = graph
    base = f"/api/v1/workspaces/{workspace}"
    canonical = f"person:{_name()}"
    first = record("one", _name(), "employee", "Engineer", canonical_id=canonical)
    second = record("two", _name(), "employee", "Lead", canonical_id=canonical, acl=["writer"])
    assert call(client, "writer", "POST", base + "/records", json=first).status_code == 200
    assert call(client, "writer", "POST", base + "/records", json=second).status_code == 200
    writer = call(client, "writer", "GET", base + f"/entities/{canonical}").json()
    assert writer["name"] is None
    assert writer["conflicts"]["name"] == ["Engineer", "Lead"]
    reader = call(client, "reader", "GET", base + f"/entities/{canonical}").json()
    assert reader["name"] == "Engineer"
    assert "Lead" not in str(reader)
    assert call(client, "writer", "DELETE", base + f"/records/two/{second['record_id']}").status_code == 200
    assert call(client, "writer", "GET", base + f"/entities/{canonical}").json()["name"] == "Engineer"
    first["entities"][0]["name"] = "Senior Engineer"
    assert call(client, "writer", "POST", base + "/records", json=first).status_code == 200
    assert call(client, "writer", "GET", base + f"/entities/{canonical}").json()["name"] == "Senior Engineer"
    assert call(client, "writer", "DELETE", base + f"/records/one/{first['record_id']}").status_code == 200
    assert call(client, "writer", "GET", base + f"/entities/{canonical}").status_code == 404
    assert call(client, "writer", "POST", base + "/records", json=second).status_code == 200
    assert call(client, "writer", "GET", base + f"/entities/{canonical}").json()["name"] == "Lead"


def test_search_pagination_and_scope(graph):
    client, workspace, other = graph
    base = f"/api/v1/workspaces/{workspace}"
    assert call(client, "writer", "GET", base + "/search", params={"q": "nothing"}).json()["items"] == []
    entities = [{"external_id": f"id-{n}", "type": "TASK", "name": f"Special $ value {n}"}
                for n in range(30)]
    payload = {"source_id": "one", "record_id": _name(), "title": "Search page",
               "entities": entities, "relationships": []}
    assert call(client, "writer", "POST", base + "/records", json=payload).status_code == 200
    first = call(client, "reader", "GET", base + "/search", params={"q": "$ value", "limit": 20})
    second = call(client, "reader", "GET", base + "/search",
                  params={"q": "$ value", "limit": 20, "offset": 20})
    assert first.status_code == 200 and second.status_code == 200
    assert len(first.json()["items"]) == 20 and first.json()["has_more"]
    assert len(second.json()["items"]) == 10 and not second.json()["has_more"]
    assert call(client, "reader", "GET", base + "/search", params={"q": "x", "offset": -1}).status_code == 422
    assert call(client, "elsewhere", "GET", base + "/search", params={"q": "$ value"}).json()["items"] == []
    assert call(client, "reader", "GET", f"/api/v1/workspaces/{other}/search",
                params={"q": "$ value"}).status_code == 404


def test_local_import_and_graph_only_provenance(graph):
    client, workspace, _ = graph
    base = f"/api/v1/workspaces/{workspace}"
    employee, task = _name(), _name()
    payload = {"source_id": "one", "records": [{
        "id": _name(), "title": "Local import", "revision": "r1",
        "entities": [
            {"id": employee, "kind": "PERSON", "name": "Imported employee"},
            {"id": task, "kind": "TASK", "name": "Imported task"}
        ],
        "links": [{"from": task, "to": employee, "kind": "ASSIGNED_TO"}]
    }]}
    assert call(client, "writer", "POST", base + "/imports/json", json=payload).status_code == 200
    result = call(client, "reader", "GET", base + "/search", params={"q": "Imported employee"})
    assert result.status_code == 200 and len(result.json()["items"]) == 1
    graph_only = call(client, "graph", "GET", base + f"/entities/one::{employee}/neighborhood")
    assert graph_only.status_code == 200
    relation = graph_only.json()["relationships"][0]
    assert relation["record_id"] is None and relation["source_id_ref"] is None
    relation_lookup = call(client, "graph", "GET", base + f"/relationships/{relation['id']}")
    assert relation_lookup.status_code == 200
    assert relation_lookup.json()["record_id"] is None
    graph_path = call(client, "graph", "GET", base + "/paths",
                      params={"source_id": f"one::{employee}", "target_id": f"one::{task}"})
    assert graph_path.status_code == 200
    assert all(edge["record_id"] is None for path in graph_path.json()["paths"]
               for edge in path["relationships"])
    history = call(client, "graph", "GET", base + f"/entities/one::{employee}/history")
    assert history.status_code == 200
    assert all(edge["record_id"] is None for edge in history.json()["relationships"])
    assert call(client, "graph", "GET", base + f"/entities/one::{employee}/evidence").status_code == 403
    with_evidence = call(client, "reader", "GET", base + f"/entities/one::{employee}/evidence")
    assert with_evidence.status_code == 200 and with_evidence.json()["items"][0]["record_id"] == payload["records"][0]["id"]
    invalid = {"source_id": "one", "records": [{"id": _name(), "title": "Invalid",
        "entities": [{"id": "a", "kind": "PERSON", "name": "A"}],
        "links": [{"from": "a", "to": "absent", "kind": "RELATED_TO"}]}]}
    assert call(client, "writer", "POST", base + "/imports/json", json=invalid).status_code == 422


def test_replay_and_concurrent_imports(graph):
    client, workspace, _ = graph
    base = f"/api/v1/workspaces/{workspace}"
    entity_id = _name()
    payload = record("one", _name(), entity_id, "Concurrent")
    def post(_):
        return call(client, "writer", "POST", base + "/records", json=payload).status_code
    with ThreadPoolExecutor(max_workers=4) as pool:
        statuses = list(pool.map(post, range(8)))
    assert statuses == [200] * 8
    result = call(client, "writer", "GET", base + "/search", params={"q": entity_id}).json()
    assert len(result["items"]) == 1
    canonical = f"shared:{_name()}"
    claims = [
        record("one", _name(), "same", "Shared", canonical_id=canonical),
        record("two", _name(), "same", "Shared", canonical_id=canonical),
    ]
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert list(pool.map(lambda item: call(client, "writer", "POST", base + "/records",
                                               json=item).status_code, claims)) == [200, 200]
    resolved = call(client, "writer", "GET", base + f"/entities/{canonical}")
    assert resolved.status_code == 200 and resolved.json()["name"] == "Shared"
    assert len(call(client, "writer", "GET", base + "/search",
                    params={"q": canonical}).json()["items"]) == 1


def test_bounded_graph_and_errors(graph):
    client, workspace, _ = graph
    base = f"/api/v1/workspaces/{workspace}"
    hub = _name()
    leaves = [_name() for _ in range(105)]
    payload = {"source_id": "one", "record_id": _name(), "title": "Dense",
        "entities": [{"external_id": hub, "type": "SERVICE", "name": "Hub"}] +
                    [{"external_id": item, "type": "SERVICE", "name": item} for item in leaves],
        "relationships": [{"source_external_id": item, "target_external_id": hub, "type": "DEPENDS_ON"}
                          for item in leaves] +
                         [{"source_external_id": hub, "target_external_id": leaves[0], "type": "RELATED_TO"}]}
    assert call(client, "writer", "POST", base + "/records", json=payload).status_code == 200
    result = call(client, "writer", "GET", base + f"/entities/one::{hub}/neighborhood",
                  params={"limit": 20}).json()
    assert len(result["relationships"]) == 20 and result["truncated"]
    paths = call(client, "writer", "GET", base + "/paths",
                 params={"source_id": f"one::{hub}", "target_id": f"one::{leaves[0]}", "max_depth": 3})
    assert paths.status_code == 200 and len(paths.json()["paths"]) <= 10
    invalid = call(client, "writer", "GET", base + "/paths",
                   params={"source_id": f"one::{hub}", "target_id": f"one::{leaves[0]}", "max_depth": 9})
    assert invalid.status_code == 422 and invalid.json()["error"]["code"] == "INVALID_REQUEST"
    denied = call(client, "graph", "POST", base + "/records", json=payload)
    assert denied.status_code == 403 and denied.json()["error"]["code"] == "FORBIDDEN"


def test_public_github_import_when_enabled(graph):
    if os.getenv("GRAPH_HACKS_TEST_LIVE_GITHUB") != "1":
        pytest.skip("Set GRAPH_HACKS_TEST_LIVE_GITHUB=1 for a live public GitHub read")
    client, workspace, _ = graph
    base = f"/api/v1/workspaces/{workspace}"
    response = call(client, "writer", "POST", base + "/imports/github", json={
        "owner": "cli", "repository": "cli", "source_id": "github", "max_pull_requests": 1,
    })
    assert response.status_code == 200, response.text
    assert len(response.json()["imported"]) == 1
    record_id = response.json()["imported"][0]["record_id"]
    source = call(client, "writer", "GET", base + f"/records/github/{record_id}")
    assert source.status_code == 200 and source.json()["record_id"] == record_id


def test_versioned_and_temporal_assertions(graph):
    client, workspace, _ = graph
    base = f"/api/v1/workspaces/{workspace}"
    entity_id = _name()
    payload = record("one", _name(), entity_id, "Original")
    payload["revision"] = "one"
    assert call(client, "writer", "POST", base + "/records", json=payload).status_code == 200
    payload["revision"] = "two"
    payload["entities"][0]["name"] = "Revised"
    assert call(client, "writer", "POST", base + "/records", json=payload).status_code == 200
    current = call(client, "writer", "GET", base + f"/entities/one::{entity_id}")
    assert current.status_code == 200 and current.json()["name"] == "Revised"
    claims = call(client, "writer", "GET", base + f"/entities/one::{entity_id}/assertions")
    assert claims.status_code == 200
    assert {(item["name"], item["current"]) for item in claims.json()["items"]} == {
        ("Original", False), ("Revised", True)
    }
    future = record("two", _name(), _name(), "Future")
    future["entities"][0]["valid_from"] = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    assert call(client, "writer", "POST", base + "/records", json=future).status_code == 200
    future_id = future["entities"][0]["external_id"]
    assert call(client, "writer", "GET", base + f"/entities/two::{future_id}").status_code == 404
    history = call(client, "writer", "GET", base + f"/entities/two::{future_id}/assertions")
    assert history.status_code == 200 and history.json()["items"][0]["current"] is False


def test_widened_source_acl_does_not_publish_old_restricted_claim(graph):
    client, workspace, _ = graph
    base = f"/api/v1/workspaces/{workspace}"
    entity_id = _name()
    payload = record("one", _name(), entity_id, "Restricted old value", acl=["writer"])
    payload["revision"] = "restricted"
    assert call(client, "writer", "POST", base + "/records", json=payload).status_code == 200
    payload["revision"] = "public"
    payload["acl_subjects"] = []
    payload["entities"][0]["name"] = "Public current value"
    assert call(client, "writer", "POST", base + "/records", json=payload).status_code == 200
    reader = call(client, "reader", "GET", base + f"/entities/one::{entity_id}")
    assert reader.status_code == 200 and reader.json()["name"] == "Public current value"
    history = call(client, "reader", "GET", base + f"/entities/one::{entity_id}/assertions")
    assert history.status_code == 200
    assert [item["name"] for item in history.json()["items"]] == ["Public current value"]


def test_query_timeout(graph):
    store = Neo4jStore(Settings.from_env(), read_timeout=0.001)
    try:
        with pytest.raises(Neo4jError, match="TransactionTimedOut"):
            store.read(lambda tx: tx.run(
                "UNWIND range(1,10000000) AS x RETURN sum(sin(x)) AS n"
            ).single()["n"])
    finally:
        store.close()


def test_partial_import_recovery_after_write_failure(graph, monkeypatch):
    client, workspace, _ = graph
    base = f"/api/v1/workspaces/{workspace}"
    first_id, second_id = _name(), _name()
    document = {"source_id": "one", "records": [
        {"id": _name(), "title": "First", "entities": [
            {"id": first_id, "kind": "TASK", "name": "First recoverable"}]},
        {"id": _name(), "title": "Second", "entities": [
            {"id": second_id, "kind": "TASK", "name": "Second recoverable"}]},
    ]}
    store = app.state.graph_store
    original_write = store.write
    calls = 0

    def fail_second(work, *args):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise ServiceUnavailable("Injected connection failure")
        return original_write(work, *args)

    with monkeypatch.context() as patch:
        patch.setattr(store, "write", fail_second)
        failed = call(client, "writer", "POST", base + "/imports/json", json=document)
    assert failed.status_code == 503
    assert failed.json()["error"]["code"] == "DATABASE_UNAVAILABLE"
    assert call(client, "writer", "GET", base + f"/entities/one::{first_id}").status_code == 200
    assert call(client, "writer", "GET", base + f"/entities/one::{second_id}").status_code == 404
    retry = call(client, "writer", "POST", base + "/imports/json", json=document)
    assert retry.status_code == 200
    assert call(client, "writer", "GET", base + f"/entities/one::{second_id}").status_code == 200
    assert len(call(client, "writer", "GET", base + "/search",
                    params={"q": "recoverable"}).json()["items"]) == 2
