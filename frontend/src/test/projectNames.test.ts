import { expect, it } from "vitest";
import { projectLabel } from "../workspace/projectNames";

it.each([
  ["NEX-PRJ-PAY", "Payment"],
  ["NEX-PRJ-COM", "Commerce"],
  ["NEX-PRJ-ID", "Identity"],
  ["NEX-PRJ-DATA", "Data"],
])("displays %s as %s", (id, name) => {
  expect(projectLabel(id, id)).toBe(name);
});

it("uses existing metadata or the identifier for unknown projects", () => {
  expect(projectLabel("custom", "Custom project")).toBe("Custom project");
  expect(projectLabel("custom")).toBe("custom");
  expect(projectLabel("custom", "  ")).toBe("custom");
});
