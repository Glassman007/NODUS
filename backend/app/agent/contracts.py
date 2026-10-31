"""Typed contracts for the GH-007A general investigator agent.

Reuses ``backend.app.contracts.Record`` (frozen Pydantic base),
``backend.app.security.AuthorizationContext`` and
``backend.app.gateway.contracts.ModelRole`` rather than inventing parallel
trust/identity/model types.

``AgentExecutionContext`` is the one new trust-relevant contract here. It
must always be constructed by the calling backend from an already-trusted
``AuthorizationContext`` and a server-approved list of (skill_id, version)
pins — never from ADK ``user_id``/session state, never from model output,
never from caller-supplied arbitrary JSON. See its docstring.
"""
from __future__ import annotations

from enum import StrEnum

from pydantic import Field, model_validator

from backend.app.contracts import Record
from backend.app.gateway.contracts import ModelRole
from backend.app.security import AuthorizationContext


class ApprovedSkill(Record):
    """One (skill_id, version) pin the calling backend has approved for this
    run. The agent may only load instructions for a skill named here, at
    exactly this version — never a different version, even if one becomes
    active in the shared ``SkillRegistry`` mid-run (see
    ``backend/app/agent/tool_bridge.py``)."""
    skill_id: str = Field(min_length=1, max_length=64)
    version: str = Field(min_length=1)


class RuntimeLimits(Record):
    """Small, explicit, configurable defaults — never an unrestricted ADK
    default (``RunConfig.max_llm_calls`` otherwise defaults to 500)."""
    max_llm_calls: int = Field(default=6, ge=1, le=50)
    max_tool_calls: int = Field(default=12, ge=1, le=100)
    max_output_tokens_per_call: int = Field(default=1024, ge=1, le=65_536)
    max_total_tokens_per_call: int = Field(default=8192, ge=1, le=200_000)
    overall_timeout_seconds: float = Field(default=90.0, gt=0, le=600)
    request_budget_key: str | None = Field(default=None, min_length=1)


class AgentExecutionContext(Record):
    """Trusted execution context for exactly one investigation run.

    Must be created by the calling backend from an already-authorized
    ``AuthorizationContext`` (see ``backend/app/security.py``) plus a
    server-chosen, explicit list of approved skill (id, version) pins and a
    fresh ``run_id``. Never constructed from model output, ADK session
    state, or unvalidated request JSON. One instance is scoped to one run —
    sharing an instance across concurrent runs would defeat the per-run
    isolation ``backend/app/agent/run_state.py`` relies on.
    """
    authorization: AuthorizationContext
    run_id: str = Field(min_length=1)
    model_role: ModelRole = ModelRole.DEFAULT
    approved_skills: tuple[ApprovedSkill, ...] = Field(min_length=1)
    limits: RuntimeLimits = Field(default_factory=RuntimeLimits)

    @model_validator(mode="after")
    def unique_skill_ids(self):
        ids = [skill.skill_id for skill in self.approved_skills]
        if len(ids) != len(set(ids)):
            raise ValueError("approved_skills must not repeat a skill_id")
        return self


class InvestigationRequest(Record):
    """A scoped company-data investigation question. ``entity_id`` is only a
    hint for prompt construction — it never substitutes for the ACL/tenant
    scoping already carried by ``AgentExecutionContext.authorization``, and
    the agent must still look it up through an authorized tool before
    treating it as real."""
    question: str = Field(min_length=1, max_length=4000)
    entity_id: str | None = Field(default=None, max_length=500)


class InvestigationStatus(StrEnum):
    COMPLETE = "COMPLETE"
    PARTIAL = "PARTIAL"
    INCOMPLETE = "INCOMPLETE"
    BLOCKED = "BLOCKED"


class SkillUsageRecord(Record):
    """Exactly what was actually loaded and used — never a skill the model
    merely mentioned in text."""
    skill_id: str = Field(min_length=1)
    version: str = Field(min_length=1)
    content_digest: str = Field(min_length=64, max_length=64)
    trust_status: str = Field(min_length=1)


class ToolCallRecord(Record):
    """One authorized tool invocation actually executed by
    ``backend.app.tools.executor.ToolExecutor`` during this run."""
    tool_id: str = Field(min_length=1)
    version: str = Field(min_length=1)
    status: str = Field(min_length=1)
    evidence_refs: tuple[str, ...] = ()
    graph_revision: int | None = None


class ModelUsageSummary(Record):
    """Aggregated across every ``ModelGateway.generate()`` call made during
    this run — sourced from ``ModelResponse.usage``, never re-estimated."""
    llm_calls: int = Field(default=0, ge=0)
    total_input_tokens: int = Field(default=0, ge=0)
    total_output_tokens: int = Field(default=0, ge=0)
    total_tokens: int = Field(default=0, ge=0)
    estimated_cost_usd: float | None = Field(default=None, ge=0)
    tool_calls: int = Field(default=0, ge=0)


