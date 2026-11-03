"""Offline check for the public, demo-mode-gated /api/v1/nexus/demo-identities
endpoint used by the judge-facing login screen's Demo Access panel. No
Postgres/Neo4j fixture is needed: the endpoint reads only the static
in-process demo-user map.
"""
from __future__ import annotations

from fastapi.testclient import TestClient

import backend.app.main as main


def test_demo_identities_listed_when_demo_mode_enabled(monkeypatch):
    monkeypatch.setenv("GRAPH_HACKS_NEXUS_DEMO_MODE", "true")
    client = TestClient(main.app)
    response = client.get("/api/v1/nexus/demo-identities")
    assert response.status_code == 200
    items = response.json()["items"]
    by_token = {item["token"]: item for item in items}
    assert set(by_token) == {"4", "dev-02-pay", "intern-10-com"}
    assert by_token["4"]["role_code"] == "ADMIN"
    assert by_token["4"]["project_id"] is None
    assert by_token["dev-02-pay"]["display_name"] == "Arav Mehta"
    assert by_token["dev-02-pay"]["role_code"] == "DEVELOPER"
    assert by_token["dev-02-pay"]["project_id"] == "NEX-PRJ-PAY"
    assert by_token["intern-10-com"]["display_name"] == "Anika Bose"
    assert by_token["intern-10-com"]["role_code"] == "INTERN"
    assert by_token["intern-10-com"]["project_id"] == "NEX-PRJ-COM"


def test_demo_identities_hidden_when_demo_mode_disabled(monkeypatch):
    monkeypatch.setenv("GRAPH_HACKS_NEXUS_DEMO_MODE", "false")
    client = TestClient(main.app)
    response = client.get("/api/v1/nexus/demo-identities")
    assert response.status_code == 404
