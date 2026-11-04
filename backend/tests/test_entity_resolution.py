"""NODUS FIX 2: deterministic entity resolution.

Covers the actual production failure (graph.entity_lookup NOT_FOUND for
"Identity"/"Commerce"/"Payment" despite the data existing) end to end against
the real, already-imported NEXUS dataset (see ``backend.tests.nexus_live``):

1. canonical id lookup
2. human-readable name resolution
3. normalized/alias (case, punctuation, spacing) lookup
4. ambiguous matches
5. unauthorized entity visibility
6. selected-source restrictions (the company-foundation scaffold fix)
7. entity-to-relationship traversal
8. repeated NOT_FOUND lookup deduplication
"""
from __future__ import annotations

import asyncio

import pytest

from backend.app.agent.contracts import AgentExecutionContext, ApprovedSkill, RuntimeLimits
from backend.app.agent.discovery import effective_source_scope
from backend.app.agent.run_state import CURRENT_RUN, RunState
from backend.app.agent.tool_bridge import DeterministicToolAdapter
from backend.app.gateway.contracts import ModelRole
from backend.app.governance.identity import (
    NEXUS_TENANT_ID, investigation_read_principal, non_selectable_source_ids,
)
from backend.app.security import AuthorizationContext, Permission
from backend.app.skills.registry import SkillRegistry
from backend.app.skills.trust import SkillTrustPolicy
from backend.app.tools.contracts import ToolInvocation, ToolStatus
from backend.app.tools.executor import ToolExecutor
from backend.app.tools import register_all_tools
from backend.app.tools.graph_tools import (
    GRAPH_ENTITY_LOOKUP_TOOL_ID, GRAPH_ENTITY_LOOKUP_VERSION, GRAPH_SEARCH_ENTITIES_TOOL_ID,
    GRAPH_SEARCH_ENTITIES_VERSION, _search_entities_handler, GraphSearchEntitiesInput,
)
from backend.app.tools.registry import ToolDependencies, ToolRegistry
from backend.tests.nexus_live import (
    admin_principal, developer_principal, intern_principal, nexus_neo4j, nexus_pg, nexus_settings, repository_for,
)

pytestmark = pytest.mark.integration


def _auth(principal, selected_source_ids=None) -> AuthorizationContext:
    return AuthorizationContext(
        principal=principal, tenant_id=principal.tenant_id, workspace_id="nexus-workspace",
        task_id="entity-resolution-test", permissions=principal.permissions,
        selected_source_ids=selected_source_ids)


# ---------------------------------------------------------------------------
# 1-4: the resolver itself (direct handler calls -- no agent loop needed).
# ---------------------------------------------------------------------------

def test_canonical_id_resolves_directly(nexus_neo4j, admin_principal):
    deps = ToolDependencies(graph_store=nexus_neo4j)
    out = _search_entities_handler(_auth(admin_principal), GraphSearchEntitiesInput(query="NEX-PRJ-ID"), deps)
    assert out["status"] == "RESOLVED"
    assert out["resolved_entity"].id == "NEX-PRJ-ID"


def test_human_readable_name_resolves_the_real_service(nexus_neo4j, admin_principal):
    """The exact production failure: a bare domain-word query must not come
    back NOT_FOUND when authorized data for it exists."""
    deps = ToolDependencies(graph_store=nexus_neo4j)
    out = _search_entities_handler(_auth(admin_principal), GraphSearchEntitiesInput(query="payment-api"), deps)
    assert out["status"] == "RESOLVED"
    assert out["resolved_entity"].id == "NEX-SVC-PAYMENT_API"


def test_normalized_alias_resolves_despite_case_and_spacing(nexus_neo4j, admin_principal):
    deps = ToolDependencies(graph_store=nexus_neo4j)
    out = _search_entities_handler(_auth(admin_principal), GraphSearchEntitiesInput(query="IDENTITY API"), deps)
    assert out["status"] == "RESOLVED"
    assert out["resolved_entity"].id == "NEX-SVC-IDENTITY_API"


def test_ambiguous_query_returns_bounded_candidates_never_a_silent_pick(nexus_neo4j, admin_principal):
    deps = ToolDependencies(graph_store=nexus_neo4j)
    out = _search_entities_handler(_auth(admin_principal), GraphSearchEntitiesInput(query="Commerce", limit=10), deps)
    assert out["status"] == "AMBIGUOUS"
    assert out["resolved_entity"] is None
    assert 1 < len(out["candidates"]) <= 10
    assert "NEX-PRJ-COM" in {c.id for c in out["candidates"]}


def test_genuinely_missing_reference_is_not_found(nexus_neo4j, admin_principal):
    deps = ToolDependencies(graph_store=nexus_neo4j)
    out = _search_entities_handler(
        _auth(admin_principal), GraphSearchEntitiesInput(query="totally-nonexistent-service-xyz"), deps)
    assert out is None


