"""Bounded analysis preservation; no model, graph or storage calls."""
import pytest
from backend.app.agent.contracts import AgentExecutionContext, ApprovedSkill, InvestigationRequest, InvestigationResult
from backend.app.agent.investigator import _build_result
from backend.app.agent.run_state import RunState
from backend.app.security import AuthorizationContext, Permission, Principal


@pytest.mark.parametrize('length', [4500, 25000, 1_000_100])
def test_result_retains_analysis_beyond_compatible_preview(monkeypatch, length):
    principal = Principal(subject='test-reader', tenant_id='tenant', workspaces=('workspace',), permissions=frozenset({Permission.READ_GRAPH}))
    authorization = AuthorizationContext(principal=principal, tenant_id='tenant', workspace_id='workspace', task_id='task', permissions=principal.permissions)
    context = AgentExecutionContext(authorization=authorization, run_id='analysis-run', approved_skills=(ApprovedSkill(skill_id='graph-trace', version='1.0.0'),))
    state = RunState(exec_context=context, tool_executor=object(), skill_registry=object())
    analysis = 'A' * (length - 23) + 'Final analysis content.'
    monkeypatch.setattr('backend.app.agent.investigator._final_text', lambda events: analysis)
    result = _build_result(InvestigationRequest(question='Read the full analysis'), context, state, [], timed_out=False)
    assert result.summary == analysis[:4000]
    assert result.full_analysis == analysis[:1_000_000]
    assert result.analysis_character_count == len(analysis)
    assert result.analysis_truncated == (len(analysis) > 1_000_000)


def test_analysis_contract_accepts_legacy_results_and_checks_bounds():
    assert InvestigationResult(run_id='legacy', status='COMPLETE', summary='Preview').full_analysis is None
    with pytest.raises(ValueError):
        InvestigationResult(run_id='invalid', status='COMPLETE', summary='Preview', full_analysis='abc', analysis_character_count=1)
    with pytest.raises(ValueError):
        InvestigationResult(run_id='invalid', status='COMPLETE', summary='Preview', full_analysis='abc', analysis_character_count=4, analysis_truncated=False)
