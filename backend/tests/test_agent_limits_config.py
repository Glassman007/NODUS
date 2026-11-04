"""Focused tests for the environment-driven agent execution budgets
(backend.app.agent.limits_config) -- see the pasted NODUS directive this
satisfies: the old 10 LLM-call / 8 tool-call pass defaults and 150s/12-call/
16-tool-call coordinator defaults must not silently cap a normal
investigation, and the new defaults must be configurable without editing
code."""
from __future__ import annotations

import importlib

import backend.app.agent.coordinator as coordinator
import backend.app.agent.limits_config as limits_config


def test_default_runtime_limits_match_the_new_per_pass_minimums():
    limits = limits_config.default_runtime_limits()
    assert limits.max_llm_calls == 250
    assert limits.max_tool_calls == 1250


def test_default_coordinator_budget_matches_the_new_per_investigation_minimums():
    budget = limits_config.default_coordinator_budget()
    assert budget.max_total_llm_calls == 1000
    assert budget.max_total_tool_calls == 5000


def test_runtime_limits_env_overrides_are_honored(monkeypatch):
    monkeypatch.setenv("GRAPH_HACKS_AGENT_MAX_LLM_CALLS_PER_PASS", "300")
    monkeypatch.setenv("GRAPH_HACKS_AGENT_MAX_TOOL_CALLS_PER_PASS", "1500")
    monkeypatch.setenv("GRAPH_HACKS_AGENT_PASS_TIMEOUT_SECONDS", "900")
    limits = limits_config.default_runtime_limits()
    assert limits.max_llm_calls == 300
    assert limits.max_tool_calls == 1500
    assert limits.overall_timeout_seconds == 900.0


def test_coordinator_budget_env_overrides_are_honored(monkeypatch):
    monkeypatch.setenv("GRAPH_HACKS_AGENT_MAX_LLM_CALLS_PER_INVESTIGATION", "1500")
    monkeypatch.setenv("GRAPH_HACKS_AGENT_MAX_TOOL_CALLS_PER_INVESTIGATION", "6000")
    budget = limits_config.default_coordinator_budget()
    assert budget.max_total_llm_calls == 1500
    assert budget.max_total_tool_calls == 6000


def test_coordinator_module_default_pass_limits_come_from_limits_config():
    # Guards against a future edit reintroducing a hardcoded 10/8 default
    # directly in coordinator.py instead of going through limits_config.
    assert coordinator._DEFAULT_PASS_LIMITS.max_llm_calls == limits_config._DEFAULT_PASS_MAX_LLM_CALLS
    assert coordinator._DEFAULT_PASS_LIMITS.max_tool_calls == limits_config._DEFAULT_PASS_MAX_TOOL_CALLS
    assert coordinator._DEFAULT_PASS_LIMITS.max_llm_calls > 10
    assert coordinator._DEFAULT_PASS_LIMITS.max_tool_calls > 8
