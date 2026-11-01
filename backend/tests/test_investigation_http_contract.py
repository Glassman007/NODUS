"""Offline HTTP contract checks for the existing single-agent entry point."""
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

import backend.app.main as main
from backend.app.agent.contracts import InvestigationResult, InvestigationStatus
from backend.app.security import Permission, Principal


@pytest.fixture
def http_contract(monkeypatch):
    user = Principal(subject="contract-developer", tenant_id="contract-tenant",
                     workspaces=("verified-workspace",),
                     permissions=frozenset({Permission.READ_GRAPH, Permission.READ_EVIDENCE, Permission.EXECUTE_TOOL}),
                     source_ids=("original-source",))
    monkeypatch.setitem(main.app.dependency_overrides, main.principal, lambda: user)
    for attribute in ("model_gateway", "graph_store", "tool_registry", "tool_executor", "skill_registry"):
        monkeypatch.setattr(main.app.state, attribute, object(), raising=False)
    monkeypatch.setattr(main.app.state, "authority_rules", (), raising=False)
    execute = AsyncMock(return_value=InvestigationResult(run_id="contract-run", status=InvestigationStatus.COMPLETE, summary="Deterministic contract response"))
    monkeypatch.setattr(main, "run_scoped_investigation", execute)
    return TestClient(main.app), execute, user


@pytest.mark.parametrize("status", list(InvestigationStatus))
def test_http_investigation_awaits_result_and_preserves_contract(http_contract, status):
    client, execute, user = http_contract
    execute.return_value = InvestigationResult(run_id="contract-run", status=status, summary="Returned narrative",
                                               error_message="Model call stopped: RATE_LIMITED" if status == InvestigationStatus.INCOMPLETE else None)
    response = client.post("/api/v1/workspaces/verified-workspace/investigations", json={
        "objective": "Inspect the payment API", "selected_source_ids": ["original-source"], "entity_id": "actual-entity",
    })
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == status.value
    assert set(data) == set(InvestigationResult.model_fields)
    assert data["evidence_refs"] == []
    assert execute.await_count == 1
    arguments = execute.call_args.kwargs
    assert arguments["workspace_id"] == "verified-workspace"
    assert arguments["selected_source_ids"] == ("original-source",)
    assert arguments["entity_id"] == "actual-entity"
    assert arguments["principal"] == user


def test_http_investigation_rejects_project_id_as_workspace(http_contract):
    client, execute, _ = http_contract
    response = client.post("/api/v1/workspaces/NEX-PRJ-PAY/investigations", json={"objective": "Inspect", "selected_source_ids": ["original-source"]})
    assert response.status_code == 404
    assert response.json()["error"]["request_id"]
    execute.assert_not_awaited()


def test_http_investigation_requires_execute_permission(http_contract, monkeypatch):
    client, execute, user = http_contract
    readonly = user.model_copy(update={"permissions": frozenset({Permission.READ_GRAPH, Permission.READ_EVIDENCE})})
    monkeypatch.setitem(main.app.dependency_overrides, main.principal, lambda: readonly)
    response = client.post("/api/v1/workspaces/verified-workspace/investigations", json={"objective": "Inspect", "selected_source_ids": ["original-source"]})
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "FORBIDDEN"
    execute.assert_not_awaited()
