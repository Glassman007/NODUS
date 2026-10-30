# UI Routes

- `/anomalies` — observed incidents and graph-inferred findings
- `/organization` — entity search and category browsing
- `/situations`
- `/situations/:situationId`
- `/investigations`
- `/investigations/:investigationId`
- `/knowledge`
- `/claims/:claimId`
- `/evidence/:evidenceId`
- `/decisions`
- `/decisions/:decisionId`
- `/entities/:entityId`
- `/company-brain` — processes, risk analysis, and `tab=simulations` for counterfactuals
- `/anomalies`
- `/sources`, `/sources/new`, `/sources/runs`, `/sources/runs/:runId`, `/sources/identity-review`, `/sources/:sourceId`, `/sources/:sourceId/mapping`

Query parameters are used for reproducible tabs and temporal/filter state, for example:

- `/company-brain?tab=bus-factor`
- `/entities/SYS-PRICING-API?tab=blast-radius&depth=3`
- `/situations/INC-001?tab=timeline&as_of=...`

