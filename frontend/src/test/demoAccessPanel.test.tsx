import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DemoAccessPanel } from "../components/DemoAccessPanel";

const items = [
  { token: "4", display_name: "Leena Vardhan", role_code: "ADMIN", project_id: null },
  { token: "dev-02-pay", display_name: "Arav Mehta", role_code: "DEVELOPER", project_id: "NEX-PRJ-PAY" },
  { token: "intern-10-com", display_name: "Anika Bose", role_code: "INTERN", project_id: "NEX-PRJ-COM" },
];

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ items }), { status: 200 })),
  );
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } });
});
afterEach(() => vi.unstubAllGlobals());

it("renders demo identity cards and copies the token into the parent", async () => {
  const onUseToken = vi.fn();
  render(<DemoAccessPanel onUseToken={onUseToken} />);
  expect(await screen.findByText("Arav Mehta")).toBeVisible();
  expect(screen.getByText("Leena Vardhan")).toBeVisible();
  expect(screen.getByText("Anika Bose")).toBeVisible();

  const user = userEvent.setup();
  const copyButtons = screen.getAllByRole("button", { name: "Copy Token" });
  await user.click(copyButtons[1]);

  expect(onUseToken).toHaveBeenCalledWith("dev-02-pay");
  await waitFor(() =>
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("dev-02-pay"),
  );
  expect(await screen.findByText("Copied")).toBeVisible();
});

it("renders nothing when demo mode is disabled", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("", { status: 404 })),
  );
  const { container } = render(<DemoAccessPanel onUseToken={vi.fn()} />);
  await waitFor(() => expect(container).toBeEmptyDOMElement());
});
