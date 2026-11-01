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

from backend.app.agent.provenance import EvidenceSnapshot, StructuredFinding
from backend.app.resolution_models import ActionableProblem, OwnershipDecision

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
    max_llm_calls: int = Field(default=50, ge=1, le=50)
    max_tool_calls: int = Field(default=100, ge=1, le=100)
    max_output_tokens_per_call: int = Field(default=65_536, ge=1, le=65_536)
    max_total_tokens_per_call: int = Field(default=200_000, ge=1, le=200_000)
    overall_timeout_seconds: float = Field(default=600.0, gt=0, le=600)
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
    model_used: str | None = None


class InvestigationResult(Record):
    """The agent's structured, evidence-backed result.

    ``entity_ids``/``relationship_ids``/``evidence_refs``/``graph_revision``
    are built by the orchestrator (``backend/app/agent/investigator.py``)
    from actually-executed ``ToolResult`` payloads — never parsed out of the
    model's free-text answer. ``summary``/``findings`` are the model's
    narrative and may describe more than retrieval captured. Identifiers and
    citations establish provenance only; ``structured_findings`` carry explicit
    claim-level verification outcomes. ``rejected_unverified_claims`` names anything the model's
    narrative referenced that no tool call actually returned.
    """
    run_id: str = Field(min_length=1)
    status: InvestigationStatus
    summary: str = Field(min_length=1, max_length=4000)
    # Keep the compatible summary preview while retaining the available model analysis.
    full_analysis: str | None = Field(default=None, max_length=1_000_000)
    analysis_character_count: int | None = Field(default=None, ge=0)
    analysis_truncated: bool = False
    findings: tuple[str, ...] = ()
    evidence_registry: tuple[EvidenceSnapshot, ...] = ()
    structured_findings: tuple[StructuredFinding, ...] = ()
    verification_status: str = "UNVERIFIED"
    source_usage: dict[str, int] = Field(default_factory=dict)
    restricted_retrieval_attempts: int = Field(default=0, ge=0)
    selected_source_ids: tuple[str, ...] = ()
    requested_source_ids: tuple[str, ...] = ()
    verification_summary: dict[str, int] = Field(default_factory=dict)
    project_id: str | None = None
    starting_entity_id: str | None = None
    persistence_status: str = "UNAVAILABLE"
    actionable_findings: tuple[ActionableProblem, ...] = ()
    ownership_decisions: tuple[OwnershipDecision, ...] = ()
    resolution_status: str = "NOT_EVALUATED"
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

    @model_validator(mode="after")
    def valid_evidence_membership(self):
        identifiers = {item.evidence_id for item in self.evidence_registry}
        if len(identifiers) != len(self.evidence_registry) or any(
                item.run_id != self.run_id for item in self.evidence_registry):
            raise ValueError("Evidence registry must contain unique, run-bound snapshots")
        for finding in self.structured_findings:
            if finding.verification_status in ("SUPPORTED", "INFERRED") and (
                    not finding.evidence_ids or not set(finding.evidence_ids) <= identifiers):
                raise ValueError("Checked findings require this run's retrieved evidence")
        for problem in self.actionable_findings:
            if problem.verification_status == "SUPPORTED" and (not problem.evidence_ids or
                    not set((*problem.evidence_ids,*problem.ownership.evidence_ids)) <= identifiers):
                raise ValueError("Actionable problems require this run's problem and ownership evidence")
        return self

    @model_validator(mode="after")
    def consistent_analysis_bounds(self):
        if self.full_analysis is None:
            if self.analysis_character_count is not None or self.analysis_truncated:
                raise ValueError("Analysis metadata requires full_analysis")
        elif self.analysis_character_count is not None:
            length = len(self.full_analysis)
            if self.analysis_character_count < length:
                raise ValueError("Analysis character count cannot be shorter than returned analysis")
            if self.analysis_truncated != (self.analysis_character_count > length):
                raise ValueError("Analysis truncation metadata is inconsistent")
        elif self.analysis_truncated:
            raise ValueError("Truncated analysis requires the original character count")
        return self


class SpecialistRole(StrEnum):
    """ND-13A/13B bounded specialist roles. See ``backend/app/agent/coordinator.py``."""
    DISCOVERY = "DISCOVERY"
    IMPACT = "IMPACT"
    VERIFICATION = "VERIFICATION"
    SYNTHESIS = "SYNTHESIS"


class ClaimType(StrEnum):
    """ND-13B: what kind of statement a ``ClaimVerificationResult`` is
    checking — preserves the section-4 distinction between an observed fact,
    a derived potential impact, and (never produced by today's Stage 12
    tools) a demonstrated technical failure."""
    ENTITY_ASSERTION = "ENTITY_ASSERTION"
    DEPENDENCY_PATH = "DEPENDENCY_PATH"


class VerificationStatus(StrEnum):
    """ND-13B claim-verification outcome vocabulary (section 4). Never a
    numeric confidence score."""
    SUPPORTED = "SUPPORTED"
    PARTIALLY_SUPPORTED = "PARTIALLY_SUPPORTED"
    UNSUPPORTED = "UNSUPPORTED"
    CONTRADICTED = "CONTRADICTED"
    STALE = "STALE"
    NOT_CHECKED = "NOT_CHECKED"
    INFERRED = "INFERRED"
    INSUFFICIENT_EVIDENCE = "INSUFFICIENT_EVIDENCE"
    INVALID_REFERENCE = "INVALID_REFERENCE"
    SOURCE_RESTRICTED = "SOURCE_RESTRICTED"
    UNVERIFIED = "UNVERIFIED"