# ---------------------------------------------------------------------------
# 5: unauthorized entity visibility.
# ---------------------------------------------------------------------------

def _candidate_ids(out: dict | None) -> set[str]:
    if out is None:
        return set()
    ids = {c.id for c in out["candidates"]}
    if out["resolved_entity"] is not None:
        ids.add(out["resolved_entity"].id)
    return ids


def test_search_never_reveals_entities_outside_the_principal_scope(nexus_neo4j, admin_principal, intern_principal):
    """An intern (shared + foundation sources only -- never PROJECT_DEVELOPER/
    CROSS_PROJECT_CONFIDENTIAL access, see ``_effective_source_ids``) must
    never see a candidate an admin can see only because it is backed by a
    project-repo/platform source the intern cannot read -- proven by a
    strict subset, never equal, never larger."""
    deps = ToolDependencies(graph_store=nexus_neo4j)
    admin_ids = _candidate_ids(
        _search_entities_handler(_auth(admin_principal), GraphSearchEntitiesInput(query="identity", limit=25), deps))
    intern_ids = _candidate_ids(
        _search_entities_handler(_auth(intern_principal), GraphSearchEntitiesInput(query="identity", limit=25), deps))
    assert intern_ids <= admin_ids
    assert intern_ids < admin_ids, "an intern should not see project-repo-only artifacts an admin can"


# ---------------------------------------------------------------------------
# 6: selected-source restrictions must never silently drop the shared,
#    non-selectable company-foundation scaffold.
# ---------------------------------------------------------------------------

def test_non_selectable_source_ids_includes_the_foundation_scaffold(nexus_pg):
    assert "NEX-SRC-COMPANY_FOUNDATION" in non_selectable_source_ids(nexus_pg)


def test_investigation_read_principal_keeps_foundation_source_despite_narrow_selection(
        nexus_pg, developer_principal):
    """Regression for the actual root cause: a caller selecting only their
    own project's repo source must still keep read access to the always-on
    company/project/service catalog -- that source is never offered as
    something to select, so requiring it in ``selected_source_ids`` silently
    excluded every project/service entity from every selection-scoped
    investigation."""
    assert "NEX-SRC-COMPANY_FOUNDATION" in developer_principal.source_ids
    own_selection = tuple(s for s in developer_principal.source_ids if s != "NEX-SRC-COMPANY_FOUNDATION")[:1]
    assert own_selection, "fixture principal must have at least one other selectable source"

    narrowed = investigation_read_principal(developer_principal, own_selection, None, nexus_pg)
    assert "NEX-SRC-COMPANY_FOUNDATION" in narrowed.source_ids
    assert set(narrowed.source_ids) - {"NEX-SRC-COMPANY_FOUNDATION"} <= set(own_selection)


def test_effective_source_scope_restores_foundation_source_without_broadening_access(developer_principal):
    selected = ("NEX-SRC-PAY-REPO",)
    always_included = frozenset({"NEX-SRC-COMPANY_FOUNDATION"}) & frozenset(developer_principal.source_ids)
    scope = effective_source_scope(selected, developer_principal, always_included_source_ids=always_included)
    assert "NEX-SRC-COMPANY_FOUNDATION" in scope
    assert "NEX-SRC-PAY-REPO" in scope
    # Never broadened beyond the caller's own selection plus the always-included scaffold.
    assert scope <= set(selected) | always_included
    # A source never selected and never foundational stays excluded.
    assert "NEX-SRC-ID-REPO" not in scope


def test_effective_source_scope_still_blocks_a_totally_empty_selection(developer_principal):
    always_included = frozenset({"NEX-SRC-COMPANY_FOUNDATION"}) & frozenset(developer_principal.source_ids)
    assert effective_source_scope((), developer_principal, always_included_source_ids=always_included) == frozenset()


def test_payment_identity_commerce_resolve_once_foundation_source_is_restored(nexus_neo4j, developer_principal):
    """The exact acceptance scenario: with the fix, the foundation-scoped
    project/service catalog is reachable even when the caller only selected
    one of their own project's sources."""
    own_source = next(s for s in developer_principal.source_ids if s.endswith("-REPO"))
    always_included = frozenset({"NEX-SRC-COMPANY_FOUNDATION"}) & frozenset(developer_principal.source_ids)
    scope = effective_source_scope((own_source,), developer_principal,
                                   always_included_source_ids=always_included)
    assert "NEX-SRC-COMPANY_FOUNDATION" in scope

    from backend.app.graph.repository import GraphRepository
    scoped_principal = developer_principal.model_copy(update={"source_ids": tuple(sorted(scope))})
    repo = GraphRepository(nexus_neo4j, scoped_principal.tenant_id, "nexus-workspace", scoped_principal.subject,
                           allow_all=Permission.ADMIN in scoped_principal.permissions, can_evidence=True,
                           authorized_source_ids=scope)
    for entity_id in ("NEX-PRJ-PAY", "NEX-SVC-PAYMENT_API"):
        assert repo.get_entity(entity_id) is not None, f"{entity_id} should be reachable via the foundation source"


