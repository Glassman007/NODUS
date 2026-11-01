"""Fixed local-demo logins. No PostgreSQL, Neo4j, or imported identities required.

These deliberately guessable tokens are never used unless
GRAPH_HACKS_NEXUS_DEMO_MODE=true. This is a demo identity snapshot, not
production authentication or dynamically revocable database authorization.
"""
from __future__ import annotations

from dataclasses import dataclass
from types import MappingProxyType

from backend.app.governance.demo_tokens import canonical_demo_token


_SHARED_SOURCES = (
    "NEX-SRC-COMPANY_FOUNDATION", "NEX-SRC-KNOWLEDGE_HUB",
    "NEX-SRC-SERVICE_CATALOG", "NEX-SRC-INTERFACE_REGISTRY",
    "NEX-SRC-ARCHITECTURE_DECISIONS",
)
_PROJECT_SOURCES = MappingProxyType({
    "NEX-PRJ-PAY": ("NEX-SRC-PAY-REPO", "NEX-SRC-PAY-ISSUES", "NEX-SRC-PAY-CI", "NEX-SRC-PAY-DISCUSS"),
    "NEX-PRJ-COM": ("NEX-SRC-COM-REPO", "NEX-SRC-COM-ISSUES", "NEX-SRC-COM-CI", "NEX-SRC-COM-DISCUSS"),
    "NEX-PRJ-ID": ("NEX-SRC-ID-REPO", "NEX-SRC-ID-ISSUES", "NEX-SRC-ID-CI", "NEX-SRC-ID-DISCUSS"),
    "NEX-PRJ-DATA": ("NEX-SRC-DATA-REPO", "NEX-SRC-DATA-ISSUES", "NEX-SRC-DATA-CI", "NEX-SRC-DATA-DISCUSS"),
})
_OTHER_ADMIN_SOURCES = (
    "NEX-SRC-PLAT-REPO", "NEX-SRC-PLAT-ISSUES", "NEX-SRC-PLAT-CI", "NEX-SRC-PLAT-DISCUSS",
    "NEX-SRC-ACCESS_GOVERNANCE", "NEX-SRC-PRIVILEGED_CHANGES",
    "NEX-SRC-VENDOR_GOVERNANCE", "NEX-SRC-SECURITY_GOVERNANCE",
)
_ALL_PROJECTS = tuple(_PROJECT_SOURCES)


@dataclass(frozen=True)
class DemoUser:
    employee_id: str
    display_name: str
    role_code: str
    project_ids: tuple[str, ...] = ()

    @property
    def source_ids(self) -> tuple[str, ...]:
        if self.role_code == "ADMIN":
            return tuple(sorted((*_SHARED_SOURCES,
                                 *(source for group in _PROJECT_SOURCES.values() for source in group),
                                 *_OTHER_ADMIN_SOURCES)))
        # Interns receive only company-shared sources, even when assigned to a project.
        if self.role_code == "INTERN":
            return tuple(sorted(_SHARED_SOURCES))
        return tuple(sorted((*_SHARED_SOURCES, *(
            source for project in self.project_ids for source in _PROJECT_SOURCES[project]
        ))))

    @property
    def capabilities(self) -> dict[str, bool]:
        admin = self.role_code == "ADMIN"
        return {
            "investigate": True, "generate_report": self.role_code != "INTERN",
            "request_access": True, "review_access_requests": admin,
            "approve_access_request": admin, "narrow_access_grant": admin,
            "deny_access_request": admin, "expire_access_grant": admin,
            "revoke_access_grant": admin, "issue_handoff": admin,
        }

    def session_summary(self) -> dict:
        return {
            "employee_id": self.employee_id, "display_name": self.display_name,
            "role_code": self.role_code, "company_id": "nexus",
            "project_ids": list(self.project_ids), "source_ids": list(self.source_ids),
            "capabilities": self.capabilities,
        }


_USERS = MappingProxyType({
    "4": DemoUser("NEX-EMP-001", "Leena Vardhan", "ADMIN", _ALL_PROJECTS),
    "D02": DemoUser("NEX-EMP-002", "Arav Mehta", "DEVELOPER", ("NEX-PRJ-PAY",)),
    "D03": DemoUser("NEX-EMP-003", "Sofia D'Souza", "DEVELOPER", ("NEX-PRJ-PAY",)),
    "D04": DemoUser("NEX-EMP-004", "Kabir Malhotra", "DEVELOPER", ("NEX-PRJ-COM",)),
    "D05": DemoUser("NEX-EMP-005", "Nisha Fernandes", "DEVELOPER", ("NEX-PRJ-COM",)),
    "D06": DemoUser("NEX-EMP-006", "Rohan Bhat", "DEVELOPER", ("NEX-PRJ-ID",)),
    "D07": DemoUser("NEX-EMP-007", "Ira Menon", "DEVELOPER", ("NEX-PRJ-ID",)),
    "D08": DemoUser("NEX-EMP-008", "Tara Chatterjee", "DEVELOPER", ("NEX-PRJ-DATA",)),
    "D09": DemoUser("NEX-EMP-009", "Dev Malik", "DEVELOPER", ("NEX-PRJ-DATA",)),
    "I10": DemoUser("NEX-EMP-010", "Anika Bose", "INTERN", ("NEX-PRJ-COM",)),
    "I11": DemoUser("NEX-EMP-011", "Yusuf Khan", "INTERN", ("NEX-PRJ-DATA",)),
    "I12": DemoUser("NEX-EMP-012", "Priya Nair", "INTERN", ("NEX-PRJ-ID",)),
})


def demo_user_for_token(token: str) -> DemoUser | None:
    """Exact token match; never parse user-controlled role/project from the token."""
    return _USERS.get(canonical_demo_token(token))
