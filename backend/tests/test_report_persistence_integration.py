"""Actual Postgres snapshots with authenticated HTTP reopen and current graph ACL."""
import uuid

import pytest
from fastapi.testclient import TestClient

import backend.app.main as main
from backend.tests.test_agent_persistence import isolated_postgres
from backend.tests.test_agent_investigation_integration import isolated_neo4j, store
from backend.tests.test_agent_investigation_integration import (
    tool_registry, skill_registry, FakeProviderClient, _success, _router,
)
from backend.app.agent.contracts import InvestigationResult, InvestigationStatus
from backend.app.agent.persistence import InvestigationStore
from backend.app.agent.provenance import capture
from backend.app.graph.models import EntityInput, RelationInput, SourceRecordInput
from backend.app.graph.repository import GraphRepository
from backend.app.security import Principal, Permission
from backend.app.gateway.gateway import ModelGateway
from backend.app.gateway.provider import RawFunctionCall
from backend.app.tools.executor import ToolExecutor
from backend.app.tools.registry import ToolDependencies

pytestmark = pytest.mark.integration


def test_report_survives_store_reopen_and_http_rechecks_owner_scope_and_record_acl(
        isolated_postgres, store, monkeypatch):
    tenant, workspace, run = (uuid.uuid4().hex for _ in range(3))
    user = Principal(subject="owner", tenant_id=tenant, workspaces=(workspace,),
        permissions=frozenset({Permission.READ_GRAPH, Permission.READ_EVIDENCE}), source_ids=("selected",))
    repo = GraphRepository(store, tenant, workspace, "writer", allow_all=True, can_evidence=True)
    record = SourceRecordInput(source_id="selected", record_id="r1", title="Actual source record",
        entities=[EntityInput(external_id="a", canonical_id="a", type="SERVICE", name="A"),
                  EntityInput(external_id="b", canonical_id="b", type="SERVICE", name="B")],
        relationships=[RelationInput(source_external_id="a", target_external_id="b", type="DEPENDS_ON")])
    repo.ingest(record)
    registry = {}
    capture(run, "graph.neighborhood", repo.neighborhood("a").model_dump(mode="json"), 1,
            frozenset({"selected"}), registry)
    result = InvestigationResult(run_id=run, status=InvestigationStatus.COMPLETE, summary="Generated analysis",
        evidence_registry=tuple(registry.values()), selected_source_ids=("selected",), persistence_status="PERSISTED")
    persistence = InvestigationStore(isolated_postgres)
    persistence.start()
    persistence.save_report(result=result, tenant_id=tenant, workspace_id=workspace,
                            principal_subject=user.subject, objective="Dependency", selected_source_ids=("selected",))
    # A new store object reopens the same immutable result; duplicate writes cannot replace it.
    reopened = InvestigationStore(isolated_postgres)
    with pytest.raises(ValueError):
        reopened.save_report(result=result, tenant_id=tenant, workspace_id=workspace,
            principal_subject="attacker", objective="replacement", selected_source_ids=())
    reopened.save_report(result=result.model_copy(update={"summary": "replacement"}), tenant_id=tenant,
        workspace_id=workspace, principal_subject="attacker", objective="replacement", selected_source_ids=("selected",))
    monkeypatch.setattr(main.app.state, "investigation_store", reopened, raising=False)
    monkeypatch.setattr(main.app.state, "graph_store", store, raising=False)
    monkeypatch.setattr(main.app.state, "authority_rules", (), raising=False)
    monkeypatch.setattr(main.app.state, "governance_store", None, raising=False)
    monkeypatch.setitem(main.app.dependency_overrides, main.principal, lambda: user)
    client = TestClient(main.app)
    base = f"/api/v1/workspaces/{workspace}/investigations"
    response = client.get(f"{base}/{run}")
    assert response.status_code == 200
    assert response.json()["summary"] == "Generated analysis"
    assert response.json()["verification_status"] == "PARTIALLY_VERIFIED"
    evidence = next(iter(registry.values()))
    assert client.get(f"{base}/{run}/evidence/{evidence.evidence_id}").json()["content_hash"] == evidence.content_hash
    assert client.get(f"{base}/other/evidence/{evidence.evidence_id}").status_code == 404
    assert client.get(f"{base}/{run}/evidence/ev_forged").status_code == 404
    assert len(client.get(base).json()["items"]) == 1
    for changed in (user.model_copy(update={"subject": "other"}),
                    user.model_copy(update={"tenant_id": "other"}),
                    user.model_copy(update={"source_ids": ("other",)}),
                    user.model_copy(update={"permissions": frozenset({Permission.READ_GRAPH})})):
        monkeypatch.setitem(main.app.dependency_overrides, main.principal, lambda changed=changed: changed)
        assert client.get(f"{base}/{run}").status_code == 404
        assert not client.get(base).json()["items"]
    monkeypatch.setitem(main.app.dependency_overrides, main.principal, lambda: user)
    repo.ingest(record.model_copy(update={"acl_subjects": ["different-reader"]}))
    assert client.get(f"{base}/{run}").status_code == 404
    assert client.get(f"{base}/{run}/evidence/{evidence.evidence_id}").status_code == 404