class InvestigationResult(Record):
    """The agent's structured, evidence-backed result.

    ``entity_ids``/``relationship_ids``/``evidence_refs``/``graph_revision``
    are built by the orchestrator (``backend/app/agent/investigator.py``)
    from actually-executed ``ToolResult`` payloads — never parsed out of the
    model's free-text answer. ``summary``/``findings`` are the model's
    narrative and may describe more than the structured fields capture, but
    the structured fields are the only parts the application treats as
    verified. ``rejected_unverified_claims`` names anything the model's
    narrative referenced that no tool call actually returned.
    """
    run_id: str = Field(min_length=1)
    status: InvestigationStatus
    summary: str = Field(min_length=1, max_length=4000)
    findings: tuple[str, ...] = ()
    entity_ids: tuple[str, ...] = ()
    relationship_ids: tuple[str, ...] = ()
    evidence_refs: tuple[str, ...] = ()
    graph_revision: int | None = None
    unresolved_conflicts: tuple[str, ...] = ()
    source_coverage_limitations: tuple[str, ...] = ()
    rejected_unverified_claims: tuple[str, ...] = ()
    # Stage 11 (ND-11B/C): the subset of ``relationship_ids`` (already included
    # there) that this run's deterministic candidate-validation step actually
    # newly committed to the graph via ``GraphRepository.ingest`` versus found
    # already current from an earlier run of the same/different objective over
    # unchanged evidence (``ingest``'s own content-hash idempotency — see
    # ``backend/app/agent/discovery.py``). Both default empty for every
    # investigation that never reaches objective-driven discovery (e.g. GH-007A
    # callers), so this is purely additive.
    newly_discovered_relationship_ids: tuple[str, ...] = ()
    reused_relationship_ids: tuple[str, ...] = ()
    skill_used: SkillUsageRecord | None = None
    model_usage: ModelUsageSummary = Field(default_factory=ModelUsageSummary)
    tool_calls: tuple[ToolCallRecord, ...] = ()
    error_message: str | None = Field(default=None, max_length=1000)


class SpecialistRole(StrEnum):
    """ND-13A bounded specialist roles. See ``backend/app/agent/coordinator.py``."""
    DISCOVERY = "DISCOVERY"
    IMPACT = "IMPACT"
    SYNTHESIS = "SYNTHESIS"


class CoordinatorBudget(Record):
    """The ONE shared budget enforced across every specialist pass of a
    coordinated investigation (ND-13A section 3). Each pass is handed a
    ``RuntimeLimits`` carved out of whatever remains here when it starts —
    never a fresh, independent allowance. Deliberately small defaults, same
    spirit as ``RuntimeLimits``."""
    max_total_tool_calls: int = Field(default=16, ge=1, le=200)
    max_total_llm_calls: int = Field(default=12, ge=1, le=100)
    overall_timeout_seconds: float = Field(default=150.0, gt=0, le=1200)


class SpecialistResult(Record):
    """The small, structured handoff contract between specialist passes
    (ND-13A section 5) — never a raw tool payload or conversation history.
    Built entirely from an already-executed ``InvestigationResult`` (or, for
    SYNTHESIS, from the prior specialists' own ``SpecialistResult``s) —
    never from a specialist's free-text narrative."""
    role: SpecialistRole
    status: InvestigationStatus
    skill_used: SkillUsageRecord | None = None
    entity_ids: tuple[str, ...] = ()
    relationship_ids: tuple[str, ...] = ()
    evidence_refs: tuple[str, ...] = ()
    graph_revision: int | None = None
    unresolved_conflicts: tuple[str, ...] = ()
    source_coverage_limitations: tuple[str, ...] = ()
    rejected_unverified_claims: tuple[str, ...] = ()
    summary: str = Field(default="", max_length=4000)
    tool_calls_made: int = Field(default=0, ge=0)
    tool_ids_called: tuple[str, ...] = ()
    llm_calls_made: int = Field(default=0, ge=0)
    skipped_reason: str | None = Field(default=None, max_length=500)


class CoordinatedInvestigationResult(Record):
    """ND-13A's coordinated-investigation result: what a discovery + impact +
    synthesis pass over the existing infrastructure actually produced.
    ``verification_status`` is always ``PENDING_INDEPENDENT_VERIFICATION``
    here — ND-13A performs no independent verification of synthesized
    conclusions; that is ND-13B's job (see module docstring of
    ``backend/app/agent/coordinator.py``)."""
    run_id: str = Field(min_length=1)
    status: InvestigationStatus
    summary: str = Field(min_length=1, max_length=4000)
    entity_ids: tuple[str, ...] = ()
    relationship_ids: tuple[str, ...] = ()
    evidence_refs: tuple[str, ...] = ()
    graph_revision: int | None = None
    unresolved_conflicts: tuple[str, ...] = ()
    source_coverage_limitations: tuple[str, ...] = ()
    specialist_results: tuple[SpecialistResult, ...] = ()
    model_usage: ModelUsageSummary = Field(default_factory=ModelUsageSummary)
    incomplete_work: tuple[str, ...] = ()
    verification_status: str = "PENDING_INDEPENDENT_VERIFICATION"
    error_message: str | None = Field(default=None, max_length=1000)
