export interface InvestigationScenario {
  id: string;
  role: "ADMIN" | "DEVELOPER" | "INTERN";
  /** Only shown when the active project matches, or undefined for role-wide (e.g. Admin). */
  projectId?: string;
  title: string;
  oneLiner: string;
  requiredSourceIds: string[];
  objective: string;
}

const SHARED = [
  "NEX-SRC-SERVICE_CATALOG",
  "NEX-SRC-INTERFACE_REGISTRY",
  "NEX-SRC-ARCHITECTURE_DECISIONS",
];

export const INVESTIGATION_SCENARIOS: readonly InvestigationScenario[] = [
  {
    id: "admin-auth-api-change-impact",
    role: "ADMIN",
    title: "Authentication API Change Impact",
    oneLiner:
      "A change to the Identity authentication interface could unexpectedly disrupt checkout and payment operations.",
    requiredSourceIds: [...SHARED, "NEX-SRC-PAY-REPO", "NEX-SRC-PAY-ISSUES"],
    objective:
      "Investigate the organizational and technical impact of removing the user_id field from the Identity authentication API response. Trace the relationships between Identity, Commerce, and Payment services. Identify downstream dependencies, potentially affected interfaces, implementation risks, and responsible teams. Support conclusions with available source evidence and explicitly identify anything that cannot be verified.",
  },
  {
    id: "developer-duplicate-payment-prevention",
    role: "DEVELOPER",
    projectId: "NEX-PRJ-PAY",
    title: "Duplicate Payment Prevention",
    oneLiner:
      "Changes to Payment retry handling could cause duplicate transaction execution.",
    requiredSourceIds: [...SHARED, "NEX-SRC-PAY-REPO", "NEX-SRC-PAY-ISSUES"],
    objective:
      "Investigate whether changes to Payment retry handling could cause duplicate transaction execution. Trace relevant service dependencies, payment interfaces, implementation records, and issue history. Identify potential idempotency weaknesses, downstream consumers, unresolved blockers, and tests that should be considered before deployment. Distinguish verified relationships from possible risks.",
  },
  {
    id: "intern-checkout-dependencies",
    role: "INTERN",
    projectId: "NEX-PRJ-COM",
    title: "Understanding Checkout Dependencies",
    oneLiner:
      "Explains which services, interfaces, and architectural decisions Commerce checkout depends on.",
    requiredSourceIds: [...SHARED],
    objective:
      "Investigate the Commerce checkout system and explain which services, interfaces, and architectural decisions it depends on. Trace the available relationships, identify any important external dependencies, and explain the findings in simple technical language. Use only sources that I am authorized to access and distinguish confirmed relationships from missing information.",
  },
];

export function scenariosForContext(
  role: "ADMIN" | "DEVELOPER" | "INTERN",
  projectId: string | undefined,
): InvestigationScenario[] {
  return INVESTIGATION_SCENARIOS.filter(
    (scenario) =>
      scenario.role === role && (!scenario.projectId || scenario.projectId === projectId),
  );
}
