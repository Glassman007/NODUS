from __future__ import annotations

import hashlib
import time
from collections import deque
from datetime import datetime, timezone
from typing import Any

from backend.app.graph.driver import Neo4jStore
from backend.app.graph.models import Entity, Evidence, GraphPage, Relationship, SourceRecordInput


def scoped_key(*parts: str) -> str:
    return hashlib.sha256("\x1f".join(parts).encode("utf-8")).hexdigest()


def iso(value: datetime | None) -> str | None:
    return value.astimezone(timezone.utc).isoformat() if value else None


class GraphRepository:
    """All graph reads and writes require one authorized tenant/workspace context."""

    def __init__(self, store: Neo4jStore, tenant_id: str, workspace_id: str,
                 subject: str, allow_all: bool = False, can_evidence: bool = False):
        if not tenant_id or not workspace_id or not subject:
            raise ValueError("Tenant, workspace and subject are required")
        self.store = store
        self.tenant_id = tenant_id
        self.workspace_id = workspace_id
        self.subject = subject
        self.allow_all = allow_all
        self.can_evidence = can_evidence or allow_all

    def _params(self) -> dict[str, Any]:
        return dict(tenant=self.tenant_id, workspace=self.workspace_id,
                    subject=self.subject, allow_all=self.allow_all,
                    as_of=iso(datetime.now(timezone.utc)))

    @staticmethod
    def _resolve(entity_id: str, assertions: list[dict[str, Any]], active: bool = True) -> Entity:
        values: dict[str, Any] = {}
        conflicts: dict[str, list[str]] = {}
        for field in ("type", "name", "description"):
            choices = sorted({claim[field] for claim in assertions if claim.get(field) is not None})
            if len(choices) == 1:
                values[field] = choices[0]
            elif len(choices) > 1:
                values[field] = None
                conflicts[field] = choices
            else:
                values[field] = None
        return Entity(id=entity_id, type=values["type"], name=values["name"],
                      description=values["description"], active=active, conflicts=conflicts)

    def _relationship(self, rel, source_id: str, target_id: str) -> Relationship:
        return Relationship(
            id=rel["key"], source_id=source_id, target_id=target_id, type=rel.type,
            active=bool(rel.get("active")), observed_at=rel.get("observed_at"),
            valid_from=rel.get("valid_from"), valid_to=rel.get("valid_to"),
            source_id_ref=rel.get("source_id") if self.can_evidence else None,
            record_id=rel.get("record_id") if self.can_evidence else None,
        )

    @staticmethod
    def _claim(row) -> dict[str, Any]:
        assertion = row["a"]
        return dict(type=assertion.get("type"), name=assertion.get("name"),
                    description=assertion.get("description"))

    def _entity_in_tx(self, tx, entity_id: str, history: bool = False) -> Entity | None:
        key = scoped_key(self.tenant_id, self.workspace_id, entity_id)
        rows = list(tx.run("""
            MATCH (e:Entity {key:$key, tenant_id:$tenant, workspace_id:$workspace})
            MATCH (s:SourceRecord)-[a:ASSERTS]->(e)
            WHERE ($history OR (s.active=true AND a.active=true
              AND (a.valid_from IS NULL OR a.valid_from <= $as_of)
              AND (a.valid_to IS NULL OR a.valid_to > $as_of)))
              AND s.tenant_id=$tenant AND s.workspace_id=$workspace
              AND ($allow_all OR size(s.acl_subjects)=0 OR $subject IN s.acl_subjects)
              AND ($allow_all OR size(coalesce(a.acl_subjects, []))=0 OR $subject IN a.acl_subjects)
            RETURN e.public_id AS id, a, s.active AS source_active
            """, key=key, history=history, **self._params()))
        if not rows:
            return None
        current = [row for row in rows if row["source_active"] and row["a"].get("active")
                   and (not row["a"].get("valid_from") or row["a"]["valid_from"] <= iso(datetime.now(timezone.utc)))
                   and (not row["a"].get("valid_to") or row["a"]["valid_to"] > iso(datetime.now(timezone.utc)))]
        selected = current if current else rows
        return self._resolve(rows[0]["id"], [self._claim(row) for row in selected], active=bool(current))

    def get_entity(self, entity_id: str) -> Entity | None:
        return self.store.read(lambda tx: self._entity_in_tx(tx, entity_id))

    def get_entity_history(self, entity_id: str) -> Entity | None:
        return self.store.read(lambda tx: self._entity_in_tx(tx, entity_id, history=True))

    def assertions(self, entity_id: str, limit: int = 50) -> dict[str, Any]:
        if not self.can_evidence:
            raise PermissionError("Evidence permission required")
        key = scoped_key(self.tenant_id, self.workspace_id, entity_id)
        def work(tx):
            rows = list(tx.run("""
                MATCH (s:SourceRecord {tenant_id:$tenant, workspace_id:$workspace})
                      -[a:ASSERTS]->(e:Entity {key:$key, tenant_id:$tenant, workspace_id:$workspace})
                WHERE ($allow_all OR size(s.acl_subjects)=0 OR $subject IN s.acl_subjects)
                  AND ($allow_all OR size(coalesce(a.acl_subjects, []))=0 OR $subject IN a.acl_subjects)
                RETURN s, a ORDER BY s.source_id, s.record_id, a.observed_at DESC LIMIT $fetch
                """, key=key, **self._params(), fetch=limit + 1))
            items = []
            now = iso(datetime.now(timezone.utc))
            for row in rows[:limit]:
                s, a = row["s"], row["a"]
                current = bool(s["active"] and a["active"]
                               and (not a.get("valid_from") or a["valid_from"] <= now)
                               and (not a.get("valid_to") or a["valid_to"] > now))
                items.append({
                    "source_id": s["source_id"], "record_id": s["record_id"],
                    "type": a.get("type"), "name": a.get("name"),
                    "description": a.get("description"), "current": current,
                    "observed_at": a.get("observed_at"),
                    "valid_from": a.get("valid_from"), "valid_to": a.get("valid_to"),
                })
            return {"items": items, "truncated": len(rows) > limit}
        return self.store.read(work)

    def ingest(self, record: SourceRecordInput) -> dict[str, Any]:
        external_ids = {entity.external_id for entity in record.entities}
        if len(external_ids) != len(record.entities):
            raise ValueError("Duplicate entity external_id in source record")
        if any(rel.source_external_id not in external_ids or rel.target_external_id not in external_ids
               for rel in record.relationships):
            raise ValueError("Relationship endpoints must be in the same source record")
        if len({(rel.source_external_id, rel.target_external_id, rel.type) for rel in record.relationships}) != len(record.relationships):
            raise ValueError("Duplicate relationship in source record")
        tenant, workspace = self.tenant_id, self.workspace_id
        record_key = scoped_key(tenant, workspace, record.source_id, record.record_id)
        entity_keys = {
            entity.external_id: scoped_key(
                tenant, workspace, entity.canonical_id or f"{record.source_id}::{entity.external_id}"
            ) for entity in record.entities
        }
        public_ids = {
            entity.external_id: entity.canonical_id or f"{record.source_id}::{entity.external_id}"
            for entity in record.entities
        }

        def work(tx):
            tx.run("""
                MERGE (s:SourceRecord {key:$key})
                SET s.tenant_id=$tenant, s.workspace_id=$workspace, s.source_id=$source_id,
                    s.record_id=$record_id, s.title=$title, s.uri=$uri,
                    s.acl_subjects=$acl, s.observed_at=$observed_at,
                    s.revision=$revision, s.active=true
                """, key=record_key, tenant=tenant, workspace=workspace,
                source_id=record.source_id, record_id=record.record_id, title=record.title,
                uri=record.uri, acl=record.acl_subjects, observed_at=iso(record.observed_at),
                revision=record.revision).consume()
            tx.run("""
                MATCH (s:SourceRecord {key:$key})-[a:ASSERTS]->(:Entity)
                SET a.active=false
                """, key=record_key).consume()
            tx.run("""
                MATCH (:Entity)-[r]->(:Entity)
                WHERE r.record_key=$key AND r.tenant_id=$tenant AND r.workspace_id=$workspace
                SET r.active=false
                """, key=record_key, tenant=tenant, workspace=workspace).consume()
            for entity in record.entities:
                entity_key = entity_keys[entity.external_id]
                assertion_key = scoped_key(
                    record_key, entity_key, entity.type.value, entity.name,
                    entity.description, iso(entity.valid_from) or "", iso(entity.valid_to) or "",
                    record.revision or "", *sorted(record.acl_subjects),
                )
                tx.run("""
                    MATCH (s:SourceRecord {key:$record_key, tenant_id:$tenant, workspace_id:$workspace})
                    MERGE (e:Entity {key:$entity_key})
                    SET e.tenant_id=$tenant, e.workspace_id=$workspace, e.public_id=$public_id
                    MERGE (s)-[a:ASSERTS {key:$assertion_key}]->(e)
                    SET a.active=true, a.type=$type, a.name=$name,
                        a.description=$description, a.observed_at=$observed_at,
                        a.acl_subjects=$acl,
                        a.valid_from=$valid_from, a.valid_to=$valid_to
                    """, record_key=record_key, entity_key=entity_key,
                    assertion_key=assertion_key, tenant=tenant, workspace=workspace,
                    public_id=public_ids[entity.external_id], type=entity.type.value,
                    name=entity.name, description=entity.description,
                    acl=record.acl_subjects,
                    observed_at=iso(record.observed_at),
                    valid_from=iso(entity.valid_from), valid_to=iso(entity.valid_to)).consume()
            for rel in record.relationships:
                left, right = entity_keys[rel.source_external_id], entity_keys[rel.target_external_id]
                relation_key = scoped_key(
                    record_key, left, right, rel.type.value,
                    iso(rel.observed_at or record.observed_at) or "",
                    iso(rel.valid_from) or "", iso(rel.valid_to) or "",
                    record.revision or "", *sorted(record.acl_subjects),
                )
                # The token is an enum value. Request strings are never interpolated.
                tx.run(f"""
                    MATCH (a:Entity {{key:$left, tenant_id:$tenant, workspace_id:$workspace}})
                    MATCH (b:Entity {{key:$right, tenant_id:$tenant, workspace_id:$workspace}})
                    MERGE (a)-[r:{rel.type.value} {{key:$relation_key}}]->(b)
                    SET r.tenant_id=$tenant, r.workspace_id=$workspace, r.record_key=$record_key,
                        r.source_id=$source_id, r.record_id=$record_id, r.active=true,
                        r.observed_at=$observed_at, r.valid_from=$valid_from, r.valid_to=$valid_to,
                        r.acl_subjects=$acl
                    """, left=left, right=right, tenant=tenant, workspace=workspace,
                    relation_key=relation_key, record_key=record_key,
                    source_id=record.source_id, record_id=record.record_id,
                    acl=record.acl_subjects,
                    observed_at=iso(rel.observed_at or record.observed_at),
                    valid_from=iso(rel.valid_from), valid_to=iso(rel.valid_to)).consume()
            return {"source_id": record.source_id, "record_id": record.record_id,
                    "entities": len(record.entities), "relationships": len(record.relationships)}

        return self.store.write(work)

    def retract_record(self, source_id: str, record_id: str) -> bool:
        key = scoped_key(self.tenant_id, self.workspace_id, source_id, record_id)

        def work(tx):
            found = tx.run("""
                MATCH (s:SourceRecord {key:$key, tenant_id:$tenant, workspace_id:$workspace})
                SET s.active=false RETURN s.key AS key
                """, key=key, **self._params()).single()
            if not found:
                return False
            tx.run("MATCH (s:SourceRecord {key:$key})-[a:ASSERTS]->() SET a.active=false",
                   key=key).consume()
            tx.run("""
                MATCH (:Entity)-[r]->(:Entity)
                WHERE r.record_key=$key AND r.tenant_id=$tenant AND r.workspace_id=$workspace
                SET r.active=false
                """, key=key, **self._params()).consume()
            return True

        return self.store.write(work)

    def search(self, text: str, limit: int = 25, offset: int = 0) -> dict[str, Any]:
        if not 1 <= limit <= 100 or not 0 <= offset <= 10000:
            raise ValueError("Invalid pagination")
        needle = text.casefold()

        def work(tx):
            rows = list(tx.run("""
                MATCH (e:Entity {tenant_id:$tenant, workspace_id:$workspace})
                MATCH (s:SourceRecord)-[a:ASSERTS {active:true}]->(e)
                WHERE s.active=true AND s.tenant_id=$tenant AND s.workspace_id=$workspace
                  AND (a.valid_from IS NULL OR a.valid_from <= $as_of)
                  AND (a.valid_to IS NULL OR a.valid_to > $as_of)
                  AND ($allow_all OR size(s.acl_subjects)=0 OR $subject IN s.acl_subjects)
                  AND ($allow_all OR size(coalesce(a.acl_subjects, []))=0 OR $subject IN a.acl_subjects)
                WITH e, collect({type:a.type, name:a.name, description:a.description}) AS claims
                WHERE toLower(e.public_id) CONTAINS $needle
                   OR any(claim IN claims WHERE toLower(claim.name) CONTAINS $needle)
                RETURN e.public_id AS id, claims
                ORDER BY id SKIP $offset LIMIT $fetch
                """, **self._params(), needle=needle, offset=offset, fetch=limit + 1))
            return {"items": [self._resolve(row["id"], row["claims"]) for row in rows[:limit]],
                    "has_more": len(rows) > limit, "limit": limit, "offset": offset}

        return self.store.read(work)

    def neighborhood(self, entity_id: str, limit: int = 50,
                     include_history: bool = False, reverse_only: bool = False) -> GraphPage:
        if not 1 <= limit <= 100:
            raise ValueError("Invalid limit")
        key = scoped_key(self.tenant_id, self.workspace_id, entity_id)

        def work(tx):
            if self._entity_in_tx(tx, entity_id, history=include_history) is None:
                return GraphPage(nodes=[], relationships=[])
            rows = list(tx.run("""
                MATCH (root:Entity {key:$key, tenant_id:$tenant, workspace_id:$workspace})
                MATCH (root)-[r]-(other:Entity {tenant_id:$tenant, workspace_id:$workspace})
                WHERE r.tenant_id=$tenant AND r.workspace_id=$workspace
                  AND ($history OR (r.active=true
                    AND (r.valid_from IS NULL OR r.valid_from <= $as_of)
                    AND (r.valid_to IS NULL OR r.valid_to > $as_of)))
                  AND (NOT $reverse OR (endNode(r)=root AND type(r)='DEPENDS_ON'))
                  AND EXISTS {
                    MATCH (source:SourceRecord {key:r.record_key, tenant_id:$tenant, workspace_id:$workspace})
                    WHERE $allow_all OR size(source.acl_subjects)=0 OR $subject IN source.acl_subjects
                  }
                  AND ($allow_all OR size(coalesce(r.acl_subjects, []))=0 OR $subject IN r.acl_subjects)
                RETURN startNode(r).public_id AS source_id, endNode(r).public_id AS target_id, r
                ORDER BY r.active DESC, type(r), r.key LIMIT $fetch
                """, key=key, **self._params(), history=include_history,
                reverse=reverse_only, fetch=limit + 1))
            nodes: dict[str, Entity] = {}
            edges: list[Relationship] = []
            for row in rows[:limit]:
                source_id, target_id = row["source_id"], row["target_id"]
                source = nodes.get(source_id) or self._entity_in_tx(tx, source_id, history=include_history)
                target = nodes.get(target_id) or self._entity_in_tx(tx, target_id, history=include_history)
                if source is None or target is None:
                    continue
                nodes[source_id], nodes[target_id] = source, target
                edges.append(self._relationship(row["r"], source_id, target_id))
            return GraphPage(nodes=list(nodes.values()), relationships=edges,
                             truncated=len(rows) > limit)

        return self.store.read(work)

    def reverse_dependencies(self, entity_id: str, limit: int = 50) -> GraphPage:
        return self.neighborhood(entity_id, limit=limit, reverse_only=True)

    def relationship(self, relation_id: str) -> Relationship | None:
        def work(tx):
            row = tx.run("""
                MATCH (a:Entity {tenant_id:$tenant, workspace_id:$workspace})-[r]->
                      (b:Entity {tenant_id:$tenant, workspace_id:$workspace})
                WHERE r.key=$key AND r.active=true AND r.tenant_id=$tenant AND r.workspace_id=$workspace
                  AND (r.valid_from IS NULL OR r.valid_from <= $as_of)
                  AND (r.valid_to IS NULL OR r.valid_to > $as_of)
                  AND EXISTS {
                    MATCH (s:SourceRecord {key:r.record_key, tenant_id:$tenant, workspace_id:$workspace, active:true})
                    WHERE $allow_all OR size(s.acl_subjects)=0 OR $subject IN s.acl_subjects
                  }
                  AND ($allow_all OR size(coalesce(r.acl_subjects, []))=0 OR $subject IN r.acl_subjects)
                RETURN a.public_id AS source_id, b.public_id AS target_id, r
                """, key=relation_id, **self._params()).single()
            if row is None:
                return None
            if self._entity_in_tx(tx, row["source_id"]) is None or self._entity_in_tx(tx, row["target_id"]) is None:
                return None
            return self._relationship(row["r"], row["source_id"], row["target_id"])
        return self.store.read(work)

    def paths(self, source_id: str, target_id: str, max_depth: int = 3, limit: int = 10) -> dict[str, Any]:
        if not 1 <= max_depth <= 4 or not 1 <= limit <= 20:
            raise ValueError("Invalid path bounds")
        if self.get_entity(source_id) is None or self.get_entity(target_id) is None:
            return {"paths": [], "truncated": False, "coverage": "source_backed_only"}
        frontier = deque([(source_id, [source_id], [])])
        found: list[dict[str, Any]] = []
        visited = 0
        truncated = False
        deadline = time.monotonic() + 10
        while frontier and len(found) < limit and visited < 100 and time.monotonic() < deadline:
            current, ids, edges = frontier.popleft()
            visited += 1
            if len(edges) >= max_depth:
                continue
            graph = self.neighborhood(current, limit=50)
            truncated = truncated or graph.truncated
            for relation in graph.relationships:
                neighbor = relation.target_id if relation.source_id == current else relation.source_id
                if neighbor in ids:
                    continue
                next_ids, next_edges = ids + [neighbor], edges + [relation]
                if neighbor == target_id:
                    nodes = [self.get_entity(item) for item in next_ids]
                    if all(nodes):
                        found.append({"nodes": nodes, "relationships": next_edges})
                    if len(found) >= limit:
                        break
                elif len(next_edges) < max_depth and len(frontier) < 200:
                    frontier.append((neighbor, next_ids, next_edges))
                else:
                    truncated = True
        if frontier or visited >= 100 or time.monotonic() >= deadline:
            truncated = True
        return {"paths": found, "truncated": truncated, "coverage": "source_backed_only"}

    def evidence(self, entity_id: str, limit: int = 50) -> dict[str, Any]:
        if not self.can_evidence:
            raise PermissionError("Evidence permission required")
        key = scoped_key(self.tenant_id, self.workspace_id, entity_id)
        def work(tx):
            rows = list(tx.run("""
                MATCH (s:SourceRecord {tenant_id:$tenant, workspace_id:$workspace, active:true})
                      -[a:ASSERTS {active:true}]->(e:Entity {key:$key, tenant_id:$tenant, workspace_id:$workspace})
                WHERE ($allow_all OR size(s.acl_subjects)=0 OR $subject IN s.acl_subjects)
                  AND ($allow_all OR size(coalesce(a.acl_subjects, []))=0 OR $subject IN a.acl_subjects)
                  AND (a.valid_from IS NULL OR a.valid_from <= $as_of)
                  AND (a.valid_to IS NULL OR a.valid_to > $as_of)
                RETURN DISTINCT s ORDER BY s.source_id, s.record_id LIMIT $fetch
                """, key=key, **self._params(), fetch=limit + 1))
            return {"items": [Evidence(source_id=row["s"]["source_id"], record_id=row["s"]["record_id"],
                                       title=row["s"]["title"], uri=row["s"].get("uri"),
                                       observed_at=row["s"].get("observed_at")) for row in rows[:limit]],
                    "truncated": len(rows) > limit}
        return self.store.read(work)

    def sources(self, limit: int = 50) -> dict[str, Any]:
        if not self.can_evidence:
            raise PermissionError("Evidence permission required")
        def work(tx):
            rows = list(tx.run("""
                MATCH (s:SourceRecord {tenant_id:$tenant, workspace_id:$workspace, active:true})
                WHERE $allow_all OR size(s.acl_subjects)=0 OR $subject IN s.acl_subjects
                RETURN s.source_id AS id, count(s) AS records ORDER BY id LIMIT $fetch
                """, **self._params(), fetch=limit + 1))
            return {"items": [dict(row) for row in rows[:limit]], "truncated": len(rows) > limit}
        return self.store.read(work)

    def source_record(self, source_id: str, record_id: str) -> dict[str, Any] | None:
        if not self.can_evidence:
            raise PermissionError("Evidence permission required")
        key = scoped_key(self.tenant_id, self.workspace_id, source_id, record_id)
        def work(tx):
            row = tx.run("""
                MATCH (s:SourceRecord {key:$key, tenant_id:$tenant, workspace_id:$workspace, active:true})
                WHERE $allow_all OR size(s.acl_subjects)=0 OR $subject IN s.acl_subjects
                RETURN s
                """, key=key, **self._params()).single()
            if row is None:
                return None
            s = row["s"]
            return {"source_id": s["source_id"], "record_id": s["record_id"],
                    "title": s["title"], "uri": s.get("uri"),
                    "revision": s.get("revision"), "observed_at": s.get("observed_at")}
        return self.store.read(work)
