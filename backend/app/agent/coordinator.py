"""NODUS Stage 13 (ND-13A): bounded, permission-aware multi-specialist
coordination over the existing GH-007A general investigator.

This is plain, deterministic orchestrator Python in the same spirit as
``backend/app/agent/discovery.py`` — it calls the existing, unmodified
``backend.app.agent.investigator.run_investigation`` once per specialist
pass, and otherwise never duplicates the investigator, the tool bridge, the
authorization boundary, or the evidence machinery. Nothing here is a second
agent platform.

Three bounded, role-scoped passes:

* DISCOVERY — a ``graph-trace`` investigator pass that finds which
  authorized entities/relationships/evidence are relevant to the objective.
* IMPACT — a second investigator pass, approved for exactly one of the
  Stage 12 intelligence skills (``pr-impact``/``blocker-chain``/
  ``decision-genealogy``/``expert-finder``) selected deterministically from
  the question text, seeded with the entity id(s) DISCOVERY actually
  observed.
* SYNTHESIS — plain Python, no model/tool call at all. It merges the two
  specialists' already-authorized, already-structured
  ``SpecialistResult``s (never their free text, never a raw tool payload)
  into one ``CoordinatedInvestigationResult``.

Trust and authorization are never re-implemented here:

* Each pass is its own ``AgentExecutionContext`` built from the SAME
  server-supplied ``AuthorizationContext`` the coordinator was given — never
  from model output, never from a prior pass's result. Permission filtering
  of which tools a pass can even see
  (``backend.app.agent.investigator._permitted_tool_ids``) and the real
  per-call authorization decision (``ToolExecutor``/``ToolPolicy``) are
  exactly the existing single-investigator machinery; naming a skill here
  grants nothing by itself, same as always.
* Immediately before building each pass's ``AgentExecutionContext``, the
  authorization is re-resolved via
  ``backend.app.agent.tool_bridge.refresh_authorization`` — the same
  Stage 08/09 governance-store-backed refresh the tool bridge already uses
  mid-run, now also applied at the boundary BETWEEN passes, so a grant
  revoked or expired while an earlier pass was running is never still
  honored by a later one.

One shared budget (``CoordinatorBudget``) is enforced across every pass: each
pass receives ``RuntimeLimits`` carved out of whatever remains of the total
tool-call / LLM-call / wall-clock budget when it starts, never a fresh
independent allowance. Budget exhaustion stops the coordinator cleanly,
preserves whatever specialists already completed, and reports
``InvestigationStatus.PARTIAL`` with an explicit ``incomplete_work`` entry —
never raises, never silently drops findings.

Verification boundary: a ``CoordinatedInvestigationResult`` is always marked
``verification_status="PENDING_INDEPENDENT_VERIFICATION"``. Independently
re-checking a synthesized conclusion is ND-13B's job, not this module's.
"""
from __future__ import annotations

import time

from backend.app.agent.contracts import (
    AgentExecutionContext, ApprovedSkill, CoordinatedInvestigationResult, CoordinatorBudget, InvestigationRequest,
    InvestigationResult, InvestigationStatus, ModelUsageSummary, RuntimeLimits, SpecialistResult, SpecialistRole,
)
from backend.app.agent.investigator import run_investigation
from backend.app.agent.tool_bridge import refresh_authorization
from backend.app.gateway.gateway import ModelGateway
from backend.app.security import AuthorizationContext
from backend.app.skills.errors import RevokedSkillError, UnknownSkillVersionError, UntrustedSkillError
from backend.app.skills.registry import SkillRegistry
from backend.app.tools.executor import ToolExecutor
from backend.app.tools.registry import ToolRegistry

DISCOVERY_SKILL_ID = "graph-trace"

# Every first-party production skill (``skills/*/nodus.json``) is currently
# pinned at this one version — exactly the same assumption
# ``backend/app/agent/discovery.py`` already makes for its own default
# ``approved_skills``. ``skill_registry.active_version`` is deliberately NOT
# used here: the shipped skill catalog is registered but never explicitly
# ``activate()``-d (see ``backend.app.skills.catalog.build_production_skill_registry``),
# so relying on "active" would make every coordinated investigation BLOCKED
# in exactly the deployment this is meant to run in.
_SKILL_VERSION = "1.0.0"

