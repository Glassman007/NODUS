"""Actual ADK/ToolExecutor/Neo4j with a scripted, offline provider."""
import asyncio
import uuid

import pytest

from backend.tests.test_agent_investigation_integration import (
    isolated_neo4j, store, tool_registry, skill_registry, FakeProviderClient, _success, _router,
    _exec_context,
)
from backend.app.agent.contracts import InvestigationRequest
from backend.app.agent.investigator import run_investigation
from backend.app.gateway.gateway import ModelGateway
from backend.app.gateway.provider import RawFunctionCall
from backend.app.graph.models import EntityInput, RelationInput, SourceRecordInput
from backend.app.graph.repository import GraphRepository
from backend.app.security import Permission
from backend.app.tools.executor import ToolExecutor
from backend.app.tools.registry import ToolDependencies

pytestmark = pytest.mark.integration


@pytest.mark.parametrize("admin,revoke", [(False, False), (True, False),
    (False, "source"), (True, "source"), (False, "record")])
def test_excluded_fact_never_reaches_model_and_graph_evidence_is_verified(
        store, tool_registry, skill_registry, admin, revoke, monkeypatch):
    tenant, workspace = uuid.uuid4().hex, uuid.uuid4().hex
    writer = GraphRepository(store, tenant, workspace, "writer", allow_all=True, can_evidence=True)
    for source, description in (("selected", "Allowed dependency"), ("excluded", "EXCLUDED_SENTINEL_8317")):
        record = SourceRecordInput(source_id=source, record_id="r1", title=description,
            entities=[EntityInput(external_id="a", canonical_id="a", type="SERVICE", name="A", description=description),
                      EntityInput(external_id="b", canonical_id="b", type="SERVICE", name="B")],
            relationships=[RelationInput(source_external_id="a", target_external_id="b", type="DEPENDS_ON")])
        writer.ingest(record)
        if source == "selected":
            selected_record = record
    class RecordingProvider(FakeProviderClient):
        def __init__(self):
            super().__init__()
            self.inputs = []
        def generate(self, model, contents, config):
            self.inputs.append(str(contents))
            return super().generate(model, contents, config)
    provider = RecordingProvider()
    if revoke:
        refresh_calls = 0
        def refresh(context, executor):
            nonlocal refresh_calls
            refresh_calls += 1
            if refresh_calls >= 5:
                if revoke == "record":
                    writer.ingest(selected_record.model_copy(update={"acl_subjects": ["other-reader"]}))
                    return context
                return context.model_copy(update={"principal": context.principal.model_copy(
                    update={"source_ids": ("excluded",)})})
            return context
        monkeypatch.setattr("backend.app.agent.tool_bridge.refresh_authorization", refresh)
    provider.queue = [
        _success(function_calls=(RawFunctionCall(id="1", name="skill_discover", arguments={}),)),
        _success(function_calls=(RawFunctionCall(id="2", name="skill_load_instructions", arguments={"skill_id": "graph-trace"}),)),
        _success(function_calls=(RawFunctionCall(id="3", name="graph_neighborhood", arguments={"entity_id": "a"}),)),
        _success(text="A caused a production outage [ev_fabricated]."),
    ]
    context = _exec_context(tenant, workspace, skill_id="graph-trace")
    principal = context.authorization.principal.model_copy(update={
        "source_ids": ("selected", "excluded"),
        "permissions": context.authorization.permissions | ({Permission.ADMIN} if admin else set())})
    context = context.model_copy(update={"authorization": context.authorization.model_copy(update={
        "principal": principal, "selected_source_ids": ("selected",)})})
    executor = ToolExecutor(tool_registry, ToolDependencies(graph_store=store))
    result = asyncio.run(run_investigation(InvestigationRequest(question="Show dependencies", entity_id="a"),
        context, ModelGateway(provider, _router()), tool_registry, executor, skill_registry))
    assert "EXCLUDED_SENTINEL_8317" not in "\n".join(provider.inputs)
    if revoke:
        assert provider.calls == 3
        assert "Allowed dependency" not in "\n".join(provider.inputs)
        assert not result.evidence_registry
        assert result.verification_status == "SOURCE_RESTRICTED"
        return
    assert "Allowed dependency" in "\n".join(provider.inputs)
    assert result.evidence_registry
    assert {item.source_id for item in result.evidence_registry} == {"selected"}
    assert any(f.verification_status == "SUPPORTED" and f.claim_type == "GRAPH_RELATIONSHIP"
               for f in result.structured_findings)
    assert any(f.verification_status == "INVALID_REFERENCE" for f in result.structured_findings)
    assert result.verification_status == "PARTIALLY_VERIFIED"
    assert provider.calls == 4  # No model-based verification call.


