import { expect, test } from "@playwright/test";

test.describe("admin smoke", () => {
  test.skip(!process.env["ADMIN_E2E_BASE_URL"], "Set ADMIN_E2E_BASE_URL to run authenticated admin smoke tests.");

  for (const route of ["/", "/analytics", "/llm", "/content", "/operations", "/system"]) {
    test(`section root responds: ${route}`, async ({ page }) => {
      const response = await page.goto(route, { waitUntil: "domcontentloaded" });
      expect(response?.ok()).toBeTruthy();
    });
  }

  for (const route of ["/analytics/llm", "/analytics/content", "/analytics/pipelines", "/analytics/product"]) {
    test(`analytics leaf responds: ${route}`, async ({ page }) => {
      const response = await page.goto(route, { waitUntil: "domcontentloaded" });
      expect(response?.ok()).toBeTruthy();
    });
  }

  for (const route of ["/dashboard", "/model-usage", "/pipeline-health", "/simulation-recipe"]) {
    test(`legacy route 404s: ${route}`, async ({ page }) => {
      const response = await page.goto(route, { waitUntil: "domcontentloaded" });
      expect(response?.status()).toBe(404);
    });
  }
});