# Deterministic, auditable keyword -> intelligence-skill mapping (ND-13A
# section 2B). Checked in this fixed order so an ambiguous question picks the
# same skill every time; never an LLM's own judgment call about which tool is
# "most relevant" (that would be an unbounded, unauditable routing decision).
_IMPACT_SKILL_KEYWORDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("pr-impact", ("pull request", " pr ", "pr-", "deploy", "change impact", "affected by")),
    ("blocker-chain", ("blocker", "blocking", "blocked by", "block ")),
    ("decision-genealogy", ("decision", "why was", "rationale", "superseded", "alternatives")),
    ("expert-finder", ("expert", "who owns", "who knows", "reviewer", "contact for")),
)

_DEFAULT_PASS_LIMITS = RuntimeLimits(max_llm_calls=8, max_tool_calls=6, overall_timeout_seconds=45.0)


def _resolvable_version(skill_registry: SkillRegistry, skill_id: str) -> str | None:
    """The pinned version to approve for this skill, or ``None`` if it cannot
    currently be used (unregistered, untrusted or revoked) — in which case
    the caller skips that specialist pass entirely rather than approving a
    skill the run could never actually load."""
    try:
        skill_registry.resolve(skill_id, _SKILL_VERSION)
    except (UnknownSkillVersionError, RevokedSkillError, UntrustedSkillError):
        return None
    return _SKILL_VERSION


def select_impact_skill(question: str) -> str | None:
    """Returns the one Stage 12 intelligence skill_id the question calls for,
    or ``None`` if nothing matches (the IMPACT pass is then skipped cleanly
    rather than guessing one)."""
    lowered = f" {question.lower()} "
    for skill_id, keywords in _IMPACT_SKILL_KEYWORDS:
        if any(keyword in lowered for keyword in keywords):
            return skill_id
    return None


def _carve_limits(budget: CoordinatorBudget, *, tool_calls_used: int, llm_calls_used: int,
                  started_at: float) -> RuntimeLimits | None:
    """Carves one pass's ``RuntimeLimits`` out of whatever remains of
    ``budget``. Returns ``None`` if nothing meaningful remains — the caller
    must then skip the pass entirely rather than construct a limit of zero
    (``RuntimeLimits`` requires every bound to be >= 1)."""
    remaining_tool_calls = budget.max_total_tool_calls - tool_calls_used
    remaining_llm_calls = budget.max_total_llm_calls - llm_calls_used
    remaining_seconds = budget.overall_timeout_seconds - (time.monotonic() - started_at)
    if remaining_tool_calls <= 0 or remaining_llm_calls <= 0 or remaining_seconds <= 1.0:
        return None
    return RuntimeLimits(
        max_llm_calls=min(_DEFAULT_PASS_LIMITS.max_llm_calls, remaining_llm_calls),
        max_tool_calls=min(_DEFAULT_PASS_LIMITS.max_tool_calls, remaining_tool_calls),
        overall_timeout_seconds=min(_DEFAULT_PASS_LIMITS.overall_timeout_seconds, remaining_seconds),
    )


def _to_specialist_result(role: SpecialistRole, result: InvestigationResult) -> SpecialistResult:
    return SpecialistResult(
        role=role, status=result.status, skill_used=result.skill_used, entity_ids=result.entity_ids,
        relationship_ids=result.relationship_ids, evidence_refs=result.evidence_refs,
        graph_revision=result.graph_revision, unresolved_conflicts=result.unresolved_conflicts,
        source_coverage_limitations=result.source_coverage_limitations,
        rejected_unverified_claims=result.rejected_unverified_claims, summary=result.summary,
        tool_calls_made=len(result.tool_calls), tool_ids_called=tuple(c.tool_id for c in result.tool_calls),
        llm_calls_made=result.model_usage.llm_calls,
    )


def _skipped_result(role: SpecialistRole, reason: str) -> SpecialistResult:
    return SpecialistResult(role=role, status=InvestigationStatus.INCOMPLETE, skipped_reason=reason)


