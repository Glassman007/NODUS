"""Narrow adapter between ADK tool calls and the existing
``backend.app.tools.registry.ToolRegistry`` / ``backend.app.tools.executor.ToolExecutor``.

Per GH-007A section 4/5: this is *not* ADK's ``SkillToolset`` and does not
create a second, independent skill-trust system. It is a small, explicit
translation layer:

- ``SkillDiscoveryTool``/``SkillLoadInstructionsTool`` call straight into the
  existing, production ``SkillRegistry`` (trust/digest/revocation
  enforcement unchanged) and record the pinned skill selection on the
  current run's ``RunState`` — never activating a different version of the
  shared registry, and never letting the model switch skills mid-run.
- ``DeterministicToolAdapter`` wraps one ``ToolSpec`` and, at call time,
  checks that the tool is declared compatible by the run's *already
  selected* skill before invoking ``ToolExecutor.execute`` with the
  server-owned ``AuthorizationContext``. The model supplies only a tool name
  and JSON-schema-validated arguments; it never supplies tenant/workspace/
  principal identity, and ``ToolExecutor``/``ToolPolicy`` remain the sole
  authority on whether the call is actually authorized — this adapter's own
  skill-compatibility check is an additional restriction, never a grant.

Only ``READ_ONLY`` tools are ever exposed (enforced both by only wiring
read-only tool specs here and, independently, by ``ToolExecutor`` itself
default-denying any ``MUTATION``-effect tool). No raw Cypher, no Python/
shell execution, no filesystem/network access and no arbitrary external API
tool is ever reachable through this bridge.
"""
from __future__ import annotations

from google.adk.tools.base_tool import BaseTool
from google.adk.tools.tool_context import ToolContext
from google.genai import types

from backend.app.agent.run_state import SkillAlreadySelectedError, current_run
from backend.app.skills.errors import (
    RevokedSkillError, SkillIntegrityError, UnknownSkillVersionError, UntrustedSkillError,
)
from backend.app.skills.registry import SkillRegistry
from backend.app.tools.contracts import ToolInvocation
from backend.app.tools.registry import SideEffect, ToolRegistry, ToolSpec


def _adk_name(tool_id: str) -> str:
    """Gemini function names must not contain '.': ``graph.entity_lookup``
    becomes ``graph_entity_lookup``. The mapping back to the real
    ``(tool_id, version)`` lives on the adapter instance, never inferred by
    re-splitting the sanitized name."""
    return tool_id.replace(".", "_").replace("-", "_")


class SkillDiscoveryTool(BaseTool):
    """Level A: lists only the skills this run's backend-approved pin list
    allows — metadata only, never an instruction body (keeps discovery cheap
    and never discloses an un-approved skill's existence as usable)."""

    def __init__(self) -> None:
        super().__init__(name="skill_discover",
                         description="List the trusted skills available for this investigation, "
                                     "with a short description of when each applies. Call this first.")

    def _get_declaration(self) -> types.FunctionDeclaration:
        return types.FunctionDeclaration(name=self.name, description=self.description,
                                         parameters_json_schema={"type": "object", "properties": {}})

    async def run_async(self, *, args: dict, tool_context: ToolContext) -> dict:
        run_state = current_run()
        items = []
        for approved in run_state.exec_context.approved_skills:
            try:
                descriptor = run_state.skill_registry.resolve(approved.skill_id, approved.version)
            except (UnknownSkillVersionError, RevokedSkillError, UntrustedSkillError) as exc:
                items.append({"skill_id": approved.skill_id, "version": approved.version,
                             "available": False, "reason": str(exc)})
                continue
            items.append({
                "skill_id": descriptor.skill_id, "version": descriptor.version,
                "description": descriptor.description, "effect": descriptor.effect.value,
                "required_capabilities": list(descriptor.required_capabilities),
                "available": True,
            })
        return {"skills": items}


