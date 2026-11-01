"""Bounded snapshots of validated retrievals; never extract evidence from prose."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone

from pydantic import Field, model_validator

from backend.app.contracts import Record


def canonical(value: dict) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


class EvidenceSnapshot(Record):
    evidence_id: str
    run_id: str
    source_id: str
    record_id: str
    kind: str
    locator: str
    excerpt: str = Field(max_length=16000)
    content_hash: str
    retrieved_at: str
    tool_id: str
    graph_revision: int | None = None
    include_history: bool = False

    @model_validator(mode="after")
    def valid_hash(self):
        if self.locator.startswith("history/") != self.include_history:
            raise ValueError("Evidence retrieval mode mismatch")
        if hashlib.sha256(self.excerpt.encode()).hexdigest() != self.content_hash:
            raise ValueError("Evidence snapshot hash mismatch")
        expected = evidence_identifier(self.run_id, self.source_id, self.record_id,
                                       self.locator, self.content_hash)
        if self.evidence_id != expected:
            raise ValueError("Evidence identifier mismatch")
        payload = json.loads(self.excerpt)
        if not isinstance(payload, dict) or self.kind not in ("GRAPH_RELATIONSHIP", "ENTITY_ASSERTION", "RECORD_METADATA"):
            raise ValueError("Invalid retrieved evidence projection")
        source = payload.get("source_id_ref") if self.kind == "GRAPH_RELATIONSHIP" else payload.get("source_id")
        if source != self.source_id or payload.get("record_id") != self.record_id:
            raise ValueError("Evidence origin does not match retrieved projection")
        if self.kind == "GRAPH_RELATIONSHIP" and not all(payload.get(key) for key in ("id", "source_id", "target_id", "type")):
            raise ValueError("Relationship evidence requires an exact typed edge")
        return self


def evidence_identifier(run: str, source: str, record: str, locator: str, digest: str) -> str:
    key = canonical(dict(run=run, source=source, record=record, locator=locator, digest=digest))
    return "ev_" + hashlib.sha256(key.encode()).hexdigest()


class StructuredFinding(Record):
    finding_id: str
    claim: str = Field(max_length=4000)
    claim_type: str = "NARRATIVE"
    verification_status: str = "UNVERIFIED"
    evidence_ids: tuple[str, ...] = ()
    entity_ids: tuple[str, ...] = ()
    relationship_ids: tuple[str, ...] = ()
    explanation: str = "Narrative has not been independently established by retrieved evidence."


def capture(run_id: str, tool_id: str, data: dict, revision: int | None,
            scope: frozenset[str] | None, registry: dict[str, EvidenceSnapshot],
            include_history: bool = False) -> tuple[str, ...]:
    """Only source-attributed objects in the actual validated response are eligible.

    GRAPH_RELATIONSHIP snapshots are graph projections, not quotes from original
    documents. RECORD_METADATA snapshots establish provenance only, not semantics.
    The same projection retrieved repeatedly has the same run-local evidence ID.
    """
    found: list[str] = []

    def walk(value, path: str):
        if isinstance(value, list):
            for item in value:
                walk(item, path)
        elif isinstance(value, dict):
            relationship = all(value.get(k) for k in ("id", "source_id", "target_id", "type"))
            source = value.get("source_id_ref") if relationship else value.get("source_id")
            record = value.get("record_id")
            if source and record:
                if scope is not None and source not in scope:
                    raise PermissionError("Retrieved evidence exceeds investigation source scope")
                excerpt = canonical(value)
                kind = "GRAPH_RELATIONSHIP" if relationship else (
                    "ENTITY_ASSERTION" if value.get("entity_id") and "name" in value else "RECORD_METADATA")
                locator = f"relationship:{value['id']}" if relationship else f"record:{record}:{path}"
                if include_history:
                    locator = "history/" + locator
                digest = hashlib.sha256(excerpt.encode()).hexdigest()
                identifier = evidence_identifier(run_id, source, record, locator, digest)
                if len(excerpt) > 16000 or (identifier not in registry and len(registry) >= 500):
                    raise OverflowError("Evidence snapshot limit reached")
                if identifier not in registry:
                    registry[identifier] = EvidenceSnapshot(
                        evidence_id=identifier, run_id=run_id, source_id=source, record_id=record,
                        kind=kind, locator=locator, excerpt=excerpt, content_hash=digest,
                        retrieved_at=datetime.now(timezone.utc).isoformat(), tool_id=tool_id,
                        graph_revision=revision, include_history=include_history)
                found.append(identifier)
            for key, child in value.items():
                if isinstance(child, (dict, list)):
                    walk(child, path + "/" + key)

    walk(data, "")
    return tuple(dict.fromkeys(found))



def narrative_finding(text: str, registry: dict[str, EvidenceSnapshot]) -> StructuredFinding:
    """Citations are membership checks only, never semantic verification."""
    import re
    refs = tuple(dict.fromkeys(re.findall(r"\bev_[A-Za-z0-9_-]+", text)))
    invalid = any(ref not in registry for ref in refs)
    return StructuredFinding(
        finding_id="narrative", claim=text[:4000], evidence_ids=refs,
        verification_status="INVALID_REFERENCE" if invalid else "UNVERIFIED",
        explanation="One or more cited evidence IDs were not retrieved in this run." if invalid else (
            "Generated analysis remains unverified; valid citations alone do not establish its claims."))


def narrative_findings(text: str, registry: dict[str, EvidenceSnapshot]) -> tuple[StructuredFinding, ...]:
    import re
    paragraphs = [part.strip() for part in re.split(r"\n\s*\n|\n(?=[-*] )", text) if part.strip()]
    return tuple(narrative_finding(part, registry).model_copy(update={"finding_id": f"narrative_{i}"})
                 for i, part in enumerate(paragraphs[:100]))
