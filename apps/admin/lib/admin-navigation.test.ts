import { describe, expect, it } from "vitest";
import { getBreadcrumbsForPathname, getPageForPathname, getSectionForPathname, isActivePath } from "./admin-navigation";

describe("admin navigation registry", () => {
  it("matches the longest child route", () => {
    expect(getPageForPathname("/analytics/product").href).toBe("/analytics/product");
    expect(getSectionForPathname("/analytics/product").key).toBe("analytics");
  });

  it("handles root paths without false positives", () => {
    expect(isActivePath("/", "/")).toBe(true);
    expect(isActivePath("/analytics", "/")).toBe(false);
  });

  it("builds breadcrumbs from section and page metadata", () => {
    expect(getBreadcrumbsForPathname("/system/request-trace")).toEqual([
      { label: "System", href: "/system" },
      { label: "Request Trace", href: "/system/request-trace" },
    ]);
  });

  it("registers boards as a first-class section", () => {
    expect(getPageForPathname("/boards/operations").href).toBe("/boards/operations");
    expect(getSectionForPathname("/boards/operations").key).toBe("boards");
  });
});