class SkillLoadInstructionsTool(BaseTool):
    """Level B: loads exactly one approved skill's instructions, at its
    server-pinned version, verifying its content digest on every load
    (``SkillRegistry.get_instructions``). Records the selection on
    ``RunState`` — a second call naming a *different* skill is rejected
    rather than silently switching the run's active skill."""

    def __init__(self) -> None:
        super().__init__(name="skill_load_instructions",
                         description="Load the instructions for one trusted skill by skill_id, so you can "
                                     "follow its procedure exactly. You may only load one skill per "
                                     "investigation.")

    def _get_declaration(self) -> types.FunctionDeclaration:
        return types.FunctionDeclaration(
            name=self.name, description=self.description,
            parameters_json_schema={
                "type": "object",
                "properties": {"skill_id": {"type": "string", "description": "The skill_id from skill_discover."}},
                "required": ["skill_id"],
            },
        )

    async def run_async(self, *, args: dict, tool_context: ToolContext) -> dict:
        run_state = current_run()
        skill_id = args.get("skill_id")
        if not isinstance(skill_id, str) or not skill_id:
            return {"error": "skill_id is required"}

        version = run_state.approved_version(skill_id)
        if version is None:
            return {"error": f"{skill_id!r} is not an approved skill for this run"}

        try:
            descriptor = run_state.skill_registry.resolve(skill_id, version)
            manifest = run_state.skill_registry.manifest(skill_id, version)
            instructions = run_state.skill_registry.get_instructions(skill_id, version)
        except (UnknownSkillVersionError, RevokedSkillError, UntrustedSkillError, SkillIntegrityError) as exc:
            run_state.skill_load_errors.append(f"{skill_id}@{version}: {exc}")
            return {"error": str(exc)}

        try:
            run_state.select_skill(descriptor, manifest)
        except SkillAlreadySelectedError as exc:
            return {"error": str(exc)}

        return {
            "skill_id": descriptor.skill_id, "version": descriptor.version,
            "content_digest": descriptor.content_digest, "instructions": instructions.body,
            "compatible_tools": [f"{dep.tool_id}" for dep in manifest.compatible_tools],
        }


class DeterministicToolAdapter(BaseTool):
    """Wraps exactly one registered, read-only ``ToolSpec``."""

    def __init__(self, spec: ToolSpec) -> None:
        if spec.side_effect is not SideEffect.READ_ONLY:
            raise ValueError(f"{spec.tool_id}: only READ_ONLY tools may be exposed to the agent")
        super().__init__(name=_adk_name(spec.tool_id), description=spec.description)
        self.spec = spec

    def _get_declaration(self) -> types.FunctionDeclaration:
        schema = self.spec.input_model.model_json_schema()
        schema.pop("title", None)
        return types.FunctionDeclaration(name=self.name, description=self.description,
                                         parameters_json_schema=schema)

    async def run_async(self, *, args: dict, tool_context: ToolContext) -> dict:
        run_state = current_run()

        if run_state.selected_skill_manifest is None:
            return {"error": "No trusted skill has been selected yet. Call skill_discover and "
                             "skill_load_instructions first."}
        if not run_state.tool_allowed(self.spec.tool_id, self.spec.version):
            return {"error": f"{self.spec.tool_id}@{self.spec.version} is not declared compatible by the "
                             f"selected skill {run_state.selected_skill_descriptor.skill_id}"}
        if run_state.tool_calls_made >= run_state.exec_context.limits.max_tool_calls:
            return {"error": "Per-run tool call limit reached; stop calling tools and summarize what you "
                             "have so far."}

        invocation = ToolInvocation(
            tool_id=self.spec.tool_id, version=self.spec.version, arguments=args or {},
            context=run_state.exec_context.authorization, correlation_id=run_state.exec_context.run_id,
        )
        result = run_state.tool_executor.execute(invocation)
        run_state.record_tool_result(self.spec.tool_id, self.spec.version, result, arguments=args)
        return result.model_dump(mode="json")


def build_investigation_tools(tool_registry: ToolRegistry,
                              permitted_tool_ids: "frozenset[tuple[str, str]]") -> list[BaseTool]:
    """Builds the full static tool list for the investigator's single
    ``LlmAgent``: skill discovery/loading plus every ``(tool_id, version)``
    in ``permitted_tool_ids`` — tools declared compatible by at least one of
    the run's approved skills *and* actually permitted for the calling
    principal (computed by ``backend/app/agent/investigator.py``).

    This pre-filter is a UX/cost optimization only (an unreachable tool is
    simply never offered to the model); it grants nothing by itself.
    ``DeterministicToolAdapter.run_async`` still re-checks skill
    compatibility at call time, and ``ToolExecutor``/``ToolPolicy`` still
    perform the real authorization check on every single call.
    """
    tools: list[BaseTool] = [SkillDiscoveryTool(), SkillLoadInstructionsTool()]
    for tool_id, version in sorted(permitted_tool_ids):
        spec = tool_registry.resolve(tool_id, version)
        if spec is None or spec.side_effect is not SideEffect.READ_ONLY:
            continue
        tools.append(DeterministicToolAdapter(spec))
    return tools
