# NODUS frontend

From this directory:

```powershell
npm.cmd install
npm.cmd run dev
```

Vite serves the page at http://127.0.0.1:5173 and proxies /api to
http://127.0.0.1:8000 by default. If FastAPI is using port 8001, run
`$env:NODUS_API_PROXY_TARGET = 'http://127.0.0.1:8001'` **before** starting
Vite. Start FastAPI separately from the repository root with the existing
Python environment and configured databases:

```powershell
.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

## Deterministic local-demo tokens

The NEXUS 7A dataset already defines the non-secret admin token `4` and
canonical developer/intern tokens (`D02`–`D09`, `I10`–`I12`). The backend now
also accepts these readable aliases **only in NEXUS demo mode**, after looking
up the same existing identity in PostgreSQL:

| Identity / initial project | Demo token |
| --- | --- |
| Administrator / company | `4` |
| Developer NEX-EMP-002 / NEXUS Pay | `dev-02-pay` |
| Developer NEX-EMP-003 / NEXUS Pay | `dev-03-pay` |
| Developer NEX-EMP-004 / NEXUS Commerce | `dev-04-com` |
| Developer NEX-EMP-005 / NEXUS Commerce | `dev-05-com` |
| Developer NEX-EMP-006 / NEXUS Identity | `dev-06-id` |
| Developer NEX-EMP-007 / NEXUS Identity | `dev-07-id` |
| Developer NEX-EMP-008 / NEXUS Insights | `dev-08-data` |
| Developer NEX-EMP-009 / NEXUS Insights | `dev-09-data` |
| Intern NEX-EMP-010 / NEXUS Commerce | `intern-10-com` |
| Intern NEX-EMP-011 / NEXUS Insights | `intern-11-data` |
| Intern NEX-EMP-012 / NEXUS Identity | `intern-12-id` |

The project suffix describes the **initial dataset assignment**, not a grant.
Neither the token nor frontend code determines privileges; role, project
membership and effective source grants are read afresh from the governance
database. Invalid tokens still return 401. Do not use these tokens as secrets
or enable this mode on a public server.

From the **repository root**, configure `POSTGRES_DSN`, Neo4j, and PostgreSQL
in your local `.env` (never commit it). With both databases running, import
the NEXUS dataset once (safe to rerun):

```dotenv
# Example: replace the password with your POSTGRES_PASSWORD from the same .env.
# URL-encode any special characters in the password when used in a DSN.
POSTGRES_DSN=postgresql://graphhacks:YOUR_POSTGRES_PASSWORD@localhost:5432/graphhacks
```

```powershell
docker compose up -d neo4j postgres
python scripts/import_nexus.py
```

In the **same terminal that launches FastAPI**, explicitly opt into demo mode:

```powershell
$env:GRAPH_HACKS_NEXUS_DEMO_MODE = 'true'
python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8001
```

Then, in a **separate terminal** under `frontend/`, point Vite at that port:

```powershell
$env:NODUS_API_PROXY_TARGET = 'http://127.0.0.1:8001'
npm.cmd run dev
```

Verify the real resolver before opening the browser:

```powershell
curl.exe -i -H 'Authorization: Bearer 4' http://127.0.0.1:8001/api/v1/session
curl.exe -i -H 'Authorization: Bearer dev-02-pay' http://127.0.0.1:8001/api/v1/nexus/session
```

If either returns 401, confirm FastAPI inherited demo mode and the governance
tables were populated. A ZIP or an empty PostgreSQL container does not by
itself import the 7A–7E identities and grants.

## Authorization and workspace context

The frontend uses these existing GET endpoints with an Authorization bearer
header and no cached responses:

- /api/v1/session: subject, tenant_id, permissions.
- /api/v1/nexus/session: employee_id, display_name, role_code, company_id,
  project_ids, source_ids, capabilities.

The fixed company display name comes from src/auth/company.ts, matching
nexus_src/7A/NEXUS_Stage_7A/company.json. It is displayed only after the
server confirms that company and a matching identity. The server's project_ids
are assignment IDs; no project display-name catalog or company-wide admin
project list is inferred. A missing/empty scope never unlocks other projects.
Access actions require the corresponding server capability, and admin review
also requires the server's ADMIN role and permission.

Each project switch re-resolves both session endpoints, removes the prior
objective immediately and aborts the old project scope. Future project requests
must use the new scope's projectId and signal. There is no project data cache.
Access-management actions currently open informational panels; no requests,
approvals or investigations are submitted.

The NEXUS session route requires the existing server-side demo mode and
imported PostgreSQL governance identities, roles and project assignments.
Database availability alone does not populate those records. This frontend
does not seed identities, enable demo mode, or map token values to roles.

## Checks

```powershell
npm.cmd run lint
npm.cmd run build
npm.cmd test
npm.cmd run test:e2e
```

Component/API tests and access.spec.ts use test-only mocks. For a real
FastAPI authorization check with no interception:

```powershell
$env:NODUS_LIVE_AUTH = '1'
npm.cmd run test:e2e -- live-authorization.spec.ts
```

This attempts token 4. If FastAPI rejects it, the diagnostic verifies that the
page remains locked and records that success is blocked. It does not count
rejection as proof of successful authorization. To require a successful flow,
supply a valid locally configured credential in NODUS_LIVE_TOKEN using your
local environment; do not commit it. The live test never creates credentials.

Production hosting must route /api to FastAPI on the same origin. The Vite
development proxy is not a production deployment configuration.
