"""Install fixed, DB-independent demo login into the existing NODUS main.py.

Run from any directory: python scripts/apply_static_demo_login.py

Does not modify .env, PostgreSQL, Neo4j, frontend, or unrelated backend files.
It intentionally fails safely if the expected auth hooks have changed.
"""
from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MAIN = ROOT / "backend" / "app" / "main.py"
MODULE = ROOT / "backend" / "app" / "governance" / "local_demo_login.py"
ALIASES = ROOT / "backend" / "app" / "governance" / "demo_tokens.py"

IMPORTS = (
    "from backend.app.governance.identity import ROLE_PERMISSIONS\n"
    "from backend.app.governance.local_demo_login import demo_user_for_token\n"
)
IMPORT_ANCHOR = "from backend.app.governance.store import GovernanceStore\n"

AUTH_ANCHOR = (
    "    demo_mode = isolated_demo_mode_enabled()\n"
    "    if governance_store is not None and demo_mode:\n"
)
AUTH_REPLACEMENT = (
    "    demo_mode = isolated_demo_mode_enabled()\n"
    "    if demo_mode:\n"
    "        local_user = demo_user_for_token(token)\n"
    "        if local_user is not None:\n"
    "            return Principal(\n"
    "                subject=f\"nexus:{local_user.employee_id}\", tenant_id=NEXUS_TENANT_ID,\n"
    "                workspaces=(NEXUS_WORKSPACE_ID,), permissions=ROLE_PERMISSIONS[local_user.role_code],\n"
    "                source_ids=local_user.source_ids,\n"
    "            )\n"
    "    if governance_store is not None and demo_mode:\n"
)

SESSION_ANCHOR = (
    "def nexus_session(request: Request, user: Principal = Depends(principal)):\n"
    "    governance_store = getattr(request.app.state, \"governance_store\", None)\n"
)
SESSION_REPLACEMENT = (
    "def nexus_session(request: Request, user: Principal = Depends(principal)):\n"
    "    # Static local-demo session. No governance/PostgreSQL query needed.\n"
    "    if isolated_demo_mode_enabled():\n"
    "        local_auth = request.headers.get(\"authorization\", \"\")\n"
    "        local_token = local_auth.split(\" \", 1)[1].strip() if \" \" in local_auth else \"\"\n"
    "        local_user = demo_user_for_token(local_token)\n"
    "        if local_user is not None and user.subject == f\"nexus:{local_user.employee_id}\" "
    "and user.tenant_id == NEXUS_TENANT_ID:\n"
    "            return local_user.session_summary()\n"
    "    governance_store = getattr(request.app.state, \"governance_store\", None)\n"
)


def main() -> None:
    if not MODULE.is_file() or not ALIASES.is_file():
        raise SystemExit("Missing demo modules. Extract the patch ZIP into the NODUS root first.")
    original = MAIN.read_bytes()
    newline = "\r\n" if b"\r\n" in original else "\n"
    source = original.decode("utf-8").replace("\r\n", "\n")
    if "from backend.app.governance.local_demo_login import demo_user_for_token" in source:
        if "demo_user_for_token(token)" in source and "session_summary()" in source:
            print("Static demo login is already installed. No changes made.")
            return
        raise SystemExit("Partial demo-login modification detected; main.py left unchanged.")

    for label, anchor in (("imports", IMPORT_ANCHOR), ("principal", AUTH_ANCHOR),
                          ("NEXUS session", SESSION_ANCHOR)):
        if source.count(anchor) != 1:
            raise SystemExit(f"Cannot safely locate {label} hook in main.py; no changes made.")

    source = source.replace(IMPORT_ANCHOR, IMPORTS + IMPORT_ANCHOR, 1)
    source = source.replace(AUTH_ANCHOR, AUTH_REPLACEMENT, 1)
    source = source.replace(SESSION_ANCHOR, SESSION_REPLACEMENT, 1)
    import ast
    ast.parse(source, filename=str(MAIN))

    backup = MAIN.with_name("main.py.before_static_demo_login.bak")
    if not backup.exists():
        backup.write_bytes(original)
    # Replace only this one file; never overwrite the user's other backend work.
    temp = MAIN.with_name("main.py.static_demo_login.tmp")
    temp.write_bytes(source.replace("\n", newline).encode("utf-8"))
    temp.replace(MAIN)
    print("Installed static demo login in backend/app/main.py")
    print(f"Backup: {backup}")
    print("Restart FastAPI with GRAPH_HACKS_NEXUS_DEMO_MODE=true; try token dev-02-pay")


if __name__ == "__main__":
    main()