async def _run_pass(role: SpecialistRole, *, question: str, entity_id: str | None, skill_id: str,
                    skill_version: str, authorization: AuthorizationContext, run_id: str,
                    model_gateway: ModelGateway, tool_registry: ToolRegistry, tool_executor: ToolExecutor,
                    skill_registry: SkillRegistry, limits: RuntimeLimits,
                    request_budget_key: str | None) -> InvestigationResult:
    limits = limits.model_copy(update={"request_budget_key": request_budget_key})
    exec_context = AgentExecutionContext(
        authorization=authorization, run_id=f"{run_id}:{role.value.lower()}",
        approved_skills=(ApprovedSkill(skill_id=skill_id, version=skill_version),), limits=limits)
    request = InvestigationRequest(question=question, entity_id=entity_id)
    return await run_investigation(request, exec_context, model_gateway, tool_registry, tool_executor,
                                   skill_registry)


def _synthesize(run_id: str, discovery: SpecialistResult, impact: SpecialistResult | None,
                incomplete_work: list[str]) -> CoordinatedInvestigationResult:
    """SYNTHESIS pass: plain Python, no model/tool call. Merges only the
    already-authorized structured fields of the prior passes — never their
    free text treated as fact, never a raw tool payload."""
    parts = [discovery]
    if impact is not None:
        parts.append(impact)

    entity_ids = tuple(sorted(set().union(*(p.entity_ids for p in parts))))
    relationship_ids = tuple(sorted(set().union(*(p.relationship_ids for p in parts))))
    evidence_refs = tuple(sorted(set().union(*(p.evidence_refs for p in parts))))
    graph_revision = max((p.graph_revision for p in parts if p.graph_revision is not None), default=None)
    unresolved_conflicts = tuple(dict.fromkeys(c for p in parts for c in p.unresolved_conflicts))
    source_coverage_limitations = tuple(dict.fromkeys(s for p in parts for s in p.source_coverage_limitations))
    rejected_unverified_claims = tuple(dict.fromkeys(r for p in parts for r in p.rejected_unverified_claims))

    summary_lines = [f"Discovery ({discovery.status.value}): {discovery.summary or 'no summary produced'}"]
    if impact is not None:
        summary_lines.append(f"Impact ({impact.status.value}): {impact.summary or 'no summary produced'}")
    elif incomplete_work:
        summary_lines.append("Impact: not performed.")
    summary_lines.append(
        "This synthesis combines observed, evidence-backed findings from the passes above; it has not yet "
        "been independently verified.")
    summary = "\n".join(summary_lines)

    statuses = {p.status for p in parts}
    if incomplete_work:
        status = InvestigationStatus.PARTIAL if entity_ids or evidence_refs else InvestigationStatus.INCOMPLETE
    elif InvestigationStatus.BLOCKED in statuses and not (entity_ids or evidence_refs):
        status = InvestigationStatus.BLOCKED
    elif statuses <= {InvestigationStatus.COMPLETE}:
        status = InvestigationStatus.COMPLETE
    else:
        status = InvestigationStatus.PARTIAL

    synthesis = SpecialistResult(
        role=SpecialistRole.SYNTHESIS, status=status, entity_ids=entity_ids, relationship_ids=relationship_ids,
        evidence_refs=evidence_refs, graph_revision=graph_revision, unresolved_conflicts=unresolved_conflicts,
        source_coverage_limitations=source_coverage_limitations,
        rejected_unverified_claims=rejected_unverified_claims, summary=summary,
    )
    specialist_results = (discovery, impact, synthesis) if impact is not None else (discovery, synthesis)

    model_usage = ModelUsageSummary(
        llm_calls=sum(p.llm_calls_made for p in parts), tool_calls=sum(p.tool_calls_made for p in parts))

    return CoordinatedInvestigationResult(
        run_id=run_id, status=status, summary=summary[:4000], entity_ids=entity_ids,
        relationship_ids=relationship_ids, evidence_refs=evidence_refs, graph_revision=graph_revision,
        unresolved_conflicts=unresolved_conflicts, source_coverage_limitations=source_coverage_limitations,
        specialist_results=specialist_results, model_usage=model_usage, incomplete_work=tuple(incomplete_work),
    )


