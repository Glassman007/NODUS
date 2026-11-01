import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { ReportMarkdown } from "../components/ReportMarkdown";
it("renders GFM structure without enabling model HTML, remote images or unsafe links", () => {
  const { container } = render(
    <ReportMarkdown
      text={
        "## Service overview\n\n**Order API** uses `orders-v2`.\n\n| Service | Type |\n| --- | --- |\n| Order API | Service |\n\n- Parent\n  - Child\n\n<script>window.bad = true</script>\n\n[unsafe](javascript:alert(1))\n\n![remote](https://untrusted.example/track.png)"
      }
    />,
  );
  expect(
    screen.getByRole("heading", { name: "Service overview" }),
  ).toBeVisible();
  expect(container.querySelector("strong")).toHaveTextContent("Order API");
  expect(container.querySelector("table")).toBeInTheDocument();
  expect(container.querySelector("code")).toHaveTextContent("orders-v2");
  expect(container.querySelector("script")).toBeNull();
  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector('a[href^="javascript"]')).toBeNull();
});