def test_authenticated_http_execution_uses_real_adk_graph_and_durable_report(
        isolated_postgres, store, tool_registry, skill_registry, monkeypatch):
    tenant, workspace = uuid.uuid4().hex, uuid.uuid4().hex
    user = Principal(subject="developer", tenant_id=tenant, workspaces=(workspace,),
        permissions=frozenset({Permission.EXECUTE_TOOL, Permission.READ_GRAPH, Permission.READ_EVIDENCE}),
        source_ids=("selected",))
    writer = GraphRepository(store, tenant, workspace, "writer", allow_all=True, can_evidence=True)
    for source, description in (("selected", "Permitted dependency"), ("secret", "HTTP_EXCLUDED_FACT_472")):
        writer.ingest(SourceRecordInput(source_id=source, record_id="dependency", title=description,
            entities=[EntityInput(external_id="a", canonical_id="a", type="SERVICE", name="A", description=description),
                      EntityInput(external_id="b", canonical_id="b", type="SERVICE", name="B")],
            relationships=[RelationInput(source_external_id="a", target_external_id="b", type="DEPENDS_ON")]))
    class Recording(FakeProviderClient):
        inputs = []
        def generate(self, model, contents, config):
            self.inputs.append(str(contents))
            return super().generate(model, contents, config)
    provider = Recording()
    provider.queue = [
        _success(function_calls=(RawFunctionCall(id="1", name="skill_discover", arguments={}),)),
        _success(function_calls=(RawFunctionCall(id="2", name="skill_load_instructions", arguments={"skill_id": "graph-trace"}),)),
        _success(function_calls=(RawFunctionCall(id="3", name="graph_neighborhood", arguments={"entity_id": "a"}),)),
        _success(text="Dependency observations; changing an API may have effects that remain unverified."),
    ]
    persistence = InvestigationStore(isolated_postgres)
    persistence.start()
    dependencies = {"graph_store": store, "authority_rules": (), "governance_store": None,
        "investigation_store": persistence, "tool_registry": tool_registry, "skill_registry": skill_registry,
        "tool_executor": ToolExecutor(tool_registry, ToolDependencies(graph_store=store)),
        "model_gateway": ModelGateway(provider, _router())}
    for name, value in dependencies.items():
        monkeypatch.setattr(main.app.state, name, value, raising=False)
    monkeypatch.setitem(main.app.dependency_overrides, main.principal, lambda: user)
    client = TestClient(main.app)
    base = f"/api/v1/workspaces/{workspace}/investigations"
    response = client.post(base, json={"objective": "Assess API dependency impact", "selected_source_ids": ["selected", "secret"]})
    assert response.status_code == 200
    report = response.json()
    assert report["status"] == "COMPLETE"
    assert report["persistence_status"] == "PERSISTED"
    assert report["selected_source_ids"] == ["selected"]
    assert set(report["source_usage"]) == {"selected"}
    assert report["evidence_registry"] and report["structured_findings"]
    assert report["verification_status"] == "PARTIALLY_VERIFIED"
    assert "HTTP_EXCLUDED_FACT_472" not in "\n".join(provider.inputs)
    assert provider.calls == 4
    reopened = client.get(f"{base}/{report['run_id']}")
    assert reopened.status_code == 200
    assert reopened.json()["evidence_registry"] == report["evidence_registry"]
    blocked = client.post(base, json={"objective": "Read secret content", "selected_source_ids": ["secret"]})
    assert blocked.json()["status"] == "BLOCKED"
    assert not blocked.json()["evidence_registry"]
    assert provider.calls == 4
