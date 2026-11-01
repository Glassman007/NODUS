export interface SourceMetadata {
  source_id: string;
  display_name?: unknown;
  name?: unknown;
  title?: unknown;
  description?: unknown;
  owner_project_id?: string;
  classification?: string;
  [key: string]: unknown;
}
const knownNames: Readonly<Record<string, string>> = {
  "NEX-SRC-ARCHITECTURE_DECISIONS": "Architecture Decisions",
  "NEX-SRC-COMPANY_FOUNDATION": "Company Foundation",
  "NEX-SRC-INTERFACE_REGISTRY": "Interface Registry",
  "NEX-SRC-KNOWLEDGE_HUB": "Knowledge Hub",
  "NEX-SRC-SERVICE_CATALOG": "Service Catalog",
};
const acronyms: Readonly<Record<string, string>> = Object.fromEntries(
  [
    "API",
    "APIs",
    "UI",
    "UX",
    "HTTP",
    "HTTPS",
    "SQL",
    "SSO",
    "SDK",
    "CI",
    "CD",
    "DB",
    "REST",
    "SLA",
    "SRE",
    "AWS",
    "GCP",
    "JWT",
    "DNS",
    "URL",
    "OAuth",
    "GitHub",
    "PostgreSQL",
  ].map((word) => [word.toUpperCase(), word]),
);

/** Display only: never use the result as a request parameter or record key. */
export function sourceDisplayName(id: unknown, metadata?: unknown): string {
  const sourceId = typeof id === "string" ? id.trim() : "";
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const record = metadata as Record<string, unknown>;
    for (const key of ["display_name", "name", "title"]) {
      const value = record[key];
      if (
        typeof value === "string" &&
        value.trim() &&
        value.trim() !== sourceId
      )
        return value.trim();
    }
  }
  if (!sourceId) return "Unnamed source";
  if (Object.hasOwn(knownNames, sourceId)) return knownNames[sourceId];
  const words = sourceId
    .replace(/^(?:NEX[-_]SRC[-_]|NODUS[-_]SRC[-_]|SRC[-_])/i, "")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .split(/[\s_.-]+/)
    .filter(Boolean);
  return (
    words
      .map(
        (word) =>
          acronyms[word.toUpperCase()] ??
          word[0].toUpperCase() + word.slice(1).toLowerCase(),
      )
      .join(" ") || "Unnamed source"
  );
}

/** Disambiguate only collisions in the currently authorized catalog. */
export function sourceLabel(
  id: string,
  catalog: readonly SourceMetadata[],
): string {
  const name = sourceDisplayName(
    id,
    catalog.find((source) => source.source_id === id),
  );
  const duplicates = new Set(
    catalog
      .filter(
        (source) =>
          sourceDisplayName(source.source_id, source).toLocaleLowerCase() ===
          name.toLocaleLowerCase(),
      )
      .map((source) => source.source_id),
  );
  return duplicates.size > 1 ? `${name} (${id})` : name;
}

export function sourceReferenceLabel(
  reference: string,
  catalog: readonly SourceMetadata[],
): string {
  // Longest match prevents a short source ID from consuming another ID's prefix.
  const id = catalog
    .map((source) => source.source_id)
    .sort((a, b) => b.length - a.length)
    .find(
      (sourceId) =>
        reference === sourceId ||
        [":", "/", "#"].some((separator) =>
          reference.startsWith(sourceId + separator),
        ),
    );
  if (id) return sourceLabel(id, catalog) + reference.slice(id.length);
  const match = reference.match(/^(NEX[-_]SRC[-_][^:/#]+)(.*)$/i);
  if (match) return sourceDisplayName(match[1]) + match[2];
  // The evidence API emits source_id:record_id. Keep URLs and opaque refs intact.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(reference)) {
    const separator = reference.indexOf(':');
    if (separator > 0) return sourceDisplayName(reference.slice(0, separator)) + reference.slice(separator);
  }
  return reference;
}