class ClaimVerificationResult(Record):
    """One independently-checked claim. Built only from a fresh, independent
    re-fetch through the existing tool gateway (``backend.app.tools.executor.
    ToolExecutor``) under the verifier's own freshly-refreshed authorization —
    never from re-asking the impact specialist's model whether its own
    answer looks right, and never from trusting a duplicate citation as a
    second independent confirmation (ND-13B section 5)."""
    claim_id: str = Field(min_length=1, max_length=500)
    claim_type: ClaimType
    claim_summary: str = Field(min_length=1, max_length=1000)
    status: VerificationStatus
    supporting_evidence_refs: tuple[str, ...] = ()
    contradicting_evidence_refs: tuple[str, ...] = ()
    graph_revision: int | None = None
    explanation: str = Field(default="", max_length=1000)
    limitations: tuple[str, ...] = ()


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
    claim_verifications: tuple[ClaimVerificationResult, ...] = ()
    model_used: str | None = None
    total_input_tokens: int = Field(default=0, ge=0)
    total_output_tokens: int = Field(default=0, ge=0)
    total_tokens: int = Field(default=0, ge=0)
    estimated_cost_usd: float | None = Field(default=None, ge=0)


class CoordinatedInvestigationResult(Record):
    """ND-13A/13B's coordinated-investigation result: what a discovery +
    impact + verification + synthesis pass over the existing infrastructure
    actually produced.

    ``verification_status`` (ND-13C section 1 fix — see
    ``backend.app.agent.coordinator.verification_status_for``) is one of:

    * ``"PENDING_INDEPENDENT_VERIFICATION"`` — verification never ran, or
      produced no claims at all.
    * ``"PARTIALLY_VERIFIED"`` — verification ran but did not reach a full,
      claim-level conclusion: some claim is ``NOT_CHECKED`` (budget/access)
      or ``STALE``, or every claim produced was only the weaker
      entity-existence-level check (no actual relationship/path claim was
      independently re-derived — the case for the three Stage 12 skills
      that carry no multi-hop finding shape today).
    * ``"INDEPENDENTLY_VERIFIED"`` — every claim reached a definitive,
      current outcome (``SUPPORTED``/``UNSUPPORTED``/``CONTRADICTED``) and at
      least one was an actual relationship-level (``DEPENDENCY_PATH``) check,
      not merely "the entity still exists". A claim coming back
      ``UNSUPPORTED``/``CONTRADICTED`` does not by itself prevent this value
      — independent verification succeeded at determining that, which is the
      point; only an incomplete check (``NOT_CHECKED``/``STALE``) does.

    Section 8's safe-synthesis buckets never promote a derived potential
    impact into a demonstrated technical failure, and never silently upgrade
    an unchecked/contradicted/stale claim to supported."""
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
    models_used: tuple[str, ...] = ()
    incomplete_work: tuple[str, ...] = ()
    verification_status: str = "PENDING_INDEPENDENT_VERIFICATION"
    supported_findings: tuple[str, ...] = ()
    potential_effects: tuple[str, ...] = ()
    unverified_findings: tuple[str, ...] = ()
    contradictions: tuple[str, ...] = ()
    stale_findings: tuple[str, ...] = ()
    error_message: str | None = Field(default=None, max_length=1000)


class FreshnessStatus(StrEnum):
    """ND-14C: whether a persisted verification result can still be treated as describing the current
    graph state. Never a numeric confidence score."""
    CURRENT = "CURRENT"
    STALE = "STALE"
    REVERIFICATION_REQUIRED = "REVERIFICATION_REQUIRED"
    REVERIFIED = "REVERIFIED"
    UNAVAILABLE = "UNAVAILABLE"


class InvestigationHandoffPacket(Record):
    """ND-14B section 5: a compact, typed snapshot of an investigation's
    persisted state for a human-to-human handoff. Assembled entirely from
    already-authorized, already-structured persisted records
    (``backend.app.agent.persistence.InvestigationStore`` checkpoints) —
    never from a fresh LLM call, never a raw model conversation or
    unrestricted source document. See
    ``backend.app.agent.handoff.build_handoff_packet``, which is the only
    place this is constructed: it is returned only after confirming every
    evidence reference below is within the RECIPIENT's own current
    authorized source scope, never the original investigator's."""
    run_id: str = Field(min_length=1)
    objective: str
    original_creator: str
    current_owner: str
    intended_recipient: str | None = None
    status: str

    completed_phases: tuple[str, ...] = ()
    current_phase: str | None = None
    remaining_work: tuple[str, ...] = ()
    checkpoint_version: int = Field(default=0, ge=0)
    budget_usage: dict = Field(default_factory=dict)

    entity_ids: tuple[str, ...] = ()
    evidence_backed_findings: tuple[str, ...] = ()
    potential_impacts: tuple[str, ...] = ()
    uncertainties: tuple[str, ...] = ()

    supported_findings: tuple[str, ...] = ()
    unverified_findings: tuple[str, ...] = ()
    contradictions: tuple[str, ...] = ()
    stale_findings: tuple[str, ...] = ()
    evidence_refs: tuple[str, ...] = ()
    graph_revision: int | None = None

    outstanding_tasks: tuple[str, ...] = ()
    authorization_status: str = "AUTHORIZED"
    next_continuation_point: str = ""
    # ND-14C section 6: whether the verification findings above are still current as of generation time
    # — never silently presented as current when they are not. ``recipient_identity_validated`` is
    # ``None`` when no authoritative principal registry was available to check against (ND-14C section 8
    # — an honest "unknown", never treated as "valid").
    verification_freshness: str = FreshnessStatus.UNAVAILABLE.value
    recipient_identity_validated: bool | None = None