# ---------------------------------------------------------------------------
# 7: entity-to-relationship traversal from a resolved starting entity.
# ---------------------------------------------------------------------------

def test_resolved_entity_traverses_to_a_real_relationship(nexus_neo4j, admin_principal):
    deps = ToolDependencies(graph_store=nexus_neo4j)
    resolved = _search_entities_handler(_auth(admin_principal), GraphSearchEntitiesInput(query="payment-api"), deps)
    assert resolved["status"] == "RESOLVED"
    repo = repository_for(nexus_neo4j, admin_principal)
    page = repo.neighborhood(resolved["resolved_entity"].id, limit=100)
    assert page.relationships, "payment-api should have at least one authorized relationship"
    assert all(rel.source_id == resolved["resolved_entity"].id or rel.target_id == resolved["resolved_entity"].id
              for rel in page.relationships)


# ---------------------------------------------------------------------------
# 8: repeated NOT_FOUND lookup deduplication (entity_id and search query).
# ---------------------------------------------------------------------------

def _run(coro):
    return asyncio.run(coro)


def _bound_run_state(graph_store, governance_store, principal) -> RunState:
    from backend.app.skills.catalog import build_production_skill_registry
    tool_registry = ToolRegistry()
    register_all_tools(tool_registry)
    tool_executor = ToolExecutor(tool_registry, ToolDependencies(graph_store=graph_store,
                                                                 governance_store=governance_store))
    skill_registry: SkillRegistry = build_production_skill_registry(tool_registry=tool_registry)
    exec_context = AgentExecutionContext(
        authorization=_auth(principal), run_id="dedup-test", model_role=ModelRole.DEFAULT,
        approved_skills=(ApprovedSkill(skill_id="graph-trace", version="1.0.0"),),
        limits=RuntimeLimits(max_llm_calls=10, max_tool_calls=10))
    run_state = RunState(exec_context=exec_context, tool_executor=tool_executor, skill_registry=skill_registry)
    descriptor = skill_registry.resolve("graph-trace", "1.0.0")
    manifest = skill_registry.manifest("graph-trace", "1.0.0")
    run_state.select_skill(descriptor, manifest)
    return run_state


def test_repeated_not_found_entity_lookup_is_deduplicated(nexus_neo4j, nexus_pg, admin_principal):
    run_state = _bound_run_state(nexus_neo4j, nexus_pg, admin_principal)
    token = CURRENT_RUN.set(run_state)
    try:
        spec = run_state.tool_executor.registry.resolve(GRAPH_ENTITY_LOOKUP_TOOL_ID, GRAPH_ENTITY_LOOKUP_VERSION)
        adapter = DeterministicToolAdapter(spec)
        args = {"entity_id": "NEX-DOES-NOT-EXIST"}
        first = _run(adapter.run_async(args=args, tool_context=None))
        assert first["status"] == ToolStatus.NOT_FOUND.value
        assert run_state.tool_calls_made == 1
        second = _run(adapter.run_async(args=args, tool_context=None))
        assert second["status"] == ToolStatus.NOT_FOUND.value
        assert "already looked up" in second["message"]
        assert run_state.tool_calls_made == 2  # still counted against the budget, never a free retry loop
    finally:
        CURRENT_RUN.reset(token)


def test_repeated_not_found_search_query_is_deduplicated(nexus_neo4j, nexus_pg, admin_principal):
    run_state = _bound_run_state(nexus_neo4j, nexus_pg, admin_principal)
    token = CURRENT_RUN.set(run_state)
    try:
        spec = run_state.tool_executor.registry.resolve(GRAPH_SEARCH_ENTITIES_TOOL_ID, GRAPH_SEARCH_ENTITIES_VERSION)
        adapter = DeterministicToolAdapter(spec)
        first = _run(adapter.run_async(args={"query": "totally-nonexistent-service-xyz"}, tool_context=None))
        assert first["status"] == ToolStatus.NOT_FOUND.value
        assert run_state.tool_calls_made == 1
        # A trivially reworded repeat (different case/spacing) still normalizes to the same cache key.
        second = _run(adapter.run_async(
            args={"query": "Totally Nonexistent Service XYZ"}, tool_context=None))
        assert second["status"] == ToolStatus.NOT_FOUND.value
        assert "already searched" in second["message"]
        assert run_state.tool_calls_made == 2
    finally:
        CURRENT_RUN.reset(token)
