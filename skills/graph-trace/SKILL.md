---
name: graph-trace
description: Trace connected company relationships from a starting entity using one-hop neighborhoods, reverse dependencies and bounded paths, distinguishing source-backed, observed, inferred and unsupported connections. Use when asked how two entities are connected or what an entity relates to.
compatibility: NODUS deterministic tool layer (Stage 04); no LLM required to execute the underlying tools.
---
# Graph trace

1. Resolve the starting entity:
   - If you already have a value that looks like a real canonical id
     (e.g. an unverified `entity_id` hint from the caller), try
     `graph.entity_lookup` with it first.
   - Otherwise, or if that returns NOT_FOUND, call `graph.search_entities`
     with the human-readable name/reference from the objective (e.g.
     "Identity", "payment service"). Never guess variations of an id
     yourself (no trying "identity-service", "service:identity", etc.) --
     the search tool already normalizes case, punctuation and spacing, and
     is the only approved way to turn a name into a canonical id.
   - `graph.search_entities` returns one of:
     - `status: "RESOLVED"` with one `resolved_entity` -- use its `id` as
       the canonical starting entity for every following tool call.
     - `status: "AMBIGUOUS"` with a bounded `candidates` list -- do not
       silently pick one. Report the candidates (id, name, type) and ask
       for disambiguation, unless the objective's own wording already
       names a specific type/context that uniquely picks one candidate.
     - a `NOT_FOUND` tool result -- no authorized entity matches; report
       that the referenced entity could not be found (or is not
       accessible), never that it definitely does not exist anywhere.
   - If a search for the exact same reference already came back
     NOT_FOUND/AMBIGUOUS earlier in this investigation, do not repeat it
     with a trivial rewording -- move on or report it as unresolved.
2. Record the graph revision via `graph.revision` so results can be
   compared against later state.
3. Choose the narrowest query for the question:
   - one-hop neighborhood -> `graph.neighborhood`
   - "what depends on this" -> `graph.reverse_dependencies`
   - a specific connection between two named entities -> `graph.find_paths`
   Never request unrestricted Cypher; only these bounded, typed tools.
4. Respect each tool's own `limit`/`max_depth` arguments and its reported
   `truncated` flag — report truncation explicitly rather than treating a
   partial result as complete.
5. For every relationship returned, read its `origin` field:
   - `source_asserted` -> a direct source-backed relationship.
   - `observed` -> a directly witnessed relationship.
   - `inferred` -> derived by an explicit rule (`derivation_rule_version`);
     report it as inferred, never as directly source-backed.
   A relationship absent from the result is unknown/unsupported — never
   assert a connection the tools did not return.
6. Use each relationship's `active` flag (and whether the call used
   `include_history`) to distinguish current from historical relationships;
   only an `include_history=true` call surfaces inactive ones, and those
   must be labeled historical.
7. Never infer ownership (`OWNS`) from an `AUTHORED`/`MODIFIES`
   relationship, and never infer a causal (`BLOCKS`) relationship purely
   from the relative `observed_at` ordering of two unrelated relationships.
8. Report only the nodes/relationships/paths the tools actually returned —
   never a hidden intermediate node or a path beyond what `graph.find_paths`
   or `graph.neighborhood` disclosed (ACL/authorization already scoped
   them; do not try to work around that).

Never modify graph state. This skill only reads.

## Output

- Task objective and the starting entity.
- Graph revision.
- Relevant entities and relationships, each labeled by origin
  (source-backed / observed / inferred) and current vs. historical.
- Evidence references, where the underlying tool provided them.
- Truncation/incompleteness, stated explicitly when `truncated` is true.
- Unknown or unsupported paths, named as such rather than omitted.