def test_multihop_path_retains_every_authorized_edge_and_intermediate_node(store, tool_registry, skill_registry):
    tenant, workspace = uuid.uuid4().hex, uuid.uuid4().hex
    writer = GraphRepository(store, tenant, workspace, "writer", allow_all=True, can_evidence=True)
    writer.ingest(SourceRecordInput(source_id="selected", record_id="chain", title="Dependency chain",
        entities=[EntityInput(external_id=node, canonical_id=node, type="SERVICE", name=node) for node in ("a", "b", "c")],
        relationships=[RelationInput(source_external_id=a, target_external_id=b, type="DEPENDS_ON")
                       for a, b in (("a", "b"), ("b", "c"))]))
    provider = FakeProviderClient()
    provider.queue = [
        _success(function_calls=(RawFunctionCall(id="1", name="skill_discover", arguments={}),)),
        _success(function_calls=(RawFunctionCall(id="2", name="skill_load_instructions", arguments={"skill_id": "graph-trace"}),)),
        _success(function_calls=(RawFunctionCall(id="3", name="graph_find_paths", arguments={"source_id": "a", "target_id": "c"}),)),
        _success(text="The recorded connection is not proof of a technical failure."),
    ]
    context = _exec_context(tenant, workspace, skill_id="graph-trace")
    context = context.model_copy(update={"authorization": context.authorization.model_copy(
        update={"selected_source_ids": ("selected",)})})
    result = asyncio.run(run_investigation(InvestigationRequest(question="Find the path from a to c"),
        context, ModelGateway(provider, _router()), tool_registry,
        ToolExecutor(tool_registry, ToolDependencies(graph_store=store)), skill_registry))
    paths = [finding for finding in result.structured_findings if finding.claim_type == "GRAPH_PATH"]
    assert len(paths) == 1
    assert paths[0].entity_ids == ("a", "b", "c")
    assert len(paths[0].relationship_ids) == len(paths[0].evidence_ids) == 2
    assert paths[0].verification_status == "SUPPORTED"


def test_authorized_history_is_replayable_but_retired_edges_are_not_currently_supported(store, tool_registry, skill_registry):
    tenant, workspace = uuid.uuid4().hex, uuid.uuid4().hex
    writer = GraphRepository(store, tenant, workspace, "writer", allow_all=True, can_evidence=True)
    writer.ingest(SourceRecordInput(source_id="selected", record_id="retired", title="Historical record",
        entities=[EntityInput(external_id=node, canonical_id=node, type="SERVICE", name=node) for node in ("a", "b")],
        relationships=[RelationInput(source_external_id="a", target_external_id="b", type="DEPENDS_ON")]))
    writer.retract_record("selected", "retired")
    provider = FakeProviderClient()
    provider.queue = [
        _success(function_calls=(RawFunctionCall(id="1", name="skill_discover", arguments={}),)),
        _success(function_calls=(RawFunctionCall(id="2", name="skill_load_instructions", arguments={"skill_id": "graph-trace"}),)),
        _success(function_calls=(RawFunctionCall(id="3", name="graph_neighborhood", arguments={"entity_id": "a", "include_history": True}),)),
        _success(text="This is an authorized historical connection, not a current dependency."),
    ]
    context = _exec_context(tenant, workspace, skill_id="graph-trace")
    context = context.model_copy(update={"authorization": context.authorization.model_copy(
        update={"selected_source_ids": ("selected",)})})
    result = asyncio.run(run_investigation(InvestigationRequest(question="Show historical connections"),
        context, ModelGateway(provider, _router()), tool_registry,
        ToolExecutor(tool_registry, ToolDependencies(graph_store=store)), skill_registry))
    assert provider.calls == 4
    assert result.evidence_registry and all(item.include_history for item in result.evidence_registry)
    edges = [finding for finding in result.structured_findings if finding.claim_type == "GRAPH_RELATIONSHIP"]
    assert edges and all(finding.verification_status == "STALE" for finding in edges)
