"""Deterministic provenance validation, independent of a model/provider."""
import hashlib
import pytest
from pydantic import ValidationError

from backend.app.agent.provenance import capture, EvidenceSnapshot, narrative_finding
from backend.app.agent.verifier import verify_snapshots
from backend.app.governance.identity import recipient_authorized_sources
from backend.app.security import AuthorizationContext, Permission, Principal


def edge():
    return dict(id="edge-1", source_id="A", target_id="B", type="DEPENDS_ON", active=True,
                source_id_ref="selected", record_id="record-1")


def test_evidence_is_run_bound_deduplicated_and_immutable():
    registry = {}
    first = capture("run", "graph.neighborhood", {"relationships": [edge()]}, 1,
                    frozenset({"selected"}), registry)
    assert capture("run", "graph.neighborhood", {"relationships": [edge()]}, 1,
                   frozenset({"selected"}), registry) == first
    assert len(registry) == 1
    snapshot = registry[first[0]]
    assert snapshot.content_hash == hashlib.sha256(snapshot.excerpt.encode()).hexdigest()
    with pytest.raises(ValidationError):
        EvidenceSnapshot.model_validate({**snapshot.model_dump(), "excerpt": "tampered"})
    other = {}
    assert capture("other", "graph.neighborhood", {"relationships": [edge()]}, 1,
                   frozenset({"selected"}), other) != first
    with pytest.raises(PermissionError):
        capture("run", "graph.neighborhood", {"relationships": [edge()]}, 1, frozenset(), {})


def test_valid_citation_does_not_prove_arbitrary_narrative_and_forgery_is_invalid():
    registry = {}
    refs = capture("run", "graph.neighborhood", {"relationships": [edge()]}, 1, None, registry)
    assert narrative_finding(f"A caused an outage [{refs[0]}]", registry).verification_status == "UNVERIFIED"
    assert narrative_finding("A caused an outage [ev_forged]", registry).verification_status == "INVALID_REFERENCE"


def test_removed_edge_cannot_remain_supported():
    registry = {}
    capture("run", "graph.neighborhood", {"relationships": [edge()]}, 1, None, registry)
    class Removed:
        def relationship(self, identifier):
            return None
    assert verify_snapshots(registry, Removed())[0].verification_status == "STALE"


def test_write_only_grant_cannot_supply_investigation_content():
    from backend.app.governance.identity import investigation_read_principal, NEXUS_TENANT_ID
    class Grants:
        def read(self, sql, params=()):
            if "SELECT source_id FROM nexus_sources WHERE selectable" in sql:
                return []
            if "SELECT resource_id" in sql:
                return [{"resource_id": "selected"}]
            if "SELECT data" in sql:
                return [{"data": {"approved_actions": ["WRITE"]}}]
            raise AssertionError(sql)
    principal = Principal(subject="nexus:employee", tenant_id=NEXUS_TENANT_ID, workspaces=("w",),
        source_ids=("selected",), permissions=frozenset({Permission.READ_GRAPH, Permission.EXECUTE_TOOL}))
    narrowed = investigation_read_principal(principal, ("selected",), None, Grants())
    assert narrowed.source_ids == ()


def test_every_path_edge_must_be_current_and_traceable():
    from backend.app.graph.models import Relationship
    registry = {}
    first = edge()
    second = {**edge(), "id": "edge-2", "source_id": "B", "target_id": "C"}
    capture("run", "graph.find_paths", {"relationships": [first, second]}, 1, None, registry)
    class Graph:
        removed = False
        def relationship(self, identifier):
            return None if self.removed and identifier == "edge-2" else Relationship(**(first if identifier == "edge-1" else second))
    graph = Graph()
    path = ({"nodes": ["A", "B", "C"], "relationships": ["edge-1", "edge-2"]},)
    assert verify_snapshots(registry, graph, path)[-1].verification_status == "SUPPORTED"
    graph.removed = True
    assert verify_snapshots(registry, graph, path)[-1].verification_status == "STALE"
    broken = ({"nodes": ["A", "C", "B"], "relationships": ["edge-1", "edge-2"]},)
    assert verify_snapshots(registry, graph, broken)[-1].verification_status == "INVALID_REFERENCE"


def test_rule_derived_edge_remains_inferred_even_when_current():
    from backend.app.graph.models import Relationship
    observed = {**edge(), "origin": "inferred", "derivation_rule_version": "rule-1"}
    registry = {}
    capture("run", "graph.neighborhood", {"relationships": [observed]}, 1, None, registry)
    class Derived:
        def relationship(self, identifier):
            return Relationship(**observed)
    assert verify_snapshots(registry, Derived())[0].verification_status == "INFERRED"


def test_project_scope_rejects_foreign_owned_sources():
    from backend.app.governance.identity import investigation_read_principal, NEXUS_TENANT_ID
    class Projects:
        def read(self, sql, params=()):
            if "FROM nexus_projects" in sql or "FROM nexus_project_assignments" in sql:
                return [{"project_id": "project-a"}]
            if "FROM nexus_sources" in sql:
                return [{"source_id": "shared"}]
            if "SELECT resource_id" in sql:
                return []
            raise AssertionError(sql)
    principal = Principal(subject="nexus:employee", tenant_id=NEXUS_TENANT_ID, workspaces=("w",),
        source_ids=("shared", "foreign-project-source"), permissions=frozenset({Permission.READ_GRAPH}))
    narrowed = investigation_read_principal(principal, principal.source_ids, "project-a", Projects())
    assert narrowed.source_ids == ("shared",)


@pytest.mark.parametrize("admin", [False, True])
def test_refreshed_permissions_never_expand_selection(admin):
    permissions = frozenset({Permission.READ_GRAPH, Permission.ADMIN} if admin else {Permission.READ_GRAPH})
    principal = Principal(subject="reader", tenant_id="tenant", workspaces=("workspace",),
                          permissions=permissions, source_ids=("selected", "excluded"))
    context = AuthorizationContext(principal=principal, tenant_id="tenant", workspace_id="workspace",
                                   task_id="run", permissions=permissions, selected_source_ids=("selected",))
    assert recipient_authorized_sources(context) == frozenset({"selected"})
    assert recipient_authorized_sources(context.model_copy(update={"selected_source_ids": ()})) == frozenset()
