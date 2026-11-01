import { describe, expect, it } from "vitest";
import {
  sourceDisplayName,
  sourceLabel,
  sourceReferenceLabel,
} from "../workspace/sourceNames";
describe("source display names preserve technical identifiers", () => {
  it.each([
    ["NEX-SRC-ARCHITECTURE_DECISIONS", "Architecture Decisions"],
    ["NEX-SRC-COMPANY_FOUNDATION", "Company Foundation"],
    ["NEX-SRC-INTERFACE_REGISTRY", "Interface Registry"],
    ["NEX-SRC-KNOWLEDGE_HUB", "Knowledge Hub"],
    ["NEX-SRC-SERVICE_CATALOG", "Service Catalog"],
    ["NEX-SRC-SECURITY_POLICIES", "Security Policies"],
    ["NEX-SRC-API_SECURITY-SSO", "API Security SSO"],
    ["SRC-HTTP_API", "HTTP API"],
    ["source-a", "Source A"],
    ["NODUS-SRC-github_ci_cd", "GitHub CI CD"],
  ])("formats %s", (id, expected) =>
    expect(sourceDisplayName(id)).toBe(expected),
  );
  it("prefers usable authoritative metadata before mappings or fallbacks", () => {
    expect(
      sourceDisplayName("NEX-SRC-SERVICE_CATALOG", {
        display_name: "Engineering Services",
        name: "Catalog",
      }),
    ).toBe("Engineering Services");
    expect(
      sourceDisplayName("NEX-SRC-SERVICE_CATALOG", {
        display_name: " ",
        name: "Our Services",
      }),
    ).toBe("Our Services");
    expect(
      sourceDisplayName("NEX-SRC-SERVICE_CATALOG", {
        name: "NEX-SRC-SERVICE_CATALOG",
      }),
    ).toBe("Service Catalog");
  });
  it.each([undefined, null, {}, 42, { name: false }, { name: [] }])(
    "handles missing or unexpected metadata: %j",
    (metadata) => {
      expect(sourceDisplayName("NEX-SRC-SECURITY_POLICIES", metadata)).toBe(
        "Security Policies",
      );
    },
  );
  it.each([undefined, null, "", 42])("handles missing identifiers: %j", (id) =>
    expect(sourceDisplayName(id)).toBe("Unnamed source"),
  );
  it("treats unexpected object property names as identifiers", () =>
    expect(sourceDisplayName("__proto__")).toBe("Proto"));
  it("disambiguates duplicate display names without changing IDs or catalog records", () => {
    const catalog = Object.freeze([
      Object.freeze({ source_id: "first", name: "Service Catalog" }),
      Object.freeze({ source_id: "second", name: "Service Catalog" }),
    ]);
    expect(sourceLabel("first", catalog)).toBe("Service Catalog (first)");
    expect(sourceLabel("second", catalog)).toBe("Service Catalog (second)");
    expect(catalog.map((s) => s.source_id)).toEqual(["first", "second"]);
  });
  it("formats references using the longest authorized source match, preserving the record portion", () => {
    const catalog = [
      { source_id: "source", name: "Base" },
      { source_id: "source:extended", name: "Extended" },
    ];
    expect(sourceReferenceLabel("source:extended:record:1", catalog)).toBe(
      "Extended:record:1",
    );
    expect(sourceReferenceLabel("NEX-SRC-SERVICE_CATALOG:record/1", [])).toBe(
      "Service Catalog:record/1",
    );
    expect(sourceReferenceLabel("opaque-record", [])).toBe("opaque-record");
    expect(sourceReferenceLabel("source-b:record:1", [])).toBe("Source B:record:1");
    expect(sourceReferenceLabel("https://example.test/record", [])).toBe("https://example.test/record");
  });
});