async def run_coordinated_investigation(
    request: InvestigationRequest, authorization: AuthorizationContext, run_id: str, model_gateway: ModelGateway,
    tool_registry: ToolRegistry, tool_executor: ToolExecutor, skill_registry: SkillRegistry, *,
    budget: CoordinatorBudget | None = None, request_budget_key: str | None = None,
) -> CoordinatedInvestigationResult:
    """ND-13A's one coordinated-investigation entry point.

    ``authorization`` must already be the caller's trusted, authenticated
    ``AuthorizationContext`` — exactly what a single-investigator caller
    would pass into ``AgentExecutionContext`` today. It is never accepted
    from the model, from a prior pass, or from unvalidated request JSON.
    """
    budget = budget or CoordinatorBudget()
    started_at = time.monotonic()
    tool_calls_used = 0
    llm_calls_used = 0
    incomplete_work: list[str] = []

    discovery_version = _resolvable_version(skill_registry, DISCOVERY_SKILL_ID)
    if discovery_version is None:
        return CoordinatedInvestigationResult(
            run_id=run_id, status=InvestigationStatus.BLOCKED,
            summary=f"The {DISCOVERY_SKILL_ID!r} skill is not active; no discovery pass could be started.",
            incomplete_work=(f"{DISCOVERY_SKILL_ID} skill unavailable",))

    discovery_auth = refresh_authorization(authorization, tool_executor)
    discovery_limits = _carve_limits(budget, tool_calls_used=tool_calls_used, llm_calls_used=llm_calls_used,
                                     started_at=started_at)
    if discovery_limits is None:
        return CoordinatedInvestigationResult(
            run_id=run_id, status=InvestigationStatus.PARTIAL,
            summary="The shared investigation budget was exhausted before the discovery pass could start.",
            incomplete_work=("discovery pass: shared budget exhausted before it could start",))

    discovery_raw = await _run_pass(
        SpecialistRole.DISCOVERY, question=request.question, entity_id=request.entity_id,
        skill_id=DISCOVERY_SKILL_ID, skill_version=discovery_version, authorization=discovery_auth, run_id=run_id,
        model_gateway=model_gateway, tool_registry=tool_registry, tool_executor=tool_executor,
        skill_registry=skill_registry, limits=discovery_limits, request_budget_key=request_budget_key)
    discovery = _to_specialist_result(SpecialistRole.DISCOVERY, discovery_raw)
    tool_calls_used += discovery.tool_calls_made
    llm_calls_used += discovery.llm_calls_made

    impact_skill_id = select_impact_skill(request.question)
    impact: SpecialistResult | None = None
    if impact_skill_id is None:
        incomplete_work.append("impact pass: no Stage 12 intelligence skill matched this question")
    else:
        impact_version = _resolvable_version(skill_registry, impact_skill_id)
        if impact_version is None:
            incomplete_work.append(f"impact pass: {impact_skill_id!r} skill is not active")
        else:
            impact_auth = refresh_authorization(authorization, tool_executor)
            impact_limits = _carve_limits(budget, tool_calls_used=tool_calls_used, llm_calls_used=llm_calls_used,
                                          started_at=started_at)
            if impact_limits is None:
                incomplete_work.append("impact pass: shared budget exhausted before it could start")
            else:
                impact_entity_hint = request.entity_id or (discovery.entity_ids[0] if discovery.entity_ids else None)
                impact_raw = await _run_pass(
                    SpecialistRole.IMPACT, question=request.question, entity_id=impact_entity_hint,
                    skill_id=impact_skill_id, skill_version=impact_version, authorization=impact_auth,
                    run_id=run_id, model_gateway=model_gateway, tool_registry=tool_registry,
                    tool_executor=tool_executor, skill_registry=skill_registry, limits=impact_limits,
                    request_budget_key=request_budget_key)
                impact = _to_specialist_result(SpecialistRole.IMPACT, impact_raw)
                tool_calls_used += impact.tool_calls_made
                llm_calls_used += impact.llm_calls_made

    return _synthesize(run_id, discovery, impact, incomplete_work)
