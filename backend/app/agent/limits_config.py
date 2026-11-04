"""Environment-driven defaults for agent execution budgets, following the
same ``load_dotenv``/``.env`` convention as ``backend.app.gateway.config``.

Two distinct budgets exist (see ``backend.app.agent.contracts``):

* ``RuntimeLimits`` — ONE execution pass (one ``run_investigation`` call:
  the single GH-007A investigator, or one DISCOVERY/IMPACT pass of a
  coordinated investigation).
* ``CoordinatorBudget`` — the ONE shared budget across an entire
  coordinated investigation's DISCOVERY/IMPACT/VERIFICATION/SYNTHESIS
  passes, including everything already spent by a resumed run.

Both are configurable independently so a deployment can raise either
without editing code. Unset or blank environment variables fall back to
this module's own defaults, which satisfy the stage's required minimums
(1000 LLM calls / 5000 tool calls per complete investigation; 250 LLM
calls / 1250 tool calls per pass) — a production investigation must not
terminate merely because it used more than the OLD (10 LLM call / 8 tool
call pass, 150s coordinator) defaults.
"""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

from backend.app.agent.contracts import CoordinatorBudget, RuntimeLimits

_DEFAULT_PASS_MAX_LLM_CALLS = 250
_DEFAULT_PASS_MAX_TOOL_CALLS = 1250
_DEFAULT_PASS_TIMEOUT_SECONDS = 1800.0

_DEFAULT_INVESTIGATION_MAX_LLM_CALLS = 1000
_DEFAULT_INVESTIGATION_MAX_TOOL_CALLS = 5000
_DEFAULT_INVESTIGATION_TIMEOUT_SECONDS = 3600.0


def _env_path() -> Path:
    return Path(__file__).resolve().parents[3] / ".env"


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    return int(raw) if raw else default


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name, "").strip()
    return float(raw) if raw else default


def default_runtime_limits() -> RuntimeLimits:
    """The ``RuntimeLimits`` for ONE execution pass. Configurable via
    ``GRAPH_HACKS_AGENT_MAX_LLM_CALLS_PER_PASS`` /
    ``GRAPH_HACKS_AGENT_MAX_TOOL_CALLS_PER_PASS`` /
    ``GRAPH_HACKS_AGENT_PASS_TIMEOUT_SECONDS``. Callers that need a budget
    carved out of a SHARED, multi-pass allowance (``backend.app.agent.
    coordinator._carve_limits``) still start from this, then narrow it
    further to whatever remains of the coordinator's own budget — this
    function never itself tracks cross-pass usage."""
    load_dotenv(dotenv_path=_env_path(), override=False)
    return RuntimeLimits(
        max_llm_calls=_env_int("GRAPH_HACKS_AGENT_MAX_LLM_CALLS_PER_PASS", _DEFAULT_PASS_MAX_LLM_CALLS),
        max_tool_calls=_env_int("GRAPH_HACKS_AGENT_MAX_TOOL_CALLS_PER_PASS", _DEFAULT_PASS_MAX_TOOL_CALLS),
        overall_timeout_seconds=_env_float(
            "GRAPH_HACKS_AGENT_PASS_TIMEOUT_SECONDS", _DEFAULT_PASS_TIMEOUT_SECONDS),
    )


def default_coordinator_budget() -> CoordinatorBudget:
    """The ``CoordinatorBudget`` shared across one COMPLETE coordinated
    investigation (every specialist pass, including a resumed run's
    already-spent usage). Configurable via
    ``GRAPH_HACKS_AGENT_MAX_LLM_CALLS_PER_INVESTIGATION`` /
    ``GRAPH_HACKS_AGENT_MAX_TOOL_CALLS_PER_INVESTIGATION`` /
    ``GRAPH_HACKS_AGENT_INVESTIGATION_TIMEOUT_SECONDS``."""
    load_dotenv(dotenv_path=_env_path(), override=False)
    return CoordinatorBudget(
        max_total_tool_calls=_env_int(
            "GRAPH_HACKS_AGENT_MAX_TOOL_CALLS_PER_INVESTIGATION", _DEFAULT_INVESTIGATION_MAX_TOOL_CALLS),
        max_total_llm_calls=_env_int(
            "GRAPH_HACKS_AGENT_MAX_LLM_CALLS_PER_INVESTIGATION", _DEFAULT_INVESTIGATION_MAX_LLM_CALLS),
        overall_timeout_seconds=_env_float(
            "GRAPH_HACKS_AGENT_INVESTIGATION_TIMEOUT_SECONDS", _DEFAULT_INVESTIGATION_TIMEOUT_SECONDS),
    )
