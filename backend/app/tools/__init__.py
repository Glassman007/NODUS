"""Deterministic tool execution foundation (Stage 04 / GH-005A, GH-005B).

No LLM, agent, ADK, skill-loader or Temporal dependency belongs in this
package — those are reserved for Stages 05+ (see
``docs/IMPLEMENTATION_ROADMAP.md``). Tool selection here is always explicit:
a caller names a ``tool_id``/``version`` and supplies validated arguments.

``register_all_tools`` is the single application-level registration entry
point; a future Google ADK (or any other) adapter can call it to populate a
``ToolRegistry`` without this package importing ADK itself.
"""
from __future__ import annotations

from backend.app.tools.evidence_tools import register_evidence_tools
from backend.app.tools.graph_tools import register_graph_tools
from backend.app.tools.ontology_tools import register_ontology_tools
from backend.app.tools.registry import ToolRegistry
from backend.app.tools.source_tools import register_source_tools


def register_all_tools(registry: ToolRegistry) -> None:
    register_graph_tools(registry)
    register_evidence_tools(registry)
    register_ontology_tools(registry)
    register_source_tools(registry)
