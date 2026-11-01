"""Deterministic problem and ownership checks over the existing scoped graph.

No model prose is promoted to a defect. Conflicting current assertions establish
only that sources disagree.
Ordinary dependencies and proposed API changes never create remediation tasks.
"""
import hashlib
import json

from backend.app.agent.provenance import capture
from backend.app.resolution_models import ActionableProblem, OwnershipDecision


def fingerprint(value) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode()).hexdigest()


def enrich_resolution(result, repo):
    if result.status.value == "BLOCKED":
        return result
    if not repo.can_evidence:
        return result.model_copy(update={"resolution_status":"UNAVAILABLE",
            "source_coverage_limitations":(*result.source_coverage_limitations,
                                           "Problem and ownership verification requires evidence-read permission.")})
    registry = {item.evidence_id: item for item in result.evidence_registry}
    ownerships, problems = [], []
    nodes, edges = set(result.entity_ids), set(result.relationship_ids)
    scope = frozenset(result.selected_source_ids)
    for service_id in result.entity_ids[:20]:
        entity = repo.get_entity(service_id)
        if entity is None or entity.type != "SERVICE":
            continue
        page = repo.neighborhood(service_id, limit=100)
        by_id = {node.id: node for node in page.nodes}
        direct, projects, people, supporting = {}, set(), set(), set()
        relevant = []
        for edge in page.relationships:
            if edge.origin not in ("source_asserted", "observed"):
                continue
            other = by_id.get(edge.source_id)
            if edge.type == "OWNS" and edge.target_id == service_id and other is not None:
                relevant.append(edge)
                if other.type == "TEAM":
                    direct[other.id] = other.name or other.id
                elif other.type == "PROJECT":
                    projects.add(other.id)
                elif other.type == "PERSON":
                    people.add(other.id)
        # Capture only ownership facts used in the decision, not an extra graph expansion.
        owner_data = {"relationships": [edge.model_dump(mode="json") for edge in relevant]}
        evidence_ids = capture(result.run_id, "resolution.ownership", owner_data,
                               repo.graph_revision(), scope, registry)
        primary = next(iter(direct)) if len(direct) == 1 and not page.truncated else None
        decision = OwnershipDecision(service_id=service_id, service_name=entity.name or service_id,
            primary_team_id=primary, primary_team_name=direct.get(primary),
            candidate_team_ids=tuple(sorted(direct)), supporting_team_ids=tuple(sorted(supporting)),
            owner_ids=tuple(sorted(people)), project_ids=tuple(sorted(projects)), evidence_ids=evidence_ids,
            status="VERIFIED" if primary else "REVIEW_REQUIRED",
            explanation="Selected, authorized ownership records identify one responsible team for this service."
                if primary else "Ownership is missing, conflicting, or truncated in this investigation's scope. Administrator review is required.")
        ownerships.append(decision)
        for edge in relevant:
            edges.add(edge.id)
            nodes.update((edge.source_id, edge.target_id))
        # Names may be legitimate aliases. Only disagreements in technical descriptions
        # become reconciliation work; we do not claim that either description is correct.
        descriptions = {claim["description"].strip() for claim in entity.provenance
                        if isinstance(claim.get("description"),str) and claim["description"].strip()}
        if len(descriptions)>1:
            assertions = [claim for claim in entity.provenance
                          if isinstance(claim.get("description"),str) and claim["description"].strip()]
            evidence = capture(result.run_id, "resolution.assertions", {"items": assertions},
                               repo.graph_revision(), scope, registry)
            dependent_edges = [edge for edge in page.relationships if edge.type == "DEPENDS_ON"
                and edge.target_id == service_id and edge.source_id in result.entity_ids
                and by_id.get(edge.source_id) is not None and by_id[edge.source_id].type == "SERVICE"]
            dependent_evidence = capture(result.run_id,"resolution.dependencies",
                {"relationships":[edge.model_dump(mode="json") for edge in dependent_edges]},
                repo.graph_revision(),scope,registry)
            evidence = tuple(dict.fromkeys((*evidence,*dependent_evidence)))
            for edge in dependent_edges:
                edges.add(edge.id)
                nodes.update((edge.source_id,edge.target_id))
            problem_id = fingerprint((service_id, "CONFLICTING_ASSERTIONS", "description"))
            problems.append(ActionableProblem(problem_id=problem_id, category="CONFLICTING_ASSERTIONS",
                title=f"Reconcile conflicting descriptions for {entity.name or service_id}",
                description="Current authorized source records disagree about this service's technical description.",
                service_id=service_id, affected_system_ids=tuple(sorted({service_id,*(edge.source_id for edge in dependent_edges)})),
                impact="Engineers cannot rely on a single consistent service description. This does not establish an outage or a breaking API change.",
                recommended_action="Compare the cited records with the service implementation and update both sources to the agreed description.",
                acceptance_criteria=("All cited current source assertions agree on the technical description.",
                                     "The responsible team records the reviewed correction."),
                evidence_ids=evidence, verification_status="SUPPORTED", ownership=decision,
                check={"field": "description", "record_pairs": sorted({(claim["source_id"], claim["record_id"]) for claim in assertions})}))
    by_service = {owner.service_id:owner for owner in ownerships}
    expanded = []
    for problem in problems:
        supporting = [by_service[identifier] for identifier in problem.affected_system_ids
                      if identifier != problem.service_id and identifier in by_service]
        teams = {owner.primary_team_id for owner in supporting if owner.status=="VERIFIED"
                 and owner.primary_team_id != problem.ownership.primary_team_id}
        owner = problem.ownership.model_copy(update={"supporting_team_ids":tuple(sorted(team for team in teams if team)),
            "evidence_ids":tuple(dict.fromkeys((*problem.ownership.evidence_ids,
                *(identifier for supporting_owner in supporting for identifier in supporting_owner.evidence_ids))))})
        expanded.append(problem.model_copy(update={"ownership":owner}))
    problems = expanded
    usage = {}
    for item in registry.values():
        usage[item.source_id] = usage.get(item.source_id, 0) + 1
    return result.model_copy(update={"actionable_findings": tuple(problems), "ownership_decisions": tuple(ownerships),
        "evidence_registry": tuple(registry.values()), "entity_ids": tuple(sorted(nodes)),
        "relationship_ids": tuple(sorted(edges)), "source_usage": usage,"resolution_status":"EVALUATED"})


def problem_resolved(task, repo) -> bool:
    """A human RESOLVED status is not proof: re-read the exact source assertions."""
    problem = task.finding
    if problem.category != "CONFLICTING_ASSERTIONS":
        return False
    field = problem.check.get("field")
    if field != "description":
        return False
    entity = repo.get_entity(problem.service_id)
    if entity is None:
        return False
    descriptions = {claim[field].strip() for claim in entity.provenance
                    if isinstance(claim.get(field),str) and claim[field].strip()}
    if len(descriptions)!=1:
        return False
    pairs = {tuple(pair) for pair in problem.check.get("record_pairs", ())}
    current = {(claim["source_id"], claim["record_id"]): claim.get(field) for claim in entity.provenance}
    # Revoking or removing one side of a conflict is not independently verified remediation.
    return bool(pairs) and pairs <= current.keys() and all(current[pair] for pair in pairs) and len({current[pair] for pair in pairs}) == 1
